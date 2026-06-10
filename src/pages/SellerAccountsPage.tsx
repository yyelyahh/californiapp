import { useStore } from "@/context/StoreContext";
import { useState, useMemo } from "react";
import { Plus, Trash2, Wallet, TrendingDown, CheckCircle2, HandCoins, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { todayDateString, localDateToISO, formatDateBR } from "@/lib/date-utils";
import { cn } from "@/lib/utils";

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
    const sign = v > 0 ? "-" : "+";
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
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Contas de Funcionários</h1>
          <p className="text-xs text-muted-foreground">Saldo devedor das retiradas e pagamentos</p>
        </div>
        <div className="flex gap-2">
          <Dialog open={debtOpen} onOpenChange={setDebtOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 border-warning/40 text-warning hover:text-warning hover:bg-warning/5">
                <HandCoins size={15} className="mr-1.5" />Saldo Devedor
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle className="text-base font-semibold">Adicionar Saldo Devedor</DialogTitle></DialogHeader>
              <form onSubmit={handleDebtSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">Funcionário</Label>
                  <Select value={debtForm.sellerId} onValueChange={v => setDebtForm(f => ({ ...f, sellerId: v }))}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      {sellers.map(s => (
                        <SelectItem key={s.id} value={s.id}>{s.name} — saldo {formatBalance(getSellerBalance(s.id))}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5"><Label className="text-xs">Valor (R$)</Label><Input type="number" step="0.01" value={debtForm.amount} onChange={e => setDebtForm(f => ({ ...f, amount: e.target.value }))} className="h-9 mono" /></div>
                  <div className="space-y-1.5"><Label className="text-xs">Data</Label><Input type="date" value={debtForm.date} onChange={e => setDebtForm(f => ({ ...f, date: e.target.value }))} className="h-9" /></div>
                </div>
                <div className="space-y-1.5"><Label className="text-xs">Observações</Label><Input value={debtForm.notes} onChange={e => setDebtForm(f => ({ ...f, notes: e.target.value }))} placeholder="Ex: adiantamento, empréstimo" className="h-9" /></div>
                <Button type="submit" className="w-full h-10 bg-warning hover:bg-warning/90 text-warning-foreground">Adicionar Dívida</Button>
              </form>
            </DialogContent>
          </Dialog>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="h-9"><Plus size={15} className="mr-1.5" />Pagamento</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle className="text-base font-semibold">Pagamento Manual</DialogTitle></DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">Funcionário</Label>
                  <Select value={form.sellerId} onValueChange={v => setForm(f => ({ ...f, sellerId: v }))}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      {sellers.map(s => (
                        <SelectItem key={s.id} value={s.id}>{s.name} — saldo {formatBalance(getSellerBalance(s.id))}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5"><Label className="text-xs">Valor (R$)</Label><Input type="number" step="0.01" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} className="h-9 mono" /></div>
                  <div className="space-y-1.5"><Label className="text-xs">Data</Label><Input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} className="h-9" /></div>
                </div>
                <div className="space-y-1.5"><Label className="text-xs">Observações</Label><Input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Ex: pagou em dinheiro" className="h-9" /></div>
                <Button type="submit" className="w-full h-10">Registrar</Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid gap-2 grid-cols-3">
        <div className="rounded-xl border border-border bg-card px-3.5 py-2.5">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-medium"><TrendingDown size={11} /> Total Retirado</div>
          <p className="mt-0.5 text-lg font-semibold mono text-warning">{formatCurrency(totals.debt)}</p>
        </div>
        <div className="rounded-xl border border-border bg-card px-3.5 py-2.5">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-medium"><CheckCircle2 size={11} /> Total Pago</div>
          <p className="mt-0.5 text-lg font-semibold mono text-income">{formatCurrency(totals.paid)}</p>
        </div>
        <div className={cn("rounded-xl border bg-card px-3.5 py-2.5", totals.balance > 0 ? "border-destructive/40" : totals.balance < 0 ? "border-income/40" : "border-border")}>
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-medium"><Wallet size={11} /> Saldo Geral</div>
          <p className={cn("mt-0.5 text-lg font-semibold mono", totals.balance > 0 ? "text-destructive" : totals.balance < 0 ? "text-income" : "text-muted-foreground")}>{formatBalance(totals.balance)}</p>
        </div>
      </div>

      {sellers.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center"><p className="text-sm text-muted-foreground">Nenhum funcionário cadastrado.</p></div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {sellers.map(seller => {
            const debt = getSellerDebt(seller.id);
            const paid = getSellerPaid(seller.id);
            const balance = getSellerBalance(seller.id);
            const sellerRetiradas = sales.filter(s => s.sellerId === seller.id && s.type === "retirada_funcionario");
            const sellerPayments = sellerDebtPayments.filter(p => p.sellerId === seller.id);
            const sellerDebts = sellerManualDebts.filter(d => d.sellerId === seller.id);
            const isExpanded = expandedId === seller.id;

            return (
              <div key={seller.id} className={cn(
                "rounded-xl border bg-card overflow-hidden",
                balance > 0 ? "border-destructive/30" : balance < 0 ? "border-income/30" : "border-border"
              )}>
                <div className="px-4 py-3 border-b border-border/60">
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <div className="min-w-0">
                      <h3 className="font-semibold text-sm truncate">{seller.name}</h3>
                      <p className="text-[11px] text-muted-foreground">Abate {seller.debtPercentage ?? 10}% por venda</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Retirado</p>
                      <p className="text-sm font-semibold text-warning mono mt-0.5">{formatCurrency(debt)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Pago</p>
                      <p className="text-sm font-semibold text-income mono mt-0.5">{formatCurrency(paid)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Saldo</p>
                      <p className={cn("text-sm font-semibold mono mt-0.5", balance > 0 ? "text-destructive" : balance < 0 ? "text-income" : "text-muted-foreground")}>{formatBalance(balance)}</p>
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => setExpandedId(isExpanded ? null : seller.id)}
                  className="w-full flex items-center justify-between px-4 py-2 text-[11px] text-muted-foreground hover:text-foreground hover:bg-secondary/40 transition-colors"
                >
                  <span>{isExpanded ? "Ocultar histórico" : "Ver histórico"}</span>
                  <ChevronDown size={13} className={cn("transition-transform", isExpanded && "rotate-180")} />
                </button>

                {isExpanded && (
                  <div className="border-t border-border/60 px-4 py-3 space-y-3">
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Retiradas</p>
                      {sellerRetiradas.length === 0 ? (
                        <p className="text-[11px] text-muted-foreground italic">Nenhuma retirada.</p>
                      ) : (
                        <div className="space-y-0.5">
                          {sellerRetiradas.slice().reverse().map(s => (
                            <div key={s.id} className="flex justify-between text-[11px] px-2 py-1 rounded hover:bg-warning/5">
                              <span className="truncate"><span className="mono text-muted-foreground">{formatDateBR(s.date)}</span> · {s.quantity}x {getProductName(s.productId)}</span>
                              <span className="font-semibold text-warning mono shrink-0 ml-2">{formatCurrency(s.totalPrice)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Dívidas manuais</p>
                      {sellerDebts.length === 0 ? (
                        <p className="text-[11px] text-muted-foreground italic">Nenhuma dívida manual.</p>
                      ) : (
                        <div className="space-y-0.5">
                          {sellerDebts.slice().reverse().map(d => (
                            <div key={d.id} className="flex justify-between items-center text-[11px] px-2 py-1 rounded hover:bg-warning/5 group/row">
                              <div className="flex-1 min-w-0">
                                <p className="mono text-muted-foreground">{formatDateBR(d.date)}</p>
                                {d.notes && <p className="text-[10px] text-muted-foreground truncate">{d.notes}</p>}
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                <span className="font-semibold text-warning mono">{formatCurrency(d.amount)}</span>
                                <Button variant="ghost" size="icon" className="h-5 w-5 text-muted-foreground hover:text-destructive opacity-0 group-hover/row:opacity-100 transition-opacity" onClick={() => { if (confirm("Excluir esta dívida?")) deleteSellerManualDebt(d.id); }}>
                                  <Trash2 size={11} />
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Pagamentos / Abatimentos</p>
                      {sellerPayments.length === 0 ? (
                        <p className="text-[11px] text-muted-foreground italic">Nenhum pagamento.</p>
                      ) : (
                        <div className="space-y-0.5">
                          {sellerPayments.slice().reverse().map(p => (
                            <div key={p.id} className="flex justify-between items-center text-[11px] px-2 py-1 rounded hover:bg-income/5 group/row">
                              <div className="flex-1 min-w-0 flex items-center gap-1.5">
                                <p className="mono text-muted-foreground">{formatDateBR(p.date)}</p>
                                {p.saleId && <span className="inline-flex items-center rounded-full px-1.5 py-0 text-[9px] bg-secondary text-muted-foreground">auto</span>}
                                {p.notes && <p className="text-[10px] text-muted-foreground truncate">· {p.notes}</p>}
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                <span className="font-semibold text-income mono">{formatCurrency(p.amount)}</span>
                                <Button variant="ghost" size="icon" className="h-5 w-5 text-muted-foreground hover:text-destructive opacity-0 group-hover/row:opacity-100 transition-opacity" onClick={() => { if (confirm("Excluir pagamento?")) deleteSellerDebtPayment(p.id); }}>
                                  <Trash2 size={11} />
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
