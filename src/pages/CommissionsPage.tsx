import { useMemo, useState } from "react";
import { useStore } from "@/context/StoreContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetFooter } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Wallet, Sparkles, TrendingUp, Trash2, Plus, Clock, Crown, Inbox,
  ArrowRight, Users, X, HandCoins, Receipt, Package, ArrowLeftRight,
} from "lucide-react";
import {
  format, startOfMonth, endOfMonth, startOfQuarter, endOfQuarter, startOfYear,
  endOfYear, isWithinInterval, parseISO, isToday, isYesterday,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { todayDateString, localDateToISO, formatDateBR } from "@/lib/date-utils";
import { cn } from "@/lib/utils";
import { useConfirm } from "@/components/ConfirmProvider";
import SellerReportDrawer from "@/components/SellerReportDrawer";
import {
  getTierForUnits, getNextTier, unitsUntilNextTier,
  progressToNextTier, computeSellerCommission, COMMISSION_TIERS,
} from "@/lib/commissions";
import type { Sale } from "@/types";

function computeAccrualHistory(sales: Sale[]) {
  const sorted = [...sales].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const items: {
    id: string; when: string; label: string; amount: number;
    kind: "accrual" | "adjustment"; meta?: string;
  }[] = [];
  let cumUnits = 0;
  let cumRevenue = 0;
  let currentRate = COMMISSION_TIERS[0].rate;
  for (const s of sorted) {
    const priorRevenue = cumRevenue;
    cumUnits += s.quantity;
    cumRevenue += s.totalPrice;
    const tierAfter = getTierForUnits(cumUnits);
    if (tierAfter.rate > currentRate) {
      const adjustment = priorRevenue * (tierAfter.rate - currentRate);
      if (adjustment > 0.001) {
        items.push({
          id: `adj-${s.id}`,
          when: s.date,
          label: `Ajuste de Faixa → ${tierAfter.label}`,
          amount: adjustment,
          kind: "adjustment",
          meta: "Recálculo retroativo à nova taxa",
        });
      }
      currentRate = tierAfter.rate;
    }
    items.push({
      id: `acc-${s.id}`,
      when: s.date,
      label: `Comissão da venda (${s.quantity} un.)`,
      amount: s.totalPrice * currentRate,
      kind: "accrual",
      meta: `Taxa: ${(currentRate * 100).toFixed(currentRate === 0.125 ? 1 : 0)}%`,
    });
  }
  return items;
}

function formatCurrency(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v || 0);
}

type Period = "month" | "quarter" | "year";

