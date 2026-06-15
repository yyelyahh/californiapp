import { useMemo, useState } from "react";
import { useStore } from "@/context/StoreContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Wallet, Briefcase, Sparkles, TrendingUp, Trash2, Plus, Clock, Crown, Inbox, ArrowRight } from "lucide-react";
import { format, startOfMonth, endOfMonth, startOfQuarter, endOfQuarter, startOfYear, endOfYear, isWithinInterval, parseISO, isToday, isYesterday } from "date-fns";
import { ptBR } from "date-fns/locale";
import { todayDateString, localDateToISO, formatDateBR } from "@/lib/date-utils";
import { cn } from "@/lib/utils";
import { getNextTier, unitsUntilNextTier, progressToNextTier, computeSellerCommission } from "@/lib/commissions";

function formatCurrency(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v || 0);
}

type Period = "month" | "quarter" | "year";

export default function CommissionsPage() {
  const store = useStore();
  const { sellers, partners, sales, expenses, products, commissionPayments, proLaborePayments,
          addCommissionPayment, addProLaborePayment, deleteCommissionPayment, deleteProLaborePayment,
          getSellerName } = store;

  const [period, setPeriod] = useState<Period>("month");

  const { start, end, label } = useMemo(() => {
    const now = new Date();
    if (period === "month") return { start: startOfMonth(now), end: endOfMonth(now), label: format(now, "MMMM/yyyy", { locale: ptBR }) };
    if (period === "quarter") return { start: startOfQuarter(now), end: endOfQuarter(now), label: `${format(startOfQuarter(now), "MMM", { locale: ptBR })}–${format(endOfQuarter(now), "MMM/yyyy", { locale: ptBR })}` };
    return { start: startOfYear(now), end: endOfYear(now), label: format(now, "yyyy") };
  }, [period]);

  const inPeriod = (iso: string) => {
    try { return isWithinInterval(parseISO(iso), { start, end }); } catch { return false; }
  };

  const periodMetrics = useMemo(() => {
    const salesInPeriod = sales.filter(s => s.type === "venda" && inPeriod(s.date));
    const revenue = salesInPeriod.reduce((sum, s) => sum + s.totalPrice, 0);
    const cogs = salesInPeriod.reduce((sum, s) => {
      const p = products.find(x => x.id === s.productId);
      return sum + (p?.purchasePrice ?? 0) * s.quantity;
    }, 0);
    const grossProfit = revenue - cogs;
    const periodExpenses = expenses.filter(e => inPeriod(e.date)).reduce((s, e) => s + e.amount, 0);
    const netProfit = grossProfit - periodExpenses;

    const perSeller = sellers.map(seller => {
      const ss = salesInPeriod.filter(s => s.sellerId === seller.id);
      const c = computeSellerCommission(ss);
      const paid = commissionPayments.filter(p => p.sellerId === seller.id && inPeriod(p.date)).reduce((s, p) => s + p.amount, 0);
      return { seller, ...c, paid, pending: Math.max(0, c.accrued - paid) };
    }).sort((a, b) => b.revenue - a.revenue);
    const commissionsAccrued = perSeller.reduce((s, x) => s + x.accrued, 0);
    const commissionsPaid = perSeller.reduce((s, x) => s + x.paid, 0);
    const commissionsPending = perSeller.reduce((s, x) => s + x.pending, 0);

    const perPartner = partners.map(partner => {
      const paid = proLaborePayments.filter(p => p.partnerId === partner.id && inPeriod(p.date)).reduce((s, p) => s + p.amount, 0);
      const monthly = partner.monthlyProLabore || 0;
      const target = period === "month" ? monthly : period === "quarter" ? monthly * 3 : monthly * 12;
      const pending = Math.max(0, target - paid);
      const status: "Pago" | "Parcial" | "Pendente" = pending <= 0.01 && target > 0 ? "Pago" : (paid > 0 ? "Parcial" : "Pendente");
      return { partner, target, paid, pending, status };
    });
    const proLaboreTarget = perPartner.reduce((s, x) => s + x.target, 0);
    const proLaborePaid = perPartner.reduce((s, x) => s + x.paid, 0);
    const proLaborePending = perPartner.reduce((s, x) => s + x.pending, 0);

    const available = netProfit - commissionsPending - proLaborePending;
    const leader = perSeller.find(r => r.revenue > 0) || null;

    return {
      revenue, cogs, grossProfit, netProfit, periodExpenses,
      perSeller, commissionsAccrued, commissionsPaid, commissionsPending,
      perPartner, proLaboreTarget, proLaborePaid, proLaborePending,
      available, leader,
    };
  }, [sales, expenses, products, sellers, partners, commissionPayments, proLaborePayments, period, start, end]);

  const timeline = useMemo(() => {
    const items = [
      ...commissionPayments.map(p => ({ kind: "commission" as const, id: p.id, when: p.date, amount: p.amount, who: getSellerName(p.sellerId), notes: p.notes })),
      ...proLaborePayments.map(p => ({ kind: "prolabore" as const, id: p.id, when: p.date, amount: p.amount, who: partners.find(x => x.id === p.partnerId)?.name ?? "Sócio", notes: p.notes })),
    ].sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime()).slice(0, 30);
    const groups: Record<string, typeof items> = {};
    items.forEach(it => {
      const d = parseISO(it.when);
      const k = isToday(d) ? "Hoje" : isYesterday(d) ? "Ontem" : format(d, "dd 'de' MMM", { locale: ptBR });
      (groups[k] ||= []).push(it);
    });
    return groups;
  }, [commissionPayments, proLaborePayments, partners, getSellerName]);

  const [commDrawer, setCommDrawer] = useState<{ sellerId: string } | null>(null);
  const [commForm, setCommForm] = useState({ amount: "", date: todayDateString(), notes: "" });
  const [proDrawer, setProDrawer] = useState<{ partnerId: string } | null>(null);
  const [proForm, setProForm] = useState({ amount: "", date: todayDateString(), notes: "" });

  const openCommDrawer = (sellerId: string, suggested: number) => {
    setCommDrawer({ sellerId });
    setCommForm({ amount: suggested > 0 ? suggested.toFixed(2) : "", date: todayDateString(), notes: "" });
  };
  const openProDrawer = (partnerId: string, suggested: number) => {
    setProDrawer({ partnerId });
    setProForm({ amount: suggested > 0 ? suggested.toFixed(2) : "", date: todayDateString(), notes: "" });
  };

  const submitComm = async () => {
    if (!commDrawer || !Number(commForm.amount)) return;
    await addCommissionPayment({
      sellerId: commDrawer.sellerId,
      amount: Number(commForm.amount),
      date: localDateToISO(commForm.date),
      notes: commForm.notes || undefined,
    });
    setCommDrawer(null);
  };
  const submitPro = async () => {
    if (!proDrawer || !Number(proForm.amount)) return;
    await addProLaborePayment({
      partnerId: proDrawer.partnerId,
      amount: Number(proForm.amount),
      date: localDateToISO(proForm.date),
      notes: proForm.notes || undefined,
    });
    setProDrawer(null);
  };

  const sellerRow = commDrawer ? periodMetrics.perSeller.find(r => r.seller.id === commDrawer.sellerId) : null;
  const partnerRow = proDrawer ? periodMetrics.perPartner.find(r => r.partner.id === proDrawer.partnerId) : null;

  const pendingItems = [
    ...periodMetrics.perSeller
      .filter(r => r.pending > 0.01)
      .map(r => ({ kind: "commission" as const, id: r.seller.id, label: `Comissão ${r.seller.name}`, amount: r.pending, onPay: () => openCommDrawer(r.seller.id, r.pending) })),
    ...periodMetrics.perPartner
      .filter(r => r.pending > 0.01)
      .map(r => ({ kind: "prolabore" as const, id: r.partner.id, label: `Pró-labore ${r.partner.name}`, amount: r.pending, onPay: () => openProDrawer(r.partner.id, r.pending) })),
  ].sort((a, b) => b.amount - a.amount);
  const totalPending = pendingItems.reduce((s, i) => s + i.amount, 0);

  const maxRevenue = Math.max(1, ...periodMetrics.perSeller.map(r => r.revenue));

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Comissões e Pró-labore</h1>
          <p className="text-xs text-muted-foreground">Centro de distribuição financeira · {label}</p>
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
        <KPI icon={<Wallet size={14} />} label="Comissões Pendentes" value={formatCurrency(periodMetrics.commissionsPending)} tone="warning" sub={`Acumulado ${formatCurrency(periodMetrics.commissionsAccrued)}`} />
        <KPI icon={<Briefcase size={14} />} label="Pró-labore Pendente" value={formatCurrency(periodMetrics.proLaborePending)} tone="warning" sub={`Meta ${formatCurrency(periodMetrics.proLaboreTarget)}`} />
        <div className="rounded-xl p-[1px] bg-gradient-to-br from-primary/60 via-primary/20 to-transparent">
          <div className="rounded-xl bg-card px-3 py-3 h-full">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
              <Sparkles size={14} className="text-primary" /> Saldo Disponível
            </div>
            <p className={cn("mt-1 text-lg sm:text-xl font-semibold mono", periodMetrics.available >= 0 ? "text-foreground" : "text-expense")}>
              {formatCurrency(periodMetrics.available)}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">Lucro − comissões − pró-labore</p>
          </div>
        </div>
      </div>

      {/* Mini Demonstrativo Financeiro */}
      <div className="rounded-2xl p-[1px] bg-gradient-to-br from-primary/40 via-border to-transparent">
        <div className="rounded-2xl bg-card px-4 py-4 sm:px-6 sm:py-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold tracking-tight">Demonstrativo do Período</h2>
            <span className="text-[11px] text-muted-foreground mono">{label}</span>
          </div>
          <div className="space-y-2 text-sm">
            <DemoRow label="Lucro Líquido" value={periodMetrics.netProfit} tone="income" />
            <DemoRow label="(−) Comissões Pendentes" value={-periodMetrics.commissionsPending} tone="warning" />
            <DemoRow label="(−) Pró-labore Pendente" value={-periodMetrics.proLaborePending} tone="warning" />
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

      {/* Pendências do Período */}
      <div className="glass-card p-4 sm:p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-semibold tracking-tight">Pendências do Período</h2>
            <p className="text-[11px] text-muted-foreground">Tudo que ainda precisa ser pago</p>
          </div>
          <Badge variant="secondary" className="text-[11px]">{pendingItems.length}</Badge>
        </div>
        {pendingItems.length === 0 ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
            <Inbox size={14} /> Nenhuma pendência. Tudo em dia neste período.
          </div>
        ) : (
          <>
            <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
              {pendingItems.map(it => (
                <button
                  key={`${it.kind}-${it.id}`}
                  onClick={it.onPay}
                  className="group text-left rounded-xl border border-border bg-secondary/30 hover:bg-secondary/60 transition-colors p-3 flex items-center gap-3"
                >
                  <span className={cn("w-2 h-2 rounded-full shrink-0", it.kind === "commission" ? "bg-warning" : "bg-fixed")} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">{it.kind === "commission" ? "Comissão" : "Pró-labore"}</p>
                    <p className="text-sm font-medium truncate">{it.label.replace(/^(Comissão|Pró-labore)\s/, "")}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm mono font-semibold text-warning">{formatCurrency(it.amount)}</p>
                    <span className="text-[10px] text-muted-foreground inline-flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      Pagar <ArrowRight size={10} />
                    </span>
                  </div>
                </button>
              ))}
            </div>
            <div className="mt-3 pt-3 border-t border-border flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Total Pendente</span>
              <span className="text-base mono font-bold text-warning">{formatCurrency(totalPending)}</span>
            </div>
          </>
        )}
      </div>

      {/* Ranking de Comissões */}
      <div className="glass-card overflow-hidden">
        <div className="px-4 sm:px-5 pt-4 pb-3 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold tracking-tight">Comissões dos Vendedores</h2>
            <p className="text-[11px] text-muted-foreground">Ranking por faturamento · faixas 10% / 12,5% / 15%</p>
          </div>
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
              const barPct = (r.revenue / maxRevenue) * 100;
              return (
                <div key={r.seller.id} className="px-4 sm:px-5 py-4">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex items-center gap-2 min-w-0">
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
                          <span className="mono">{r.units}</span> un. · <span className="mono">{formatCurrency(r.revenue)}</span>
                        </p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Faixa</p>
                      <Badge variant="secondary" className="font-mono">{r.tier.label}</Badge>
                    </div>
                  </div>

                  {/* Revenue bar */}
                  <div className="h-1 rounded-full bg-secondary overflow-hidden mb-3">
                    <div className={cn("h-full", isLeader ? "bg-gradient-to-r from-warning to-primary" : "bg-primary/60")} style={{ width: `${barPct}%` }} />
                  </div>

                  {/* Progress to next tier */}
                  {next ? (
                    <div className="rounded-lg bg-secondary/40 px-3 py-2 mb-3">
                      <div className="flex items-center justify-between text-[11px] mb-1.5">
                        <span className="text-muted-foreground">Para atingir <span className="text-foreground font-semibold">{next.label}</span></span>
                        <span className="mono"><span className="text-foreground font-semibold">{remaining}</span> un. restantes</span>
                      </div>
                      <Progress value={pct} className="h-1.5" />
                    </div>
                  ) : (
                    <div className="rounded-lg bg-income/10 border border-income/20 px-3 py-2 mb-3 text-[11px] text-income font-medium">
                      Faixa máxima atingida
                    </div>
                  )}

                  <div className="grid grid-cols-4 gap-2 items-end">
                    <Mini label="Acumulada" value={formatCurrency(r.accrued)} strong />
                    <Mini label="Pago" value={formatCurrency(r.paid)} tone="income" />
                    <Mini label="Pendente" value={r.pending > 0.01 ? formatCurrency(r.pending) : "—"} tone={r.pending > 0.01 ? "warning" : undefined} />
                    <div className="flex justify-end">
                      <Button size="sm" variant={r.pending > 0.01 ? "default" : "secondary"} className="h-8" onClick={() => openCommDrawer(r.seller.id, r.pending)}>
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

      {/* Pró-labore — cards */}
      <div className="space-y-3">
        <div className="flex items-end justify-between">
          <div>
            <h2 className="text-sm font-semibold tracking-tight">Pró-labore dos Sócios</h2>
            <p className="text-[11px] text-muted-foreground">Retirada mensal de cada sócio</p>
          </div>
        </div>
        {periodMetrics.perPartner.length === 0 ? (
          <div className="glass-card p-5 text-xs text-muted-foreground">Nenhum sócio cadastrado.</div>
        ) : (
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {periodMetrics.perPartner.map(r => {
              const pct = r.target > 0 ? Math.min(100, (r.paid / r.target) * 100) : 0;
              return (
                <div key={r.partner.id} className="glass-card p-4 flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate">{r.partner.name}</p>
                      <p className="text-[11px] text-muted-foreground">Sócio</p>
                    </div>
                    <Badge
                      variant="secondary"
                      className={cn(
                        r.status === "Pago" && "bg-income/15 text-income border-income/30",
                        r.status === "Parcial" && "bg-warning/15 text-warning border-warning/30",
                        r.status === "Pendente" && "bg-secondary text-muted-foreground border-border",
                      )}
                    >{r.status}</Badge>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <Mini label="Mensal" value={formatCurrency(r.partner.monthlyProLabore)} />
                    <Mini label="Pago" value={formatCurrency(r.paid)} tone="income" />
                    <Mini label="Pendente" value={formatCurrency(r.pending)} tone={r.pending > 0.01 ? "warning" : undefined} strong />
                  </div>

                  {r.target > 0 && <Progress value={pct} className="h-1.5" />}

                  <Button size="sm" variant={r.pending > 0.01 ? "default" : "secondary"} className="h-8 w-full" onClick={() => openProDrawer(r.partner.id, r.pending)}>
                    <Plus size={13} className="mr-1" />Registrar pagamento
                  </Button>
                </div>
              );
            })}
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
              <p className="text-[11px] text-muted-foreground">Os pagamentos de comissão e pró-labore aparecerão aqui.</p>
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
                          <span className="text-muted-foreground">{it.kind === "commission" ? "Comissão para" : "Pró-labore para"}</span>{" "}
                          <span className="font-medium">{it.who}</span>
                        </p>
                        {it.notes && <p className="text-[11px] text-muted-foreground truncate">{it.notes}</p>}
                      </div>
                      <span className="mono text-sm font-semibold">{formatCurrency(it.amount)}</span>
                      <span className="text-[11px] text-muted-foreground mono shrink-0 hidden sm:inline">{formatDateBR(it.when)}</span>
                      <button
                        onClick={() => it.kind === "commission" ? deleteCommissionPayment(it.id) : deleteProLaborePayment(it.id)}
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

      {/* Drawer Comissão */}
      <Sheet open={!!commDrawer} onOpenChange={(v) => !v && setCommDrawer(null)}>
        <SheetContent className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Registrar Comissão</SheetTitle>
          </SheetHeader>
          {sellerRow && (
            <div className="mt-4 space-y-4">
              <div className="rounded-lg bg-secondary/50 p-3 space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Funcionário</span><span className="font-medium">{sellerRow.seller.name}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Faixa atual</span><Badge variant="secondary">{sellerRow.tier.label}</Badge></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Acumulada</span><span className="mono">{formatCurrency(sellerRow.accrued)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Já paga</span><span className="mono text-income">{formatCurrency(sellerRow.paid)}</span></div>
                <div className="flex justify-between border-t border-border pt-1 mt-1"><span className="text-muted-foreground">Pendente</span><span className="mono font-semibold text-warning">{formatCurrency(sellerRow.pending)}</span></div>
              </div>
              <div><Label>Valor (R$)</Label><Input type="number" step="0.01" value={commForm.amount} onChange={e => setCommForm(f => ({ ...f, amount: e.target.value }))} /></div>
              <div><Label>Data</Label><Input type="date" value={commForm.date} onChange={e => setCommForm(f => ({ ...f, date: e.target.value }))} /></div>
              <div><Label>Observação</Label><Input value={commForm.notes} onChange={e => setCommForm(f => ({ ...f, notes: e.target.value }))} placeholder="Opcional" /></div>
              <Button className="w-full" onClick={submitComm}>Registrar Pagamento</Button>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Drawer Pró-labore */}
      <Sheet open={!!proDrawer} onOpenChange={(v) => !v && setProDrawer(null)}>
        <SheetContent className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Registrar Pró-labore</SheetTitle>
          </SheetHeader>
          {partnerRow && (
            <div className="mt-4 space-y-4">
              <div className="rounded-lg bg-secondary/50 p-3 space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Sócio</span><span className="font-medium">{partnerRow.partner.name}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Mensal</span><span className="mono">{formatCurrency(partnerRow.partner.monthlyProLabore)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Meta período</span><span className="mono">{formatCurrency(partnerRow.target)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Pago</span><span className="mono text-income">{formatCurrency(partnerRow.paid)}</span></div>
                <div className="flex justify-between border-t border-border pt-1 mt-1"><span className="text-muted-foreground">Pendente</span><span className="mono font-semibold text-warning">{formatCurrency(partnerRow.pending)}</span></div>
              </div>
              <div><Label>Valor (R$)</Label><Input type="number" step="0.01" value={proForm.amount} onChange={e => setProForm(f => ({ ...f, amount: e.target.value }))} /></div>
              <div><Label>Data</Label><Input type="date" value={proForm.date} onChange={e => setProForm(f => ({ ...f, date: e.target.value }))} /></div>
              <div><Label>Observação</Label><Input value={proForm.notes} onChange={e => setProForm(f => ({ ...f, notes: e.target.value }))} placeholder="Opcional" /></div>
              <Button className="w-full" onClick={submitPro}>Registrar Pró-labore</Button>
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
