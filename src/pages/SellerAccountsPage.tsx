import { useStore } from "@/context/StoreContext";
import { useState, useMemo } from "react";
import { Plus, Trash2, Wallet, TrendingDown, CheckCircle2, HandCoins } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { todayDateString, localDateToISO, formatDateBR } from "@/lib/date-utils";

function formatCurrency(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

export default function SellerAccountsPage() {
  const {
    sellers, sales, sellerDebtPayments, sellerManualDebts,
    addSellerDebtPayment, deleteSellerDebtPayment,
    addSellerManualDebt, deleteSellerManualDebt,
    getSellerDebt, getSellerPaid, getSellerBalance, getProductName,
  } = useStore();

  const [open, setOpen] = useState(false);
  const [debtOpen, setDebtOpen] = useState(false);
  const [form, setForm] = useState({ sellerId: "", amount: "", date: todayDateString(), notes: "" });
  const [debtForm, setDebtForm] = useState({ sellerId: "", amount: "", date: todayDateString(), notes: "" });
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const totals = useMemo(() => {
    const debt = sellers.reduce((sum, s) => sum + getSellerDebt(s.id), 0);
    const paid = sellers.reduce((sum, s) => sum + getSellerPaid(s.id), 0);
    const balanceSum = sellers.reduce((sum, s) => sum + getSellerBalance(s.id), 0);
    return { debt, paid, balance: balanceSum };
  }, [sellers, getSellerDebt, getSellerPaid, getSellerBalance]);

  const formatBalance = (v: number) => {
    const sign = v >= 0 ? "+" : "-";
    return `${sign} ${formatCurrency(Math.abs(v))}`;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.sellerId || !form.amount) return;
    await addSellerDebtPayment({
      sellerId: form.sellerId,
      amount: Number(form.amount),
      date: localDateToISO(form.date),
      notes: form.notes || undefined,
    });
    setForm({ sellerId: "", amount: "", date: todayDateString(), notes: "" });
    setOpen(false);
  };

  const handleDebtSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!debtForm.sellerId || !debtForm.amount) return;
    await addSellerManualDebt({
      sellerId: debtForm.sellerId,
      amount: Number(debtForm.amount),
      date: localDateToISO(debtForm.date),
      notes: debtForm.notes || undefined,
    });
    setDebtForm({ sellerId: "", amount: "", date: todayDateString(), notes: "" });
    setDebtOpen(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Contas de Funcionários</h1>
          <p className="text-muted-foreground text-sm">Saldo devedor das retiradas</p>
        </div>
        <div className="flex gap-2">
          <Dialog open={debtOpen} onOpenChange={setDebtOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" className="border-amber-500/40 text-amber-400 hover:text-amber-300">
                <HandCoins size={16} className="mr-2" />Adicionar Saldo Devedor
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Adicionar Saldo Devedor</DialogTitle></DialogHeader>
              <form onSubmit={handleDebtSubmit} className="space-y-4">
                <div>
                  <Label>Funcionário</Label>
                  <Select value={debtForm.sellerId} onValueChange={v => setDebtForm(f => ({ ...f, sellerId: v }))}>
                    <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      {sellers.map(s => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name} — saldo {formatBalance(getSellerBalance(s.id))}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Valor (R$)</Label><Input type="number" step="0.01" value={debtForm.amount} onChange={e => setDebtForm(f => ({ ...f, amount: e.target.value }))} /></div>
                <div><Label>Data</Label><Input type="date" value={debtForm.date} onChange={e => setDebtForm(f => ({ ...f, date: e.target.value }))} /></div>
                <div><Label>Observações</Label><Input value={debtForm.notes} onChange={e => setDebtForm(f => ({ ...f, notes: e.target.value }))} placeholder="Ex: dinheiro emprestado, adiantamento" /></div>
                <Button type="submit" className="w-full bg-amber-500 hover:bg-amber-600 text-white">Adicionar Dívida</Button>
              </form>
            </DialogContent>
          </Dialog>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button><Plus size={16} className="mr-2" />Registrar Pagamento</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Pagamento Manual de Funcionário</DialogTitle></DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <Label>Funcionário</Label>
                  <Select value={form.sellerId} onValueChange={v => setForm(f => ({ ...f, sellerId: v }))}>
                    <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      {sellers.map(s => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name} — saldo {formatCurrency(getSellerBalance(s.id))}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Valor (R$)</Label><Input type="number" step="0.01" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} /></div>
                <div><Label>Data</Label><Input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} /></div>
                <div><Label>Observações</Label><Input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Ex: pagou em dinheiro" /></div>
                <Button type="submit" className="w-full">Registrar</Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Resumo geral */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><TrendingDown size={14} /> Total Retirado</div>
            <p className="text-lg font-bold text-amber-400 mono">{formatCurrency(totals.debt)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><CheckCircle2 size={14} /> Total Pago</div>
            <p className="text-lg font-bold text-primary mono">{formatCurrency(totals.paid)}</p>
          </CardContent>
        </Card>
        <Card className="border-destructive/30">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><Wallet size={14} /> Saldo Pendente</div>
            <p className="text-lg font-bold text-destructive mono">{formatCurrency(totals.balance)}</p>
          </CardContent>
        </Card>
      </div>

      {sellers.length === 0 ? (
        <div className="glass-card p-12 text-center"><p className="text-muted-foreground">Nenhum funcionário cadastrado.</p></div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {sellers.map(seller => {
            const debt = getSellerDebt(seller.id);
            const paid = getSellerPaid(seller.id);
            const balance = getSellerBalance(seller.id);
            const sellerRetiradas = sales.filter(s => s.sellerId === seller.id && s.type === "retirada_funcionario");
            const sellerPayments = sellerDebtPayments.filter(p => p.sellerId === seller.id);
            const sellerDebts = sellerManualDebts.filter(d => d.sellerId === seller.id);
            const isExpanded = expandedId === seller.id;

            return (
              <Card key={seller.id} className={balance > 0 ? "border-amber-500/30" : ""}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">{seller.name}</CardTitle>
                    <Badge variant="outline" className="border-amber-500/40 text-amber-400">Abate {seller.debtPercentage ?? 10}%</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-md bg-secondary/50 p-2">
                      <p className="text-[10px] uppercase text-muted-foreground">Retirado</p>
                      <p className="text-sm font-bold text-amber-400 mono">{formatCurrency(debt)}</p>
                    </div>
                    <div className="rounded-md bg-secondary/50 p-2">
                      <p className="text-[10px] uppercase text-muted-foreground">Pago</p>
                      <p className="text-sm font-bold text-primary mono">{formatCurrency(paid)}</p>
                    </div>
                    <div className="rounded-md bg-secondary/50 p-2">
                      <p className="text-[10px] uppercase text-muted-foreground">Saldo</p>
                      <p className={`text-sm font-bold mono ${balance > 0 ? "text-destructive" : "text-muted-foreground"}`}>{formatCurrency(balance)}</p>
                    </div>
                  </div>

                  <Button variant="ghost" size="sm" className="w-full text-xs" onClick={() => setExpandedId(isExpanded ? null : seller.id)}>
                    {isExpanded ? "Ocultar histórico" : "Ver histórico"}
                  </Button>

                  {isExpanded && (
                    <div className="space-y-3 pt-2 border-t border-border">
                      <div>
                        <p className="text-xs uppercase text-muted-foreground mb-1">Retiradas</p>
                        {sellerRetiradas.length === 0 ? (
                          <p className="text-xs text-muted-foreground">Nenhuma retirada.</p>
                        ) : (
                          <div className="space-y-1">
                            {sellerRetiradas.slice().reverse().map(s => (
                              <div key={s.id} className="flex justify-between text-xs px-2 py-1 rounded bg-amber-500/5">
                                <span>{formatDateBR(s.date)} · {s.quantity}x {getProductName(s.productId)}</span>
                                <span className="font-semibold text-amber-400 mono">{formatCurrency(s.totalPrice)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      <div>
                        <p className="text-xs uppercase text-muted-foreground mb-1">Saldo Devedor Manual</p>
                        {sellerDebts.length === 0 ? (
                          <p className="text-xs text-muted-foreground">Nenhuma dívida manual.</p>
                        ) : (
                          <div className="space-y-1">
                            {sellerDebts.slice().reverse().map(d => (
                              <div key={d.id} className="flex justify-between items-center text-xs px-2 py-1 rounded bg-amber-500/10">
                                <div className="flex-1">
                                  <p>{formatDateBR(d.date)}</p>
                                  {d.notes && <p className="text-muted-foreground">{d.notes}</p>}
                                </div>
                                <div className="flex items-center gap-1">
                                  <span className="font-semibold text-amber-400 mono">{formatCurrency(d.amount)}</span>
                                  <Button variant="ghost" size="icon" className="h-5 w-5 text-destructive" onClick={() => { if (confirm("Excluir esta dívida?")) deleteSellerManualDebt(d.id); }}>
                                    <Trash2 size={10} />
                                  </Button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      <div>
                        <p className="text-xs uppercase text-muted-foreground mb-1">Pagamentos / Abatimentos</p>
                        {sellerPayments.length === 0 ? (
                          <p className="text-xs text-muted-foreground">Nenhum pagamento.</p>
                        ) : (
                          <div className="space-y-1">
                            {sellerPayments.slice().reverse().map(p => (
                              <div key={p.id} className="flex justify-between items-center text-xs px-2 py-1 rounded bg-primary/5">
                                <div className="flex-1">
                                  <p>{formatDateBR(p.date)} {p.saleId && <Badge variant="secondary" className="ml-1 text-[9px] py-0 h-4">auto</Badge>}</p>
                                  {p.notes && <p className="text-muted-foreground">{p.notes}</p>}
                                </div>
                                <div className="flex items-center gap-1">
                                  <span className="font-semibold text-primary mono">{formatCurrency(p.amount)}</span>
                                  <Button variant="ghost" size="icon" className="h-5 w-5 text-destructive" onClick={() => { if (confirm("Excluir pagamento?")) deleteSellerDebtPayment(p.id); }}>
                                    <Trash2 size={10} />
                                  </Button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
