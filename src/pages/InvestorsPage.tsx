import { useStore } from "@/context/StoreContext";
import { useState, useMemo } from "react";
import { Plus, Trash2, DollarSign, ChevronDown, Users, Wallet, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { todayDateString } from "@/lib/date-utils";
import { cn } from "@/lib/utils";

function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getFullYear()).slice(-2)}`;
}

function formatCurrency(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

export default function InvestorsPage() {
  const store = useStore();
  const [openInvestor, setOpenInvestor] = useState(false);
  const [openPayment, setOpenPayment] = useState(false);
  const [investorForm, setInvestorForm] = useState({ name: "", investedAmount: "", returnPercentage: "" });
  const [paymentForm, setPaymentForm] = useState({ investorId: "", amount: "", date: todayDateString(), notes: "" });

  const handleAddInvestor = (e: React.FormEvent) => {
    e.preventDefault();
    if (!investorForm.name.trim()) return;
    store.addInvestor({
      name: investorForm.name.trim(),
      investedAmount: Number(investorForm.investedAmount) || 0,
      returnPercentage: Number(investorForm.returnPercentage) || 0,
    });
    setInvestorForm({ name: "", investedAmount: "", returnPercentage: "" });
    setOpenInvestor(false);
  };

  const handleAddPayment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentForm.investorId || !Number(paymentForm.amount)) return;
    store.addDividend({
      investorId: paymentForm.investorId,
      amount: Number(paymentForm.amount),
      date: paymentForm.date,
      notes: paymentForm.notes.trim() || undefined,
    });
    setPaymentForm({ investorId: "", amount: "", date: todayDateString(), notes: "" });
    setOpenPayment(false);
  };

  const totals = useMemo(() => {
    const invested = store.getTotalInvested();
    const totalReturn = store.investors.reduce((s, i) => s + i.totalReturn, 0);
    const paid = store.investors.reduce((s, i) => s + store.getPaidToInvestor(i.id), 0);
    const remaining = Math.max(0, totalReturn - paid);
    return { invested, totalReturn, paid, remaining };
  }, [store.investors, store.dividends]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Investidores</h1>
          <p className="text-xs text-muted-foreground">Capital, retorno acordado e pagamentos</p>
        </div>
        <div className="flex gap-2">
          <Dialog open={openPayment} onOpenChange={setOpenPayment}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="h-9"><DollarSign size={15} className="mr-1.5" />Pagamento</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle className="text-base font-semibold">Registrar Pagamento</DialogTitle></DialogHeader>
              <form onSubmit={handleAddPayment} className="space-y-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">Investidor</Label>
                  <select className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm" value={paymentForm.investorId} onChange={e => setPaymentForm(f => ({ ...f, investorId: e.target.value }))}>
                    <option value="">Selecione</option>
                    {store.investors.map(i => {
                      const remaining = store.getRemainingForInvestor(i.id);
                      return <option key={i.id} value={i.id} disabled={remaining <= 0}>{i.name} — Resta {formatCurrency(remaining)}</option>;
                    })}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5"><Label className="text-xs">Valor (R$)</Label><Input type="number" step="0.01" value={paymentForm.amount} onChange={e => setPaymentForm(f => ({ ...f, amount: e.target.value }))} className="h-9 mono" /></div>
                  <div className="space-y-1.5"><Label className="text-xs">Data</Label><Input type="date" value={paymentForm.date} onChange={e => setPaymentForm(f => ({ ...f, date: e.target.value }))} className="h-9" /></div>
                </div>
                <div className="space-y-1.5"><Label className="text-xs">Observação</Label><Input value={paymentForm.notes} onChange={e => setPaymentForm(f => ({ ...f, notes: e.target.value }))} placeholder="Opcional" className="h-9" /></div>
                <Button type="submit" className="w-full h-10">Registrar</Button>
              </form>
            </DialogContent>
          </Dialog>
          <Dialog open={openInvestor} onOpenChange={setOpenInvestor}>
            <DialogTrigger asChild>
              <Button size="sm" className="h-9"><Plus size={15} className="mr-1.5" />Investidor</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle className="text-base font-semibold">Adicionar Investidor</DialogTitle></DialogHeader>
              <form onSubmit={handleAddInvestor} className="space-y-4">
                <div className="space-y-1.5"><Label className="text-xs">Nome</Label><Input value={investorForm.name} onChange={e => setInvestorForm(f => ({ ...f, name: e.target.value }))} className="h-9" /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5"><Label className="text-xs">Valor Investido (R$)</Label><Input type="number" step="0.01" value={investorForm.investedAmount} onChange={e => setInvestorForm(f => ({ ...f, investedAmount: e.target.value }))} className="h-9 mono" /></div>
                  <div className="space-y-1.5"><Label className="text-xs">Retorno (%)</Label><Input type="number" step="0.1" value={investorForm.returnPercentage} onChange={e => setInvestorForm(f => ({ ...f, returnPercentage: e.target.value }))} placeholder="Ex: 20" className="h-9 mono" /></div>
                </div>
                {investorForm.investedAmount && investorForm.returnPercentage && (
                  <div className="rounded-lg border border-border bg-secondary/30 p-3 space-y-1">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Impacto</p>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Total a devolver</span>
                      <span className="mono font-semibold text-primary">{formatCurrency(Number(investorForm.investedAmount) * (1 + Number(investorForm.returnPercentage) / 100))}</span>
                    </div>
                  </div>
                )}
                <Button type="submit" className="w-full h-10">Adicionar</Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid gap-2 grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-border bg-card px-3.5 py-2.5">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-medium"><Users size={11} /> Investidores</div>
          <p className="mt-0.5 text-lg font-semibold mono">{store.investors.length}</p>
        </div>
        <div className="rounded-xl border border-border bg-card px-3.5 py-2.5">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-medium"><Wallet size={11} /> Capital</div>
          <p className="mt-0.5 text-lg font-semibold mono">{formatCurrency(totals.invested)}</p>
        </div>
        <div className="rounded-xl border border-border bg-card px-3.5 py-2.5">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-medium"><TrendingUp size={11} /> Pago</div>
          <p className="mt-0.5 text-lg font-semibold mono text-income">{formatCurrency(totals.paid)}</p>
        </div>
        <div className="rounded-xl border border-border bg-card px-3.5 py-2.5">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-medium"><DollarSign size={11} /> Resta pagar</div>
          <p className={cn("mt-0.5 text-lg font-semibold mono", totals.remaining > 0 ? "text-warning" : "text-muted-foreground")}>{formatCurrency(totals.remaining)}</p>
        </div>
      </div>

      {/* Investor cards */}
      {store.investors.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center"><p className="text-sm text-muted-foreground">Nenhum investidor cadastrado.</p></div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {store.investors.map(inv => {
            const paid = store.getPaidToInvestor(inv.id);
            const remaining = store.getRemainingForInvestor(inv.id);
            const progress = inv.totalReturn > 0 ? (paid / inv.totalReturn) * 100 : 0;
            const isComplete = remaining <= 0;
            const investorDividends = [...store.dividends]
              .filter(d => d.investorId === inv.id)
              .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

            return (
              <div key={inv.id} className="rounded-xl border border-border bg-card p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="font-semibold text-sm truncate">{inv.name}</h3>
                    <p className="text-[11px] text-muted-foreground">{inv.returnPercentage}% sobre {formatCurrency(inv.investedAmount)}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {isComplete && <span className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-income/10 text-income">Quitado</span>}
                    <Button variant="ghost" size="icon" onClick={() => { if (confirm("Excluir este investidor? Todos os dividendos relacionados também serão removidos.")) store.deleteInvestor(inv.id); }} className="text-muted-foreground hover:text-destructive h-7 w-7"><Trash2 size={13} /></Button>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Investido</p>
                    <p className="mono font-semibold mt-0.5">{formatCurrency(inv.investedAmount)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Total</p>
                    <p className="mono font-semibold mt-0.5">{formatCurrency(inv.totalReturn)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Resta</p>
                    <p className={cn("mono font-semibold mt-0.5", remaining > 0 ? "text-warning" : "text-muted-foreground")}>{formatCurrency(remaining)}</p>
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-[10px] text-muted-foreground">
                    <span className="text-income mono">{formatCurrency(paid)} pago</span>
                    <span className="mono">{Math.round(progress)}%</span>
                  </div>
                  <Progress value={progress} className="h-1.5" />
                </div>

                <Collapsible>
                  <CollapsibleTrigger className="flex items-center justify-between w-full text-[11px] text-muted-foreground hover:text-foreground transition-colors group pt-1 border-t border-border/60">
                    <span className="pt-2">Histórico ({investorDividends.length})</span>
                    <ChevronDown size={13} className="mt-2 transition-transform group-data-[state=open]:rotate-180" />
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-1">
                    {investorDividends.length === 0 ? (
                      <p className="text-[11px] text-muted-foreground italic py-1">Sem pagamentos.</p>
                    ) : (
                      <div className="divide-y divide-border/40">
                        {investorDividends.map(d => (
                          <div key={d.id} className="flex items-center justify-between py-1.5 group/row">
                            <div className="min-w-0">
                              <p className="text-[11px] mono">{formatShortDate(d.date)}</p>
                              {d.notes && <p className="text-[10px] text-muted-foreground truncate">{d.notes}</p>}
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <span className="text-xs font-semibold mono text-income">{formatCurrency(d.amount)}</span>
                              <Button size="sm" variant="ghost" onClick={() => store.deleteDividend(d.id)} className="text-muted-foreground hover:text-destructive h-6 w-6 p-0 opacity-0 group-hover/row:opacity-100 transition-opacity">
                                <Trash2 size={11} />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CollapsibleContent>
                </Collapsible>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
