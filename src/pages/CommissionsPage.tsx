import { useMemo, useState } from "react";
import { useStore } from "@/context/StoreContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Wallet, Sparkles, TrendingUp, Trash2, Plus, Clock, Crown, Inbox,
  ArrowRight, ArrowDownCircle, ArrowUpCircle, Award, Users, X, RefreshCw,
} from "lucide-react";
import {
  format, startOfMonth, endOfMonth, startOfQuarter, endOfQuarter, startOfYear,
  endOfYear, isWithinInterval, parseISO, isToday, isYesterday,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { todayDateString, localDateToISO, formatDateBR } from "@/lib/date-utils";
import { cn } from "@/lib/utils";
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
  const {
    sellers, partners, sales, expenses, products,
    commissionPayments, proLaborePayments, sellerDebtPayments, sellerManualDebts,
    addCommissionPayment, addProLaborePayment,
    deleteCommissionPayment, deleteProLaborePayment,
    getSellerName, deleteSeller,
  } = store;

  // Retiradas dos sócios = proLaborePayments (apenas relabel semântico)
  const withdrawals = proLaborePayments;
  const addWithdrawal = addProLaborePayment;
  const deleteWithdrawal = deleteProLaborePayment;

  const [period, setPeriod] = useState<Period>("month");

  // Cutoff: ignora qualquer movimentação anterior ao mês atual (início do projeto)
  const PROJECT_START = useMemo(() => startOfMonth(new Date()), []);

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

    // Conta Corrente do vendedor — APENAS comissão (não inclui valor bruto das vendas)
    const perSeller = sellers.map(seller => {
      const sellerSales = salesPeriod.filter(s => s.sellerId === seller.id);
      const vendas = sellerSales.filter(s => s.type === "venda");
      const vendasTotal = vendas.reduce((a, s) => a + s.totalPrice, 0);
      const commPaid = commissionPayments.filter(p => p.sellerId === seller.id && inPeriod(p.date)).reduce((a, p) => a + p.amount, 0);

      const c = computeSellerCommission(vendas);
      const accrued = c.accrued; // comissão total = receita × taxa da faixa atual
      const units = c.units;

      // Quebra cronológica em accruals + ajustes de faixa (para o extrato)
      const accrualItems = computeAccrualHistory(vendas);
      const adjustmentsTotal = accrualItems.filter(i => i.kind === "adjustment").reduce((a, x) => a + x.amount, 0);
      const baseAccrued = accrued - adjustmentsTotal;

      const balance = accrued - commPaid;

      return {
        seller, units, vendasTotal, commPaid,
        accrued, baseAccrued, adjustmentsTotal,
        tier: c.tier, balance, accrualItems,
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
      const d = parseISO(it.when);
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

  const sellerRow = payDrawer ? periodMetrics.perSeller.find(r => r.seller.id === payDrawer.sellerId) : null;
  const partnerRow = wdDrawer ? periodMetrics.perPartner.find(r => r.partner.id === wdDrawer.partnerId) : null;
  const extractRow = extractFor ? periodMetrics.perSeller.find(r => r.seller.id === extractFor) : null;

  // Extrato do vendedor — apenas comissão (sem vendas brutas, sem retiradas de produto, sem débitos manuais)
  const extractItems = useMemo(() => {
    if (!extractRow) return [];
    const sid = extractRow.seller.id;
    const items: { id: string; when: string; label: string; amount: number; kind: "credit" | "debit"; icon: "accrual" | "adjustment" | "pagamento"; meta?: string }[] = [];

    extractRow.accrualItems.forEach(it => {
      items.push({
        id: it.id, when: it.when, label: it.label, amount: it.amount,
        kind: "credit",
        icon: it.kind === "adjustment" ? "adjustment" : "accrual",
        meta: it.meta,
      });
    });
    commissionPayments.filter(p => p.sellerId === sid && inPeriod(p.date)).forEach(p => {
      items.push({ id: `c-${p.id}`, when: p.date, label: "Pagamento de Comissão", amount: p.amount, kind: "debit", icon: "pagamento", meta: p.notes });
    });
    return items.sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime());
  }, [extractRow, commissionPayments, start, end]);

  const maxVendas = Math.max(1, ...periodMetrics.perSeller.map(r => r.vendasTotal));

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Comissão</h1>
          <p className="text-xs text-muted-foreground">Saldos dos vendedores e retiradas dos sócios · {label}</p>
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

      {/* Demonstrativo */}
      <div className="rounded-2xl p-[1px] bg-gradient-to-br from-primary/40 via-border to-transparent">
        <div className="rounded-2xl bg-card px-4 py-4 sm:px-6 sm:py-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold tracking-tight">Demonstrativo do Período</h2>
            <span className="text-[11px] text-muted-foreground mono">{label}</span>
          </div>
          <div className="space-y-2 text-sm">
            <DemoRow label="Lucro Líquido" value={periodMetrics.netProfit} tone="income" />
            <DemoRow label="(−) A pagar a vendedores" value={-periodMetrics.totalSellerBalance} tone="warning" />
            <DemoRow label="(−) Retiradas dos Sócios" value={-periodMetrics.totalWithdrawalsPeriod} tone="warning" />
            <div className="border-t border-dashed border-border my-2" />
            <div className="flex items-baseline justify-between gap-3 pt-1">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Saldo Disponível</p>
                <p className="text-[11px] text-muted-foreground">Pronto para retirada ou reinvestimento</p>
              </div>
              <p className={cn("text-2xl sm:text-3xl font-bold mono", periodMetrics.available >= 0 ? "text-income" : "text-expense")}>
                {formatCurrency(periodMetrics.available)}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Conta Corrente dos Vendedores */}
      <div className="glass-card overflow-hidden">
        <div className="px-4 sm:px-5 pt-4 pb-3 flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold tracking-tight">Conta Corrente dos Vendedores</h2>
            <p className="text-[11px] text-muted-foreground">Saldo unificado · vendas + bônus − retiradas − pagamentos</p>
          </div>
          <Badge variant="secondary" className="text-[11px]">{periodMetrics.perSeller.length}</Badge>
        </div>
        {periodMetrics.perSeller.length === 0 ? (
          <p className="px-5 pb-5 text-xs text-muted-foreground">Nenhum vendedor cadastrado.</p>
        ) : (
          <div className="divide-y divide-border/40">
            {periodMetrics.perSeller.map((r, idx) => {
              const next = getNextTier(r.tier);
              const remaining = unitsUntilNextTier(r.units);
              const pct = progressToNextTier(r.units);
              const isLeader = periodMetrics.leader?.seller.id === r.seller.id;
              const barPct = (r.vendasTotal / maxVendas) * 100;
              const positive = r.balance > 0.01;
              return (
                <div key={r.seller.id} className="px-4 sm:px-5 py-4 group/seller">
                  <div className="flex items-start justify-between gap-3 mb-2">
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
                        <p className="text-[11px] text-muted-foreground">
                          <span className="mono">{r.units}</span> un. · faturamento <span className="mono">{formatCurrency(r.vendasTotal)}</span> · faixa <span className="font-mono">{r.tier.label}</span>
                        </p>
                      </div>
                    </button>
                    <div className="flex items-start gap-2 shrink-0">
                      <div className="text-right">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Saldo de Comissão</p>
                        <p className={cn("text-base sm:text-lg mono font-bold", positive ? "text-warning" : r.balance < -0.01 ? "text-income" : "text-foreground")}>
                          {formatCurrency(r.balance)}
                        </p>
                      </div>
                      <button
                        onClick={() => { if (confirm(`Remover ${r.seller.name} da lista de comissão?\n\nIsso excluirá o vendedor permanentemente.`)) deleteSeller(r.seller.id); }}
                        className="text-muted-foreground/40 hover:text-destructive transition-colors p-1 opacity-0 group-hover/seller:opacity-100"
                        aria-label="Remover vendedor"
                      ><X size={14} /></button>
                    </div>
                  </div>

                  <div className="h-1 rounded-full bg-secondary overflow-hidden mb-3">
                    <div className={cn("h-full", isLeader ? "bg-gradient-to-r from-warning to-primary" : "bg-primary/60")} style={{ width: `${barPct}%` }} />
                  </div>

                  {next && (
                    <div className="rounded-lg bg-secondary/40 px-3 py-2 mb-3">
                      <div className="flex items-center justify-between text-[11px] mb-1.5">
                        <span className="text-muted-foreground">Para atingir <span className="text-foreground font-semibold">{next.label}</span></span>
                        <span className="mono"><span className="text-foreground font-semibold">{remaining}</span> un. restantes</span>
                      </div>
                      <Progress value={pct} className="h-1.5" />
                    </div>
                  )}

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <Mini label="Comissão base" value={formatCurrency(r.baseAccrued)} tone="income" />
                    <Mini label="Ajustes faixa" value={formatCurrency(r.adjustmentsTotal)} tone={r.adjustmentsTotal > 0 ? "income" : undefined} />
                    <Mini label="Pago" value={formatCurrency(r.commPaid)} tone="warning" />
                    <div className="flex sm:justify-end gap-2 items-end">
                      <Button size="sm" variant="ghost" className="h-8 text-[11px]" onClick={() => setExtractFor(r.seller.id)}>
                        Extrato <ArrowRight size={11} className="ml-1" />
                      </Button>
                      <Button size="sm" variant={positive ? "default" : "secondary"} className="h-8" onClick={() => openPay(r.seller.id, Math.max(0, r.balance))}>
                        <Plus size={13} className="mr-1" />Pagar
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Retiradas dos Sócios */}
      <div className="space-y-3">
        <div className="flex items-end justify-between">
          <div>
            <h2 className="text-sm font-semibold tracking-tight">Retiradas dos Sócios</h2>
            <p className="text-[11px] text-muted-foreground">Histórico de retiradas reais de cada sócio</p>
          </div>
        </div>
        {periodMetrics.perPartner.length === 0 ? (
          <div className="glass-card p-5 text-xs text-muted-foreground">Nenhum sócio cadastrado.</div>
        ) : (
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {periodMetrics.perPartner.map(r => (
              <div key={r.partner.id} className="glass-card p-4 flex flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">{r.partner.name}</p>
                    <p className="text-[11px] text-muted-foreground">Sócio · {r.partner.percentage}%</p>
                  </div>
                  {r.count > 0 && <Badge variant="secondary" className="text-[10px]">{r.count} no período</Badge>}
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <Mini label="No período" value={formatCurrency(r.periodAmt)} strong tone={r.periodAmt > 0 ? "warning" : undefined} />
                  <Mini label="No ano" value={formatCurrency(r.yearAmt)} />
                </div>

                <div className="rounded-lg bg-secondary/40 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Última retirada</p>
                  {r.last ? (
                    <div className="flex items-baseline justify-between gap-2 mt-0.5">
                      <span className="text-sm mono font-semibold">{formatCurrency(r.last.amount)}</span>
                      <span className="text-[11px] text-muted-foreground mono">{formatDateBR(r.last.date)}</span>
                    </div>
                  ) : (
                    <p className="text-[11px] text-muted-foreground mt-0.5">Nenhuma ainda</p>
                  )}
                </div>

                <Button size="sm" className="h-8 w-full" onClick={() => openWd(r.partner.id)}>
                  <Plus size={13} className="mr-1" />Registrar Retirada
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Histórico */}
      <div className="glass-card p-4 sm:p-5">
        <div className="flex items-center gap-2 mb-3">
          <Clock size={14} className="text-muted-foreground" />
          <h2 className="text-sm font-semibold tracking-tight">Histórico Financeiro</h2>
        </div>
        {Object.keys(timeline).length === 0 ? (
          <div className="flex items-start gap-2.5 py-1">
            <Inbox size={14} className="text-muted-foreground mt-0.5 shrink-0" />
            <div>
              <p className="text-xs text-foreground">Nenhum pagamento registrado ainda.</p>
              <p className="text-[11px] text-muted-foreground">Pagamentos a vendedores e retiradas dos sócios aparecerão aqui.</p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {Object.entries(timeline).map(([day, items]) => (
              <div key={day}>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">{day}</div>
                <div className="space-y-1">
                  {items.map(it => (
                    <div key={`${it.kind}-${it.id}`} className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-secondary/40 transition-colors">
                      <div className={cn("w-1.5 h-1.5 rounded-full shrink-0", it.kind === "commission" ? "bg-warning" : "bg-fixed")} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm truncate">
                          <span className="text-muted-foreground">{it.kind === "commission" ? "Pagamento a" : "Retirada"}</span>{" "}
                          <span className="font-medium">{it.who}</span>
                        </p>
                        {it.notes && <p className="text-[11px] text-muted-foreground truncate">{it.notes}</p>}
                      </div>
                      <span className="mono text-sm font-semibold">{formatCurrency(it.amount)}</span>
                      <span className="text-[11px] text-muted-foreground mono shrink-0 hidden sm:inline">{formatDateBR(it.when)}</span>
                      <button
                        onClick={() => it.kind === "commission" ? deleteCommissionPayment(it.id) : deleteWithdrawal(it.id)}
                        className="text-muted-foreground hover:text-destructive transition-colors p-1"
                        aria-label="Excluir"
                      ><Trash2 size={13} /></button>
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

      {/* Drawer Extrato Vendedor */}
      <Sheet open={!!extractFor} onOpenChange={(v) => !v && setExtractFor(null)}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader><SheetTitle>Extrato do Vendedor</SheetTitle></SheetHeader>
          {extractRow && (
            <div className="mt-4 space-y-4">
              <div className="rounded-lg bg-secondary/50 p-3">
                <p className="text-sm font-semibold">{extractRow.seller.name}</p>
                <p className="text-[11px] text-muted-foreground">{label} · faixa {extractRow.tier.label}</p>
                <div className="grid grid-cols-3 gap-2 mt-3">
                  <Mini label="Acumulada" value={formatCurrency(extractRow.accrued)} tone="income" />
                  <Mini label="Paga" value={formatCurrency(extractRow.commPaid)} tone="warning" />
                  <Mini label="Saldo" value={formatCurrency(extractRow.balance)} strong tone={extractRow.balance > 0 ? "warning" : "income"} />
                </div>
              </div>

              {extractItems.length === 0 ? (
                <p className="text-xs text-muted-foreground py-4 text-center">Sem movimentações no período.</p>
              ) : (
                <div className="space-y-1">
                  {extractItems.map(it => (
                    <div key={it.id} className="flex items-center gap-3 rounded-lg border border-border/60 px-3 py-2">
                      <ExtractIcon kind={it.icon} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{it.label}</p>
                        <p className="text-[11px] text-muted-foreground mono">{formatDateBR(it.when)}</p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {it.kind === "credit"
                          ? <ArrowUpCircle size={14} className="text-income" />
                          : <ArrowDownCircle size={14} className="text-warning" />}
                        <span className={cn("mono text-sm font-semibold", it.kind === "credit" ? "text-income" : "text-warning")}>
                          {it.kind === "credit" ? "+" : "−"}{formatCurrency(it.amount)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-center justify-between rounded-lg bg-secondary p-3 sticky bottom-0">
                <span className="text-xs uppercase tracking-wider font-semibold text-muted-foreground">Saldo Atual</span>
                <span className={cn("mono text-lg font-bold", extractRow.balance > 0 ? "text-warning" : "text-income")}>
                  {formatCurrency(extractRow.balance)}
                </span>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
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

function DemoRow({ label, value, tone }: { label: string; value: number; tone?: "income" | "warning" | "expense" }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn(
        "mono font-semibold",
        tone === "income" && value >= 0 && "text-income",
        tone === "warning" && "text-warning",
        tone === "expense" && "text-expense",
      )}>{formatCurrency(value)}</span>
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

function ExtractIcon({ kind }: { kind: "venda" | "retirada" | "bonus" | "pagamento" | "ajuste" }) {
  const cls = "w-7 h-7 rounded-full flex items-center justify-center shrink-0";
  if (kind === "venda") return <div className={cn(cls, "bg-income/15 text-income")}><Banknote size={14} /></div>;
  if (kind === "retirada") return <div className={cn(cls, "bg-warning/15 text-warning")}><Package size={14} /></div>;
  if (kind === "bonus") return <div className={cn(cls, "bg-primary/15 text-primary")}><Award size={14} /></div>;
  if (kind === "pagamento") return <div className={cn(cls, "bg-fixed/15 text-fixed")}><Wallet size={14} /></div>;
  return <div className={cn(cls, "bg-secondary text-muted-foreground")}><ArrowDownCircle size={14} /></div>;
}
