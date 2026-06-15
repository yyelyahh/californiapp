import { useMemo, useState } from "react";
import { useStore } from "@/context/StoreContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Wallet, Briefcase, Sparkles, TrendingUp, Trash2, Plus, Clock } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";
import { format, startOfMonth, endOfMonth, startOfQuarter, endOfQuarter, startOfYear, endOfYear, isWithinInterval, parseISO, eachMonthOfInterval, subMonths, isToday, isYesterday } from "date-fns";
import { ptBR } from "date-fns/locale";
import { todayDateString, localDateToISO, formatDateBR } from "@/lib/date-utils";
import { cn } from "@/lib/utils";
import { COMMISSION_TIERS, getTierForUnits, getNextTier, unitsUntilNextTier, progressToNextTier, computeSellerCommission } from "@/lib/commissions";

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

  // ---- Métricas globais do período ----
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

    // por vendedor
    const perSeller = sellers.map(seller => {
      const ss = salesInPeriod.filter(s => s.sellerId === seller.id);
      const c = computeSellerCommission(ss);
      const paid = commissionPayments.filter(p => p.sellerId === seller.id && inPeriod(p.date)).reduce((s, p) => s + p.amount, 0);
      return { seller, ...c, paid, pending: Math.max(0, c.accrued - paid) };
    });
    const commissionsAccrued = perSeller.reduce((s, x) => s + x.accrued, 0);
    const commissionsPaid = perSeller.reduce((s, x) => s + x.paid, 0);
    const commissionsPending = perSeller.reduce((s, x) => s + x.pending, 0);

    // por sócio (pró-labore)
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

    return {
      revenue, cogs, grossProfit, netProfit, periodExpenses,
      perSeller, commissionsAccrued, commissionsPaid, commissionsPending,
      perPartner, proLaboreTarget, proLaborePaid, proLaborePending,
      available,
    };
  }, [sales, expenses, products, sellers, partners, commissionPayments, proLaborePayments, period, start, end]);

  // ---- Série mensal para o gráfico (últimos 6 meses) ----
  const chartData = useMemo(() => {
    const months = eachMonthOfInterval({ start: subMonths(startOfMonth(new Date()), 5), end: endOfMonth(new Date()) });
    return months.map(m => {
      const s = startOfMonth(m), e = endOfMonth(m);
      const within = (iso: string) => { try { return isWithinInterval(parseISO(iso), { start: s, end: e }); } catch { return false; } };
      const ss = sales.filter(x => x.type === "venda" && within(x.date));
      const rev = ss.reduce((acc, x) => acc + x.totalPrice, 0);
      const cogs = ss.reduce((acc, x) => acc + (products.find(p => p.id === x.productId)?.purchasePrice ?? 0) * x.quantity, 0);
      const exp = expenses.filter(x => within(x.date)).reduce((a, x) => a + x.amount, 0);
      const net = rev - cogs - exp;
      const com = sellers.reduce((acc, sl) => acc + computeSellerCommission(ss.filter(x => x.sellerId === sl.id)).accrued, 0);
      const prol = proLaborePayments.filter(x => within(x.date)).reduce((a, x) => a + x.amount, 0);
      return {
        month: format(m, "MMM", { locale: ptBR }),
        lucro: Math.round(net),
        comissoes: Math.round(com),
        proLabore: Math.round(prol),
        saldo: Math.round(net - com - prol),
      };
    });
  }, [sales, expenses, products, sellers, proLaborePayments]);

  // ---- Timeline ----
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

  // ---- Drawers ----
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

  // distribuição visual (cascata)
  const distSegments = (() => {
    const base = Math.max(0, periodMetrics.netProfit);
    const com = Math.min(periodMetrics.commissionsPending, base);
    const after1 = base - com;
    const pro = Math.min(periodMetrics.proLaborePending, after1);
    const avail = Math.max(0, after1 - pro);
    const total = base || 1;
    return {
      com: (com / total) * 100,
      pro: (pro / total) * 100,
      avail: (avail / total) * 100,
    };
  })();

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Comissões e Pró-labore</h1>
          <p className="text-xs text-muted-foreground">Distribuição de resultados · {label}</p>
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

      {/* Distribuição de Resultados */}
      <div className="glass-card p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h2 className="text-sm font-semibold tracking-tight">Distribuição de Resultados</h2>
          <span className="text-[11px] text-muted-foreground mono">{label}</span>
        </div>
        <div className="h-3 rounded-full overflow-hidden bg-secondary flex">
          <div className="h-full bg-warning/80" style={{ width: `${distSegments.com}%` }} />
          <div className="h-full bg-fixed/80" style={{ width: `${distSegments.pro}%` }} />
          <div className="h-full bg-income/80" style={{ width: `${distSegments.avail}%` }} />
        </div>
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <DistItem dot="bg-primary" label="Lucro Líquido" value={periodMetrics.netProfit} />
          <DistItem dot="bg-warning" label="Comissões" value={periodMetrics.commissionsPending} />
          <DistItem dot="bg-fixed" label="Pró-labore" value={periodMetrics.proLaborePending} />
          <DistItem dot="bg-income" label="Saldo" value={periodMetrics.available} highlight />
        </div>
      </div>

      {/* Tabela Vendedores */}
      <div className="glass-card overflow-hidden">
        <div className="px-4 sm:px-5 pt-4 pb-3 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold tracking-tight">Comissões dos Vendedores</h2>
            <p className="text-[11px] text-muted-foreground">Faixas progressivas: 10% até 10un · 12,5% até 15un · 15% a partir de 16un</p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="border-y border-border bg-secondary/30 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                <th className="text-left py-2 px-3">Funcionário</th>
                <th className="text-right py-2 px-3">Un.</th>
                <th className="text-right py-2 px-3">Faturamento</th>
                <th className="text-left py-2 px-3">Faixa / Progresso</th>
                <th className="text-right py-2 px-3">Acumulada</th>
                <th className="text-right py-2 px-3">Pago</th>
                <th className="text-right py-2 px-3">Pendente</th>
                <th className="text-right py-2 px-3 w-[120px]">Ação</th>
              </tr>
            </thead>
            <tbody>
              {periodMetrics.perSeller.length === 0 ? (
                <tr><td colSpan={8} className="py-8 text-center text-xs text-muted-foreground">Nenhum vendedor cadastrado.</td></tr>
              ) : periodMetrics.perSeller.map(r => {
                const next = getNextTier(r.tier);
                const remaining = unitsUntilNextTier(r.units);
                const pct = progressToNextTier(r.units);
                return (
                  <tr key={r.seller.id} className="border-b border-border/40 last:border-0 align-middle">
                    <td className="py-3 px-3 font-medium">{r.seller.name}</td>
                    <td className="py-3 px-3 text-right mono">{r.units}</td>
                    <td className="py-3 px-3 text-right mono">{formatCurrency(r.revenue)}</td>
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="font-mono">{r.tier.label}</Badge>
                        {next ? (
                          <span className="text-[11px] text-muted-foreground">faltam <span className="text-foreground font-medium">{remaining}</span> p/ {next.label}</span>
                        ) : (
                          <span className="text-[11px] text-income font-medium">faixa máxima</span>
                        )}
                      </div>
                      {next && <Progress value={pct} className="h-1 mt-1.5" />}
                    </td>
                    <td className="py-3 px-3 text-right mono font-semibold">{formatCurrency(r.accrued)}</td>
                    <td className="py-3 px-3 text-right mono text-income">{formatCurrency(r.paid)}</td>
                    <td className="py-3 px-3 text-right mono">
                      {r.pending > 0.01 ? <span className="text-warning font-semibold">{formatCurrency(r.pending)}</span> : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="py-3 px-3 text-right">
                      <Button size="sm" variant="secondary" className="h-8" onClick={() => openCommDrawer(r.seller.id, r.pending)}>
                        <Plus size={13} className="mr-1" />Pagar
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Tabela Sócios */}
      <div className="glass-card overflow-hidden">
        <div className="px-4 sm:px-5 pt-4 pb-3">
          <h2 className="text-sm font-semibold tracking-tight">Pró-labore dos Sócios</h2>
          <p className="text-[11px] text-muted-foreground">Valor mensal de retirada de cada sócio</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr className="border-y border-border bg-secondary/30 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                <th className="text-left py-2 px-3">Sócio</th>
                <th className="text-right py-2 px-3">Valor Mensal</th>
                <th className="text-right py-2 px-3">Meta Período</th>
                <th className="text-right py-2 px-3">Pago</th>
                <th className="text-left py-2 px-3">Status</th>
                <th className="text-right py-2 px-3 w-[120px]">Ação</th>
              </tr>
            </thead>
            <tbody>
              {periodMetrics.perPartner.length === 0 ? (
                <tr><td colSpan={6} className="py-8 text-center text-xs text-muted-foreground">Nenhum sócio cadastrado.</td></tr>
              ) : periodMetrics.perPartner.map(r => (
                <tr key={r.partner.id} className="border-b border-border/40 last:border-0">
                  <td className="py-3 px-3 font-medium">{r.partner.name}</td>
                  <td className="py-3 px-3 text-right mono">{formatCurrency(r.partner.monthlyProLabore)}</td>
                  <td className="py-3 px-3 text-right mono text-muted-foreground">{formatCurrency(r.target)}</td>
                  <td className="py-3 px-3 text-right mono text-income">{formatCurrency(r.paid)}</td>
                  <td className="py-3 px-3">
                    <Badge
                      variant="secondary"
                      className={cn(
                        r.status === "Pago" && "bg-income/15 text-income border-income/30",
                        r.status === "Parcial" && "bg-warning/15 text-warning border-warning/30",
                        r.status === "Pendente" && "bg-secondary text-muted-foreground border-border",
                      )}
                    >{r.status}</Badge>
                  </td>
                  <td className="py-3 px-3 text-right">
                    <Button size="sm" variant="secondary" className="h-8" onClick={() => openProDrawer(r.partner.id, r.pending)}>
                      <Plus size={13} className="mr-1" />Pagar
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Gráfico evolução */}
      <div className="glass-card p-4 sm:p-5">
        <h2 className="text-sm font-semibold tracking-tight mb-3">Evolução (últimos 6 meses)</h2>
        <div className="h-[260px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 5, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={11} />
              <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
              <Tooltip
                contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                formatter={(v: number) => formatCurrency(v)}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="lucro" name="Lucro" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="comissoes" name="Comissões" stroke="hsl(var(--warning))" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="proLabore" name="Pró-labore" stroke="hsl(var(--fixed))" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="saldo" name="Saldo" stroke="hsl(var(--income))" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Timeline */}
      <div className="glass-card p-4 sm:p-5">
        <div className="flex items-center gap-2 mb-3">
          <Clock size={14} className="text-muted-foreground" />
          <h2 className="text-sm font-semibold tracking-tight">Histórico Financeiro</h2>
        </div>
        {Object.keys(timeline).length === 0 ? (
          <p className="text-xs text-muted-foreground py-6 text-center">Nenhum pagamento registrado ainda.</p>
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
                        <p className="text-sm">
                          <span className="text-muted-foreground">{it.kind === "commission" ? "Comissão paga para" : "Pró-labore para"}</span>{" "}
                          <span className="font-medium">{it.who}</span>
                        </p>
                        {it.notes && <p className="text-[11px] text-muted-foreground truncate">{it.notes}</p>}
                      </div>
                      <span className="mono text-sm font-semibold">{formatCurrency(it.amount)}</span>
                      <span className="text-[11px] text-muted-foreground mono shrink-0">{formatDateBR(it.when)}</span>
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

function DistItem({ dot, label, value, highlight }: { dot: string; label: string; value: number; highlight?: boolean }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className={cn("w-2 h-2 rounded-full shrink-0", dot)} />
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className={cn("text-sm mono font-semibold truncate", highlight && "text-income")}>{formatCurrency(value)}</p>
      </div>
    </div>
  );
}
