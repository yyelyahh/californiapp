import { useStore } from "@/context/StoreContext";
import { useState, useMemo } from "react";
import { Plus, Trash2, Pencil, Users, TrendingUp, TrendingDown, DollarSign, Check, X, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useConfirm } from "@/components/ConfirmProvider";

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
  const [form, setForm] = useState({ name: "", percentage: "", monthlyProLabore: "" });

  const [payOpen, setPayOpen] = useState(false);
  const [payTarget, setPayTarget] = useState<{ partnerId: string; suggested: number } | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payNotes, setPayNotes] = useState("");

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

    return { revenue, costs, expenseTotal, dividendTotal, partnerPaidTotal, grossProfit, profit };
  }, [sales, stockEntries, expenses, dividends, partnerPayments, selectedMonth]);

  const totalPercentage = partners.reduce((sum, p) => sum + p.percentage, 0);

  const openNew = () => { setEditingId(null); setForm({ name: "", percentage: "", monthlyProLabore: "" }); setOpen(true); };
  const openEdit = (p: typeof partners[0]) => { setEditingId(p.id); setForm({ name: p.name, percentage: String(p.percentage), monthlyProLabore: String(p.monthlyProLabore ?? 0) }); setOpen(true); };

  const handleSubmit = async () => {
    if (!form.name || !form.percentage) return;
    const monthly = Number(form.monthlyProLabore) || 0;
    if (editingId) await updatePartner(editingId, { name: form.name, percentage: Number(form.percentage), monthlyProLabore: monthly });
    else await addPartner({ name: form.name, percentage: Number(form.percentage), monthlyProLabore: monthly });
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
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Receita Mensal</h1>
          <p className="text-xs text-muted-foreground">Lucro líquido e distribuição entre sócios</p>
        </div>
        <select
          value={selectedMonth}
          onChange={e => setSelectedMonth(e.target.value)}
          className="bg-card text-foreground border border-border rounded-md px-3 h-9 text-sm"
        >
          {monthOptions.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
      </div>

      {/* KPI strip */}
      <div className="grid gap-2 grid-cols-2 lg:grid-cols-6">
        <div className="rounded-xl border border-border bg-card px-3.5 py-2.5">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-medium"><TrendingUp size={11} /> Receita</div>
          <p className="mt-0.5 text-base font-semibold mono text-income">{formatCurrency(monthlyData.revenue)}</p>
        </div>
        <div className="rounded-xl border border-border bg-card px-3.5 py-2.5">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-medium"><TrendingDown size={11} /> Compras</div>
          <p className="mt-0.5 text-base font-semibold mono text-expense">{formatCurrency(monthlyData.costs)}</p>
        </div>
        <div className="rounded-xl border border-border bg-card px-3.5 py-2.5">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-medium"><TrendingDown size={11} /> Despesas</div>
          <p className="mt-0.5 text-base font-semibold mono text-expense">{formatCurrency(monthlyData.expenseTotal)}</p>
        </div>
        <div className="rounded-xl border border-border bg-card px-3.5 py-2.5">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-medium"><Users size={11} /> Investidores</div>
          <p className="mt-0.5 text-base font-semibold mono text-expense">{formatCurrency(monthlyData.dividendTotal)}</p>
        </div>
        <div className="rounded-xl border border-border bg-card px-3.5 py-2.5">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-medium"><Wallet size={11} /> Pago a sócios</div>
          <p className="mt-0.5 text-base font-semibold mono text-expense">{formatCurrency(monthlyData.partnerPaidTotal)}</p>
        </div>
        <div className={cn("rounded-xl border bg-card px-3.5 py-2.5", monthlyData.profit >= 0 ? "border-income/40" : "border-destructive/40")}>
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-medium"><DollarSign size={11} /> Saldo</div>
          <p className={cn("mt-0.5 text-base font-semibold mono", monthlyData.profit >= 0 ? "text-income" : "text-destructive")}>{formatCurrency(monthlyData.profit)}</p>
        </div>
      </div>

      {/* Sócios */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div>
            <h2 className="text-sm font-semibold">Sócios</h2>
            <p className="text-[11px] text-muted-foreground">Divisão sobre lucro bruto do mês</p>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" onClick={openNew} className="h-8"><Plus size={14} className="mr-1" /> Adicionar</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle className="text-base font-semibold">{editingId ? "Editar Sócio" : "Novo Sócio"}</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5"><Label className="text-xs">Nome</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="h-9" /></div>
                <div className="space-y-1.5"><Label className="text-xs">Porcentagem (%)</Label><Input type="number" value={form.percentage} onChange={e => setForm({ ...form, percentage: e.target.value })} className="h-9 mono" /></div>
                
                <Button onClick={handleSubmit} className="w-full h-10">{editingId ? "Salvar" : "Adicionar"}</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {partners.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-10">Nenhum sócio cadastrado.</p>
        ) : (
          <>
            {totalPercentage !== 100 && (
              <div className="bg-warning/10 text-warning text-[11px] px-4 py-2 border-b border-warning/20">
                A soma das porcentagens é {totalPercentage}% (deveria ser 100%)
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]">
                <thead>
                  <tr className="border-b border-border bg-secondary/30 text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="text-left py-2 px-4 font-medium">Sócio</th>
                    <th className="text-right py-2 px-3 font-medium">%</th>
                    <th className="text-right py-2 px-3 font-medium">Devido</th>
                    <th className="text-right py-2 px-3 font-medium">Pago</th>
                    <th className="text-left py-2 px-3 font-medium">Status</th>
                    <th className="w-32"></th>
                  </tr>
                </thead>
                <tbody>
                  {partners.map(p => {
                    const profitBase = Math.max(0, monthlyData.grossProfit);
                    const share = profitBase * (p.percentage / 100);
                    const paid = getPartnerPaidForMonth(p.id, selectedMonth);
                    const remaining = Math.max(0, share - paid);
                    const isPaid = share > 0 && remaining <= 0.005;
                    const monthPayments = partnerPayments.filter(pp => pp.partnerId === p.id && pp.month === selectedMonth);
                    return (
                      <tr key={p.id} className="border-b border-border/40 last:border-0 hover:bg-secondary/40 transition-colors group">
                        <td className="py-2.5 px-4 font-medium">{p.name}</td>
                        <td className="py-2.5 px-3 text-right mono text-muted-foreground">{p.percentage}%</td>
                        <td className="py-2.5 px-3 text-right mono font-semibold">{formatCurrency(share)}</td>
                        <td className="py-2.5 px-3 text-right mono text-income">{formatCurrency(paid)}</td>
                        <td className="py-2.5 px-3">
                          {isPaid ? (
                            <span className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-income/10 text-income">Pago</span>
                          ) : remaining > 0 && share > 0 ? (
                            <span className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-warning/10 text-warning mono">Falta {formatCurrency(remaining)}</span>
                          ) : (
                            <span className="text-muted-foreground/50 text-xs">—</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="flex gap-0.5 justify-end items-center opacity-60 group-hover:opacity-100 transition-opacity">
                            {!isPaid && (
                              <Button size="sm" variant="outline" onClick={() => openPay(p.id, remaining)} className="h-7 px-2 text-[11px]">
                                <Check size={12} className="mr-1" /> Pagar
                              </Button>
                            )}
                            {monthPayments.length > 0 && (
                              <Button variant="ghost" size="icon" title="Desfazer pagamentos" onClick={() => { if (confirm("Desfazer todos os pagamentos deste sócio no mês?")) monthPayments.forEach(mp => deletePartnerPayment(mp.id)); }} className="h-7 w-7 text-muted-foreground hover:text-destructive">
                                <X size={13} />
                              </Button>
                            )}
                            <Button variant="ghost" size="icon" onClick={() => openEdit(p)} className="h-7 w-7 text-muted-foreground hover:text-foreground"><Pencil size={13} /></Button>
                            <Button variant="ghost" size="icon" onClick={() => { if (confirm("Excluir este sócio? Todos os pagamentos relacionados também serão removidos.")) deletePartner(p.id); }} className="h-7 w-7 text-muted-foreground hover:text-destructive"><Trash2 size={13} /></Button>
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
      </div>

      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle className="text-base font-semibold">Registrar pagamento ao sócio</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Valor</Label>
              <Input type="number" step="0.01" value={payAmount} onChange={e => setPayAmount(e.target.value)} className="h-9 mono" />
              {payTarget && payTarget.suggested > 0 && (
                <p className="text-[11px] text-muted-foreground mt-1">Sugerido: <span className="mono">{formatCurrency(payTarget.suggested)}</span></p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Observações (opcional)</Label>
              <Input value={payNotes} onChange={e => setPayNotes(e.target.value)} placeholder="Ex.: PIX, dinheiro..." className="h-9" />
            </div>
            <Button onClick={handlePay} className="w-full h-10">Confirmar pagamento</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
