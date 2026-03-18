import { useStore } from "@/context/StoreContext";
import { useAuth } from "@/context/AuthContext";
import { useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { todayDateString, localDateToISO, formatDateBR } from "@/lib/date-utils";
import { Badge } from "@/components/ui/badge";

function formatCurrency(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

const emptyForm = { productId: "", quantity: "", unitPrice: "", date: todayDateString(), notes: "", installments: "1", paidAmount: "0", sellerId: "" };

export default function SalesPage() {
  const { products, sales, sellers, addSale, updateSale, deleteSale, getProductName, getSellerName } = useStore();
  const { role } = useAuth();
  const isSeller = role === "seller";
  const [open, setOpen] = useState(false);
  const [editingSale, setEditingSale] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);

  const selectedProduct = products.find(p => p.id === form.productId);
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
    });
    setOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.productId || !form.quantity) return;

    if (editingSale) {
      const totalPrice = Number(form.quantity) * Number(form.unitPrice);
      updateSale(editingSale, {
        quantity: Number(form.quantity),
        unitPrice: Number(form.unitPrice) || 0,
        totalPrice,
        date: localDateToISO(form.date),
        notes: form.notes || undefined,
        installments: Number(form.installments) || 1,
        paidAmount: Number(form.paidAmount) || 0,
        sellerId: form.sellerId || undefined,
      });
    } else {
      addSale({
        productId: form.productId,
        quantity: Number(form.quantity),
        unitPrice: Number(form.unitPrice) || 0,
        date: localDateToISO(form.date),
        notes: form.notes || undefined,
        installments: Number(form.installments) || 1,
        paidAmount: Number(form.paidAmount) || 0,
        sellerId: form.sellerId || undefined,
      });
    }
    setForm(emptyForm);
    setEditingSale(null);
    setOpen(false);
  };

  const handleDelete = async (id: string) => {
    if (confirm("Tem certeza que deseja excluir esta venda?")) {
      deleteSale(id);
    }
  };

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
          <DialogContent>
            <DialogHeader><DialogTitle>{editingSale ? "Editar Venda" : "Registrar Venda"}</DialogTitle></DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label>Produto</Label>
                <Select value={form.productId} onValueChange={v => {
                  const prod = products.find(p => p.id === v);
                  setForm(f => ({ ...f, productId: v, unitPrice: prod?.salePrice?.toString() || f.unitPrice }));
                }} disabled={!!editingSale}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {products.map(p => <SelectItem key={p.id} value={p.id}>{getProductDisplayName(p.id)} ({p.stock} em estoque)</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {selectedProduct && !editingSale && (
                <p className="text-xs text-muted-foreground">Estoque disponível: <span className="mono font-semibold text-foreground">{selectedProduct.stock}</span></p>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Quantidade</Label><Input type="number" value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} /></div>
                <div><Label>Preço Unitário (R$)</Label><Input type="number" step="0.01" value={form.unitPrice} onChange={e => setForm(f => ({ ...f, unitPrice: e.target.value }))} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Parcelas</Label><Input type="number" min="1" value={form.installments} onChange={e => setForm(f => ({ ...f, installments: e.target.value }))} /></div>
                <div><Label>Valor Recebido (R$)</Label><Input type="number" step="0.01" value={form.paidAmount} onChange={e => setForm(f => ({ ...f, paidAmount: e.target.value }))} /></div>
              </div>
              {Number(form.quantity) > 0 && Number(form.unitPrice) > 0 && (
                <div className="rounded-md bg-secondary/50 p-3 space-y-1 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Total:</span><span className="font-semibold">{formatCurrency(Number(form.quantity) * Number(form.unitPrice))}</span></div>
                  {Number(form.installments) > 1 && (
                    <div className="flex justify-between"><span className="text-muted-foreground">Valor por parcela:</span><span>{formatCurrency((Number(form.quantity) * Number(form.unitPrice)) / Number(form.installments))}</span></div>
                  )}
                  <div className="flex justify-between"><span className="text-muted-foreground">Falta receber:</span><span className="font-semibold text-destructive">{formatCurrency(Math.max(0, (Number(form.quantity) * Number(form.unitPrice)) - Number(form.paidAmount)))}</span></div>
                </div>
              )}
              <div><Label>Data</Label><Input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} /></div>
              <div>
                <Label>Vendedor</Label>
                <Select value={form.sellerId} onValueChange={v => setForm(f => ({ ...f, sellerId: v }))}>
                  <SelectTrigger><SelectValue placeholder="Sem vendedor" /></SelectTrigger>
                  <SelectContent>
                    {sellers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Observações</Label><Input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></div>
              <Button type="submit" className="w-full">{editingSale ? "Salvar Alterações" : "Registrar Venda"}</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {sales.length === 0 ? (
        <div className="glass-card p-12 text-center"><p className="text-muted-foreground">Nenhuma venda registrada.</p></div>
      ) : (
        <div className="glass-card overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border text-muted-foreground text-xs uppercase">
              <th className="text-left p-3">Data</th><th className="text-left p-3">Produto</th><th className="text-right p-3">Qtd</th>
              <th className="text-right p-3">Total</th><th className="text-center p-3">Parcelas</th><th className="text-right p-3">Recebido</th>
              <th className="text-right p-3">Falta</th><th className="text-left p-3">Vendedor</th><th className="text-left p-3">Obs.</th><th className="p-3"></th>
            </tr></thead>
            <tbody>
              {[...sales].reverse().map(s => {
                const remaining = Math.max(0, s.totalPrice - s.paidAmount);
                return (
                  <tr key={s.id} className="border-b border-border last:border-0 hover:bg-secondary/30 transition-colors">
                    <td className="p-3 mono text-xs">{formatDateBR(s.date)}</td>
                    <td className="p-3">{getProductDisplayName(s.productId)}</td>
                    <td className="p-3 text-right mono">{s.quantity}</td>
                    <td className="p-3 text-right mono font-semibold text-primary">{formatCurrency(s.totalPrice)}</td>
                    <td className="p-3 text-center">{s.installments > 1 ? <Badge variant="secondary">{s.installments}x</Badge> : "1x"}</td>
                    <td className="p-3 text-right mono text-primary">{formatCurrency(s.paidAmount)}</td>
                    <td className="p-3 text-right mono">
                      {remaining > 0 ? <span className="text-destructive font-semibold">{formatCurrency(remaining)}</span> : <span className="text-muted-foreground">—</span>}
                    </td>
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
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