export default function CommissionsPage() {
  const store = useStore();
  const confirm = useConfirm();
  const {
    sellers, partners, sales, expenses, products, productAssignments,
    commissionPayments, proLaborePayments, sellerDebtPayments, sellerManualDebts,
    addCommissionPayment, addProLaborePayment,
    deleteCommissionPayment, deleteProLaborePayment,
    addSellerDebtPayment, deleteSellerDebtPayment,
    addSellerManualDebt, deleteSellerManualDebt,
    addProductAssignment, transferProductAssignment,
    getSellerName, deleteSeller,
  } = store;

  // Retiradas dos sócios = proLaborePayments (apenas relabel semântico)
  const withdrawals = proLaborePayments;
  const addWithdrawal = addProLaborePayment;
  const deleteWithdrawal = deleteProLaborePayment;

  const [period, setPeriod] = useState<Period>("month");

  // Cutoff legado: tudo antes de 01/06/2026 é tratado como legado (10% de comissão, só abate consumo)
  const LEGACY_CUTOFF = useMemo(() => new Date(2026, 5, 1), []);
  const isLegacy = (iso: string) => {
    try { return parseISO(iso) < LEGACY_CUTOFF; } catch { return false; }
  };
  const PROJECT_START = LEGACY_CUTOFF;

  const { start, end, label } = useMemo(() => {
    const now = new Date();
    let s: Date, e: Date, l: string;
    if (period === "month") { s = startOfMonth(now); e = endOfMonth(now); l = format(now, "MMMM/yyyy", { locale: ptBR }); }
    else if (period === "quarter") { s = startOfQuarter(now); e = endOfQuarter(now); l = `${format(startOfQuarter(now), "MMM", { locale: ptBR })}–${format(endOfQuarter(now), "MMM/yyyy", { locale: ptBR })}`; }
    else { s = startOfYear(now); e = endOfYear(now); l = format(now, "yyyy"); }
    if (s < PROJECT_START) s = PROJECT_START;
    return { start: s, end: e, label: l };
  }, [period, PROJECT_START]);

  const inPeriod = (iso: string) => {
    try { return isWithinInterval(parseISO(iso), { start, end }); } catch { return false; }
  };
  const inYear = (iso: string) => {
    try { return isWithinInterval(parseISO(iso), { start: PROJECT_START, end: endOfYear(new Date()) }); } catch { return false; }
  };

  const periodMetrics = useMemo(() => {
    const salesPeriod = sales.filter(s => inPeriod(s.date));
    const vendasPeriod = salesPeriod.filter(s => s.type === "venda");
    const revenue = vendasPeriod.reduce((a, s) => a + s.totalPrice, 0);
    const cogs = vendasPeriod.reduce((a, s) => a + (products.find(p => p.id === s.productId)?.purchasePrice ?? 0) * s.quantity, 0);
    const grossProfit = revenue - cogs;
    const periodExpenses = expenses.filter(e => inPeriod(e.date)).reduce((a, e) => a + e.amount, 0);
    const netProfit = grossProfit - periodExpenses;

    // Conta Corrente do vendedor — comissão do período + abate consumo (incluindo legado)
    const perSeller = sellers.map(seller => {
      const sellerSales = salesPeriod.filter(s => s.sellerId === seller.id);
      const vendas = sellerSales.filter(s => s.type === "venda");
      // Comissão só é creditada em vendas QUITADAS
      const vendasPagas = vendas.filter(s => (s.paidAmount || 0) >= s.totalPrice - 0.01);
      const vendasTotal = vendas.reduce((a, s) => a + s.totalPrice, 0);
      const commPaid = commissionPayments.filter(p => p.sellerId === seller.id && inPeriod(p.date)).reduce((a, p) => a + p.amount, 0);

      const c = computeSellerCommission(vendasPagas);
      const accrued = c.accrued;
      const units = c.units;

      const accrualItems = computeAccrualHistory(vendasPagas);
      const adjustmentsTotal = accrualItems.filter(i => i.kind === "adjustment").reduce((a, x) => a + x.amount, 0);
      const baseAccrued = accrued - adjustmentsTotal;

      // === Consumo / dívidas / pagamentos — APENAS no período ===
      const retiradas = sellerSales.filter(s => s.type === "retirada_funcionario");
      const retiradasTotal = retiradas.reduce((a, s) => a + s.totalPrice, 0);
      const manualDebts = sellerManualDebts.filter(d => d.sellerId === seller.id && inPeriod(d.date));
      const manualDebtsTotal = manualDebts.reduce((a, d) => a + d.amount, 0);
      const consumoTotal = retiradasTotal + manualDebtsTotal;
      const debtPaymentsTotal = sellerDebtPayments.filter(p => p.sellerId === seller.id && inPeriod(p.date)).reduce((a, p) => a + p.amount, 0);

      const legacyCredit = 0;
      // Saldo de consumo abate direto da comissão.
      // Pagamentos de dívida no período somam de volta ao saldo do vendedor (crédito).
      const saldoConsumo = consumoTotal;
      const retiradasCount = retiradas.length + manualDebts.length;

      // Saldo de comissão = acumulada − consumo + pagamentos de dívida − comissão paga
      const balance = accrued - saldoConsumo + debtPaymentsTotal - commPaid;

      return {
        seller, units, vendasTotal, commPaid,
        accrued, baseAccrued, adjustmentsTotal,
        tier: c.tier, balance, accrualItems,
        consumoTotal, debtPaymentsTotal, legacyCredit, saldoConsumo,
        retiradasTotal, manualDebtsTotal, retiradasCount,
      };
    }).sort((a, b) => b.vendasTotal - a.vendasTotal);

    const totalSellerBalance = perSeller.reduce((a, x) => a + Math.max(0, x.balance), 0);
    const leader = perSeller.find(r => r.vendasTotal > 0) || null;

    // Retiradas dos sócios
    const perPartner = partners.map(partner => {
      const list = withdrawals.filter(w => w.partnerId === partner.id);
      const periodAmt = list.filter(w => inPeriod(w.date)).reduce((a, w) => a + w.amount, 0);
      const yearAmt = list.filter(w => inYear(w.date)).reduce((a, w) => a + w.amount, 0);
      const last = list.slice().sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
      return { partner, periodAmt, yearAmt, last, count: list.filter(w => inPeriod(w.date)).length };
    });
    const totalWithdrawalsPeriod = perPartner.reduce((a, x) => a + x.periodAmt, 0);

    const available = netProfit - totalSellerBalance - totalWithdrawalsPeriod;

    return {
      revenue, cogs, grossProfit, netProfit, periodExpenses,
      perSeller, leader, totalSellerBalance,
      perPartner, totalWithdrawalsPeriod,
      available,
    };
  }, [sales, expenses, products, sellers, partners, commissionPayments, withdrawals, sellerDebtPayments, sellerManualDebts, period, start, end]);

  const timeline = useMemo(() => {
    const items = [
      ...commissionPayments.map(p => ({ kind: "commission" as const, id: p.id, when: p.date, amount: p.amount, who: getSellerName(p.sellerId), notes: p.notes })),
      ...withdrawals.map(p => ({ kind: "withdrawal" as const, id: p.id, when: p.date, amount: p.amount, who: partners.find(x => x.id === p.partnerId)?.name ?? "Sócio", notes: p.notes })),
    ].sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime()).slice(0, 30);
    const groups: Record<string, typeof items> = {};
    items.forEach(it => {
      if (!it.when) return;
      const d = parseISO(it.when);
      if (isNaN(d.getTime())) return;
      const k = isToday(d) ? "Hoje" : isYesterday(d) ? "Ontem" : format(d, "dd 'de' MMM", { locale: ptBR });
      (groups[k] ||= []).push(it);
    });
    return groups;
  }, [commissionPayments, withdrawals, partners, getSellerName]);

  // ---- Drawers ----
  const [payDrawer, setPayDrawer] = useState<{ sellerId: string } | null>(null);
  const [payForm, setPayForm] = useState({ amount: "", date: todayDateString(), notes: "" });
  const [wdDrawer, setWdDrawer] = useState<{ partnerId: string } | null>(null);
  const [wdForm, setWdForm] = useState({ amount: "", date: todayDateString(), notes: "" });
  const [extractFor, setExtractFor] = useState<string | null>(null);
  const [debtPayDrawer, setDebtPayDrawer] = useState<{ sellerId: string } | null>(null);
  const [debtPayForm, setDebtPayForm] = useState({ amount: "", date: todayDateString(), notes: "" });
  const [manualDebtDrawer, setManualDebtDrawer] = useState<boolean>(false);
  const [manualDebtForm, setManualDebtForm] = useState({ sellerId: "", amount: "", date: todayDateString(), notes: "" });
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignSubmitting, setAssignSubmitting] = useState(false);
  const [assignForm, setAssignForm] = useState<{ sellerId: string; selectedProducts: Record<string, string> }>({ sellerId: "", selectedProducts: {} });
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferForm, setTransferForm] = useState<{ fromSellerId: string; assignmentId: string; toSellerId: string; quantity: string }>({ fromSellerId: "", assignmentId: "", toSellerId: "", quantity: "" });

  const availableProducts = useMemo(() => {
    return products
      .map(p => {
        const assigned = productAssignments.filter(a => a.productId === p.id).reduce((s, a) => s + a.quantity, 0);
        return { ...p, availableToAssign: Math.max(0, p.stock - assigned) };
      })
      .filter(p => p.availableToAssign > 0);
  }, [products, productAssignments]);

  const toggleAssignProduct = (productId: string, checked: boolean) => {
    setAssignForm(f => {
      const next = { ...f.selectedProducts };
      if (checked) next[productId] = "1"; else delete next[productId];
      return { ...f, selectedProducts: next };
    });
  };

  const handleAssign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (assignSubmitting) return;
    if (!assignForm.sellerId || Object.keys(assignForm.selectedProducts).length === 0) return;
    setAssignSubmitting(true);
    try {
      for (const [productId, qty] of Object.entries(assignForm.selectedProducts)) {
        const p = availableProducts.find(x => x.id === productId);
        const quantity = Math.min(Number(qty), p?.availableToAssign ?? 0);
        if (quantity > 0) await addProductAssignment({ sellerId: assignForm.sellerId, productId, quantity });
      }
      setAssignForm({ sellerId: "", selectedProducts: {} });
      setAssignOpen(false);
    } finally {
      setAssignSubmitting(false);
    }
  };

  const assignSelectedCount = Object.keys(assignForm.selectedProducts).length;
  const assignTotalUnits = Object.values(assignForm.selectedProducts).reduce((s, v) => s + (Number(v) || 0), 0);

  // Transfer logic
  const transferFromAssignments = useMemo(() => {
    if (!transferForm.fromSellerId) return [];
    return productAssignments
      .filter(a => a.sellerId === transferForm.fromSellerId && a.quantity > 0)
      .map(a => {
        const p = products.find(x => x.id === a.productId);
        return { ...a, productLabel: p ? `${p.flavor} · ${p.model}` : "—" };
      });
  }, [productAssignments, products, transferForm.fromSellerId]);
  const transferSelected = transferFromAssignments.find(a => a.id === transferForm.assignmentId);
  const transferMaxQty = transferSelected?.quantity ?? 0;

  const submitTransfer = async () => {
    const qty = Number(transferForm.quantity);
    if (!transferForm.assignmentId || !transferForm.toSellerId || qty <= 0) return;
    await transferProductAssignment(transferForm.assignmentId, transferForm.toSellerId, qty);
    setTransferOpen(false);
    setTransferForm({ fromSellerId: "", assignmentId: "", toSellerId: "", quantity: "" });
  };

  const openPay = (sellerId: string, suggested: number) => {
    setPayDrawer({ sellerId });
    setPayForm({ amount: suggested > 0 ? suggested.toFixed(2) : "", date: todayDateString(), notes: "" });
  };
  const openWd = (partnerId: string) => {
    setWdDrawer({ partnerId });
    setWdForm({ amount: "", date: todayDateString(), notes: "" });
  };

  const submitPay = async () => {
    if (!payDrawer || !Number(payForm.amount)) return;
    await addCommissionPayment({
      sellerId: payDrawer.sellerId,
      amount: Number(payForm.amount),
      date: localDateToISO(payForm.date),
      notes: payForm.notes || undefined,
    });
    setPayDrawer(null);
  };
  const submitWd = async () => {
    if (!wdDrawer || !Number(wdForm.amount)) return;
    await addWithdrawal({
      partnerId: wdDrawer.partnerId,
      amount: Number(wdForm.amount),
      date: localDateToISO(wdForm.date),
      notes: wdForm.notes || undefined,
    });
    setWdDrawer(null);
  };

  const submitDebtPay = async () => {
    if (!debtPayDrawer || !Number(debtPayForm.amount)) return;
    await addSellerDebtPayment({
      sellerId: debtPayDrawer.sellerId,
      amount: Number(debtPayForm.amount),
      date: localDateToISO(debtPayForm.date),
      notes: debtPayForm.notes || undefined,
    });
    setDebtPayDrawer(null);
  };

  const submitManualDebt = async () => {
    if (!manualDebtForm.sellerId || !Number(manualDebtForm.amount)) return;
    await addSellerManualDebt({
      sellerId: manualDebtForm.sellerId,
      amount: Number(manualDebtForm.amount),
      date: localDateToISO(manualDebtForm.date),
      notes: manualDebtForm.notes || undefined,
    });
    setManualDebtDrawer(false);
    setManualDebtForm({ sellerId: "", amount: "", date: todayDateString(), notes: "" });
  };

  const sellerRow = payDrawer ? periodMetrics.perSeller.find(r => r.seller.id === payDrawer.sellerId) : null;
  const debtSellerRow = debtPayDrawer ? periodMetrics.perSeller.find(r => r.seller.id === debtPayDrawer.sellerId) : null;
  const partnerRow = wdDrawer ? periodMetrics.perPartner.find(r => r.partner.id === wdDrawer.partnerId) : null;

  const maxVendas = Math.max(1, ...periodMetrics.perSeller.map(r => r.vendasTotal));

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Distribuição</h1>
          <p className="text-xs text-muted-foreground">Comissões, consumos, pagamentos e retiradas dos sócios · {label}</p>
        </div>
        <Select value={period} onValueChange={(v: Period) => setPeriod(v)}>
          <SelectTrigger className="h-9 w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="month">Mês atual</SelectItem>
            <SelectItem value="quarter">Trimestre</SelectItem>
            <SelectItem value="year">Ano</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* KPIs */}
      <div className="grid gap-2 grid-cols-2 lg:grid-cols-4">
        <KPI icon={<TrendingUp size={14} />} label="Lucro Líquido" value={formatCurrency(periodMetrics.netProfit)} tone={periodMetrics.netProfit >= 0 ? "income" : "expense"} />
        <KPI icon={<Wallet size={14} />} label="A pagar a vendedores" value={formatCurrency(periodMetrics.totalSellerBalance)} tone="warning" sub="Soma dos saldos positivos" />
        <KPI icon={<Users size={14} />} label="Retiradas dos Sócios" value={formatCurrency(periodMetrics.totalWithdrawalsPeriod)} tone="warning" sub="No período" />
        <div className="rounded-xl p-[1px] bg-gradient-to-br from-primary/60 via-primary/20 to-transparent">
          <div className="rounded-xl bg-card px-3 py-3 h-full">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
              <Sparkles size={14} className="text-primary" /> Saldo Disponível
            </div>
            <p className={cn("mt-1 text-lg sm:text-xl font-semibold mono", periodMetrics.available >= 0 ? "text-foreground" : "text-expense")}>
              {formatCurrency(periodMetrics.available)}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">Lucro − vendedores − retiradas</p>
          </div>
        </div>
      </div>

      {/* Vendedores */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2 border-b border-border pb-2">
          <div>
            <h2 className="text-sm font-semibold tracking-tight">Vendedores</h2>
            <p className="text-[11px] text-muted-foreground">Comissão do período + consumo + dívidas − pagamentos</p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" className="h-8 text-[11px]" onClick={() => setAssignOpen(true)}>
              <Package size={12} className="mr-1" />Atribuir Estoque
            </Button>
            <Button size="sm" variant="outline" className="h-8 text-[11px]" onClick={() => { setTransferForm({ fromSellerId: "", assignmentId: "", toSellerId: "", quantity: "" }); setTransferOpen(true); }}>
              <ArrowLeftRight size={12} className="mr-1" />Transferir
            </Button>
            <Button size="sm" variant="outline" className="h-8 text-[11px] border-warning/40 text-warning hover:text-warning hover:bg-warning/5" onClick={() => setManualDebtDrawer(true)}>
              <HandCoins size={12} className="mr-1" />Dívida Manual
            </Button>
            <Badge variant="secondary" className="text-[11px]">{periodMetrics.perSeller.length}</Badge>
          </div>
        </div>

        {periodMetrics.perSeller.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-8 text-center text-xs text-muted-foreground">
            Nenhum vendedor cadastrado.
          </div>
        ) : (
          <div className="grid gap-2 grid-cols-1 lg:grid-cols-2">
            {periodMetrics.perSeller.map((r, idx) => {
              const next = getNextTier(r.tier);
              const remaining = unitsUntilNextTier(r.units);
              const isLeader = periodMetrics.leader?.seller.id === r.seller.id;
              const positive = r.balance > 0.01;
              return (
                <div key={r.seller.id} className="rounded-xl border border-border bg-card px-3.5 py-3 group/seller">
                  {/* Header */}
                  <div className="flex items-start justify-between gap-2 mb-2.5">
                    <button onClick={() => setExtractFor(r.seller.id)} className="flex items-center gap-2 min-w-0 text-left hover:opacity-80 transition-opacity">
                      <span className={cn(
                        "w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold mono shrink-0",
                        isLeader ? "bg-gradient-to-br from-warning to-warning/60 text-warning-foreground" : "bg-secondary text-muted-foreground"
                      )}>{idx + 1}</span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-sm font-semibold truncate">{r.seller.name}</p>
                          {isLeader && <Crown size={12} className="text-warning shrink-0" />}
                        </div>
                        <p className="text-[11px] text-muted-foreground truncate">
                          <span className="mono">{r.units}</span> un. · <span className="mono">{formatCurrency(r.vendasTotal)}</span> · faixa <span className="mono">{r.tier.label}</span>
                        </p>
                      </div>
                    </button>
                    <button
                      onClick={async () => { if (await confirm({ title: "Remover vendedor", description: `Remover ${r.seller.name}?` })) deleteSeller(r.seller.id); }}
                      className="text-muted-foreground/40 hover:text-destructive transition-colors p-1 opacity-0 group-hover/seller:opacity-100 shrink-0"
                      aria-label="Remover vendedor"
                    ><X size={13} /></button>
                  </div>

                  {/* Linhas compactas */}
                  <div className="text-[12px] space-y-1 mb-2.5">
                    <Line label="Comissão" value={formatCurrency(r.accrued)} tone="income" />
                    <Line label="Consumo" value={`−${formatCurrency(r.retiradasTotal)}`} tone={r.retiradasTotal > 0 ? "warning" : "muted"} />
                    <Line label="Dívidas" value={`−${formatCurrency(r.manualDebtsTotal)}`} tone={r.manualDebtsTotal > 0 ? "warning" : "muted"} />
                    <Line label="Pago" value={`−${formatCurrency(r.commPaid)}`} tone={r.commPaid > 0 ? "warning" : "muted"} />
                    {r.debtPaymentsTotal > 0 && (
                      <Line label="(+) Pgto. dívida" value={`+${formatCurrency(r.debtPaymentsTotal)}`} tone="income" />
                    )}
                    <div className="flex items-center justify-between border-t border-border/40 pt-1.5">
                      <span className="font-semibold">Saldo</span>
                      <span className={cn("mono font-bold text-sm", positive ? "text-warning" : r.balance < -0.01 ? "text-income" : "text-foreground")}>
                        {formatCurrency(r.balance)}
                      </span>
                    </div>
                  </div>

                  {/* Próxima faixa compacta */}
                  {next && (
                    <p className="text-[11px] text-muted-foreground mb-2.5">
                      Próxima faixa <span className="text-foreground font-semibold">{next.label}</span> · faltam <span className="mono text-foreground font-semibold">{remaining}</span> un.
                    </p>
                  )}

                  <div className="flex flex-wrap justify-end gap-1.5">
                    <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => setExtractFor(r.seller.id)}>
                      Extrato <ArrowRight size={11} className="ml-1" />
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-[11px] border-warning/40 text-warning hover:text-warning hover:bg-warning/5" onClick={() => { setDebtPayDrawer({ sellerId: r.seller.id }); setDebtPayForm({ amount: r.saldoConsumo > 0 ? r.saldoConsumo.toFixed(2) : "", date: todayDateString(), notes: "" }); }}>
                      <Receipt size={11} className="mr-1" />Pagar Dívida
                    </Button>
                    <Button size="sm" variant={positive ? "default" : "secondary"} className="h-7 text-[11px]" onClick={() => openPay(r.seller.id, Math.max(0, r.balance))}>
                      <Plus size={11} className="mr-1" />Pagar
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Retiradas dos Sócios — compacto */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-border">
          <div>
            <h2 className="text-sm font-semibold tracking-tight">Retiradas dos Sócios</h2>
            <p className="text-[11px] text-muted-foreground">Valores retirados no período</p>
          </div>
        </div>
        {periodMetrics.perPartner.length === 0 ? (
          <p className="px-4 py-5 text-xs text-muted-foreground">Nenhum sócio cadastrado.</p>
        ) : (
          <div className="divide-y divide-border/40">
            {periodMetrics.perPartner.map(r => (
              <div key={r.partner.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{r.partner.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    Sócio · {r.partner.percentage}%{r.count > 0 ? ` · ${r.count} no período` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className={cn("mono text-sm font-semibold", r.periodAmt > 0 ? "text-warning" : "text-muted-foreground")}>
                    {formatCurrency(r.periodAmt)}
                  </span>
                  <Button size="sm" variant="outline" className="h-8 text-[11px]" onClick={() => openWd(r.partner.id)}>
                    <Plus size={11} className="mr-1" />Registrar
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Histórico Financeiro — timeline */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-border">
          <Clock size={14} className="text-muted-foreground" />
          <h2 className="text-sm font-semibold tracking-tight">Histórico Financeiro</h2>
        </div>
        {Object.keys(timeline).length === 0 ? (
          <div className="flex items-start gap-2.5 px-4 py-5">
            <Inbox size={14} className="text-muted-foreground mt-0.5 shrink-0" />
            <div>
              <p className="text-xs text-foreground">Nenhum pagamento registrado ainda.</p>
              <p className="text-[11px] text-muted-foreground">Pagamentos a vendedores e retiradas dos sócios aparecerão aqui.</p>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-border/40">
            {Object.entries(timeline).map(([day, items]) => (
              <div key={day} className="px-3.5 py-2.5">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">{day}</div>
                <div className="space-y-0.5">
                  {items.map(it => (
                    <div key={`${it.kind}-${it.id}`} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-secondary/40 transition-colors group/hist">
                      <div className={cn("w-1.5 h-1.5 rounded-full shrink-0", it.kind === "commission" ? "bg-warning" : "bg-fixed")} />
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] truncate">
                          <span className="text-muted-foreground">{it.kind === "commission" ? "Pagamento de Comissão" : "Retirada Sócio"}</span>{" · "}
                          <span className="font-medium">{it.who}</span>
                        </p>
                        {it.notes && <p className="text-[11px] text-muted-foreground truncate">{it.notes}</p>}
                      </div>
                      <span className="mono text-[13px] font-semibold">{formatCurrency(it.amount)}</span>
                      <span className="text-[11px] text-muted-foreground mono shrink-0 hidden sm:inline">{formatDateBR(it.when)}</span>
                      <button
                        onClick={async () => {
                          const ok = await confirm({ title: "Excluir registro", description: it.kind === "commission" ? "Excluir este pagamento de comissão?" : "Excluir esta retirada?" });
                          if (!ok) return;
                          it.kind === "commission" ? deleteCommissionPayment(it.id) : deleteWithdrawal(it.id);
                        }}
                        className="text-muted-foreground hover:text-destructive transition-colors p-1 opacity-0 group-hover/hist:opacity-100"
                        aria-label="Excluir"
                      ><Trash2 size={12} /></button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>


      {/* Drawer Pagar Vendedor */}
      <Sheet open={!!payDrawer} onOpenChange={(v) => !v && setPayDrawer(null)}>
        <SheetContent className="w-full sm:max-w-md">
          <SheetHeader><SheetTitle>Pagar Vendedor</SheetTitle></SheetHeader>
          {sellerRow && (
            <div className="mt-4 space-y-4">
              <div className="rounded-lg bg-secondary/50 p-3 space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Funcionário</span><span className="font-medium">{sellerRow.seller.name}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Faturamento</span><span className="mono">{formatCurrency(sellerRow.vendasTotal)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Comissão acumulada ({sellerRow.tier.label})</span><span className="mono text-income">{formatCurrency(sellerRow.accrued)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Já pago</span><span className="mono">{formatCurrency(sellerRow.commPaid)}</span></div>
                <div className="flex justify-between border-t border-border pt-1 mt-1"><span className="text-muted-foreground">Saldo a pagar</span><span className={cn("mono font-semibold", sellerRow.balance > 0 ? "text-warning" : "text-income")}>{formatCurrency(sellerRow.balance)}</span></div>
              </div>
              <div><Label>Valor (R$)</Label><Input type="number" step="0.01" value={payForm.amount} onChange={e => setPayForm(f => ({ ...f, amount: e.target.value }))} /></div>
              <div><Label>Data</Label><Input type="date" value={payForm.date} onChange={e => setPayForm(f => ({ ...f, date: e.target.value }))} /></div>
              <div><Label>Observação</Label><Input value={payForm.notes} onChange={e => setPayForm(f => ({ ...f, notes: e.target.value }))} placeholder="Opcional" /></div>
              <Button className="w-full" onClick={submitPay}>Registrar Pagamento</Button>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Drawer Retirada Sócio */}
      <Sheet open={!!wdDrawer} onOpenChange={(v) => !v && setWdDrawer(null)}>
        <SheetContent className="w-full sm:max-w-md">
          <SheetHeader><SheetTitle>Registrar Retirada</SheetTitle></SheetHeader>
          {partnerRow && (
            <div className="mt-4 space-y-4">
              <div className="rounded-lg bg-secondary/50 p-3 space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Sócio</span><span className="font-medium">{partnerRow.partner.name}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Retirado no período</span><span className="mono">{formatCurrency(partnerRow.periodAmt)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Retirado no ano</span><span className="mono">{formatCurrency(partnerRow.yearAmt)}</span></div>
              </div>
              <div><Label>Valor (R$)</Label><Input type="number" step="0.01" value={wdForm.amount} onChange={e => setWdForm(f => ({ ...f, amount: e.target.value }))} /></div>
              <div><Label>Data</Label><Input type="date" value={wdForm.date} onChange={e => setWdForm(f => ({ ...f, date: e.target.value }))} /></div>
              <div><Label>Observação</Label><Input value={wdForm.notes} onChange={e => setWdForm(f => ({ ...f, notes: e.target.value }))} placeholder="Opcional" /></div>
              <Button className="w-full" onClick={submitWd}>Registrar Retirada</Button>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Drawer Pagar Dívida (consumo) */}
      <Sheet open={!!debtPayDrawer} onOpenChange={(v) => !v && setDebtPayDrawer(null)}>
        <SheetContent className="w-full sm:max-w-md">
          <SheetHeader><SheetTitle>Pagar Dívida (consumo)</SheetTitle></SheetHeader>
          {debtSellerRow && (
            <div className="mt-4 space-y-4">
              <div className="rounded-lg bg-secondary/50 p-3 space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Funcionário</span><span className="font-medium">{debtSellerRow.seller.name}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Consumo + dívidas</span><span className="mono text-warning">{formatCurrency(debtSellerRow.consumoTotal)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Já pago</span><span className="mono">{formatCurrency(debtSellerRow.debtPaymentsTotal)}</span></div>
                {debtSellerRow.legacyCredit > 0 && (
                  <div className="flex justify-between"><span className="text-muted-foreground">Crédito legado (10%)</span><span className="mono text-income">{formatCurrency(debtSellerRow.legacyCredit)}</span></div>
                )}
                <div className="flex justify-between border-t border-border pt-1 mt-1"><span className="text-muted-foreground">Saldo a abater</span><span className={cn("mono font-semibold", debtSellerRow.saldoConsumo > 0 ? "text-warning" : "text-income")}>{formatCurrency(debtSellerRow.saldoConsumo)}</span></div>
              </div>
              <div><Label>Valor (R$)</Label><Input type="number" step="0.01" value={debtPayForm.amount} onChange={e => setDebtPayForm(f => ({ ...f, amount: e.target.value }))} /></div>
              <div><Label>Data</Label><Input type="date" value={debtPayForm.date} onChange={e => setDebtPayForm(f => ({ ...f, date: e.target.value }))} /></div>
              <div><Label>Observação</Label><Input value={debtPayForm.notes} onChange={e => setDebtPayForm(f => ({ ...f, notes: e.target.value }))} placeholder="Opcional" /></div>
              <Button className="w-full" onClick={submitDebtPay}>Registrar Pagamento</Button>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Drawer Dívida Manual */}
      <Sheet open={manualDebtDrawer} onOpenChange={(v) => setManualDebtDrawer(v)}>
        <SheetContent className="w-full sm:max-w-md">
          <SheetHeader><SheetTitle>Adicionar Dívida Manual</SheetTitle></SheetHeader>
          <div className="mt-4 space-y-4">
            <div>
              <Label>Funcionário</Label>
              <Select value={manualDebtForm.sellerId} onValueChange={v => setManualDebtForm(f => ({ ...f, sellerId: v }))}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {sellers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Valor (R$)</Label><Input type="number" step="0.01" value={manualDebtForm.amount} onChange={e => setManualDebtForm(f => ({ ...f, amount: e.target.value }))} /></div>
            <div><Label>Data</Label><Input type="date" value={manualDebtForm.date} onChange={e => setManualDebtForm(f => ({ ...f, date: e.target.value }))} /></div>
            <div><Label>Observação</Label><Input value={manualDebtForm.notes} onChange={e => setManualDebtForm(f => ({ ...f, notes: e.target.value }))} placeholder="Ex: adiantamento, empréstimo" /></div>
            <Button className="w-full bg-warning hover:bg-warning/90 text-warning-foreground" onClick={submitManualDebt}>Adicionar Dívida</Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* Drawer Atribuir Estoque */}
      <Sheet open={assignOpen} onOpenChange={setAssignOpen}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto p-0 flex flex-col">
          <SheetHeader className="px-6 py-4 border-b border-border">
            <SheetTitle className="text-base font-semibold">Atribuir Estoque</SheetTitle>
            <p className="text-xs text-muted-foreground">Selecione vendedor e produtos a consignar</p>
          </SheetHeader>
          <form onSubmit={handleAssign} className="flex-1 px-6 py-5 space-y-5">
            <div className="space-y-1.5">
              <Label className="text-xs">Vendedor</Label>
              <Select value={assignForm.sellerId} onValueChange={v => setAssignForm(f => ({ ...f, sellerId: v }))}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Selecione o vendedor" /></SelectTrigger>
                <SelectContent>
                  {sellers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Produtos disponíveis</Label>
                <span className="text-[10px] text-muted-foreground">{assignSelectedCount} selecionado{assignSelectedCount !== 1 ? "s" : ""}</span>
              </div>
              <div className="rounded-lg border border-border divide-y divide-border/60 max-h-72 overflow-y-auto">
                {availableProducts.length === 0 ? (
                  <p className="text-xs text-muted-foreground p-4 text-center">Todos os produtos já estão totalmente atribuídos.</p>
                ) : (
                  availableProducts.map(p => {
                    const isChecked = Object.prototype.hasOwnProperty.call(assignForm.selectedProducts, p.id);
                    return (
                      <div key={p.id} className={cn("px-3 py-2 transition-colors", isChecked && "bg-primary/5")}>
                        <div className="flex items-center gap-2">
                          <Checkbox id={`assign-${p.id}`} checked={isChecked} onCheckedChange={(c) => toggleAssignProduct(p.id, !!c)} />
                          <label htmlFor={`assign-${p.id}`} className="text-xs cursor-pointer flex-1 flex items-center justify-between">
                            <span className="font-medium">{p.flavor} <span className="text-muted-foreground font-normal">· {p.model}</span></span>
                            <span className="mono text-[10px] text-muted-foreground">{p.availableToAssign} disp.</span>
                          </label>
                        </div>
                        {isChecked && (
                          <Input type="number" min="1" max={p.availableToAssign} placeholder="Qtd"
                            value={assignForm.selectedProducts[p.id]}
                            onChange={e => setAssignForm(f => ({
                              ...f,
                              selectedProducts: { ...f.selectedProducts, [p.id]: String(Math.max(1, Math.min(Number(e.target.value) || 1, p.availableToAssign))) }
                            }))}
                            className="ml-6 mt-1.5 w-24 h-7 text-xs mono" />
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
            {assignSelectedCount > 0 && (
              <div className="rounded-lg border border-border bg-secondary/30 p-3 space-y-1">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Resumo</p>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Produtos</span>
                  <span className="mono font-medium">{assignSelectedCount}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Unidades</span>
                  <span className="mono font-semibold">{assignTotalUnits}</span>
                </div>
              </div>
            )}
            <SheetFooter className="px-0">
              <Button type="submit" className="w-full h-10" disabled={assignSubmitting || assignSelectedCount === 0 || availableProducts.length === 0}>
                {assignSubmitting ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" />
                    Atribuindo…
                  </span>
                ) : (
                  <>Atribuir {assignSelectedCount > 0 && `(${assignSelectedCount})`}</>
                )}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>



      {/* Drawer Transferir Estoque */}
      <Sheet open={transferOpen} onOpenChange={setTransferOpen}>
        <SheetContent className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle className="text-base font-semibold">Transferir Estoque</SheetTitle>
            <p className="text-xs text-muted-foreground">Mova itens consignados de um vendedor para outro</p>
          </SheetHeader>
          <div className="mt-4 space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">De (vendedor origem)</Label>
              <Select value={transferForm.fromSellerId} onValueChange={v => setTransferForm(f => ({ ...f, fromSellerId: v, assignmentId: "", quantity: "" }))}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Selecione o vendedor" /></SelectTrigger>
                <SelectContent>
                  {sellers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {transferForm.fromSellerId && (
              <div className="space-y-1.5">
                <Label className="text-xs">Produto a transferir</Label>
                {transferFromAssignments.length === 0 ? (
                  <p className="text-xs text-muted-foreground rounded-lg border border-border p-3 text-center">Este vendedor não possui estoque atribuído.</p>
                ) : (
                  <Select value={transferForm.assignmentId} onValueChange={v => setTransferForm(f => ({ ...f, assignmentId: v, quantity: "" }))}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="Selecione o produto" /></SelectTrigger>
                    <SelectContent>
                      {transferFromAssignments.map(a => (
                        <SelectItem key={a.id} value={a.id}>{a.productLabel} — {a.quantity} un.</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}

            {transferForm.assignmentId && (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs">Para (vendedor destino)</Label>
                  <Select value={transferForm.toSellerId} onValueChange={v => setTransferForm(f => ({ ...f, toSellerId: v }))}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="Selecione o vendedor" /></SelectTrigger>
                    <SelectContent>
                      {sellers.filter(s => s.id !== transferForm.fromSellerId).map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Quantidade (máx. {transferMaxQty})</Label>
                  <Input
                    type="number"
                    min="1"
                    max={transferMaxQty}
                    value={transferForm.quantity}
                    onChange={e => setTransferForm(f => ({ ...f, quantity: String(Math.max(1, Math.min(Number(e.target.value) || 1, transferMaxQty))) }))}
                    className="h-9 mono"
                  />
                </div>
              </>
            )}

            <Button
              className="w-full"
              onClick={submitTransfer}
              disabled={!transferForm.assignmentId || !transferForm.toSellerId || !Number(transferForm.quantity)}
            >
              <ArrowLeftRight size={14} className="mr-1.5" />Transferir
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* Relatório do Vendedor */}
      <SellerReportDrawer
        sellerId={extractFor}
        open={!!extractFor}
        onClose={() => setExtractFor(null)}
      />
    </div>
  );
}

function KPI({ icon, label, value, sub, tone }: { icon: React.ReactNode; label: string; value: string; sub?: string; tone?: "income" | "expense" | "warning" }) {
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-3 min-w-0">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
        <span className={cn(
          tone === "income" && "text-income",
          tone === "expense" && "text-expense",
          tone === "warning" && "text-warning",
        )}>{icon}</span>
        {label}
      </div>
      <p className={cn(
        "mt-1 text-lg sm:text-xl font-semibold mono break-all",
        tone === "expense" && "text-expense",
        tone === "income" && "text-income",
      )}>{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{sub}</p>}
    </div>
  );
}

function Line({ label, value, tone }: { label: string; value: string; tone?: "income" | "warning" | "muted" }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn(
        "mono font-semibold",
        tone === "income" && "text-income",
        tone === "warning" && "text-warning",
        tone === "muted" && "text-muted-foreground",
      )}>{value}</span>
    </div>
  );
}

function Mini({ label, value, tone, strong }: { label: string; value: string; tone?: "income" | "warning"; strong?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn(
        "text-sm mono truncate",
        strong && "font-semibold",
        tone === "income" && "text-income",
        tone === "warning" && "text-warning font-semibold",
      )}>{value}</p>
    </div>
  );
}
