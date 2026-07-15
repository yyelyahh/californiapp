import { useMemo, useState } from "react";
import { useStore } from "@/context/StoreContext";
import { cn } from "@/lib/utils";
import {
  Wallet, Boxes, HandCoins, Users, Landmark, TrendingUp, ArrowDownRight, ArrowUpRight,
  Plus, Trash2, ArrowRightLeft, Package, Receipt, Sparkles, AlertTriangle, CheckCircle2,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useConfirm } from "@/components/ConfirmProvider";
import { todayDateString } from "@/lib/date-utils";
import type { FinancialEventKind } from "@/types";

function formatCurrency(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v || 0);
}

const kindMeta: Record<FinancialEventKind, { label: string; icon: any; tone: string }> = {
  partner_contribution: { label: "Aporte", icon: Users, tone: "text-primary" },
  loan_received: { label: "Empréstimo recebido", icon: Landmark, tone: "text-primary" },
  loan_payment: { label: "Pagamento de empréstimo", icon: ArrowDownRight, tone: "text-warning" },
  stock_purchase: { label: "Compra de estoque", icon: Package, tone: "text-muted-foreground" },
  sale: { label: "Venda", icon: TrendingUp, tone: "text-income" },
  sale_cogs: { label: "CPV", icon: ArrowDownRight, tone: "text-muted-foreground" },
  expense: { label: "Despesa", icon: Receipt, tone: "text-destructive" },
  withdrawal: { label: "Retirada de sócio", icon: HandCoins, tone: "text-warning" },
  commission_paid: { label: "Comissão paga", icon: Sparkles, tone: "text-warning" },
  stock_loss: { label: "Perda de estoque", icon: AlertTriangle, tone: "text-destructive" },
};

