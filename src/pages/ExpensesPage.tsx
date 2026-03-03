import { useStore } from "@/context/StoreContext";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { format, parseISO } from "date-fns";

const categories = ["Frete", "Embalagem", "Marketing", "Aluguel", "Outros"];

function formatCurrency(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

export default function ExpensesPage() {
  const { expenses, addExpense, deleteExpense } = useStore();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ description: "", category: "", amount: "", date: new Date().toISOString().split("T")[0] });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.description.trim() || !form.amount) return;
    addExpense({
      description: form.description.trim(),
      category: form.category || "Outros",
      amount: Number(form.amount),
      date: new Date(form.date).toISOString(),
    });
    setForm({ description: "", category: "", amount: "", date: new Date().toISOString().split("T")[0] });
    setOpen(false);
  };

  const total = expenses.reduce((s, e) => s + e.amount, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Despesas</h1>
          <p className="text-muted-foreground text-sm">Total: <span className="mono text-accent font-semibold">{formatCurrency(total)}</span></p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus size={16} className="mr-2" />Nova Despesa</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Adicionar Despesa</DialogTitle></DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div><Label>Descrição</Label><Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></div>
              <div>
                <Label>Categoria</Label>
                <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>{categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Valor (R$)</Label><Input type="number" step="0.01" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} /></div>
                <div><Label>Data</Label><Input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} /></div>
              </div>
              <Button type="submit" className="w-full">Adicionar</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {expenses.length === 0 ? (
        <div className="glass-card p-12 text-center"><p className="text-muted-foreground">Nenhuma despesa registrada.</p></div>
      ) : (
        <div className="glass-card overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border text-muted-foreground text-xs uppercase">
              <th className="text-left p-3">Data</th><th className="text-left p-3">Descrição</th><th className="text-left p-3">Categoria</th>
              <th className="text-right p-3">Valor</th><th className="p-3 w-10"></th>
            </tr></thead>
            <tbody>
              {[...expenses].reverse().map(e => (
                <tr key={e.id} className="border-b border-border last:border-0 hover:bg-secondary/30 transition-colors">
                  <td className="p-3 mono text-xs">{format(parseISO(e.date), "dd/MM/yyyy")}</td>
                  <td className="p-3">{e.description}</td>
                  <td className="p-3"><span className="text-xs bg-secondary text-secondary-foreground px-2 py-0.5 rounded-full">{e.category}</span></td>
                  <td className="p-3 text-right mono font-semibold text-accent">{formatCurrency(e.amount)}</td>
                  <td className="p-3"><Button variant="ghost" size="icon" onClick={() => deleteExpense(e.id)} className="text-muted-foreground hover:text-destructive h-7 w-7"><Trash2 size={14} /></Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
