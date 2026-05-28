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

function formatCurrency(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

const emptyForm = { productId: "", quantity: "", unitPrice: "", date: todayDateString(), notes: "", installments: "1", paidAmount: "0", sellerId: "", type: "venda" as "venda" | "retirada_funcionario" };

export default function SalesPage() {
  const { products, sales, sellers, productAssignments, addSale, updateSale, deleteSale, getProductName, getSellerName } = useStore();
  const { role, sellerId } = useAuth();
  const isSeller = role === "seller";

  const [open, setOpen] = useState(false);
  const [editingSale, setEditingSale] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);

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
    return product ? `${product.model} * ${product.flavor}` : getProductName(productId);
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
    if (!form.productId || !form.quantity) return;

    // Retirada exige vendedor
    if (form.type === "retirada_funcionario" && !isSeller && !form.sellerId) {
      alert("Selecione o funcionário para a retirada.");
      return;
    }

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
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm("Tem certeza que deseja excluir esta venda?")) {
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
                  ? "bg-amber-500/20 text-amber-400 border-amber-500/50"
                  : "bg-secondary text-muted-foreground border-border hover:text-foreground"
              )}
            >Retirada Funcionário</button>
          </div>
          {isRetirada && (
            <div className="mt-2 flex items-start gap-2 rounded-md bg-amber-500/10 border border-amber-500/20 px-3 py-2 text-xs text-amber-400">
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
        <div className={cn("rounded-md p-3 space-y-1 text-sm", isRetirada ? "bg-amber-500/10" : "bg-secondary/50")}>
          <div className="flex justify-between"><span className="text-muted-foreground">Total:</span><span className="font-semibold">{formatCurrency(Number(form.quantity) * Number(form.unitPrice))}</span></div>
          {!isRetirada && Number(form.installments) > 1 && (
            <div className="flex justify-between"><span className="text-muted-foreground">Valor por parcela:</span><span>{formatCurrency((Number(form.quantity) * Number(form.unitPrice)) / Number(form.installments))}</span></div>
          )}
          {!isRetirada && (
            <div className="flex justify-between"><span className="text-muted-foreground">Falta receber:</span><span className="font-semibold text-destructive">{formatCurrency(Math.max(0, (Number(form.quantity) * Number(form.unitPrice)) - Number(form.paidAmount)))}</span></div>
          )}
          {isRetirada && (
            <div className="flex justify-between"><span className="text-amber-400">Vai p/ saldo devedor do funcionário:</span><span className="font-semibold text-amber-400">{formatCurrency(Number(form.quantity) * Number(form.unitPrice))}</span></div>
          )}
        </div>
      )}
      <div><Label>Data</Label><Input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} /></div>
      {!isSeller && (
        <div>
          <Label>Funcionário {isRetirada && <span className="text-destructive">*</span>}</Label>
          <Select value={form.sellerId} onValueChange={v => setForm(f => ({ ...f, sellerId: v }))}>
            <SelectTrigger><SelectValue placeholder={isRetirada ? "Obrigatório" : "Sem vendedor"} /></SelectTrigger>
            <SelectContent>
              {sellers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}
      <div><Label>Observações</Label><Input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></div>
      <Button type="submit" className="w-full">{editingSale ? "Salvar Alterações" : (isRetirada ? "Registrar Retirada" : "Registrar Venda")}</Button>
    </form>
  );

  if (isSeller) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Registrar Venda</h1>
          <p className="text-muted-foreground text-sm">Preencha os dados da venda</p>
        </div>
        <div className="glass-card p-6">
          {saleForm}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Vendas</h1>
          <p className="text-muted-foreground text-sm">Registrar saídas e vendas</p>
        </div>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditingSale(null); }}>
          <DialogTrigger asChild>
            <Button onClick={openNew}><Plus size={16} className="mr-2" />Nova Venda</Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>{editingSale ? "Editar Venda" : "Registrar Venda"}</DialogTitle></DialogHeader>
            {saleForm}
          </DialogContent>
        </Dialog>
      </div>

      {(() => {
        const baseSales = sales.filter(s => (s.type || "venda") !== "retirada_funcionario");
        const sortedRetiradas = [...sales]
          .filter(s => s.type === "retirada_funcionario")
          .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

        // Aplica filtros
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

        const renderRow = (s: typeof sales[number]) => {
          const remaining = Math.max(0, s.totalPrice - s.paidAmount);
          const isRet = s.type === "retirada_funcionario";
          return (
            <tr key={s.id} className={cn("border-b border-border last:border-0 hover:bg-secondary/30 transition-colors", isRet && "bg-amber-500/5")}>
              <td className="p-3 mono text-xs">{formatDateBR(s.date)}</td>
              <td className="p-3">{getProductDisplayName(s.productId)}</td>
              <td className="p-3 text-right mono">{s.quantity}</td>
              <td className={cn("p-3 text-right mono font-semibold", isRet ? "text-amber-400" : "text-primary")}>{formatCurrency(s.totalPrice)}</td>
              {!isRet && <td className="p-3 text-right mono text-primary">{formatCurrency(s.paidAmount)}</td>}
              {!isRet && (
                <td className="p-3 text-right mono">
                  {remaining > 0 ? <span className="text-destructive font-semibold">{formatCurrency(remaining)}</span> : <span className="text-muted-foreground">—</span>}
                </td>
              )}
              <td className="p-3 text-sm">{s.sellerId ? getSellerName(s.sellerId) : <span className="text-muted-foreground">—</span>}</td>
              <td className="p-3 text-xs text-muted-foreground max-w-[120px] truncate">{s.notes || '—'}</td>
              <td className="p-3">
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(s)}><Pencil size={14} /></Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDelete(s.id)}><Trash2 size={14} /></Button>
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
              "px-2.5 py-1 rounded-md text-xs font-medium border transition",
              fPreset === key ? "bg-primary text-primary-foreground border-primary" : "bg-secondary text-muted-foreground border-border hover:text-foreground"
            )}
          >{label}</button>
        );

        return (
          <Tabs defaultValue="vendas" className="w-full">
            <TabsList>
              <TabsTrigger value="vendas">Vendas ({baseSales.length})</TabsTrigger>
              <TabsTrigger value="retiradas">Retiradas ({sortedRetiradas.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="vendas" className="mt-4 space-y-4">
              {/* Painel de filtros */}
              <div className="glass-card p-4 space-y-3">
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <Label className="text-xs mb-1 block">Funcionário</Label>
                    <Select value={fSeller} onValueChange={setFSeller}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todos</SelectItem>
                        <SelectItem value="none">Sem funcionário</SelectItem>
                        {sellers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs mb-1 block">Status de pagamento</Label>
                    <Select value={fStatus} onValueChange={(v) => setFStatus(v as PaymentStatus)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todas</SelectItem>
                        <SelectItem value="paid">Pagas</SelectItem>
                        <SelectItem value="partial">Parcial</SelectItem>
                        <SelectItem value="open">Em aberto</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs mb-1 block">Buscar produto</Label>
                    <Input placeholder="Modelo ou sabor..." value={fProduct} onChange={e => setFProduct(e.target.value)} />
                  </div>
                  <div>
                    <Label className="text-xs mb-1 block">Ordenar por</Label>
                    <div className="flex gap-1">
                      <Select value={fSortKey} onValueChange={(v) => setFSortKey(v as SortKey)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="date">Data</SelectItem>
                          <SelectItem value="total">Valor total</SelectItem>
                          <SelectItem value="remaining">Falta receber</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button type="button" variant="outline" size="icon" onClick={() => setFSortDir(d => d === "asc" ? "desc" : "asc")} title={fSortDir === "asc" ? "Crescente" : "Decrescente"}>
                        <ArrowUpDown size={14} className={cn(fSortDir === "asc" && "rotate-180 transition-transform")} />
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-end gap-3">
                  <div className="flex flex-wrap gap-1.5">
                    {presetBtn("all", "Tudo")}
                    {presetBtn("today", "Hoje")}
                    {presetBtn("7d", "7 dias")}
                    {presetBtn("month", "Este mês")}
                    {presetBtn("lastMonth", "Mês passado")}
                  </div>
                  <div className="flex items-end gap-2">
                    <div>
                      <Label className="text-xs mb-1 block">De</Label>
                      <Input type="date" value={fFrom} onChange={e => { setFFrom(e.target.value); setFPreset("custom"); }} className="w-[150px]" />
                    </div>
                    <div>
                      <Label className="text-xs mb-1 block">Até</Label>
                      <Input type="date" value={fTo} onChange={e => { setFTo(e.target.value); setFPreset("custom"); }} className="w-[150px]" />
                    </div>
                  </div>
                  {hasActiveFilters && (
                    <Button type="button" variant="ghost" size="sm" onClick={clearFilters} className="ml-auto">
                      <X size={14} className="mr-1" />Limpar filtros
                    </Button>
                  )}
                </div>
              </div>

              {/* Resumo dos resultados filtrados */}
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="glass-card p-3"><p className="text-xs text-muted-foreground">Registros</p><p className="text-lg font-bold mono">{sortedSales.length}</p></div>
                <div className="glass-card p-3"><p className="text-xs text-muted-foreground">Total vendido</p><p className="text-lg font-bold mono text-primary">{formatCurrency(sumTotal)}</p></div>
                <div className="glass-card p-3"><p className="text-xs text-muted-foreground">Total recebido</p><p className="text-lg font-bold mono text-primary">{formatCurrency(sumPaid)}</p></div>
                <div className="glass-card p-3"><p className="text-xs text-muted-foreground">Em aberto</p><p className={cn("text-lg font-bold mono", sumOpen > 0 ? "text-destructive" : "text-muted-foreground")}>{formatCurrency(sumOpen)}</p></div>
              </div>

              {sortedSales.length === 0 ? (
                <div className="glass-card p-12 text-center"><p className="text-muted-foreground">{baseSales.length === 0 ? "Nenhuma venda registrada." : "Nenhuma venda encontrada com os filtros aplicados."}</p></div>
              ) : (
                <div className="glass-card overflow-hidden overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="border-b border-border text-muted-foreground text-xs uppercase">
                      <th className="text-left p-3">Data</th><th className="text-left p-3">Produto</th><th className="text-right p-3">Qtd</th>
                      <th className="text-right p-3">Total</th><th className="text-right p-3">Recebido</th>
                      <th className="text-right p-3">Falta</th><th className="text-left p-3">Funcionário</th><th className="text-left p-3">Obs.</th><th className="p-3"></th>
                    </tr></thead>
                    <tbody>{sortedSales.map(renderRow)}</tbody>
                  </table>
                </div>
              )}
            </TabsContent>


            <TabsContent value="retiradas" className="mt-4">
              {sortedRetiradas.length === 0 ? (
                <div className="glass-card p-12 text-center"><p className="text-muted-foreground">Nenhuma retirada registrada.</p></div>
              ) : (
                <div className="glass-card overflow-hidden overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="border-b border-border text-muted-foreground text-xs uppercase">
                      <th className="text-left p-3">Data</th><th className="text-left p-3">Produto</th><th className="text-right p-3">Qtd</th>
                      <th className="text-right p-3">Valor</th>
                      <th className="text-left p-3">Funcionário</th><th className="text-left p-3">Obs.</th><th className="p-3"></th>
                    </tr></thead>
                    <tbody>{sortedRetiradas.map(renderRow)}</tbody>
                  </table>
                </div>
              )}
            </TabsContent>
          </Tabs>
        );
      })()}
    </div>
  );
}
