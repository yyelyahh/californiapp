import { useStore } from "@/context/StoreContext";
import { useState, useMemo } from "react";
import { Plus, Trash2, Pencil, Users, TrendingUp, TrendingDown, DollarSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function formatCurrency(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

function getMonthOptions() {
  const now = new Date();
  const months: { value: string; label: string }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
    months.push({ value, label: label.charAt(0).toUpperCase() + label.slice(1) });
  }
  return months;
}

function isInMonth(dateStr: string, month: string) {
  return dateStr.slice(0, 7) === month;
}

export default function MonthlyRevenuePage() {
  const { sales, stockEntries, expenses, dividends, partners, addPartner, updatePartner, deletePartner, getProductName } = useStore();

  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const monthOptions = useMemo(() => getMonthOptions(), []);

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", percentage: "" });

  // Monthly calculations
  const monthlyData = useMemo(() => {
    const monthSales = sales.filter(s => isInMonth(s.date, selectedMonth));
    const monthStockEntries = stockEntries.filter(e => isInMonth(e.date, selectedMonth));
    const monthExpenses = expenses.filter(e => isInMonth(e.date, selectedMonth));
    const monthDividends = dividends.filter(d => isInMonth(d.date, selectedMonth));

    const revenue = monthSales.reduce((sum, s) => sum + s.totalPrice, 0);
    const costs = monthStockEntries.reduce((sum, e) => sum + e.totalCost, 0);
    const expenseTotal = monthExpenses.reduce((sum, e) => sum + e.amount, 0);
    const dividendTotal = monthDividends.reduce((sum, d) => sum + d.amount, 0);
    const profit = revenue - costs - expenseTotal - dividendTotal;

    return { revenue, costs, expenseTotal, dividendTotal, profit, monthSales, monthStockEntries, monthExpenses, monthDividends };
  }, [sales, stockEntries, expenses, dividends, selectedMonth]);

  const totalPercentage = partners.reduce((sum, p) => sum + p.percentage, 0);

  const openNew = () => { setEditingId(null); setForm({ name: "", percentage: "" }); setOpen(true); };
  const openEdit = (p: typeof partners[0]) => { setEditingId(p.id); setForm({ name: p.name, percentage: String(p.percentage) }); setOpen(true); };

  const handleSubmit = async () => {
    if (!form.name || !form.percentage) return;
    if (editingId) {
      await updatePartner(editingId, { name: form.name, percentage: Number(form.percentage) });
    } else {
      await addPartner({ name: form.name, percentage: Number(form.percentage) });
    }
    setOpen(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Receita Mensal</h1>
          <p className="text-muted-foreground text-sm">Lucro e divisão entre sócios</p>
        </div>
        <select
          value={selectedMonth}
          onChange={e => setSelectedMonth(e.target.value)}
          className="bg-secondary text-secondary-foreground border border-border rounded-lg px-3 py-2 text-sm"
        >
          {monthOptions.map(m => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><TrendingUp size={14} /> Receita</div>
            <p className="text-lg font-bold text-primary">{formatCurrency(monthlyData.revenue)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><TrendingDown size={14} /> Compras</div>
            <p className="text-lg font-bold text-destructive">{formatCurrency(monthlyData.costs)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><TrendingDown size={14} /> Despesas</div>
            <p className="text-lg font-bold text-destructive">{formatCurrency(monthlyData.expenseTotal)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><Users size={14} /> Investidores</div>
            <p className="text-lg font-bold text-destructive">{formatCurrency(monthlyData.dividendTotal)}</p>
          </CardContent>
        </Card>
        <Card className={monthlyData.profit >= 0 ? "border-primary/30" : "border-destructive/30"}>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><DollarSign size={14} /> Lucro</div>
            <p className={`text-lg font-bold ${monthlyData.profit >= 0 ? "text-primary" : "text-destructive"}`}>
              {formatCurrency(monthlyData.profit)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Partners Section */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base">Sócios</CardTitle>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" onClick={openNew}><Plus size={16} className="mr-1" /> Adicionar</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>{editingId ? "Editar Sócio" : "Novo Sócio"}</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>Nome</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
                <div><Label>Porcentagem (%)</Label><Input type="number" value={form.percentage} onChange={e => setForm({ ...form, percentage: e.target.value })} /></div>
                <Button onClick={handleSubmit} className="w-full">{editingId ? "Salvar" : "Adicionar"}</Button>
              </div>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          {partners.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-6">Nenhum sócio cadastrado</p>
          ) : (
            <>
              {totalPercentage !== 100 && (
                <div className="bg-accent/10 text-accent text-xs px-3 py-2 rounded-lg mb-3">
                  ⚠️ A soma das porcentagens é {totalPercentage}% (deveria ser 100%)
                </div>
              )}
              <table className="w-full text-sm">
                <thead><tr className="border-b border-border text-muted-foreground text-xs uppercase">
                  <th className="text-left p-3">Sócio</th>
                  <th className="text-right p-3">%</th>
                  <th className="text-right p-3">Receita do Mês</th>
                  <th className="p-3"></th>
                </tr></thead>
                <tbody>
                  {partners.map(p => {
                    const share = Math.max(0, monthlyData.revenue) * (p.percentage / 100);
                    return (
                      <tr key={p.id} className="border-b border-border/50 hover:bg-muted/30">
                        <td className="p-3 font-medium">{p.name}</td>
                        <td className="p-3 text-right text-muted-foreground">{p.percentage}%</td>
                        <td className={`p-3 text-right font-semibold ${share >= 0 ? "text-primary" : "text-destructive"}`}>
                          {formatCurrency(share)}
                        </td>
                        <td className="p-3 text-right">
                          <div className="flex gap-1 justify-end">
                            <Button variant="ghost" size="icon" onClick={() => openEdit(p)} className="h-7 w-7 text-muted-foreground hover:text-foreground">
                              <Pencil size={14} />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => deletePartner(p.id)} className="h-7 w-7 text-muted-foreground hover:text-destructive">
                              <Trash2 size={14} />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
