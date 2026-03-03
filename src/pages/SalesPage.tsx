import { useStore } from "@/context/StoreContext";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { format, parseISO } from "date-fns";

function formatCurrency(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

export default function SalesPage() {
  const { products, sales, addSale, getProductName } = useStore();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ productId: "", quantity: "", unitPrice: "", date: new Date().toISOString().split("T")[0], notes: "" });

  const selectedProduct = products.find(p => p.id === form.productId);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.productId || !form.quantity) return;
    addSale({
      productId: form.productId,
      quantity: Number(form.quantity),
      unitPrice: Number(form.unitPrice) || 0,
      date: new Date(form.date).toISOString(),
      notes: form.notes || undefined,
    });
    setForm({ productId: "", quantity: "", unitPrice: "", date: new Date().toISOString().split("T")[0], notes: "" });
    setOpen(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Vendas</h1>
          <p className="text-muted-foreground text-sm">Registrar saídas e vendas</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus size={16} className="mr-2" />Nova Venda</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Registrar Venda</DialogTitle></DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label>Produto</Label>
                <Select value={form.productId} onValueChange={v => {
                  const prod = products.find(p => p.id === v);
                  setForm(f => ({ ...f, productId: v, unitPrice: prod?.salePrice?.toString() || f.unitPrice }));
                }}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {products.map(p => <SelectItem key={p.id} value={p.id}>{p.name} ({p.stock} em estoque)</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {selectedProduct && (
                <p className="text-xs text-muted-foreground">Estoque disponível: <span className="mono font-semibold text-foreground">{selectedProduct.stock}</span></p>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Quantidade</Label><Input type="number" value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} /></div>
                <div><Label>Preço Unitário (R$)</Label><Input type="number" step="0.01" value={form.unitPrice} onChange={e => setForm(f => ({ ...f, unitPrice: e.target.value }))} /></div>
              </div>
              <div><Label>Data</Label><Input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} /></div>
              <div><Label>Observações</Label><Input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></div>
              <Button type="submit" className="w-full">Registrar Venda</Button>
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
              <th className="text-right p-3">Preço Un.</th><th className="text-right p-3">Total</th><th className="text-left p-3">Obs.</th>
            </tr></thead>
            <tbody>
              {[...sales].reverse().map(s => (
                <tr key={s.id} className="border-b border-border last:border-0 hover:bg-secondary/30 transition-colors">
                  <td className="p-3 mono text-xs">{format(parseISO(s.date), "dd/MM/yyyy")}</td>
                  <td className="p-3">{getProductName(s.productId)}</td>
                  <td className="p-3 text-right mono">{s.quantity}</td>
                  <td className="p-3 text-right mono text-primary">{formatCurrency(s.unitPrice)}</td>
                  <td className="p-3 text-right mono font-semibold text-primary">{formatCurrency(s.totalPrice)}</td>
                  <td className="p-3 text-xs text-muted-foreground">{s.notes || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
