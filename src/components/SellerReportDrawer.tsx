import { useEffect, useMemo, useState } from "react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { useStore } from "@/context/StoreContext";
import { computeClosedCommission, computePriorCommissionBalance, getTierForUnits, COMMISSION_TIERS } from "@/lib/commissions";
import { formatDateBR } from "@/lib/date-utils";
import {
  startOfDay, endOfDay, startOfMonth, endOfMonth, subDays, subMonths, parseISO, format,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { MessageCircle, Boxes, Trash2 } from "lucide-react";
import { motion } from "motion/react";
import { Stagger } from "@/components/motion/Stagger";
import AnimatedNumber from "@/components/motion/AnimatedNumber";
import { listItem } from "@/lib/motion";
import { NcButton, NcSheetHeader, NcTabsList, SegmentedChips, Rule, EYEBROW } from "@/components/nocturne";
import { useConfirm } from "@/components/ConfirmProvider";
import type { Sale } from "@/types";
import { compareCatalog } from "@/lib/catalog-order";

type PeriodKey = "today" | "7d" | "month" | "lastMonth" | "custom";

/**
 * Os mesmos chips das telas do painel. "custom" não está aqui de propósito: ele
 * é o que sobra quando a pessoa digita um intervalo à mão, e aí nenhum chip
 * fica aceso.
 */
const PERIOD_OPTIONS: { value: PeriodKey; label: string; short: string }[] = [
  { value: "today", label: "Hoje", short: "Hoje" },
  { value: "7d", label: "Últimos 7 dias", short: "7d" },
  { value: "month", label: "Este mês", short: "Mês" },
  { value: "lastMonth", label: "Mês passado", short: "Mês ant." },
];

const TABS = [
  { value: "resumo", label: "Resumo" },
  { value: "consumo", label: "Consumo" },
  { value: "estoque", label: "Estoque" },
  { value: "mov", label: "Movimentações" },
];

function fmt(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v || 0);
}

/** Sem centavos — para o número grande do topo, como nos trilhos das telas. */
function fmtShort(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(v || 0);
}

/**
 * Saldo em cor, com o MESMO vocabulário da tela de Distribuição: positivo é o
 * que a casa deve ao vendedor (--nc-alert, "falta pagar"), negativo é dívida
 * dele com a casa (--nc-crit, "não entrou nada"), zerado é neutro.
 */
