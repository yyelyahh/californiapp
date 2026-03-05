import { useStore } from "@/context/StoreContext";
import { useState, useMemo } from "react";
import { Plus, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { todayDateString, localDateToISO, formatDateBR } from "@/lib/date-utils";

function formatCurrency(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

export default function StockEntryPage() {
  const { products, stockEntries, addStockEntry, deleteStockEntry, getProductName } = useStore();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ productId: "", quantity: "", unitCost: "", date: todayDateString(), notes: "" });
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const filtered = useMemo(() => {
    let items = [...stockEntries].reverse();
    if (search.trim()) {
      const q = search.toLowerCase();
      items = items.filter(e => getProductName(e.productId).toLowerCase().includes(q));
    }
    if (dateFrom) {
      items = items.filter(e => e.date.slice(0, 10) >= dateFrom);
    }
    if (dateTo) {
      items = items.filter(e => e.date.slice(0, 10) <= dateTo);
    }
    return items;
  }, [stockEntries, search, dateFrom, dateTo, getProductName]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.productId || !form.quantity) return;
    addStockEntry({
      productId: form.productId,
      quantity: Number(form.quantity),
      unitCost: Number(form.unitCost) || 0,
      date: localDateToISO(form.date),
      notes: form.notes || undefined,
    });
    setForm({ productId: "", quantity: "", unitCost: "", date: todayDateString(), notes: "" });
    setOpen(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Entrada de Estoque</h1>
          <p className="text-muted-foreground text-sm">Registrar compras de pods</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus size={16} className="mr-2" />Nova Entrada</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Registrar Entrada</DialogTitle></DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label>Produto</Label>
                <Select value={form.productId} onValueChange={v => setForm(f => ({ ...f, productId: v }))}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {products.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Quantidade</Label><Input type="number" value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} /></div>
                <div><Label>Custo Unitário (R$)</Label><Input type="number" step="0.01" value={form.unitCost} onChange={e => setForm(f => ({ ...f, unitCost: e.target.value }))} /></div>
              </div>
              <div><Label>Data</Label><Input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} /></div>
              <div><Label>Observações</Label><Input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></div>
              <Button type="submit" className="w-full">Registrar</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Buscar por produto..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <div className="flex gap-2">
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-36" placeholder="De" />
          <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-36" placeholder="Até" />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="glass-card p-12 text-center"><p className="text-muted-foreground">{stockEntries.length === 0 ? "Nenhuma entrada registrada." : "Nenhuma entrada encontrada."}</p></div>
      ) : (
        <div className="glass-card overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border text-muted-foreground text-xs uppercase">
              <th className="text-left p-3">Data</th><th className="text-left p-3">Produto</th><th className="text-right p-3">Qtd</th>
              <th className="text-right p-3">Custo Un.</th><th className="text-right p-3">Total</th><th className="text-left p-3">Obs.</th><th className="p-3"></th>
            </tr></thead>
            <tbody>
              {filtered.map(e => (
                <tr key={e.id} className="border-b border-border last:border-0 hover:bg-secondary/30 transition-colors">
                  <td className="p-3 mono text-xs">{formatDateBR(e.date)}</td>
                  <td className="p-3">{getProductName(e.productId)}</td>
                  <td className="p-3 text-right mono">{e.quantity}</td>
                  <td className="p-3 text-right mono text-accent">{formatCurrency(e.unitCost)}</td>
                  <td className="p-3 text-right mono font-semibold text-accent">{formatCurrency(e.totalCost)}</td>
                  <td className="p-3 text-xs text-muted-foreground">{e.notes || '—'}</td>
                  <td className="p-3 text-right">
                    <Button variant="ghost" size="icon" onClick={() => deleteStockEntry(e.id)} className="text-muted-foreground hover:text-destructive h-7 w-7">
                      <Trash2 size={14} />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}