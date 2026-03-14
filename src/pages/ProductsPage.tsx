import { useStore } from "@/context/StoreContext";
import { useState, useMemo } from "react";
import { Trash2, Search, Package, TrendingUp, DollarSign, ChevronDown, ChevronRight, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import AddProductDialog from "@/components/AddProductDialog";

function formatCurrency(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}


export default function ProductsPage() {
  const { products, updateProduct, deleteProduct } = useStore();
  const [search, setSearch] = useState("");
  const [collapsedBrands, setCollapsedBrands] = useState<Set<string>>(new Set());
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: "", brand: "", model: "", flavor: "", purchasePrice: "", salePrice: "", stock: "" });

  const filtered = useMemo(() => {
    if (!search.trim()) return products;
    const q = search.toLowerCase();
    return products.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.brand.toLowerCase().includes(q) ||
      p.flavor.toLowerCase().includes(q)
    );
  }, [products, search]);

  const brandGroups = useMemo(() => {
    const groups = new Map<string, typeof filtered>();
    filtered.forEach(p => {
      const brand = p.brand || "Sem Marca";
      if (!groups.has(brand)) groups.set(brand, []);
      groups.get(brand)!.push(p);
    });
    return Array.from(groups.entries())
      .map(([brand, prods]) => ({
        brand,
        products: prods,
        totalInvested: prods.reduce((s, p) => s + p.purchasePrice * p.stock, 0),
        totalSaleValue: prods.reduce((s, p) => s + p.salePrice * p.stock, 0),
        totalProfit: prods.reduce((s, p) => s + (p.salePrice - p.purchasePrice) * p.stock, 0),
        totalStock: prods.reduce((s, p) => s + p.stock, 0),
      }))
      .sort((a, b) => a.brand.localeCompare(b.brand));
  }, [filtered]);

  const totals = useMemo(() => ({
    invested: products.reduce((s, p) => s + p.purchasePrice * p.stock, 0),
    saleValue: products.reduce((s, p) => s + p.salePrice * p.stock, 0),
    profit: products.reduce((s, p) => s + (p.salePrice - p.purchasePrice) * p.stock, 0),
    stock: products.reduce((s, p) => s + p.stock, 0),
  }), [products]);

  const toggleBrand = (brand: string) => {
    setCollapsedBrands(prev => {
      const next = new Set(prev);
      if (next.has(brand)) next.delete(brand);
      else next.add(brand);
      return next;
    });
  };


  const startEdit = (p: typeof products[0]) => {
    setEditId(p.id);
    setEditForm({
      name: p.name,
      brand: p.brand,
      flavor: p.flavor,
      purchasePrice: String(p.purchasePrice),
      salePrice: String(p.salePrice),
      stock: String(p.stock),
    });
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editId || !editForm.name.trim()) return;
    await updateProduct(editId, {
      name: editForm.name.trim(),
      brand: editForm.brand.trim() || editForm.name.trim().split(" ")[0],
      flavor: editForm.flavor.trim(),
      purchasePrice: Number(editForm.purchasePrice) || 0,
      salePrice: Number(editForm.salePrice) || 0,
      stock: Number(editForm.stock) || 0,
    });
    setEditId(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Produtos</h1>
          <p className="text-muted-foreground text-sm">Catálogo de pods descartáveis</p>
        </div>
        <AddProductDialog />
      </div>

      {/* Dialog de edição */}
      <Dialog open={!!editId} onOpenChange={v => { if (!v) setEditId(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Editar Produto</DialogTitle></DialogHeader>
          <form onSubmit={handleEdit} className="space-y-4">
            <div><Label>Nome</Label><Input value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div><Label>Marca</Label><Input value={editForm.brand} onChange={e => setEditForm(f => ({ ...f, brand: e.target.value }))} placeholder="Auto: primeira palavra do nome" /></div>
            <div><Label>Sabor</Label><Input value={editForm.flavor} onChange={e => setEditForm(f => ({ ...f, flavor: e.target.value }))} /></div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label>Preço Compra (R$)</Label><Input type="number" step="0.01" value={editForm.purchasePrice} onChange={e => setEditForm(f => ({ ...f, purchasePrice: e.target.value }))} /></div>
              <div><Label>Preço Venda (R$)</Label><Input type="number" step="0.01" value={editForm.salePrice} onChange={e => setEditForm(f => ({ ...f, salePrice: e.target.value }))} /></div>
              <div><Label>Estoque</Label><Input type="number" value={editForm.stock} onChange={e => setEditForm(f => ({ ...f, stock: e.target.value }))} /></div>
            </div>
            <Button type="submit" className="w-full">Salvar Alterações</Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dashboard de indicadores */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="stat-card">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
            <DollarSign size={14} />
            <span>Investido em Estoque</span>
          </div>
          <p className="mono text-lg font-semibold text-accent">{formatCurrency(totals.invested)}</p>
        </div>
        <div className="stat-card">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
            <TrendingUp size={14} />
            <span>Valor Potencial de Venda</span>
          </div>
          <p className="mono text-lg font-semibold text-primary">{formatCurrency(totals.saleValue)}</p>
        </div>
        <div className="stat-card stat-card-accent">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
            <TrendingUp size={14} />
            <span>Lucro Potencial</span>
          </div>
          <p className="mono text-lg font-semibold" style={{ color: totals.profit >= 0 ? 'hsl(var(--success))' : 'hsl(var(--destructive))' }}>
            {formatCurrency(totals.profit)}
          </p>
        </div>
        <div className="stat-card">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
            <Package size={14} />
            <span>Itens em Estoque</span>
          </div>
          <p className="mono text-lg font-semibold">{totals.stock}</p>
        </div>
      </div>

      {/* Busca */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar por nome, marca ou sabor..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Grupos por marca */}
      {brandGroups.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <p className="text-muted-foreground">{products.length === 0 ? "Nenhum produto cadastrado ainda." : "Nenhum produto encontrado."}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {brandGroups.map(group => {
            const isCollapsed = collapsedBrands.has(group.brand);
            return (
              <div key={group.brand} className="glass-card overflow-hidden">
                <button
                  onClick={() => toggleBrand(group.brand)}
                  className="w-full flex items-center justify-between p-4 hover:bg-secondary/50 transition-colors text-left"
                >
                  <div className="flex items-center gap-3">
                    {isCollapsed ? <ChevronRight size={18} className="text-muted-foreground" /> : <ChevronDown size={18} className="text-muted-foreground" />}
                    <div>
                      <h2 className="text-lg font-bold">{group.brand}</h2>
                      <p className="text-xs text-muted-foreground">{group.products.length} produto{group.products.length !== 1 ? 's' : ''} · {group.totalStock} un.</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-5 text-xs">
                    <div className="text-right">
                      <p className="text-muted-foreground">Investido</p>
                      <p className="mono text-accent font-medium">{formatCurrency(group.totalInvested)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-muted-foreground">Potencial</p>
                      <p className="mono text-primary font-medium">{formatCurrency(group.totalSaleValue)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-muted-foreground">Lucro</p>
                      <p className="mono font-medium" style={{ color: group.totalProfit >= 0 ? 'hsl(var(--success))' : 'hsl(var(--destructive))' }}>
                        {formatCurrency(group.totalProfit)}
                      </p>
                    </div>
                  </div>
                </button>

                {!isCollapsed && (
                  <div className="border-t border-border">
                    {group.products.map(p => (
                      <div key={p.id} className="flex items-center justify-between px-4 py-3 border-b border-border/50 last:border-b-0 hover:bg-secondary/30 transition-colors">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <h3 className="font-medium text-sm truncate">{p.name}</h3>
                            {p.flavor && <span className="text-xs text-muted-foreground shrink-0">· {p.flavor}</span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-5 text-sm shrink-0">
                          <div className="text-right">
                            <p className="text-[10px] text-muted-foreground">Compra</p>
                            <p className="mono text-xs text-accent">{formatCurrency(p.purchasePrice)}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-[10px] text-muted-foreground">Venda</p>
                            <p className="mono text-xs text-primary">{formatCurrency(p.salePrice)}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-[10px] text-muted-foreground">Lucro/un</p>
                            <p className="mono text-xs font-medium" style={{ color: (p.salePrice - p.purchasePrice) >= 0 ? 'hsl(var(--success))' : 'hsl(var(--destructive))' }}>
                              {formatCurrency(p.salePrice - p.purchasePrice)}
                            </p>
                          </div>
                          <div className="text-right w-12">
                            <p className="text-[10px] text-muted-foreground">Estoque</p>
                            <p className="mono text-xs font-semibold">{p.stock}</p>
                          </div>
                          <Button variant="ghost" size="icon" onClick={() => startEdit(p)} className="text-muted-foreground hover:text-primary h-7 w-7">
                            <Pencil size={14} />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => deleteProduct(p.id)} className="text-muted-foreground hover:text-destructive h-7 w-7">
                            <Trash2 size={14} />
                          </Button>
                        </div>
                      </div>
                    ))}
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
