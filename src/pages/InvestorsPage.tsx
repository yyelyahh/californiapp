import { useStore } from "@/context/StoreContext";
import { useState, useMemo } from "react";
import { Plus, Trash2, Check, DollarSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

function formatCurrency(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

export default function InvestorsPage() {
  const store = useStore();
  const [openInvestor, setOpenInvestor] = useState(false);
  const [openDividend, setOpenDividend] = useState(false);
  const [investorForm, setInvestorForm] = useState({ name: "", investedAmount: "", sharePercentage: "" });
  const [dividendForm, setDividendForm] = useState({ investorId: "", amount: "", month: format(new Date(), "yyyy-MM") });

  const profit = store.getNetProfit();

  const handleAddInvestor = (e: React.FormEvent) => {
    e.preventDefault();
    if (!investorForm.name.trim()) return;
    store.addInvestor({
      name: investorForm.name.trim(),
      investedAmount: Number(investorForm.investedAmount) || 0,
      sharePercentage: Number(investorForm.sharePercentage) || 0,
    });
    setInvestorForm({ name: "", investedAmount: "", sharePercentage: "" });
    setOpenInvestor(false);
  };

  const handleAddDividend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!dividendForm.investorId) return;
    store.addDividend({
      investorId: dividendForm.investorId,
      amount: Number(dividendForm.amount) || 0,
      month: dividendForm.month,
      paid: false,
    });
    setDividendForm({ investorId: "", amount: "", month: format(new Date(), "yyyy-MM") });
    setOpenDividend(false);
  };

  const plannedDividends = useMemo(() => {
    if (profit <= 0) return [];
    return store.investors.map(inv => ({
      investor: inv,
      suggestedAmount: (profit * inv.sharePercentage) / 100,
    }));
  }, [profit, store.investors]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Investidores</h1>
          <p className="text-muted-foreground text-sm">Capital investido: <span className="mono text-accent font-semibold">{formatCurrency(store.getTotalInvested())}</span></p>
        </div>
        <div className="flex gap-2">
          <Dialog open={openDividend} onOpenChange={setOpenDividend}>
            <DialogTrigger asChild>
              <Button variant="outline"><DollarSign size={16} className="mr-2" />Dividendo</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Registrar Dividendo</DialogTitle></DialogHeader>
              <form onSubmit={handleAddDividend} className="space-y-4">
                <div>
                  <Label>Investidor</Label>
                  <select className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm" value={dividendForm.investorId} onChange={e => setDividendForm(f => ({ ...f, investorId: e.target.value }))}>
                    <option value="">Selecione</option>
                    {store.investors.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Valor (R$)</Label><Input type="number" step="0.01" value={dividendForm.amount} onChange={e => setDividendForm(f => ({ ...f, amount: e.target.value }))} /></div>
                  <div><Label>Mês ref.</Label><Input type="month" value={dividendForm.month} onChange={e => setDividendForm(f => ({ ...f, month: e.target.value }))} /></div>
                </div>
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
                  <div><Label>Participação (%)</Label><Input type="number" step="0.1" max="100" value={investorForm.sharePercentage} onChange={e => setInvestorForm(f => ({ ...f, sharePercentage: e.target.value }))} /></div>
                </div>
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
          {store.investors.map(inv => (
            <div key={inv.id} className="stat-card stat-card-accent">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold">{inv.name}</h3>
                <Button variant="ghost" size="icon" onClick={() => store.deleteInvestor(inv.id)} className="text-muted-foreground hover:text-destructive h-7 w-7"><Trash2 size={14} /></Button>
              </div>
              <div className="flex gap-6 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Investido</p>
                  <p className="mono text-accent font-semibold">{formatCurrency(inv.investedAmount)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Participação</p>
                  <p className="mono font-semibold">{inv.sharePercentage}%</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Dividend planning */}
      {plannedDividends.length > 0 && (
        <div className="glass-card p-5">
          <h2 className="text-sm font-medium text-muted-foreground mb-3 uppercase tracking-wider">Planejamento de Dividendos</h2>
          <p className="text-xs text-muted-foreground mb-4">
            Lucro líquido atual: <span className="text-primary mono font-semibold">{formatCurrency(profit)}</span>
          </p>
          <div className="space-y-2">
            {plannedDividends.map(pd => (
              <div key={pd.investor.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                <div>
                  <p className="text-sm font-medium">{pd.investor.name}</p>
                  <p className="text-xs text-muted-foreground">{pd.investor.sharePercentage}% do lucro</p>
                </div>
                <span className="text-sm font-semibold mono text-primary">{formatCurrency(pd.suggestedAmount)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Dividend history */}
      {store.dividends.length > 0 && (
        <div className="glass-card p-5">
          <h2 className="text-sm font-medium text-muted-foreground mb-3 uppercase tracking-wider">Histórico de Dividendos</h2>
          <div className="space-y-2">
            {[...store.dividends].reverse().map(d => (
              <div key={d.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                <div>
                  <p className="text-sm font-medium">{store.getInvestorName(d.investorId)}</p>
                  <p className="text-xs text-muted-foreground">Ref: {d.month}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold mono">{formatCurrency(d.amount)}</span>
                  {d.paid ? (
                    <span className="text-xs bg-primary/20 text-primary px-2 py-0.5 rounded-full flex items-center gap-1"><Check size={10} />Pago</span>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => store.markDividendPaid(d.id)} className="text-xs h-6">Marcar Pago</Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
