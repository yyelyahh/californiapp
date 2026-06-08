import { useStore } from "@/context/StoreContext";
import { useState, useMemo } from "react";
import { Plus, Trash2, Pencil, Users, TrendingUp, TrendingDown, DollarSign, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

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
  const {
    sales, stockEntries, expenses, dividends, partners,
    partnerPayments, addPartnerPayment, deletePartnerPayment, getPartnerPaidForMonth,
    addPartner, updatePartner, deletePartner,
  } = useStore();

  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const monthOptions = useMemo(() => getMonthOptions(), []);

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", percentage: "" });

  const [payOpen, setPayOpen] = useState(false);
  const [payTarget, setPayTarget] = useState<{ partnerId: string; suggested: number } | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payNotes, setPayNotes] = useState("");

  // Monthly calculations — receita conta apenas o que foi recebido
  const monthlyData = useMemo(() => {
    const monthSales = sales.filter(s => s.type === "venda" && isInMonth(s.date, selectedMonth));
    const monthStockEntries = stockEntries.filter(e => isInMonth(e.date, selectedMonth));
    const monthExpenses = expenses.filter(e => isInMonth(e.date, selectedMonth));
    const monthDividends = dividends.filter(d => isInMonth(d.date, selectedMonth));
    const monthPartnerPayments = partnerPayments.filter(p => p.month === selectedMonth);

    const revenue = monthSales.reduce((sum, s) => sum + (s.paidAmount || 0), 0);
    const costs = monthStockEntries.reduce((sum, e) => sum + e.totalCost, 0);
    const expenseTotal = monthExpenses.reduce((sum, e) => sum + e.amount, 0);
    const dividendTotal = monthDividends.reduce((sum, d) => sum + d.amount, 0);
    const partnerPaidTotal = monthPartnerPayments.reduce((sum, p) => sum + p.amount, 0);
    const grossProfit = revenue - costs - expenseTotal - dividendTotal;
    const profit = grossProfit - partnerPaidTotal;

    return { revenue, costs, expenseTotal, dividendTotal, partnerPaidTotal, grossProfit, profit, monthSales, monthStockEntries, monthExpenses, monthDividends };
  }, [sales, stockEntries, expenses, dividends, partnerPayments, selectedMonth]);

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

  const openPay = (partnerId: string, suggested: number) => {
    setPayTarget({ partnerId, suggested });
    setPayAmount(suggested > 0 ? suggested.toFixed(2) : "");
    setPayNotes("");
    setPayOpen(true);
  };

  const handlePay = async () => {
    if (!payTarget) return;
    const amount = Number(payAmount);
    if (!amount || amount <= 0) return;
    await addPartnerPayment({
      partnerId: payTarget.partnerId,
      month: selectedMonth,
      amount,
      date: new Date().toISOString(),
      notes: payNotes || undefined,
    });
    setPayOpen(false);
    setPayTarget(null);
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
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><TrendingUp size={14} /> Receita</div>
            <p className="text-lg font-bold text-income">{formatCurrency(monthlyData.revenue)}</p>
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
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><Users size={14} /> Pago a Sócios</div>
            <p className="text-lg font-bold text-destructive">{formatCurrency(monthlyData.partnerPaidTotal)}</p>
          </CardContent>
        </Card>
        <Card className={monthlyData.profit >= 0 ? "border-income/30" : "border-destructive/30"}>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><DollarSign size={14} /> Saldo</div>
            <p className={`text-lg font-bold ${monthlyData.profit >= 0 ? "text-income" : "text-destructive"}`}>
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
              <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]">
                <thead><tr className="border-b border-border text-muted-foreground text-xs uppercase">
                  <th className="text-left p-3">Sócio</th>
                  <th className="text-right p-3">%</th>
                  <th className="text-right p-3">Devido</th>
                  <th className="text-right p-3">Pago</th>
                  <th className="text-center p-3">Status</th>
                  <th className="p-3"></th>
                </tr></thead>
                <tbody>
                  {partners.map(p => {
                    const profitBase = Math.max(0, monthlyData.grossProfit);
                    const share = profitBase * (p.percentage / 100);
                    const paid = getPartnerPaidForMonth(p.id, selectedMonth);
                    const remaining = Math.max(0, share - paid);
                    const isPaid = share > 0 && remaining <= 0.005;
                    const monthPayments = partnerPayments.filter(pp => pp.partnerId === p.id && pp.month === selectedMonth);
                    return (
                      <tr key={p.id} className="border-b border-border/50 hover:bg-muted/30">
                        <td className="p-3 font-medium">{p.name}</td>
                        <td className="p-3 text-right text-muted-foreground">{p.percentage}%</td>
                        <td className="p-3 text-right font-semibold text-foreground">
                          {formatCurrency(share)}
                        </td>
                        <td className="p-3 text-right text-income">
                          {formatCurrency(paid)}
                        </td>
                        <td className="p-3 text-center">
                          {isPaid ? (
                            <Badge className="bg-income/15 text-income hover:bg-income/20 border-0">Pago</Badge>
                          ) : remaining > 0 && share > 0 ? (
                            <Badge className="bg-warning/15 text-warning hover:bg-warning/20 border-0">Falta {formatCurrency(remaining)}</Badge>
                          ) : (
                            <Badge variant="outline" className="text-muted-foreground">—</Badge>
                          )}
                        </td>
                        <td className="p-3 text-right">
                          <div className="flex gap-1 justify-end items-center">
                            {!isPaid && (
                              <Button size="sm" variant="outline" onClick={() => openPay(p.id, remaining)} className="h-7 px-2 text-xs">
                                <Check size={14} className="mr-1" /> Pagar
                              </Button>
                            )}
                            {monthPayments.length > 0 && (
                              <Button
                                variant="ghost"
                                size="icon"
                                title="Desfazer pagamentos do mês"
                                onClick={() => monthPayments.forEach(mp => deletePartnerPayment(mp.id))}
                                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                              >
                                <X size={14} />
                              </Button>
                            )}
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
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Registrar pagamento ao sócio</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Valor</Label>
              <Input type="number" step="0.01" value={payAmount} onChange={e => setPayAmount(e.target.value)} />
              {payTarget && payTarget.suggested > 0 && (
                <p className="text-xs text-muted-foreground mt-1">Sugerido: {formatCurrency(payTarget.suggested)}</p>
              )}
            </div>
            <div>
              <Label>Observações (opcional)</Label>
              <Input value={payNotes} onChange={e => setPayNotes(e.target.value)} placeholder="Ex.: PIX, dinheiro..." />
            </div>
            <Button onClick={handlePay} className="w-full">Confirmar pagamento</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
