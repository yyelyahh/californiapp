import { useStore } from "@/context/StoreContext";
import { useState, useMemo } from "react";
import { Plus, Trash2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

function formatCurrency(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

export default function ProductsPage() {
  const { products, addProduct, deleteProduct } = useStore();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", brand: "", flavor: "", purchasePrice: "", salePrice: "" });
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search.trim()) return products;
    const q = search.toLowerCase();
    return products.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.brand.toLowerCase().includes(q) ||
      p.flavor.toLowerCase().includes(q)
    );
  }, [products, search]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    addProduct({
      name: form.name.trim(),
      brand: form.brand.trim(),
      flavor: form.flavor.trim(),
      purchasePrice: Number(form.purchasePrice) || 0,
      salePrice: Number(form.salePrice) || 0,
    });
    setForm({ name: "", brand: "", flavor: "", purchasePrice: "", salePrice: "" });
    setOpen(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Produtos</h1>
          <p className="text-muted-foreground text-sm">Catálogo de pods descartáveis</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus size={16} className="mr-2" />Novo Produto</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Adicionar Produto</DialogTitle></DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div><Label>Nome</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Ex: Ignite V80" /></div>
              <div><Label>Marca</Label><Input value={form.brand} onChange={e => setForm(f => ({ ...f, brand: e.target.value }))} placeholder="Ex: Ignite" /></div>
              <div><Label>Sabor</Label><Input value={form.flavor} onChange={e => setForm(f => ({ ...f, flavor: e.target.value }))} placeholder="Ex: Mango Ice" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Preço Compra (R$)</Label><Input type="number" step="0.01" value={form.purchasePrice} onChange={e => setForm(f => ({ ...f, purchasePrice: e.target.value }))} /></div>
                <div><Label>Preço Venda (R$)</Label><Input type="number" step="0.01" value={form.salePrice} onChange={e => setForm(f => ({ ...f, salePrice: e.target.value }))} /></div>
              </div>
              <Button type="submit" className="w-full">Adicionar</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar por nome, marca ou sabor..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <p className="text-muted-foreground">{products.length === 0 ? "Nenhum produto cadastrado ainda." : "Nenhum produto encontrado."}</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {filtered.map(p => (
            <div key={p.id} className="glass-card p-4 flex items-center justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold">{p.name}</h3>
                  {p.brand && <span className="text-xs bg-secondary text-secondary-foreground px-2 py-0.5 rounded-full">{p.brand}</span>}
                </div>
                {p.flavor && <p className="text-xs text-muted-foreground mt-0.5">{p.flavor}</p>}
              </div>
              <div className="flex items-center gap-6 text-sm">
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Compra</p>
                  <p className="mono text-accent">{formatCurrency(p.purchasePrice)}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Venda</p>
                  <p className="mono text-primary">{formatCurrency(p.salePrice)}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Estoque</p>
                  <p className="mono font-semibold">{p.stock}</p>
                </div>
                <Button variant="ghost" size="icon" onClick={() => deleteProduct(p.id)} className="text-muted-foreground hover:text-destructive">
                  <Trash2 size={16} />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}