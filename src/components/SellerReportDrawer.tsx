import { useMemo, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useStore } from "@/context/StoreContext";
import { computeSellerCommission, getTierForUnits, COMMISSION_TIERS } from "@/lib/commissions";
import { formatDateBR } from "@/lib/date-utils";
import { cn } from "@/lib/utils";
import {
  startOfDay, endOfDay, startOfMonth, endOfMonth, subDays, subMonths,
  isWithinInterval, parseISO, format,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { MessageCircle, ArrowUpCircle, ArrowDownCircle, Package, Boxes } from "lucide-react";
import type { Sale } from "@/types";

type PeriodKey = "today" | "7d" | "month" | "lastMonth" | "custom";

function fmt(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v || 0);
}

function computeAccrualAdjustments(sales: Sale[]) {
  const sorted = [...sales].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const out: { id: string; when: string; label: string; amount: number }[] = [];
  let cumUnits = 0; let cumRevenue = 0; let currentRate = COMMISSION_TIERS[0].rate;
  for (const s of sorted) {
    const priorRevenue = cumRevenue;
    cumUnits += s.quantity; cumRevenue += s.totalPrice;
    const tierAfter = getTierForUnits(cumUnits);
    if (tierAfter.rate > currentRate) {
      const adj = priorRevenue * (tierAfter.rate - currentRate);
      if (adj > 0.001) out.push({ id: `adj-${s.id}`, when: s.date, label: `Ajuste de faixa → ${tierAfter.label}`, amount: adj });
      currentRate = tierAfter.rate;
    }
  }
  return out;
}

