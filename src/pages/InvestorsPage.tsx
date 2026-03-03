import { useStore } from "@/context/StoreContext";
import { useState } from "react";
import { Plus, Trash2, DollarSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { format } from "date-fns";

function formatCurrency(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

export default function InvestorsPage() {
  const store = useStore();
  const [openInvestor, setOpenInvestor] = useState(false);
  const [openPayment, setOpenPayment] = useState(false);
  const [investorForm, setInvestorForm] = useState({ name: "", investedAmount: "", returnPercentage: "" });
  const [paymentForm, setPaymentForm] = useState({ investorId: "", amount: "", date: format(new Date(), "yyyy-MM-dd"), notes: "" });

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
    setPaymentForm({ investorId: "", amount: "", date: format(new Date(), "yyyy-MM-dd"), notes: "" });
    setOpenPayment(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Investidores</h1>
          <p className="text-muted-foreground text-sm">Capital investido: <span className="mono text-accent font-semibold">{formatCurrency(store.getTotalInvested())}</span></p>
        </div>
        <div className="flex gap-2">
          <Dialog open={openPayment} onOpenChange={setOpenPayment}>
            <DialogTrigger asChild>
              <Button variant="outline"><DollarSign size={16} className="mr-2" />Registrar Pagamento</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Registrar Pagamento</DialogTitle></DialogHeader>
              <form onSubmit={handleAddPayment} className="space-y-4">
                <div>
                  <Label>Investidor</Label>
                  <select className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm" value={paymentForm.investorId} onChange={e => setPaymentForm(f => ({ ...f, investorId: e.target.value }))}>
                    <option value="">Selecione</option>
                    {store.investors.map(i => {
                      const remaining = store.getRemainingForInvestor(i.id);
                      return <option key={i.id} value={i.id} disabled={remaining <= 0}>{i.name} — Resta {formatCurrency(remaining)}</option>;
                    })}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Valor (R$)</Label><Input type="number" step="0.01" value={paymentForm.amount} onChange={e => setPaymentForm(f => ({ ...f, amount: e.target.value }))} /></div>
                  <div><Label>Data</Label><Input type="date" value={paymentForm.date} onChange={e => setPaymentForm(f => ({ ...f, date: e.target.value }))} /></div>
                </div>
                <div><Label>Observação</Label><Input value={paymentForm.notes} onChange={e => setPaymentForm(f => ({ ...f, notes: e.target.value }))} placeholder="Opcional" /></div>
                <Button type="submit" className="w-full">Registrar</Button>
              </form>
            </DialogContent>
          </Dialog>
          <Dialog open={openInvestor} onOpenChange={setOpenInvestor}>
            <DialogTrigger asChild>
              <Button><Plus size={16} className="mr-2" />Investidor</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Adicionar Investidor</DialogTitle></DialogHeader>
              <form onSubmit={handleAddInvestor} className="space-y-4">
                <div><Label>Nome</Label><Input value={investorForm.name} onChange={e => setInvestorForm(f => ({ ...f, name: e.target.value }))} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Valor Investido (R$)</Label><Input type="number" step="0.01" value={investorForm.investedAmount} onChange={e => setInvestorForm(f => ({ ...f, investedAmount: e.target.value }))} /></div>
                  <div><Label>Retorno (%)</Label><Input type="number" step="0.1" value={investorForm.returnPercentage} onChange={e => setInvestorForm(f => ({ ...f, returnPercentage: e.target.value }))} placeholder="Ex: 20" /></div>
                </div>
                {investorForm.investedAmount && investorForm.returnPercentage && (
                  <p className="text-xs text-muted-foreground">
                    Total a devolver: <span className="text-primary font-semibold mono">{formatCurrency(Number(investorForm.investedAmount) * (1 + Number(investorForm.returnPercentage) / 100))}</span>
                  </p>
                )}
                <Button type="submit" className="w-full">Adicionar</Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Investor cards */}
      {store.investors.length === 0 ? (
        <div className="glass-card p-12 text-center"><p className="text-muted-foreground">Nenhum investidor cadastrado.</p></div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {store.investors.map(inv => {
            const paid = store.getPaidToInvestor(inv.id);
            const remaining = store.getRemainingForInvestor(inv.id);
            const progress = inv.totalReturn > 0 ? (paid / inv.totalReturn) * 100 : 0;
            const isComplete = remaining <= 0;

            return (
              <div key={inv.id} className={`stat-card ${isComplete ? 'stat-card-primary' : 'stat-card-accent'}`}>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold">{inv.name}</h3>
                  <div className="flex items-center gap-1">
                    {isComplete && <span className="text-xs bg-primary/20 text-primary px-2 py-0.5 rounded-full">Quitado</span>}
                    <Button variant="ghost" size="icon" onClick={() => store.deleteInvestor(inv.id)} className="text-muted-foreground hover:text-destructive h-7 w-7"><Trash2 size={14} /></Button>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3 text-sm mb-3">
                  <div>
                    <p className="text-xs text-muted-foreground">Investido</p>
                    <p className="mono font-semibold">{formatCurrency(inv.investedAmount)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Retorno</p>
                    <p className="mono font-semibold">{inv.returnPercentage}%</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Total</p>
                    <p className="mono text-accent font-semibold">{formatCurrency(inv.totalReturn)}</p>
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Pago: {formatCurrency(paid)}</span>
                    <span>Resta: {formatCurrency(remaining)}</span>
                  </div>
                  <Progress value={progress} className="h-2" />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Payment history */}
      {store.dividends.length > 0 && (
        <div className="glass-card p-5">
          <h2 className="text-sm font-medium text-muted-foreground mb-3 uppercase tracking-wider">Histórico de Pagamentos</h2>
          <div className="space-y-2">
            {[...store.dividends].reverse().map(d => (
              <div key={d.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                <div>
                  <p className="text-sm font-medium">{store.getInvestorName(d.investorId)}</p>
                  <p className="text-xs text-muted-foreground">{d.date}{d.notes ? ` — ${d.notes}` : ''}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold mono">{formatCurrency(d.amount)}</span>
                  <Button size="sm" variant="ghost" onClick={() => store.deleteDividend(d.id)} className="text-muted-foreground hover:text-destructive h-6 w-6 p-0"><Trash2 size={12} /></Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
