import { useState } from "react";
import { useStore } from "@/context/StoreContext";
import { cn } from "@/lib/utils";
import { Users, Landmark, Plus, Trash2 } from "lucide-react";
import { format, parseISO } from "date-fns";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useConfirm } from "@/components/ConfirmProvider";
import { todayDateString } from "@/lib/date-utils";

function formatCurrency(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v || 0);
}

export default function FinancePage() {
  const store = useStore();
  const confirm = useConfirm();
  const {
    partners, partnerContributions, loans,
    addPartnerContribution, deletePartnerContribution,
    addLoan, addLoanPayment,
    getPartnerCapital, getLoansOutstanding,
    getLoanPaid, getLoanRemaining,
  } = store;

  const partnerCapital = getPartnerCapital();
  const loansOutstanding = getLoansOutstanding();

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
          <p className="text-xs text-muted-foreground">Aportes de sócios e empréstimos</p>
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

      {/* Aportes dos sócios */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Users size={14} className="text-primary" />
            <h2 className="text-sm font-semibold tracking-tight">Aportes dos sócios</h2>
          </div>
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
          <div className="flex items-center gap-2">
            <Landmark size={14} className="text-primary" />
            <h2 className="text-sm font-semibold tracking-tight">Empréstimos</h2>
          </div>
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
