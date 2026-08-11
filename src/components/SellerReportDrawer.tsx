import { useEffect, useMemo, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useStore } from "@/context/StoreContext";
import { computeSellerCommission, computeClosedCommission, computePriorCommissionBalance, getTierForUnits, COMMISSION_TIERS } from "@/lib/commissions";
import { formatDateBR } from "@/lib/date-utils";
import { cn } from "@/lib/utils";
import {
  startOfDay, endOfDay, startOfMonth, endOfMonth, subDays, subMonths,
  isWithinInterval, parseISO, format,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { MessageCircle, ArrowUpCircle, ArrowDownCircle, Package, Boxes, Trash2 } from "lucide-react";
import { useConfirm } from "@/components/ConfirmProvider";
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
  sellerId, open, onClose, initialPeriod, initialCustomStart, initialCustomEnd,
}: {
  sellerId: string | null; open: boolean; onClose: () => void;
  initialPeriod?: PeriodKey; initialCustomStart?: string; initialCustomEnd?: string;
}) {
  const { sellers, sales, commissionPayments, sellerDebtPayments, sellerManualDebts, productAssignments, products, getProductName, deleteSellerManualDebt, deleteSellerDebtPayment, deleteCommissionPayment } = useStore();
  const confirm = useConfirm();
  const LEGACY_CUTOFF = new Date(2026, 5, 1);
  const isLegacy = (iso: string) => { try { return parseISO(iso) < LEGACY_CUTOFF; } catch { return false; } };
  const [periodKey, setPeriodKey] = useState<PeriodKey>(initialPeriod ?? "month");
  const [customStart, setCustomStart] = useState(initialCustomStart ?? format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [customEnd, setCustomEnd] = useState(initialCustomEnd ?? format(new Date(), "yyyy-MM-dd"));

  useEffect(() => {
    if (!open) return;
    if (initialPeriod) setPeriodKey(initialPeriod);
    if (initialCustomStart) setCustomStart(initialCustomStart);
    if (initialCustomEnd) setCustomEnd(initialCustomEnd);
  }, [open, initialPeriod, initialCustomStart, initialCustomEnd]);

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

  // O extrato considera os meses FECHADOS tocados pelo período (dia 1 do mês inicial
  // até o último dia do mês final), pois a comissão fecha por mês.
  const closedStart = useMemo(() => new Date(start.getFullYear(), start.getMonth(), 1), [start]);
  const closedEnd = useMemo(() => new Date(end.getFullYear(), end.getMonth() + 1, 0, 23, 59, 59, 999), [end]);
  const inPeriod = (iso: string) => {
    try {
      const d = parseISO(iso);
      return d >= closedStart && d <= closedEnd;
    } catch { return false; }
  };


  const report = useMemo(() => {
    if (!seller) return null;
    const sellerSalesPeriod = sales.filter(s => s.sellerId === seller.id && inPeriod(s.date) && !isLegacy(s.date));
    const vendas = sellerSalesPeriod.filter(s => s.type === "venda");
    const retiradas = sellerSalesPeriod.filter(s => s.type === "retirada_funcionario");
    const units = vendas.reduce((a, s) => a + s.quantity, 0);
    const revenue = vendas.reduce((a, s) => a + s.totalPrice, 0);
    const received = vendas.reduce((a, s) => a + (s.paidAmount || 0), 0);
    const open = Math.max(0, revenue - received);

    // === Consumo / dívidas / pagamentos — APENAS no período ===
    const allManualDebts = sellerManualDebts.filter(d => d.sellerId === seller.id && inPeriod(d.date) && !isLegacy(d.date));
    const allDebtPayments = sellerDebtPayments.filter(p => p.sellerId === seller.id && inPeriod(p.date) && !isLegacy(p.date));

    const retiradasTotal = retiradas.reduce((a, s) => a + s.totalPrice, 0);
    const manualDebtsTotal = allManualDebts.reduce((a, d) => a + d.amount, 0);
    const consumoTotal = retiradasTotal + manualDebtsTotal;
    const debtPaymentsTotal = allDebtPayments.reduce((a, p) => a + p.amount, 0);

    const legacyCredit = 0;
    // Saldo de consumo abate direto da comissão. Pagamentos de dívida no período somam de volta ao saldo (crédito).
    const saldoConsumo = consumoTotal;

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

    // Comissão fecha no último dia do mês: a faixa acumula do dia 1 ao dia 30/31.
    // Em período personalizado, o valor exibido é o FECHADO dos meses tocados.
    const isPaid = (s: (typeof sales)[number]) => (s.paidAmount || 0) >= s.totalPrice - 0.01;
    const vendasPagasTodas = sales
      .filter(s => s.sellerId === seller.id && s.type === "venda" && isPaid(s) && !isLegacy(s.date));
    const closed = computeClosedCommission(vendasPagasTodas, start, end);
    const vendasRecebidasPeriodo = closed.sales;

    const vendasChrono = [...vendas].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const modernVendas = vendasRecebidasPeriodo;
    const modernUnitsTotal = closed.units;
    const finalTier = closed.tier;
    const saleCommission = new Map<string, number>();
    closed.groups.forEach(g => {
      g.sales.forEach(s => saleCommission.set(s.id, s.totalPrice * g.tier.rate));
    });

    const detailSales = [...vendasChrono];
    vendasRecebidasPeriodo.forEach(s => { if (!detailSales.some(d => d.id === s.id)) detailSales.push(s); });
    detailSales.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const salesDetail = detailSales.map(s => {
      const op = Math.max(0, s.totalPrice - (s.paidAmount || 0));
      return {
        id: s.id, when: s.date, qty: s.quantity, total: s.totalPrice,
        name: getProductName(s.productId), open: op, paid: op < 0.01,
        commission: saleCommission.get(s.id) || 0,
        paidAt: s.paidAt,
      };
    });

    // Todas as vendas em aberto do vendedor (independentemente do período)
    const allOpenSales = sales
      .filter(s => s.sellerId === seller.id && s.type === "venda")
      .map(s => {
        const op = Math.max(0, s.totalPrice - (s.paidAmount || 0));
        return {
          id: s.id, when: s.date, qty: s.quantity, total: s.totalPrice,
          name: getProductName(s.productId), open: op, paid: op < 0.01,
          commission: 0,
          paymentMethod: s.paymentMethod,
        };
      })
      .filter(s => !s.paid)
      .sort((a, b) => new Date(a.when).getTime() - new Date(b.when).getTime());
    const allOpenAmount = allOpenSales.reduce((a, s) => a + s.open, 0);

    // Current stock assigned to seller
    const stockItems = productAssignments
      .filter(a => a.sellerId === seller.id && a.quantity > 0)
      .map(a => {
        const p = products.find(pp => pp.id === a.productId);
        return { id: a.id, name: getProductName(a.productId), qty: a.quantity, brand: p?.brand || "" };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    const stockTotalUnits = stockItems.reduce((acc, i) => acc + i.qty, 0);

    const c = { units: closed.units, revenue: closed.revenue, tier: closed.tier, accrued: closed.accrued };
    const adjustments = closed.groups.flatMap(g => computeAccrualAdjustments(g.sales));

    const commPaidPeriod = commissionPayments
      .filter(p => p.sellerId === seller.id && inPeriod(p.date) && !isLegacy(p.date))
      .reduce((a, p) => a + p.amount, 0);

    const previousBalance = computePriorCommissionBalance({
      sellerId: seller.id,
      sales,
      commissionPayments,
      debtPayments: sellerDebtPayments,
      manualDebts: sellerManualDebts,
      historyStart: LEGACY_CUTOFF,
      periodStart: closedStart,
    });

    // Saldo do período + saldo trazido
    const periodBalance = c.accrued - saldoConsumo + debtPaymentsTotal - commPaidPeriod;
    const commBalance = previousBalance + periodBalance;

    type DeletableKind = "manual_debt" | "debt_payment" | "commission_payment";
    type Mov =
      | { kind: "venda"; when: string; label: string; amount: number; sub: string }
      | { kind: "retirada"; when: string; label: string; amount: number; sub: string; source?: { type: DeletableKind; id: string } }
      | { kind: "pagamento"; when: string; label: string; amount: number; sub?: string; source?: { type: DeletableKind; id: string } }
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
      movs.push({ kind: "retirada", when: d.date, label: "Dívida manual", amount: d.amount, sub: d.notes || "", source: { type: "manual_debt", id: d.id } });
    });
    allDebtPayments.filter(p => inPeriod(p.date)).forEach(p => {
      movs.push({ kind: "pagamento", when: p.date, label: "Pagamento de dívida", amount: p.amount, sub: p.notes, source: { type: "debt_payment", id: p.id } });
    });
    commissionPayments.filter(p => p.sellerId === seller.id && inPeriod(p.date)).forEach(p => {
      movs.push({ kind: "pagamento", when: p.date, label: "Pagamento de comissão", amount: p.amount, sub: p.notes, source: { type: "commission_payment", id: p.id } });
    });
    adjustments.forEach(a => movs.push({ kind: "ajuste", when: a.when, label: a.label, amount: a.amount }));
    movs.sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime());

    return {
      units, revenue, received, open, consumo, consumoUnits, consumoBreakdown,
      salesDetail, stockItems, stockTotalUnits,
      tier: c.tier, accrued: c.accrued, commPaidPeriod, commBalance, movs,
      consumoTotal, debtPaymentsTotal, legacyCredit, saldoConsumo,
      allOpenSales, allOpenAmount,
      previousBalance, periodBalance,
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
    lines.push(`💰 COMISSÃO — ${label}`);
    lines.push(`• Faixa: ${report.tier.label} (${report.units} un.)`);
    lines.push(`• Saldo anterior: ${fmt(report.previousBalance)}`);
    lines.push(`• Comissão gerada: ${fmt(report.accrued)}`);
    lines.push(`• (−) Consumo no mês: ${fmt(report.saldoConsumo)}`);
    lines.push(`• (−) Comissão já paga: ${fmt(report.commPaidPeriod)}`);
    if (report.debtPaymentsTotal > 0) {
      lines.push(`• (+) Pagamentos de dívida: ${fmt(report.debtPaymentsTotal)}`);
    }
    lines.push(`──────────────────────────────`);
    lines.push(`• Saldo a receber: ${fmt(report.commBalance)}`);
    if (report.consumoBreakdown.length) {
      lines.push(``);
      lines.push(`🍃 CONSUMO DO MÊS (descontado da comissão)`);
      report.consumoBreakdown.forEach(c => {
        lines.push(`• ${c.name} (${c.qty}x) • ${fmt(c.total)}`);
      });
      lines.push(`Total: ${fmt(report.consumo)}`);
    }

    const paidSales = report.salesDetail.filter(s => s.paid);

    lines.push(``);
    lines.push(`⏳ VENDAS EM ABERTO`);
    lines.push(`Total em aberto: ${fmt(report.allOpenAmount)}`);
    if (report.allOpenSales.length) {
      lines.push(``);
      report.allOpenSales.forEach(s => {
        const dt = format(parseISO(s.when), "dd/MM");
        let pm = "";
        switch (s.paymentMethod) {
          case "pix":
          case "pix_pendente":
            pm = " · Pix"; break;
          case "dinheiro":
          case "dinheiro_pendente":
            pm = " · Dinheiro"; break;
          case "dinheiro_com_vendedor":
            pm = ` · Dinheiro com ${seller.name}`; break;
          case "pendente":
            pm = " · A definir"; break;
          default:
            pm = "";
        }
        lines.push(`• ${dt} • ${s.name} • Em aberto ${fmt(s.open)}${pm}`);
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

          {/* Header: identity + balance */}
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-base font-semibold leading-tight">{seller.name}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {label} · Faixa {report.tier.label}
            </p>
            <div className="mt-3 pt-3 border-t border-border/60">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Saldo atual</p>
              <p className={cn(
                "mono text-2xl font-bold mt-0.5",
                report.commBalance >= 0 ? "text-income" : "text-expense"
              )}>
                {fmt(report.commBalance)}
              </p>
            </div>
          </div>

          {/* Financial summary list */}
          <div className="rounded-lg border border-border/60 bg-secondary/30 px-3 py-2.5 text-[13px] space-y-1.5">
            <SummaryRow label="Saldo anterior" value={fmt(report.previousBalance)} tone={report.previousBalance >= 0 ? "income" : "warning"} sign="+" />
            <SummaryRow label="Comissão gerada" value={fmt(report.accrued)} tone="income" sign="+" />
            <SummaryRow label="Consumo" value={fmt(report.saldoConsumo)} tone={report.saldoConsumo > 0 ? "warning" : "muted"} sign="−" />
            {report.debtPaymentsTotal > 0 && (
              <SummaryRow label="Pagamentos de dívida" value={fmt(report.debtPaymentsTotal)} tone="income" sign="+" />
            )}
            <SummaryRow label="Comissão paga" value={fmt(report.commPaidPeriod)} tone={report.commPaidPeriod > 0 ? "warning" : "muted"} sign="−" />
            <div className="border-t border-border/40 pt-2 mt-1 flex items-center justify-between">
              <span className="font-semibold">Saldo final</span>
              <span className={cn("mono font-bold", report.commBalance >= 0 ? "text-income" : "text-expense")}>
                {fmt(report.commBalance)}
              </span>
            </div>
          </div>

          {/* Actions */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Button size="sm" variant="outline" className="h-10 w-full" onClick={shareWhatsSales}>
              <MessageCircle size={15} className="mr-2" /> Compartilhar Relatório
            </Button>
            <Button size="sm" variant="outline" className="h-10 w-full" onClick={shareWhatsStock}>
              <Boxes size={15} className="mr-2" /> Compartilhar Estoque
            </Button>
          </div>

          {/* Tabs */}
          <Tabs defaultValue="resumo" className="w-full">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="resumo">Resumo</TabsTrigger>
              <TabsTrigger value="consumo">Consumo</TabsTrigger>
              <TabsTrigger value="estoque">Estoque</TabsTrigger>
              <TabsTrigger value="mov">Movim.</TabsTrigger>
            </TabsList>

            {/* Resumo */}
            <TabsContent value="resumo" className="mt-3">
              <div className="rounded-lg border border-border/60 divide-y divide-border/40">
                <KV label="Unidades vendidas" value={String(report.units)} />
                <KV label="Faturamento" value={fmt(report.revenue)} tone="income" />
                <KV label="Valor em aberto" value={fmt(report.open)} tone="warning" />
                <KV label="Faixa atual" value={report.tier.label} />
                <KV label="Comissão acumulada" value={fmt(report.accrued)} tone="income" />
                <KV label="Saldo final" value={fmt(report.commBalance)} tone={report.commBalance >= 0 ? "income" : "expense"} strong />
              </div>
            </TabsContent>

            {/* Consumo */}
            <TabsContent value="consumo" className="mt-3">
              {report.consumoBreakdown.length === 0 ? (
                <p className="text-xs text-muted-foreground py-6 text-center">Sem consumo no período.</p>
              ) : (
                <div className="rounded-lg border border-border/60 divide-y divide-border/40">
                  {report.consumoBreakdown.map((c, i) => (
                    <div key={i} className="flex items-center justify-between px-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{c.name}</p>
                        <p className="text-[11px] text-muted-foreground">Qtd: {c.qty}</p>
                      </div>
                      <span className="mono text-sm font-semibold text-warning shrink-0 ml-2">{fmt(c.total)}</span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between px-3 py-2.5 bg-secondary/40">
                    <span className="text-sm font-semibold">Total consumido</span>
                    <span className="mono text-sm font-bold text-warning">{fmt(report.consumo)}</span>
                  </div>
                </div>
              )}
            </TabsContent>

            {/* Estoque */}
            <TabsContent value="estoque" className="mt-3">
              {report.stockItems.length === 0 ? (
                <p className="text-xs text-muted-foreground py-6 text-center">Sem produtos atribuídos.</p>
              ) : (
                <div className="rounded-lg border border-border/60 divide-y divide-border/40">
                  {report.stockItems.map((s) => (
                    <div key={s.id} className="flex items-center justify-between px-3 py-2.5">
                      <p className="text-sm font-medium truncate">{s.name}</p>
                      <span className="mono text-sm font-semibold text-primary shrink-0 ml-2">{s.qty}x</span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between px-3 py-2.5 bg-secondary/40">
                    <span className="text-sm font-semibold">Total em posse</span>
                    <span className="mono text-sm font-bold text-primary">{report.stockTotalUnits} un.</span>
                  </div>
                </div>
              )}
            </TabsContent>

            {/* Movimentações — extrato */}
            <TabsContent value="mov" className="mt-3">
              {report.movs.length === 0 ? (
                <p className="text-xs text-muted-foreground py-6 text-center">Sem movimentações no período.</p>
              ) : (
                <div className="rounded-lg border border-border/60 divide-y divide-border/40">
                  {report.movs.map((m, i) => {
                    const credit = m.kind === "venda" || m.kind === "ajuste" || m.kind === "pagamento";
                    return (
                      <div key={i} className="flex items-center gap-3 px-3 py-2.5">
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] text-muted-foreground mono">{formatDateBR(m.when)}</p>
                          <p className="text-sm font-medium truncate">{m.label}</p>
                        </div>
                        <span className={cn(
                          "mono text-sm font-semibold shrink-0",
                          credit ? "text-income" : "text-warning"
                        )}>
                          {credit ? "+" : "−"} {fmt(m.amount)}
                        </span>
                        {"source" in m && m.source && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 shrink-0 text-muted-foreground hover:text-expense"
                            onClick={async () => {
                              const ok = await confirm({ title: "Apagar movimentação?", description: `${m.label} · ${fmt(m.amount)}`, confirmText: "Apagar", destructive: true });
                              if (!ok) return;
                              const src = m.source!;
                              if (src.type === "manual_debt") await deleteSellerManualDebt(src.id);
                              else if (src.type === "debt_payment") await deleteSellerDebtPayment(src.id);
                              else if (src.type === "commission_payment") await deleteCommissionPayment(src.id);
                            }}
                            aria-label="Apagar"
                          >
                            <Trash2 size={13} />
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function SummaryRow({ label, value, tone, sign }: { label: string; value: string; tone: "income" | "warning" | "muted"; sign: "+" | "−" }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn(
        "mono font-semibold",
        tone === "income" && "text-income",
        tone === "warning" && "text-warning",
        tone === "muted" && "text-muted-foreground",
      )}>
        {sign}{value}
      </span>
    </div>
  );
}

function KV({ label, value, tone, strong }: { label: string; value: string; tone?: "income" | "warning" | "expense"; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between px-3 py-2.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={cn(
        "mono text-sm font-semibold",
        strong && "text-base font-bold",
        tone === "income" && "text-income",
        tone === "warning" && "text-warning",
        tone === "expense" && "text-expense",
      )}>{value}</span>
    </div>
  );
}
