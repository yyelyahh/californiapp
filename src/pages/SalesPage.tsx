import { useStore } from "@/context/StoreContext";
import { useAuth } from "@/context/AuthContext";
import { useMemo, useState } from "react";
import { Plus, Pencil, Trash2, AlertCircle, X, ArrowUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { todayDateString, localDateToISO, formatDateBR } from "@/lib/date-utils";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useConfirm } from "@/components/ConfirmProvider";

function formatCurrency(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

const emptyForm = { productId: "", quantity: "", unitPrice: "", date: todayDateString(), notes: "", installments: "1", paidAmount: "0", sellerId: "", type: "venda" as "venda" | "retirada_funcionario" };

export default function SalesPage() {
  const { products, sales, sellers, productAssignments, addSale, updateSale, deleteSale, getProductName, getSellerName } = useStore();
  const { role, sellerId } = useAuth();
  const confirm = useConfirm();
  const isSeller = role === "seller";

  const [open, setOpen] = useState(false);
  const [editingSale, setEditingSale] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);

  // Vendedor efetivo para filtrar produtos: vendedor logado, ou seleção do admin
  const effectiveSellerId = isSeller ? sellerId : (form.sellerId || null);

  const availableProducts = effectiveSellerId
    ? products.filter(p => {
        const assignment = productAssignments.find(a => a.productId === p.id && a.sellerId === effectiveSellerId);
        return assignment && assignment.quantity > 0;
      })
    : (isSeller ? [] : products.filter(p => p.stock > 0));

  const getAssignedQuantity = (productId: string) => {
    if (!effectiveSellerId) return null;
    const assignment = productAssignments.find(a => a.productId === productId && a.sellerId === effectiveSellerId);
    return assignment?.quantity ?? 0;
  };

  const selectedProduct = products.find(p => p.id === form.productId);

  // === Filtros (somente aba Vendas, admin) ===
  type DateRangePreset = "all" | "today" | "7d" | "month" | "lastMonth" | "custom";
  type PaymentStatus = "all" | "paid" | "partial" | "open";
  type SortKey = "date" | "total" | "remaining";
  const [fSeller, setFSeller] = useState<string>("all"); // all | none | <id>
  const [fStatus, setFStatus] = useState<PaymentStatus>("all");
  const [fProduct, setFProduct] = useState("");
  const [fPreset, setFPreset] = useState<DateRangePreset>("all");
  const [fFrom, setFFrom] = useState("");
  const [fTo, setFTo] = useState("");
  const [fSortKey, setFSortKey] = useState<SortKey>("date");
  const [fSortDir, setFSortDir] = useState<"asc" | "desc">("desc");

  const applyPreset = (p: DateRangePreset) => {
    setFPreset(p);
    const now = new Date();
    const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (p === "all") { setFFrom(""); setFTo(""); return; }
    if (p === "today") { const t = fmt(now); setFFrom(t); setFTo(t); return; }
    if (p === "7d") { const past = new Date(now); past.setDate(past.getDate() - 6); setFFrom(fmt(past)); setFTo(fmt(now)); return; }
    if (p === "month") { setFFrom(fmt(new Date(now.getFullYear(), now.getMonth(), 1))); setFTo(fmt(new Date(now.getFullYear(), now.getMonth() + 1, 0))); return; }
    if (p === "lastMonth") { setFFrom(fmt(new Date(now.getFullYear(), now.getMonth() - 1, 1))); setFTo(fmt(new Date(now.getFullYear(), now.getMonth(), 0))); return; }
  };

  const clearFilters = () => {
    setFSeller("all"); setFStatus("all"); setFProduct(""); setFPreset("all");
    setFFrom(""); setFTo(""); setFSortKey("date"); setFSortDir("desc");
  };

  const hasActiveFilters = fSeller !== "all" || fStatus !== "all" || fProduct !== "" || fFrom !== "" || fTo !== "" || fSortKey !== "date" || fSortDir !== "desc";

  const getProductDisplayName = (productId: string) => {
    const product = products.find(p => p.id === productId);
    return product ? `${product.flavor} · ${product.model}` : getProductName(productId);
  };

  const openNew = () => {
    setEditingSale(null);
    setForm(emptyForm);
    setOpen(true);
  };

  const openEdit = (s: any) => {
    setEditingSale(s.id);
    setForm({
      productId: s.productId,
      quantity: String(s.quantity),
      unitPrice: String(s.unitPrice),
      date: s.date?.split("T")[0] || todayDateString(),
      notes: s.notes || "",
      installments: String(s.installments || 1),
      paidAmount: String(s.paidAmount || 0),
      sellerId: s.sellerId || "",
      type: s.type || "venda",
    });
    setOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (!form.productId || !form.quantity) return;

    // Retirada exige vendedor
    if (form.type === "retirada_funcionario" && !isSeller && !form.sellerId) {
      alert("Selecione o funcionário para a retirada.");
      return;
    }

    setSubmitting(true);
    try {
      if (editingSale) {
        const totalPrice = Number(form.quantity) * Number(form.unitPrice);
        await updateSale(editingSale, {
          quantity: Number(form.quantity),
          unitPrice: Number(form.unitPrice) || 0,
          totalPrice,
          date: localDateToISO(form.date),
          notes: form.notes || undefined,
          installments: Number(form.installments) || 1,
          paidAmount: form.type === "retirada_funcionario" ? 0 : (Number(form.paidAmount) || 0),
          sellerId: form.sellerId || undefined,
          type: form.type,
        });
      } else {
        const effectiveSellerId = isSeller && sellerId ? sellerId : (form.sellerId || undefined);
        await addSale({
          productId: form.productId,
          quantity: Number(form.quantity),
          unitPrice: Number(form.unitPrice) || 0,
          date: localDateToISO(form.date),
          notes: form.notes || undefined,
          installments: Number(form.installments) || 1,
          paidAmount: form.type === "retirada_funcionario" ? 0 : (Number(form.paidAmount) || 0),
          sellerId: effectiveSellerId,
          type: form.type,
        });
      }
      setForm(emptyForm);
      setEditingSale(null);
      setOpen(false);
    } catch {
      // erro já reportado via toast pelo store; mantém modal aberto para correção
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (await confirm({ title: "Excluir venda", description: "Tem certeza que deseja excluir esta venda? O estoque será restaurado." })) {
      deleteSale(id);
    }
  };

  const isRetirada = form.type === "retirada_funcionario";

  const saleForm = (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Toggle tipo - só admin pode marcar retirada para outros */}
      {!isSeller && (
        <div>
          <Label className="mb-2 block">Tipo de Registro</Label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setForm(f => ({ ...f, type: "venda" }))}
              className={cn(
                "px-3 py-2 rounded-md text-sm font-medium border transition",
                form.type === "venda"
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-secondary text-muted-foreground border-border hover:text-foreground"
              )}
            >Venda Normal</button>
            <button
              type="button"
              onClick={() => setForm(f => ({ ...f, type: "retirada_funcionario" }))}
              className={cn(
                "px-3 py-2 rounded-md text-sm font-medium border transition",
                form.type === "retirada_funcionario"
                  ? "bg-warning/20 text-warning border-warning/50"
                  : "bg-secondary text-muted-foreground border-border hover:text-foreground"
              )}
            >Retirada Funcionário</button>
          </div>
          {isRetirada && (
            <div className="mt-2 flex items-start gap-2 rounded-md bg-warning/10 border border-warning/20 px-3 py-2 text-xs text-warning">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              <span>Não entra no faturamento. Vai para o saldo devedor do funcionário.</span>
            </div>
          )}
        </div>
      )}

      {!isSeller && (
        <div>
          <Label>Funcionário {isRetirada && <span className="text-destructive">*</span>}</Label>
          <Select value={form.sellerId} onValueChange={v => setForm(f => ({ ...f, sellerId: v, productId: "" }))} disabled={!!editingSale}>
            <SelectTrigger><SelectValue placeholder={isRetirada ? "Obrigatório" : "Selecione o vendedor"} /></SelectTrigger>
            <SelectContent>
              {sellers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
          {!form.sellerId && !editingSale && (
            <p className="text-xs text-muted-foreground mt-1">Selecione um vendedor para ver os produtos atribuídos a ele.</p>
          )}
        </div>
      )}

      <div>
        <Label>Produto</Label>
        <Select value={form.productId} onValueChange={v => {
          const prod = products.find(p => p.id === v);
          setForm(f => ({ ...f, productId: v, unitPrice: prod?.salePrice?.toString() || f.unitPrice }));
        }} disabled={!!editingSale || (!isSeller && !form.sellerId)}>
          <SelectTrigger><SelectValue placeholder={!isSeller && !form.sellerId ? "Selecione o vendedor primeiro" : "Selecione"} /></SelectTrigger>
          <SelectContent>
            {availableProducts.length === 0 && (
              <div className="px-2 py-3 text-xs text-muted-foreground text-center">
                {effectiveSellerId ? "Nenhum produto atribuído a este vendedor." : "Nenhum produto disponível."}
              </div>
            )}
            {availableProducts.map(p => {
              const assignedQty = getAssignedQuantity(p.id);
              const displayStock = assignedQty !== null ? assignedQty : p.stock;
              return <SelectItem key={p.id} value={p.id}>{getProductDisplayName(p.id)} ({displayStock} disponível)</SelectItem>;
            })}
          </SelectContent>
        </Select>
      </div>
      {selectedProduct && !editingSale && (
        <p className="text-xs text-muted-foreground">Disponível: <span className="mono font-semibold text-foreground">{effectiveSellerId ? getAssignedQuantity(selectedProduct.id) : selectedProduct.stock}</span></p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div><Label>Quantidade</Label><Input type="number" value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} /></div>
        <div><Label>Preço Unitário (R$)</Label><Input type="number" step="0.01" value={form.unitPrice} onChange={e => setForm(f => ({ ...f, unitPrice: e.target.value }))} /></div>
      </div>
      {!isRetirada && (
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Parcelas</Label><Input type="number" min="1" value={form.installments} onChange={e => setForm(f => ({ ...f, installments: e.target.value }))} /></div>
          <div><Label>Valor Recebido (R$)</Label><Input type="number" step="0.01" value={form.paidAmount} onChange={e => setForm(f => ({ ...f, paidAmount: e.target.value }))} /></div>
        </div>
      )}
      {Number(form.quantity) > 0 && Number(form.unitPrice) > 0 && (
        <div className={cn("rounded-md p-3 space-y-1 text-sm", isRetirada ? "bg-warning/10" : "bg-secondary/50")}>
          <div className="flex justify-between"><span className="text-muted-foreground">Total:</span><span className="font-semibold">{formatCurrency(Number(form.quantity) * Number(form.unitPrice))}</span></div>
          {!isRetirada && Number(form.installments) > 1 && (
            <div className="flex justify-between"><span className="text-muted-foreground">Valor por parcela:</span><span>{formatCurrency((Number(form.quantity) * Number(form.unitPrice)) / Number(form.installments))}</span></div>
          )}
          {!isRetirada && (
            <div className="flex justify-between"><span className="text-muted-foreground">Falta receber:</span><span className="font-semibold text-destructive">{formatCurrency(Math.max(0, (Number(form.quantity) * Number(form.unitPrice)) - Number(form.paidAmount)))}</span></div>
          )}
          {isRetirada && (
            <div className="flex justify-between"><span className="text-warning">Vai p/ saldo devedor do funcionário:</span><span className="font-semibold text-warning">{formatCurrency(Number(form.quantity) * Number(form.unitPrice))}</span></div>
          )}
        </div>
      )}
      <div><Label>Data</Label><Input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} /></div>
      <div><Label>Observações</Label><Input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></div>
      <Button type="submit" className="w-full" disabled={submitting}>{submitting ? "Salvando..." : (editingSale ? "Salvar Alterações" : (isRetirada ? "Registrar Retirada" : "Registrar Venda"))}</Button>
    </form>
  );

  if (isSeller) {
    const mySales = [...sales]
      .filter(s => s.sellerId === sellerId && (s.type || "venda") !== "retirada_funcionario")
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    const sumTotal = mySales.reduce((acc, s) => acc + s.totalPrice, 0);
    const sumPaid = mySales.reduce((acc, s) => acc + s.paidAmount, 0);
    const sumOpen = mySales.reduce((acc, s) => acc + Math.max(0, s.totalPrice - s.paidAmount), 0);

    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Vendas</h1>
            <p className="text-xs text-muted-foreground">Registre suas vendas e acompanhe o histórico</p>
          </div>
          <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditingSale(null); }}>
            <DialogTrigger asChild>
              <Button onClick={openNew} size="sm" className="h-9"><Plus size={15} className="mr-1.5" />Nova Venda</Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto">
              <DialogHeader><DialogTitle>{editingSale ? "Editar Venda" : "Registrar Venda"}</DialogTitle></DialogHeader>
              {saleForm}
            </DialogContent>
          </Dialog>
        </div>

        <div className="grid gap-2 grid-cols-2 sm:grid-cols-3">
          <div className="rounded-xl border border-border bg-card px-3 py-2.5 min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Vendas</p>
            <p className="mt-0.5 text-base font-semibold mono">{mySales.length}</p>
          </div>
          <div className="rounded-xl border border-border bg-card px-3 py-2.5 min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Recebido</p>
            <p className="mt-0.5 text-base font-semibold mono text-income truncate">{formatCurrency(sumPaid)}</p>
          </div>
          <div className="rounded-xl border border-border bg-card px-3 py-2.5 min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Em aberto</p>
            <p className={cn("mt-0.5 text-base font-semibold mono truncate", sumOpen > 0 ? "text-warning" : "text-muted-foreground")}>{formatCurrency(sumOpen)}</p>
          </div>
        </div>

        {mySales.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-12 text-center">
            <p className="text-sm text-muted-foreground">Nenhuma venda registrada ainda.</p>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card overflow-hidden overflow-x-auto">
            <table className="w-full text-sm min-w-[420px]">
              <thead>
                <tr className="border-b border-border bg-secondary/30 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                  <th className="text-left py-2 px-2 sm:px-3">Produto</th>
                  <th className="text-right py-2 px-2 sm:px-3 w-[50px]">Qtd</th>
                  <th className="text-right py-2 px-2 sm:px-3 w-[90px] sm:w-[110px]">Total</th>
                  <th className="text-right py-2 px-2 sm:px-3 w-[90px] sm:w-[110px]">Falta</th>
                </tr>
              </thead>
              <tbody>
                {mySales.map(s => {
                  const remaining = Math.max(0, s.totalPrice - s.paidAmount);
                  return (
                    <tr key={s.id} className="border-b border-border/40 last:border-0">
                      <td className="py-2.5 px-3">
                        <div className="font-medium text-foreground leading-tight">{getProductDisplayName(s.productId)}</div>
                        <div className="text-[11px] text-muted-foreground mt-0.5 mono">{formatDateBR(s.date)}</div>
                      </td>
                      <td className="py-2.5 px-3 text-right mono text-sm text-muted-foreground">{s.quantity}</td>
                      <td className="py-2.5 px-3 text-right mono text-sm font-semibold">{formatCurrency(s.totalPrice)}</td>
                      <td className="py-2.5 px-3 text-right mono text-sm">
                        {remaining > 0 ? <span className="text-warning font-medium">{formatCurrency(remaining)}</span> : <span className="text-income">Pago</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  return (
    <Tabs defaultValue="vendas" className="w-full space-y-5">
      {(() => {
        const baseSales = sales.filter(s => (s.type || "venda") !== "retirada_funcionario");
        const sortedRetiradas = [...sales]
          .filter(s => s.type === "retirada_funcionario")
          .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

        const fromTs = fFrom ? new Date(fFrom + "T00:00:00").getTime() : null;
        const toTs = fTo ? new Date(fTo + "T23:59:59").getTime() : null;
        const productQ = fProduct.trim().toLowerCase();

        const filteredSales = baseSales.filter(s => {
          if (fSeller === "none" && s.sellerId) return false;
          if (fSeller !== "all" && fSeller !== "none" && s.sellerId !== fSeller) return false;
          const ts = new Date(s.date).getTime();
          if (fromTs !== null && ts < fromTs) return false;
          if (toTs !== null && ts > toTs) return false;
          const remaining = Math.max(0, s.totalPrice - s.paidAmount);
          if (fStatus === "paid" && remaining > 0) return false;
          if (fStatus === "open" && s.paidAmount > 0) return false;
          if (fStatus === "partial" && (s.paidAmount === 0 || remaining === 0)) return false;
          if (productQ) {
            const name = getProductDisplayName(s.productId).toLowerCase();
            if (!name.includes(productQ)) return false;
          }
          return true;
        });

        const dirMul = fSortDir === "asc" ? 1 : -1;
        const sortedSales = [...filteredSales].sort((a, b) => {
          if (fSortKey === "date") return (new Date(a.date).getTime() - new Date(b.date).getTime()) * dirMul;
          if (fSortKey === "total") return (a.totalPrice - b.totalPrice) * dirMul;
          const ra = Math.max(0, a.totalPrice - a.paidAmount);
          const rb = Math.max(0, b.totalPrice - b.paidAmount);
          return (ra - rb) * dirMul;
        });

        const sumTotal = sortedSales.reduce((acc, s) => acc + s.totalPrice, 0);
        const sumPaid = sortedSales.reduce((acc, s) => acc + s.paidAmount, 0);
        const sumOpen = sortedSales.reduce((acc, s) => acc + Math.max(0, s.totalPrice - s.paidAmount), 0);
        const paidPct = sumTotal > 0 ? Math.round((sumPaid / sumTotal) * 100) : 0;

        const renderRow = (s: typeof sales[number]) => {
          const remaining = Math.max(0, s.totalPrice - s.paidAmount);
          const isRet = s.type === "retirada_funcionario";
          const sellerName = s.sellerId ? getSellerName(s.sellerId) : "Sem funcionário";
          const statusBadge = !isRet && (
            remaining === 0 ? (
              <span className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-income/10 text-income">Pago</span>
            ) : s.paidAmount > 0 ? (
              <span className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-warning/10 text-warning">Parcial</span>
            ) : (
              <span className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-destructive/10 text-destructive">Aberto</span>
            )
          );
          return (
            <tr key={s.id} className={cn("border-b border-border/40 last:border-0 hover:bg-secondary/40 transition-colors group", isRet && "bg-warning/[0.04]")}>
              <td className="py-2.5 px-3">
                <div className="font-medium text-foreground leading-tight">{getProductDisplayName(s.productId)}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1.5">
                  <span>{sellerName}</span>
                  <span className="opacity-40">·</span>
                  <span className="mono">{formatDateBR(s.date)}</span>
                  {s.notes && (<><span className="opacity-40">·</span><span className="truncate max-w-[140px]" title={s.notes}>{s.notes}</span></>)}
                </div>
              </td>
              <td className="py-2.5 px-3 text-right mono text-sm text-muted-foreground">{s.quantity}</td>
              <td className={cn("py-2.5 px-3 text-right mono text-sm font-semibold", isRet ? "text-warning" : "text-foreground")}>{formatCurrency(s.totalPrice)}</td>
              {!isRet && <td className="py-2.5 px-3 text-right mono text-sm text-income">{s.paidAmount > 0 ? formatCurrency(s.paidAmount) : <span className="text-muted-foreground/50">—</span>}</td>}
              {!isRet && (
                <td className="py-2.5 px-3 text-right mono text-sm">
                  {remaining > 0 ? <span className="text-warning font-medium">{formatCurrency(remaining)}</span> : <span className="text-muted-foreground/50">—</span>}
                </td>
              )}
              {!isRet && <td className="py-2.5 px-3">{statusBadge}</td>}
              <td className="py-2.5 px-3">
                <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(s)}><Pencil size={13} /></Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => handleDelete(s.id)}><Trash2 size={13} /></Button>
                </div>
              </td>
            </tr>
          );
        };

        const presetBtn = (key: DateRangePreset, label: string) => (
          <button
            type="button"
            onClick={() => applyPreset(key)}
            className={cn(
              "px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors",
              fPreset === key
                ? "bg-primary/15 text-primary border-primary/40"
                : "bg-transparent text-muted-foreground border-border hover:text-foreground hover:border-border/80"
            )}
          >{label}</button>
        );

        return (
          <>
            {/* Cabeçalho com tabs integradas */}
            <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-3">
              <div className="flex flex-col gap-3">
                <div>
                  <h1 className="text-xl font-semibold tracking-tight">Vendas</h1>
                  <p className="text-xs text-muted-foreground">Registrar saídas, vendas e retiradas</p>
                </div>
                <TabsList className="bg-transparent p-0 h-auto gap-4 border-0">
                  <TabsTrigger
                    value="vendas"
                    className="relative rounded-none border-0 bg-transparent px-0 pb-2 text-sm font-medium text-muted-foreground data-[state=active]:text-foreground data-[state=active]:shadow-none data-[state=active]:bg-transparent data-[state=active]:after:absolute data-[state=active]:after:inset-x-0 data-[state=active]:after:-bottom-[13px] data-[state=active]:after:h-[2px] data-[state=active]:after:bg-primary"
                  >Vendas <span className="ml-1.5 text-[11px] text-muted-foreground">{baseSales.length}</span></TabsTrigger>
                  <TabsTrigger
                    value="retiradas"
                    className="relative rounded-none border-0 bg-transparent px-0 pb-2 text-sm font-medium text-muted-foreground data-[state=active]:text-foreground data-[state=active]:shadow-none data-[state=active]:bg-transparent data-[state=active]:after:absolute data-[state=active]:after:inset-x-0 data-[state=active]:after:-bottom-[13px] data-[state=active]:after:h-[2px] data-[state=active]:after:bg-primary"
                  >Retiradas <span className="ml-1.5 text-[11px] text-muted-foreground">{sortedRetiradas.length}</span></TabsTrigger>
                </TabsList>
              </div>
              <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditingSale(null); }}>
                <DialogTrigger asChild>
                  <Button onClick={openNew} size="sm" className="h-9"><Plus size={15} className="mr-1.5" />Nova Venda</Button>
                </DialogTrigger>
                <DialogContent className="max-h-[90vh] overflow-y-auto">
                  <DialogHeader><DialogTitle>{editingSale ? "Editar Venda" : "Registrar Venda"}</DialogTitle></DialogHeader>
                  {saleForm}
                </DialogContent>
              </Dialog>
            </div>

            <TabsContent value="vendas" className="mt-0 space-y-4">
              {/* Métricas compactas */}
              <div className="grid gap-2 grid-cols-2 lg:grid-cols-4">
                <div className="rounded-xl border border-border bg-card px-3.5 py-2.5">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Vendas</p>
                  <p className="mt-0.5 text-lg font-semibold mono">{sortedSales.length}</p>
                </div>
                <div className="rounded-xl border border-border bg-card px-3.5 py-2.5">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Receita</p>
                  <p className="mt-0.5 text-lg font-semibold mono text-foreground">{formatCurrency(sumTotal)}</p>
                </div>
                <div className="rounded-xl border border-border bg-card px-3.5 py-2.5">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Recebido</p>
                  <p className="mt-0.5 text-lg font-semibold mono text-income">{formatCurrency(sumPaid)}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{paidPct}% da receita</p>
                </div>
                <div className="rounded-xl border border-border bg-card px-3.5 py-2.5">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Em aberto</p>
                  <p className={cn("mt-0.5 text-lg font-semibold mono", sumOpen > 0 ? "text-warning" : "text-muted-foreground")}>{formatCurrency(sumOpen)}</p>
                </div>
              </div>

              {/* Toolbar de filtros */}
              <div className="rounded-xl border border-border bg-card/40 px-3 py-2.5 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    placeholder="Buscar produto..."
                    value={fProduct}
                    onChange={e => setFProduct(e.target.value)}
                    className="h-8 w-full sm:w-56 text-xs"
                  />
                  <Select value={fSeller} onValueChange={setFSeller}>
                    <SelectTrigger className="h-8 w-auto min-w-[130px] text-xs"><SelectValue placeholder="Funcionário" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos funcionários</SelectItem>
                      <SelectItem value="none">Sem funcionário</SelectItem>
                      {sellers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={fStatus} onValueChange={(v) => setFStatus(v as PaymentStatus)}>
                    <SelectTrigger className="h-8 w-auto min-w-[110px] text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos status</SelectItem>
                      <SelectItem value="paid">Pagas</SelectItem>
                      <SelectItem value="partial">Parcial</SelectItem>
                      <SelectItem value="open">Em aberto</SelectItem>
                    </SelectContent>
                  </Select>
                  <div className="flex items-center gap-1">
                    <Select value={fSortKey} onValueChange={(v) => setFSortKey(v as SortKey)}>
                      <SelectTrigger className="h-8 w-auto min-w-[110px] text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="date">Data</SelectItem>
                        <SelectItem value="total">Valor</SelectItem>
                        <SelectItem value="remaining">Falta</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => setFSortDir(d => d === "asc" ? "desc" : "asc")}>
                      <ArrowUpDown size={13} className={cn(fSortDir === "asc" && "rotate-180 transition-transform")} />
                    </Button>
                  </div>
                  {hasActiveFilters && (
                    <Button type="button" variant="ghost" size="sm" onClick={clearFilters} className="h-8 text-xs ml-auto text-muted-foreground hover:text-foreground">
                      <X size={13} className="mr-1" />Limpar
                    </Button>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {presetBtn("all", "Tudo")}
                  {presetBtn("today", "Hoje")}
                  {presetBtn("7d", "7 dias")}
                  {presetBtn("month", "Este mês")}
                  {presetBtn("lastMonth", "Mês passado")}
                  <div className="flex items-center gap-1 ml-1">
                    <Input type="date" value={fFrom} onChange={e => { setFFrom(e.target.value); setFPreset("custom"); }} className="h-7 w-[130px] text-xs" />
                    <span className="text-xs text-muted-foreground">→</span>
                    <Input type="date" value={fTo} onChange={e => { setFTo(e.target.value); setFPreset("custom"); }} className="h-7 w-[130px] text-xs" />
                  </div>
                </div>
              </div>

              {/* Tabela */}
              {sortedSales.length === 0 ? (
                <div className="rounded-xl border border-border bg-card p-12 text-center">
                  <p className="text-sm text-muted-foreground">{baseSales.length === 0 ? "Nenhuma venda registrada." : "Nenhuma venda encontrada com os filtros aplicados."}</p>
                </div>
              ) : (
                <div className="rounded-xl border border-border bg-card overflow-hidden overflow-x-auto">
                  <table className="w-full text-sm min-w-[640px]">
                    <thead>
                      <tr className="border-b border-border bg-secondary/30 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                        <th className="text-left py-2 px-3">Produto</th>
                        <th className="text-right py-2 px-3 w-[50px]">Qtd</th>
                        <th className="text-right py-2 px-3 w-[100px]">Total</th>
                        <th className="text-right py-2 px-3 w-[100px]">Recebido</th>
                        <th className="text-right py-2 px-3 w-[100px]">Falta</th>
                        <th className="text-left py-2 px-3 w-[70px]">Status</th>
                        <th className="py-2 px-3 w-[70px]"></th>
                      </tr>
                    </thead>
                    <tbody>{sortedSales.map(renderRow)}</tbody>
                  </table>
                </div>
              )}
            </TabsContent>

            <TabsContent value="retiradas" className="mt-0">
              {sortedRetiradas.length === 0 ? (
                <div className="rounded-xl border border-border bg-card p-12 text-center">
                  <p className="text-sm text-muted-foreground">Nenhuma retirada registrada.</p>
                </div>
              ) : (
                <div className="rounded-xl border border-border bg-card overflow-hidden overflow-x-auto">
                  <table className="w-full text-sm min-w-[420px]">
                    <thead>
                      <tr className="border-b border-border bg-secondary/30 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                        <th className="text-left py-2 px-3">Produto</th>
                        <th className="text-right py-2 px-3 w-[60px]">Qtd</th>
                        <th className="text-right py-2 px-3 w-[140px]">Valor</th>
                        <th className="py-2 px-3 w-[80px]"></th>
                      </tr>
                    </thead>
                    <tbody>{sortedRetiradas.map(renderRow)}</tbody>
                  </table>
                </div>
              )}
            </TabsContent>
          </>
        );
      })()}
    </Tabs>
  );
}