export default function SellerReportDrawer({
  sellerId, open, onClose,
}: { sellerId: string | null; open: boolean; onClose: () => void }) {
  const { sellers, sales, commissionPayments, sellerDebtPayments, sellerManualDebts, productAssignments, products, getProductName } = useStore();
  const LEGACY_CUTOFF = new Date(2026, 5, 1);
  const isLegacy = (iso: string) => { try { return parseISO(iso) < LEGACY_CUTOFF; } catch { return false; } };
  const [periodKey, setPeriodKey] = useState<PeriodKey>("month");
  const [customStart, setCustomStart] = useState(format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [customEnd, setCustomEnd] = useState(format(new Date(), "yyyy-MM-dd"));

  const seller = sellers.find(s => s.id === sellerId);

  const { start, end, label } = useMemo(() => {
    const now = new Date();
    let s: Date, e: Date, l: string;
    const safeParse = (v: string, fallback: Date) => {
      try {
        const d = parseISO(v);
        return isNaN(d.getTime()) ? fallback : d;
      } catch { return fallback; }
    };
    switch (periodKey) {
      case "today":
        s = startOfDay(now); e = endOfDay(now); l = `Hoje · ${format(now, "dd/MM/yyyy")}`; break;
      case "7d":
        s = startOfDay(subDays(now, 6)); e = endOfDay(now); l = `Últimos 7 dias`; break;
      case "lastMonth": {
        const lm = subMonths(now, 1);
        s = startOfMonth(lm); e = endOfMonth(lm); l = format(lm, "MMMM/yyyy", { locale: ptBR });
        break;
      }
      case "custom":
        s = startOfDay(safeParse(customStart, startOfMonth(now)));
        e = endOfDay(safeParse(customEnd, now));
        l = `${format(s, "dd/MM/yy")} – ${format(e, "dd/MM/yy")}`; break;
      case "month":
      default:
        s = startOfMonth(now); e = endOfMonth(now); l = format(now, "MMMM/yyyy", { locale: ptBR }); break;
    }
    return { start: s, end: e, label: l };
  }, [periodKey, customStart, customEnd]);

  const inPeriod = (iso: string) => {
    try { return isWithinInterval(parseISO(iso), { start, end }); } catch { return false; }
  };

  const report = useMemo(() => {
    if (!seller) return null;
    const sellerSalesPeriod = sales.filter(s => s.sellerId === seller.id && inPeriod(s.date));
    const vendas = sellerSalesPeriod.filter(s => s.type === "venda");
    const retiradas = sellerSalesPeriod.filter(s => s.type === "retirada_funcionario");
    const units = vendas.reduce((a, s) => a + s.quantity, 0);
    const revenue = vendas.reduce((a, s) => a + s.totalPrice, 0);
    const received = vendas.reduce((a, s) => a + (s.paidAmount || 0), 0);
    const open = Math.max(0, revenue - received);

    // === Consumo TOTAL (todas as datas) — retiradas + dívidas manuais ===
    const allSellerSales = sales.filter(s => s.sellerId === seller.id);
    const allRetiradas = allSellerSales.filter(s => s.type === "retirada_funcionario");
    const allManualDebts = sellerManualDebts.filter(d => d.sellerId === seller.id);
    const allDebtPayments = sellerDebtPayments.filter(p => p.sellerId === seller.id);

    const retiradasTotal = allRetiradas.reduce((a, s) => a + s.totalPrice, 0);
    const manualDebtsTotal = allManualDebts.reduce((a, d) => a + d.amount, 0);
    const consumoTotal = retiradasTotal + manualDebtsTotal;
    const debtPaymentsTotal = allDebtPayments.reduce((a, p) => a + p.amount, 0);

    // Crédito legado: vendas pré-jun/26 × 10% (só abate consumo)
    const legacySalesRevenue = allSellerSales
      .filter(s => s.type === "venda" && isLegacy(s.date))
      .reduce((a, s) => a + s.totalPrice, 0);
    const legacyCredit = legacySalesRevenue * 0.10;

    const saldoConsumo = Math.max(0, consumoTotal - debtPaymentsTotal - legacyCredit);

    // Consumo do PERÍODO (para breakdown da mensagem)
    const consumo = retiradas.reduce((a, s) => a + s.totalPrice, 0);
    const consumoUnits = retiradas.reduce((a, s) => a + s.quantity, 0);
    const consumoMap = new Map<string, { name: string; qty: number; total: number }>();
    retiradas.forEach(s => {
      const cur = consumoMap.get(s.productId) || { name: getProductName(s.productId), qty: 0, total: 0 };
      cur.qty += s.quantity; cur.total += s.totalPrice;
      consumoMap.set(s.productId, cur);
    });
    const consumoBreakdown = Array.from(consumoMap.values()).sort((a, b) => b.total - a.total);

    // Sales detail (chronological) + marginal commission per sale
    const vendasChrono = [...vendas].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    let runningUnits = 0; let runningRevenue = 0; let runningAccrued = 0;
    const saleCommission = new Map<string, number>();
    vendasChrono.forEach(s => {
      runningUnits += s.quantity; runningRevenue += s.totalPrice;
      const tier = getTierForUnits(runningUnits);
      const newAccrued = runningRevenue * tier.rate;
      saleCommission.set(s.id, Math.max(0, newAccrued - runningAccrued));
      runningAccrued = newAccrued;
    });
    const salesDetail = vendasChrono.map(s => {
      const op = Math.max(0, s.totalPrice - (s.paidAmount || 0));
      return {
        id: s.id, when: s.date, qty: s.quantity, total: s.totalPrice,
        name: getProductName(s.productId), open: op, paid: op < 0.01,
        commission: saleCommission.get(s.id) || 0,
      };
    });

    // Current stock assigned to seller
    const stockItems = productAssignments
      .filter(a => a.sellerId === seller.id && a.quantity > 0)
      .map(a => {
        const p = products.find(pp => pp.id === a.productId);
        return { id: a.id, name: getProductName(a.productId), qty: a.quantity, brand: p?.brand || "" };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    const stockTotalUnits = stockItems.reduce((acc, i) => acc + i.qty, 0);

    const c = computeSellerCommission(vendas);
    const adjustments = computeAccrualAdjustments(vendas);
    const commPaidPeriod = commissionPayments
      .filter(p => p.sellerId === seller.id && inPeriod(p.date))
      .reduce((a, p) => a + p.amount, 0);
    // Saldo de comissão = acumulada no período − saldo de consumo (total) − comissão paga no período
    const commBalance = c.accrued - saldoConsumo - commPaidPeriod;

    type Mov =
      | { kind: "venda"; when: string; label: string; amount: number; sub: string }
      | { kind: "retirada"; when: string; label: string; amount: number; sub: string }
      | { kind: "pagamento"; when: string; label: string; amount: number; sub?: string }
      | { kind: "ajuste"; when: string; label: string; amount: number; sub?: string };

    const movs: Mov[] = [];
    vendas.forEach(s => {
      const op = Math.max(0, s.totalPrice - (s.paidAmount || 0));
      const comm = saleCommission.get(s.id) || 0;
      movs.push({
        kind: "venda", when: s.date,
        label: `${s.quantity}x ${getProductName(s.productId)}`,
        amount: comm,
        sub: `Venda ${fmt(s.totalPrice)} · Recebido ${fmt(s.paidAmount || 0)} · Em aberto ${fmt(op)}`,
      });
    });

    retiradas.forEach(s => {
      movs.push({
        kind: "retirada", when: s.date,
        label: `Retirada: ${s.quantity}x ${getProductName(s.productId)}`,
        amount: s.totalPrice, sub: s.notes || "",
      });
    });
    allManualDebts.filter(d => inPeriod(d.date)).forEach(d => {
      movs.push({ kind: "retirada", when: d.date, label: "Dívida manual", amount: d.amount, sub: d.notes || "" });
    });
    allDebtPayments.filter(p => inPeriod(p.date)).forEach(p => {
      movs.push({ kind: "pagamento", when: p.date, label: "Pagamento de dívida", amount: p.amount, sub: p.notes });
    });
    commissionPayments.filter(p => p.sellerId === seller.id && inPeriod(p.date)).forEach(p => {
      movs.push({ kind: "pagamento", when: p.date, label: "Pagamento de comissão", amount: p.amount, sub: p.notes });
    });
    adjustments.forEach(a => movs.push({ kind: "ajuste", when: a.when, label: a.label, amount: a.amount }));
    movs.sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime());

    return {
      units, revenue, received, open, consumo, consumoUnits, consumoBreakdown,
      salesDetail, stockItems, stockTotalUnits,
      tier: c.tier, accrued: c.accrued, commPaidPeriod, commBalance, movs,
      consumoTotal, debtPaymentsTotal, legacyCredit, saldoConsumo,
    };
  }, [seller, sales, commissionPayments, sellerDebtPayments, sellerManualDebts, productAssignments, products, start, end, getProductName]);

  if (!seller || !report) {
    return (
      <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
        <SheetContent className="w-full sm:max-w-lg" />
      </Sheet>
    );
  }

  /* ---------- Export: WhatsApp ---------- */
  const buildWhatsSales = () => {
    const lines: string[] = [];
    lines.push(`📊 Relatório de ${label}`);
    lines.push(``);
    lines.push(`👤 Funcionário: ${seller.name}`);
    lines.push(``);
    lines.push(`💰 COMISSÃO`);
    lines.push(`• Faixa atual: ${report.tier.label}`);
    lines.push(`• Comissão gerada no período: ${fmt(report.accrued)}`);
    if (report.legacyCredit > 0) {
      lines.push(`• Crédito legado (10% s/ vendas anteriores): ${fmt(report.legacyCredit)} — abate apenas consumo`);
    }
    lines.push(`• Consumo total (inclui legado e dívidas): ${fmt(report.consumoTotal)}`);
    lines.push(`• Pagamentos de dívida: ${fmt(report.debtPaymentsTotal)}`);
    lines.push(`• Saldo de consumo a abater: ${fmt(report.saldoConsumo)}`);
    lines.push(`• Comissão paga: ${fmt(report.commPaidPeriod)}`);
    lines.push(`• Saldo disponível: ${fmt(report.commBalance)}`);
    lines.push(``);
    lines.push(`🍃 CONSUMO`);
    lines.push(`Total consumido: ${fmt(report.consumo)}`);
    if (report.consumoBreakdown.length) {
      lines.push(``);
      lines.push(`Produtos consumidos:`);
      report.consumoBreakdown.forEach(c => {
        lines.push(`• ${c.name} (${c.qty}x) • ${fmt(c.total)}`);
      });
    }

    const openSales = report.salesDetail.filter(s => !s.paid);
    const paidSales = report.salesDetail.filter(s => s.paid);

    lines.push(``);
    lines.push(`⏳ VENDAS EM ABERTO`);
    lines.push(`Total em aberto: ${fmt(report.open)}`);
    if (openSales.length) {
      lines.push(``);
      openSales.forEach(s => {
        const dt = format(parseISO(s.when), "dd/MM");
        lines.push(`• ${dt} • ${s.name} • ${fmt(s.total)}`);
      });
    }

    lines.push(``);
    lines.push(`✅ VENDAS RECEBIDAS`);
    lines.push(`• Unidades vendidas: ${report.units}`);
    if (paidSales.length) {
      lines.push(``);
      lines.push(`Vendas recebidas:`);
      paidSales.forEach(s => {
        const dt = format(parseISO(s.when), "dd/MM");
        lines.push(`• ${dt} • ${s.name}`);
      });
    }

    return lines.join("\n");
  };

  const buildWhatsStock = () => {
    const lines: string[] = [];
    lines.push(`📦 Estoque Atual — ${seller.name}`);
    lines.push(``);
    if (report.stockItems.length === 0) {
      lines.push(`Total em estoque: 0 unidades`);
      lines.push(`• Sem produtos em posse`);
    } else {
      lines.push(`Total em estoque: ${report.stockTotalUnits} unidades`);
      lines.push(``);
      report.stockItems.forEach(s => {
        lines.push(`• ${s.name} (${s.qty}x)`);
      });
    }
    return lines.join("\n");
  };

  const shareWhatsSales = () => {
    window.open(`https://wa.me/?text=${encodeURIComponent(buildWhatsSales())}`, "_blank");
  };
  const shareWhatsStock = () => {
    window.open(`https://wa.me/?text=${encodeURIComponent(buildWhatsStock())}`, "_blank");
  };


  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Relatório do Funcionário</SheetTitle>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          {/* Period filter */}
          <div className="space-y-2">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Período</Label>
            <Select value={periodKey} onValueChange={(v: PeriodKey) => setPeriodKey(v)}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="today">Hoje</SelectItem>
                <SelectItem value="7d">Últimos 7 dias</SelectItem>
                <SelectItem value="month">Este mês</SelectItem>
                <SelectItem value="lastMonth">Mês passado</SelectItem>
                <SelectItem value="custom">Personalizado</SelectItem>
              </SelectContent>
            </Select>
            {periodKey === "custom" && (
              <div className="grid grid-cols-2 gap-2">
                <div><Label className="text-[10px]">Início</Label><Input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} className="h-9" /></div>
                <div><Label className="text-[10px]">Fim</Label><Input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} className="h-9" /></div>
              </div>
            )}
          </div>

          {/* Identity */}
          <div className="rounded-lg bg-secondary/50 p-3">
            <p className="text-sm font-semibold">{seller.name}</p>
            <p className="text-[11px] text-muted-foreground">{label} · faixa {report.tier.label}</p>
          </div>

          {/* Summary grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <Stat label="Unidades" value={String(report.units)} />
            <Stat label="Faturamento" value={fmt(report.revenue)} tone="income" />
            <Stat label="Em aberto" value={fmt(report.open)} tone="warning" />
            <Stat label="Consumo" value={fmt(report.consumo)} tone="warning" />
            <Stat label="Comissão" value={fmt(report.accrued)} tone="income" />
            <Stat label="Paga" value={fmt(report.commPaidPeriod)} tone="warning" />
            <Stat label="Saldo" value={fmt(report.commBalance)} strong
              tone={report.commBalance >= 0 ? "income" : "expense"} />
            <Stat label="Estoque" value={`${report.stockTotalUnits} un.`} />
          </div>

          {/* Commission calc note */}
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            <span className="font-semibold text-foreground">Saldo:</span>{" "}
            {fmt(report.accrued)} − {fmt(report.saldoConsumo)} (consumo a abater) − {fmt(report.commPaidPeriod)} (pagamentos) ={" "}
            <span className={cn(report.commBalance >= 0 ? "text-income" : "text-expense", "font-semibold")}>{fmt(report.commBalance)}</span>
            {report.legacyCredit > 0 && (
              <> · Crédito legado de <span className="font-semibold">{fmt(report.legacyCredit)}</span> abate apenas consumo.</>
            )}
          </p>


          {/* Export */}
          <div className="grid grid-cols-2 gap-2">
            <Button size="sm" className="h-10 w-full bg-green-600 hover:bg-green-700 text-white" onClick={shareWhatsSales}>
              <MessageCircle size={16} className="mr-2" /> WhatsApp — Vendas
            </Button>
            <Button size="sm" className="h-10 w-full bg-green-700 hover:bg-green-800 text-white" onClick={shareWhatsStock}>
              <MessageCircle size={16} className="mr-2" /> WhatsApp — Estoque
            </Button>
          </div>


          {/* Consumption breakdown */}
          {report.consumoBreakdown.length > 0 && (
            <div>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Consumo no período</p>
              <div className="space-y-1">
                {report.consumoBreakdown.map((c, i) => (
                  <div key={i} className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{c.name}</p>
                      <p className="text-[11px] text-muted-foreground">Qtd: {c.qty}</p>
                    </div>
                    <span className="mono text-sm font-semibold text-warning">{fmt(c.total)}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between px-3 py-2 text-sm font-semibold">
                  <span>Total consumido</span>
                  <span className="mono text-warning">{fmt(report.consumo)}</span>
                </div>
              </div>
            </div>
          )}

          {/* Current stock */}
          <div>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-2 flex items-center gap-1.5">
              <Boxes size={12} /> Estoque atual do vendedor
            </p>
            {report.stockItems.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">Sem produtos atribuídos.</p>
            ) : (
              <div className="space-y-1">
                {report.stockItems.map((s) => (
                  <div key={s.id} className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2">
                    <p className="text-sm font-medium truncate">{s.name}</p>
                    <span className="mono text-sm font-semibold text-primary">{s.qty}x</span>
                  </div>
                ))}
                <div className="flex items-center justify-between px-3 py-2 text-sm font-semibold">
                  <span>Total em posse</span>
                  <span className="mono text-primary">{report.stockTotalUnits} unidades</span>
                </div>
              </div>
            )}
          </div>

          {/* Movements */}
          <div>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Movimentações</p>
            {report.movs.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">Sem movimentações no período.</p>
            ) : (
              <div className="space-y-1">
                {report.movs.map((m, i) => {
                  const credit = m.kind === "venda" || m.kind === "ajuste";
                  return (
                    <div key={i} className="flex items-center gap-3 rounded-lg border border-border/60 px-3 py-2">
                      <div className={cn(
                        "w-7 h-7 rounded-full flex items-center justify-center shrink-0",
                        m.kind === "venda" && "bg-income/15 text-income",
                        m.kind === "retirada" && "bg-warning/15 text-warning",
                        m.kind === "pagamento" && "bg-fixed/15 text-fixed",
                        m.kind === "ajuste" && "bg-primary/15 text-primary",
                      )}>
                        {m.kind === "retirada" ? <Package size={13} /> :
                          credit ? <ArrowUpCircle size={13} /> : <ArrowDownCircle size={13} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{m.label}</p>
                        <p className="text-[11px] text-muted-foreground truncate">
                          <span className="mono">{formatDateBR(m.when)}</span>
                          {"sub" in m && m.sub ? ` · ${m.sub}` : ""}
                        </p>
                      </div>
                      <span className={cn("mono text-sm font-semibold shrink-0",
                        credit ? "text-income" : "text-warning")}>
                        {credit ? "+" : "−"}{fmt(m.amount)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Stat({ label, value, tone, strong }: { label: string; value: string; tone?: "income" | "warning" | "expense"; strong?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 min-w-0">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn(
        "mt-0.5 text-sm mono truncate",
        strong && "font-bold text-base",
        tone === "income" && "text-income",
        tone === "warning" && "text-warning",
        tone === "expense" && "text-expense",
      )}>{value}</p>
    </div>
  );
}