export default function FinancePage() {
  const store = useStore();
  const confirm = useConfirm();
  const {
    partners, partnerContributions, loans, loanPayments, financialEvents,
    addPartnerContribution, deletePartnerContribution,
    addLoan, addLoanPayment,
    getCash, getInventoryCostValue, getReceivables,
    getPartnerCapital, getLoansOutstanding,
    getAccumulatedProfit, getDistributedProfit, getRetainedEarnings,
    getLoanPaid, getLoanRemaining,
  } = store;

  const [filterKind, setFilterKind] = useState<"all" | FinancialEventKind>("all");

  const cash = getCash();
  const inventory = getInventoryCostValue();
  const receivables = getReceivables();
  const totalAssets = cash + inventory + receivables;

  const partnerCapital = getPartnerCapital();
  const loansOutstanding = getLoansOutstanding();
  const accumulated = getAccumulatedProfit();
  const distributed = getDistributedProfit();
  const retained = getRetainedEarnings();
  const totalEquityAndLiabilities = partnerCapital + loansOutstanding + retained;

  const bookDiff = totalAssets - totalEquityAndLiabilities;
  const bookMatches = Math.abs(bookDiff) < 0.01;

  const events = useMemo(() => {
    const list = filterKind === "all"
      ? financialEvents
      : financialEvents.filter(e => e.kind === filterKind);
    return [...list].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [financialEvents, filterKind]);

  // ---- Contribution dialog ----
  const [contribOpen, setContribOpen] = useState(false);
  const [contribForm, setContribForm] = useState({ partnerId: "", amount: "", date: todayDateString(), notes: "" });
  const submitContrib = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contribForm.partnerId || !Number(contribForm.amount)) return;
    await addPartnerContribution({
      partnerId: contribForm.partnerId,
      amount: Number(contribForm.amount),
      date: contribForm.date,
      notes: contribForm.notes.trim() || undefined,
    });
    setContribForm({ partnerId: "", amount: "", date: todayDateString(), notes: "" });
    setContribOpen(false);
  };

  // ---- Loan dialog ----
  const [loanOpen, setLoanOpen] = useState(false);
  const [loanForm, setLoanForm] = useState({ lenderName: "", principal: "", interestAmount: "", receivedDate: todayDateString(), notes: "" });
  const submitLoan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loanForm.lenderName.trim() || !Number(loanForm.principal)) return;
    await addLoan({
      lenderName: loanForm.lenderName.trim(),
      principal: Number(loanForm.principal),
      interestAmount: Number(loanForm.interestAmount) || 0,
      receivedDate: loanForm.receivedDate,
      notes: loanForm.notes.trim() || undefined,
    });
    setLoanForm({ lenderName: "", principal: "", interestAmount: "", receivedDate: todayDateString(), notes: "" });
    setLoanOpen(false);
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Financeiro</h1>
          <p className="text-xs text-muted-foreground">Patrimônio, capital e lucro — contabilidade simplificada</p>
        </div>
        <div className="flex gap-2">
          <Dialog open={contribOpen} onOpenChange={setContribOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline" className="h-9"><Plus size={15} className="mr-1.5" />Aporte</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle className="text-base">Aporte de sócio</DialogTitle></DialogHeader>
              <form onSubmit={submitContrib} className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Sócio</Label>
                  <Select value={contribForm.partnerId} onValueChange={v => setContribForm(f => ({ ...f, partnerId: v }))}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>{partners.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5"><Label className="text-xs">Valor</Label><Input type="number" step="0.01" value={contribForm.amount} onChange={e => setContribForm(f => ({ ...f, amount: e.target.value }))} className="h-9 mono" /></div>
                  <div className="space-y-1.5"><Label className="text-xs">Data</Label><Input type="date" value={contribForm.date} onChange={e => setContribForm(f => ({ ...f, date: e.target.value }))} className="h-9" /></div>
                </div>
                <div className="space-y-1.5"><Label className="text-xs">Observação</Label><Input value={contribForm.notes} onChange={e => setContribForm(f => ({ ...f, notes: e.target.value }))} placeholder="Opcional" className="h-9" /></div>
                <Button type="submit" className="w-full h-10">Registrar aporte</Button>
              </form>
            </DialogContent>
          </Dialog>

          <Dialog open={loanOpen} onOpenChange={setLoanOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="h-9"><Plus size={15} className="mr-1.5" />Empréstimo</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle className="text-base">Empréstimo recebido</DialogTitle></DialogHeader>
              <form onSubmit={submitLoan} className="space-y-3">
                <div className="space-y-1.5"><Label className="text-xs">Credor</Label><Input value={loanForm.lenderName} onChange={e => setLoanForm(f => ({ ...f, lenderName: e.target.value }))} className="h-9" /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5"><Label className="text-xs">Principal (R$)</Label><Input type="number" step="0.01" value={loanForm.principal} onChange={e => setLoanForm(f => ({ ...f, principal: e.target.value }))} className="h-9 mono" /></div>
                  <div className="space-y-1.5"><Label className="text-xs">Juros totais (R$)</Label><Input type="number" step="0.01" value={loanForm.interestAmount} onChange={e => setLoanForm(f => ({ ...f, interestAmount: e.target.value }))} className="h-9 mono" placeholder="0" /></div>
                </div>
                <div className="space-y-1.5"><Label className="text-xs">Data de recebimento</Label><Input type="date" value={loanForm.receivedDate} onChange={e => setLoanForm(f => ({ ...f, receivedDate: e.target.value }))} className="h-9" /></div>
                <div className="space-y-1.5"><Label className="text-xs">Observação</Label><Input value={loanForm.notes} onChange={e => setLoanForm(f => ({ ...f, notes: e.target.value }))} placeholder="Opcional" className="h-9" /></div>
                <Button type="submit" className="w-full h-10">Registrar empréstimo</Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Balanço: Ativo vs Passivo + PL */}
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold tracking-tight">Patrimônio (Ativo)</h2>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">o que temos</span>
          </div>
          <PatrimonyRow icon={Wallet} label="Caixa" value={cash} tone="text-income" />
          <PatrimonyRow icon={Boxes} label="Estoque (a custo)" value={inventory} tone="text-primary" />
          <PatrimonyRow icon={ArrowUpRight} label="A receber" value={receivables} tone={receivables > 0 ? "text-warning" : "text-muted-foreground"} />
          <div className="pt-2 border-t border-border flex items-center justify-between">
            <span className="text-xs font-semibold">Patrimônio total</span>
            <span className="mono text-base font-semibold">{formatCurrency(totalAssets)}</span>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold tracking-tight">Capital + Passivo</h2>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">de onde veio</span>
          </div>
          <PatrimonyRow icon={Users} label="Capital dos sócios" value={partnerCapital} tone="text-primary" />
          <PatrimonyRow icon={Landmark} label="Empréstimos pendentes" value={loansOutstanding} tone={loansOutstanding > 0 ? "text-warning" : "text-muted-foreground"} />
          <PatrimonyRow icon={TrendingUp} label="Lucros acumulados (retidos)" value={retained} tone={retained >= 0 ? "text-income" : "text-destructive"} />
          <div className="pt-2 border-t border-border flex items-center justify-between">
            <span className="text-xs font-semibold">Total</span>
            <span className="mono text-base font-semibold">{formatCurrency(totalEquityAndLiabilities)}</span>
          </div>
        </div>
      </div>

      {/* Book match badge */}
      <div className={cn(
        "rounded-lg border px-3 py-2 flex items-center justify-between text-xs",
        bookMatches ? "border-income/30 bg-income/5" : "border-destructive/30 bg-destructive/5"
      )}>
        <div className="flex items-center gap-2">
          {bookMatches
            ? <CheckCircle2 size={14} className="text-income" />
            : <AlertTriangle size={14} className="text-destructive" />}
          <span className="font-medium">
            {bookMatches ? "Livro bate" : "Livro não bate"}
          </span>
          <span className="text-muted-foreground">
            Ativo {formatCurrency(totalAssets)} = Passivo+PL {formatCurrency(totalEquityAndLiabilities)}
          </span>
        </div>
        {!bookMatches && (
          <span className="mono text-destructive">Δ {formatCurrency(bookDiff)}</span>
        )}
      </div>

      {/* Distribuição de lucro */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-2">
        <h2 className="text-sm font-semibold tracking-tight">Distribuição de lucro</h2>
        <LedgerLine label="Lucro operacional acumulado" value={accumulated} bold />
        <LedgerLine label="(−) Já distribuído aos sócios" value={-distributed} />
        <div className="border-t border-border pt-2 flex items-center justify-between">
          <span className="text-xs font-semibold">Lucros retidos (disponível)</span>
          <span className={cn("mono text-base font-semibold", retained >= 0 ? "text-income" : "text-destructive")}>{formatCurrency(retained)}</span>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Compras de estoque e aportes de sócios não afetam o lucro — são apenas trocas de patrimônio.
        </p>
      </div>

      {/* Aportes dos sócios */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold tracking-tight">Aportes dos sócios</h2>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Total: {formatCurrency(partnerCapital)}</span>
        </div>
        {partnerContributions.length === 0 ? (
          <p className="text-xs text-muted-foreground italic py-2">Nenhum aporte registrado.</p>
        ) : (
          <div className="divide-y divide-border/60">
            {[...partnerContributions].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).map(c => {
              const partner = partners.find(p => p.id === c.partnerId);
              return (
                <div key={c.id} className="flex items-center justify-between py-2 group">
                  <div className="min-w-0">
                    <p className="text-xs font-medium">{partner?.name ?? "—"}</p>
                    <p className="text-[10px] text-muted-foreground">{format(parseISO(c.date), "dd/MM/yyyy")}{c.notes ? ` · ${c.notes}` : ""}</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="mono text-sm font-semibold text-primary">{formatCurrency(c.amount)}</span>
                    <Button size="icon" variant="ghost" onClick={async () => { if (await confirm({ title: "Excluir aporte?", description: "Esta ação não pode ser desfeita." })) deletePartnerContribution(c.id); }} className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Trash2 size={11} />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Empréstimos */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold tracking-tight">Empréstimos</h2>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Pendente: {formatCurrency(loansOutstanding)}</span>
        </div>
        {loans.length === 0 ? (
          <p className="text-xs text-muted-foreground italic py-2">Nenhum empréstimo registrado.</p>
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {loans.map(l => {
              const total = l.principal + l.interestAmount;
              const paid = getLoanPaid(l.id);
              const remaining = getLoanRemaining(l.id);
              const quitado = remaining <= 0.01;
              return (
                <div key={l.id} className="rounded-lg border border-border/70 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold truncate">{l.lenderName}</p>
                    {quitado && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-income/10 text-income font-medium">Quitado</span>}
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-[11px]">
                    <div><p className="text-muted-foreground text-[10px] uppercase">Principal</p><p className="mono">{formatCurrency(l.principal)}</p></div>
                    <div><p className="text-muted-foreground text-[10px] uppercase">Juros</p><p className="mono">{formatCurrency(l.interestAmount)}</p></div>
                    <div><p className="text-muted-foreground text-[10px] uppercase">Restante</p><p className={cn("mono font-semibold", remaining > 0 ? "text-warning" : "text-muted-foreground")}>{formatCurrency(remaining)}</p></div>
                  </div>
                  <div className="h-1 rounded-full bg-secondary overflow-hidden">
                    <div className="h-full bg-primary transition-all" style={{ width: `${total > 0 ? Math.min(100, (paid / total) * 100) : 0}%` }} />
                  </div>
                  <LoanPayButton loanId={l.id} suggested={remaining} onSubmit={addLoanPayment} />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Histórico de movimentações */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold tracking-tight">Histórico de movimentações</h2>
          <Select value={filterKind} onValueChange={v => setFilterKind(v as any)}>
            <SelectTrigger className="h-8 w-52 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              {Object.entries(kindMeta).map(([k, m]) => <SelectItem key={k} value={k}>{m.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {events.length === 0 ? (
          <p className="text-xs text-muted-foreground italic py-2">Sem eventos.</p>
        ) : (
          <div className="divide-y divide-border/60">
            {events.slice(0, 100).map(ev => {
              const meta = kindMeta[ev.kind];
              const Icon = meta?.icon ?? ArrowRightLeft;
              const impact = describeImpact(ev);
              return (
                <div key={`${ev.kind}-${ev.id}`} className="flex items-start justify-between gap-3 py-2">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <Icon size={14} className={cn("mt-0.5 shrink-0", meta?.tone)} />
                    <div className="min-w-0">
                      <p className="text-xs font-medium truncate">{ev.description}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {format(parseISO(ev.date), "dd 'de' MMM yyyy", { locale: ptBR })} · {impact}
                      </p>
                    </div>
                  </div>
                  <span className={cn("mono text-sm font-semibold shrink-0", ev.cashDelta > 0 ? "text-income" : ev.cashDelta < 0 ? "text-destructive" : "text-muted-foreground")}>
                    {ev.cashDelta !== 0 ? (ev.cashDelta > 0 ? "+" : "") + formatCurrency(ev.cashDelta) : formatCurrency(ev.amount)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function describeImpact(ev: any): string {
  const parts: string[] = [];
  if (ev.cashDelta) parts.push(`Caixa ${ev.cashDelta > 0 ? "+" : ""}${formatCurrency(ev.cashDelta)}`);
  if (ev.inventoryDelta) parts.push(`Estoque ${ev.inventoryDelta > 0 ? "+" : ""}${formatCurrency(ev.inventoryDelta)}`);
  if (ev.receivableDelta) parts.push(`A receber ${ev.receivableDelta > 0 ? "+" : ""}${formatCurrency(ev.receivableDelta)}`);
  if (ev.loanDelta) parts.push(`Empréstimo ${ev.loanDelta > 0 ? "+" : ""}${formatCurrency(ev.loanDelta)}`);
  if (ev.partnerCapitalDelta) parts.push(`Capital ${ev.partnerCapitalDelta > 0 ? "+" : ""}${formatCurrency(ev.partnerCapitalDelta)}`);
  if (ev.accumulatedProfitDelta) parts.push(`Lucro ${ev.accumulatedProfitDelta > 0 ? "+" : ""}${formatCurrency(ev.accumulatedProfitDelta)}`);
  if (ev.distributedProfitDelta) parts.push(`Distribuído ${ev.distributedProfitDelta > 0 ? "+" : ""}${formatCurrency(ev.distributedProfitDelta)}`);
  return parts.join(" · ") || "sem impacto";
}

function PatrimonyRow({ icon: Icon, label, value, tone }: { icon: any; label: string; value: number; tone: string }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Icon size={13} className={tone} />
        <span className="text-xs">{label}</span>
      </div>
      <span className={cn("mono text-sm font-semibold", tone)}>{formatCurrency(value)}</span>
    </div>
  );
}

function LedgerLine({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={cn("text-xs", bold ? "font-semibold" : "text-muted-foreground")}>{label}</span>
      <span className={cn("mono text-sm", bold && "font-semibold", value < 0 && "text-destructive")}>{formatCurrency(value)}</span>
    </div>
  );
}

function LoanPayButton({ loanId, suggested, onSubmit }: { loanId: string; suggested: number; onSubmit: (p: any) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ principalAmount: "", interestAmount: "", date: todayDateString(), notes: "" });

  if (suggested <= 0.01) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const principal = Number(form.principalAmount) || 0;
    const interest = Number(form.interestAmount) || 0;
    if (principal + interest <= 0) return;
    await onSubmit({
      loanId,
      principalAmount: principal,
      interestAmount: interest,
      date: form.date,
      notes: form.notes.trim() || undefined,
    });
    setForm({ principalAmount: "", interestAmount: "", date: todayDateString(), notes: "" });
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="w-full h-7 text-[11px]">Registrar pagamento</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle className="text-base">Pagamento de empréstimo</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label className="text-xs">Principal</Label><Input type="number" step="0.01" value={form.principalAmount} onChange={e => setForm(f => ({ ...f, principalAmount: e.target.value }))} className="h-9 mono" /></div>
            <div className="space-y-1.5"><Label className="text-xs">Juros</Label><Input type="number" step="0.01" value={form.interestAmount} onChange={e => setForm(f => ({ ...f, interestAmount: e.target.value }))} className="h-9 mono" placeholder="0" /></div>
          </div>
          <div className="space-y-1.5"><Label className="text-xs">Data</Label><Input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} className="h-9" /></div>
          <div className="space-y-1.5"><Label className="text-xs">Observação</Label><Input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Opcional" className="h-9" /></div>
          <Button type="submit" className="w-full h-10">Registrar</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