function balanceTone(v: number) {
  if (v > 0.01) return "var(--nc-alert)";
  if (v < -0.01) return "var(--nc-crit)";
  return undefined;
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
  const [tab, setTab] = useState("resumo");

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

    // Saldo de consumo abate direto da comissão. Pagamentos de dívida no período somam de volta ao saldo (crédito).
    const saldoConsumo = consumoTotal;

    // Consumo do PERÍODO (para breakdown da mensagem)
    const consumo = retiradas.reduce((a, s) => a + s.totalPrice, 0);
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

    // Estoque hoje na mão do vendedor
    const stockItems = productAssignments
      .filter(a => a.sellerId === seller.id && a.quantity > 0)
      .map(a => {
        const p = products.find(pp => pp.id === a.productId);
        return {
          id: a.id, name: getProductName(a.productId), qty: a.quantity,
          brand: p?.brand || "", model: p?.model || "", flavor: p?.flavor || "",
        };
      })
      // Mesma ordem do resto do sistema: marca, modelo, sabor — e não o nome
      // montado, que começava pelo sabor e espalhava a marca pela lista.
      .sort(compareCatalog);
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
      // `saleTotal` é o valor da venda; `amount`, a comissão que ela gerou. A
      // linha mostra os dois lado a lado — antes o valor vinha numa sublinha
      // junto de "recebido" e "em aberto", que é assunto da tela de Vendas.
      | { kind: "venda"; when: string; label: string; amount: number; saleTotal: number }
      | { kind: "retirada"; when: string; label: string; amount: number; sub: string; source?: { type: DeletableKind; id: string } }
      | { kind: "pagamento"; when: string; label: string; amount: number; sub?: string; source?: { type: DeletableKind; id: string } }
      | { kind: "ajuste"; when: string; label: string; amount: number; sub?: string };

    const movs: Mov[] = [];
    vendas.forEach(s => {
      movs.push({
        kind: "venda", when: s.date,
        label: `${s.quantity}x ${getProductName(s.productId)}`,
        amount: saleCommission.get(s.id) || 0,
        saleTotal: s.totalPrice,
      });
    });

    retiradas.forEach(s => {
      movs.push({
        kind: "retirada", when: s.date,
        label: `Retirada: ${s.quantity}x ${getProductName(s.productId)}`,
        amount: s.totalPrice, sub: s.notes || "",
      });
    });
    allManualDebts.forEach(d => {
      movs.push({ kind: "retirada", when: d.date, label: "Dívida manual", amount: d.amount, sub: d.notes || "", source: { type: "manual_debt", id: d.id } });
    });
    allDebtPayments.forEach(p => {
      movs.push({ kind: "pagamento", when: p.date, label: "Pagamento de dívida", amount: p.amount, sub: p.notes, source: { type: "debt_payment", id: p.id } });
    });
    commissionPayments.filter(p => p.sellerId === seller.id && inPeriod(p.date)).forEach(p => {
      movs.push({ kind: "pagamento", when: p.date, label: "Pagamento de comissão", amount: p.amount, sub: p.notes, source: { type: "commission_payment", id: p.id } });
    });
    adjustments.forEach(a => movs.push({ kind: "ajuste", when: a.when, label: a.label, amount: a.amount }));
    movs.sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime());

    return {
      units, revenue, received, open, consumo, consumoBreakdown,
      salesDetail, stockItems, stockTotalUnits,
      tier: c.tier, accrued: c.accrued, commPaidPeriod, commBalance, movs,
      consumoTotal, debtPaymentsTotal, saldoConsumo,
      allOpenSales, allOpenAmount,
      previousBalance, periodBalance,
    };
  }, [seller, sales, commissionPayments, sellerDebtPayments, sellerManualDebts, productAssignments, products, start, end, getProductName]);

  if (!seller || !report) {
    return (
      <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
        <SheetContent className="nocturne w-full sm:max-w-xl" />
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
      {/* `nocturne` repetido aqui pelo mesmo motivo do SheetContent da loja: o
          Radix porta o painel para o <body> e os tokens não chegam por herança. */}
      <SheetContent className="nocturne w-full sm:max-w-xl overflow-y-auto p-0 flex flex-col">
        <NcSheetHeader
          eyebrow={`Extrato · ${label}`}
          title={
            <span className="flex items-center gap-2">
              {seller.name}
              <span className="nc-pill nc-pill--mute">{report.tier.label}</span>
            </span>
          }
        />

        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
          {/* ---- Período ---- */}
          <div className="flex flex-wrap items-center gap-2">
            <SegmentedChips options={PERIOD_OPTIONS} value={periodKey} onChange={v => setPeriodKey(v as PeriodKey)} />
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                value={customStart}
                onChange={e => { setCustomStart(e.target.value); setPeriodKey("custom"); }}
                aria-label="Data inicial"
                className="nc-input nc-num h-8 w-[128px] px-2 text-[12px]"
              />
              <span className="text-xs" style={{ color: "var(--nc-text-3)" }}>–</span>
              <input
                type="date"
                value={customEnd}
                onChange={e => { setCustomEnd(e.target.value); setPeriodKey("custom"); }}
                aria-label="Data final"
                className="nc-input nc-num h-8 w-[128px] px-2 text-[12px]"
              />
            </div>
          </div>

          {/* ---- Saldo ---- */}
          <div>
            <span className="text-[11.5px]" style={{ color: "var(--nc-text-2)" }}>Saldo do período</span>
            <div className="flex flex-wrap items-baseline gap-2">
              <span style={{ color: balanceTone(report.commBalance) }}>
                <AnimatedNumber
                  value={report.commBalance}
                  format={fmtShort}
                  duration={0.7}
                  animateOnMount
                  className="nc-num text-[30px] font-semibold tracking-[-0.025em]"
                />
              </span>
            </div>
            <p className="nc-num mt-1.5 text-[11px]" style={{ color: "var(--nc-text-2)" }}>
              {report.units} un. vendidas · faturamento {fmtShort(report.revenue)}
            </p>
          </div>

          <Rule />

          {/* ---- A conta ---- */}
          <section className="space-y-1.5">
            <p className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>Como se chega nesse saldo</p>
            <Line label="Saldo anterior" value={fmt(report.previousBalance)} tone={report.previousBalance < -0.01 ? "var(--nc-crit)" : undefined} />
            <Line label="Comissão gerada" value={`+${fmt(report.accrued)}`} tone="var(--nc-ok)" />
            <Line label="Consumo" value={`−${fmt(report.saldoConsumo)}`} tone={report.saldoConsumo > 0.01 ? "var(--nc-alert)" : undefined} />
            {report.debtPaymentsTotal > 0 && (
              <Line label="Pagamentos de dívida" value={`+${fmt(report.debtPaymentsTotal)}`} tone="var(--nc-ok)" />
            )}
            <Line label="Comissão paga" value={`−${fmt(report.commPaidPeriod)}`} tone={report.commPaidPeriod > 0.01 ? "var(--nc-alert)" : undefined} />
            <div className="nc-rule-top flex items-center justify-between gap-2 pt-2 text-[13px]">
              <span>Saldo final</span>
              <span className="nc-num font-medium" style={{ color: balanceTone(report.commBalance) }}>{fmt(report.commBalance)}</span>
            </div>
          </section>

          <div className="flex flex-wrap gap-2">
            <NcButton variant="quiet" size="md" onClick={shareWhatsSales}>
              <MessageCircle size={14} />Enviar relatório
            </NcButton>
            <NcButton variant="quiet" size="md" onClick={shareWhatsStock}>
              <Boxes size={14} />Enviar estoque
            </NcButton>
          </div>

          {/* ---- Abas ---- */}
          <Tabs value={tab} onValueChange={setTab} className="w-full">
            <NcTabsList value={tab} tabs={TABS} />

            {/* Resumo */}
            <TabsContent value="resumo" className="mt-3">
              <div className="nc-card overflow-hidden">
                <KV label="Unidades vendidas" value={String(report.units)} />
                <KV label="Faturamento" value={fmt(report.revenue)} />
                <KV label="Recebido" value={fmt(report.received)} tone="var(--nc-ok)" />
                <KV label="Em aberto no período" value={fmt(report.open)} tone={report.open > 0.01 ? "var(--nc-alert)" : undefined} />
                <KV label="Faixa de comissão" value={report.tier.label} />
                <KV label="Comissão gerada" value={fmt(report.accrued)} />
                <KV label="Saldo final" value={fmt(report.commBalance)} tone={balanceTone(report.commBalance)} />
              </div>
            </TabsContent>

            {/* Consumo */}
            <TabsContent value="consumo" className="mt-3">
              {report.consumoBreakdown.length === 0 ? (
                <p className="py-10 text-center text-[13px]" style={{ color: "var(--nc-text-3)" }}>Sem consumo no período.</p>
              ) : (
                <Stagger className="nc-card overflow-hidden">
                  {report.consumoBreakdown.map((c, i) => (
                    <motion.div key={i} variants={listItem} className="nc-row flex items-center justify-between gap-3 px-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px]">{c.name}</p>
                        <p className="nc-num text-[11px]" style={{ color: "var(--nc-text-3)" }}>{c.qty} un.</p>
                      </div>
                      <span className="nc-num flex-none text-[13px]" style={{ color: "var(--nc-alert)" }}>{fmt(c.total)}</span>
                    </motion.div>
                  ))}
                  <div className="flex items-center justify-between gap-3 px-3 py-2.5 text-[13px]" style={{ background: "var(--nc-bg)" }}>
                    <span>Total consumido</span>
                    <span className="nc-num font-medium" style={{ color: "var(--nc-alert)" }}>{fmt(report.consumo)}</span>
                  </div>
                </Stagger>
              )}
            </TabsContent>

            {/* Estoque */}
            <TabsContent value="estoque" className="mt-3">
              {report.stockItems.length === 0 ? (
                <p className="py-10 text-center text-[13px]" style={{ color: "var(--nc-text-3)" }}>Sem produtos atribuídos.</p>
              ) : (
                <Stagger className="nc-card overflow-hidden">
                  {report.stockItems.map(s => (
                    <motion.div key={s.id} variants={listItem} className="nc-row flex items-center justify-between gap-3 px-3 py-2.5">
                      <p className="truncate text-[13px]">
                        {s.flavor || s.name}
                        {s.model && <span style={{ color: "var(--nc-text-3)" }}> · {s.brand} {s.model}</span>}
                      </p>
                      <span className="nc-num flex-none text-[13px]">{s.qty}</span>
                    </motion.div>
                  ))}
                  <div className="flex items-center justify-between gap-3 px-3 py-2.5 text-[13px]" style={{ background: "var(--nc-bg)" }}>
                    <span>Total em posse</span>
                    <span className="nc-num font-medium">{report.stockTotalUnits} un.</span>
                  </div>
                </Stagger>
              )}
            </TabsContent>

            {/* Movimentações */}
            <TabsContent value="mov" className="mt-3">
              {report.movs.length === 0 ? (
                <p className="py-10 text-center text-[13px]" style={{ color: "var(--nc-text-3)" }}>Sem movimentações no período.</p>
              ) : (
                <Stagger className="nc-card overflow-hidden">
                  {report.movs.map((m, i) => {
                    const credit = m.kind === "venda" || m.kind === "ajuste" || m.kind === "pagamento";
                    // Venda e ajuste de faixa não se apagam daqui (a venda é da
                    // tela de Vendas, o ajuste é calculado) — mas o lugar do
                    // botão fica reservado nelas do mesmo jeito, senão a linha
                    // que pode apagar nasce mais estreita e o número dela não
                    // alinha com o das vizinhas.
                    const source = "source" in m ? m.source : undefined;
                    return (
                      <motion.div
                        key={i}
                        variants={i < 20 ? listItem : undefined}
                        className="nc-row group flex items-center gap-3 px-3 py-2.5"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="nc-num text-[11px]" style={{ color: "var(--nc-text-3)" }}>{formatDateBR(m.when)}</p>
                          <p className="truncate text-[13px]">{m.label}</p>
                          {/* Sublinha só onde ela carrega observação escrita por
                              alguém. A da venda saiu: repetia recebido e em
                              aberto, que é assunto da tela de Vendas. */}
                          {"sub" in m && m.sub && (
                            <p className="truncate text-[11px]" style={{ color: "var(--nc-text-3)" }}>{m.sub}</p>
                          )}
                        </div>
                        {/* Uma coluna só de dinheiro, largura reservada: valor da
                            venda em cima, comissão que ela gerou embaixo. Os dois
                            lado a lado empurravam a comissão para uma posição
                            diferente em cada linha, porque só a venda tem o
                            número de cima. */}
                        <div className="flex-none text-right" style={{ minWidth: 92 }}>
                          {m.kind === "venda" && (
                            <p className="nc-num text-[11px]" style={{ color: "var(--nc-text-3)" }}>
                              {fmt(m.saleTotal)}
                            </p>
                          )}
                          <p
                            className="nc-num text-[13px]"
                            style={{ color: credit ? "var(--nc-ok)" : "var(--nc-alert)" }}
                          >
                            {credit ? "+" : "−"}{fmt(m.amount)}
                          </p>
                        </div>
                        {/* No desktop só aparece no hover; no toque não há hover,
                            então fica sempre visível abaixo de sm. */}
                        <div className="flex-none transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                          <NcButton
                            variant="danger"
                            size="icon"
                            disabled={!source}
                            aria-hidden={!source}
                            tabIndex={source ? undefined : -1}
                            className={source ? undefined : "invisible"}
                            aria-label={source ? `Apagar ${m.label}` : undefined}
                            onClick={async () => {
                              if (!source) return;
                              const ok = await confirm({ title: "Apagar movimentação?", description: `${m.label} · ${fmt(m.amount)}`, confirmText: "Apagar", destructive: true });
                              if (!ok) return;
                              if (source.type === "manual_debt") await deleteSellerManualDebt(source.id);
                              else if (source.type === "debt_payment") await deleteSellerDebtPayment(source.id);
                              else if (source.type === "commission_payment") await deleteCommissionPayment(source.id);
                            }}
                          >
                            <Trash2 size={13} />
                          </NcButton>
                        </div>
                      </motion.div>
                    );
                  })}
                </Stagger>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Linha de conta: rótulo à esquerda, número tabular à direita. */
function Line({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-center justify-between gap-2 text-[12.5px]">
      <span style={{ color: "var(--nc-text-2)" }}>{label}</span>
      <span className="nc-num" style={{ color: tone }}>{value}</span>
    </div>
  );
}

/** Linha de tabela do resumo, com a régua curta da lista. */
function KV({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="nc-row flex items-center justify-between gap-3 px-3 py-2.5">
      <span className="text-[13px]" style={{ color: "var(--nc-text-2)" }}>{label}</span>
      <span className="nc-num text-[13px]" style={{ color: tone }}>{value}</span>
    </div>
  );
}
