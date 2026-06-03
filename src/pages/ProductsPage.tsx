import { useStore } from "@/context/StoreContext";
import type { Product } from "@/types";
import { useState, useMemo } from "react";
import { Trash2, Search, Package, TrendingUp, DollarSign, ChevronDown, ChevronRight, Pencil, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import AddProductDialog from "@/components/AddProductDialog";

function formatCurrency(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}


export default function ProductsPage() {
  const { products, updateProduct, deleteProduct } = useStore();
  const [search, setSearch] = useState("");
  const [collapsedBrands, setCollapsedBrands] = useState<Set<string>>(new Set());
  const [showOutOfStock, setShowOutOfStock] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: "", brand: "", model: "", flavor: "", purchasePrice: "", salePrice: "", stock: "" });
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkForm, setBulkForm] = useState({ model: "", brand: "all", purchasePrice: "", salePrice: "" });

  const outOfStockCount = useMemo(() => products.filter(p => p.stock <= 0).length, [products]);

  const filtered = useMemo(() => {
    const base = showOutOfStock ? products : products.filter(p => p.stock > 0);
    if (!search.trim()) return base;
    const q = search.toLowerCase();
    return base.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.brand.toLowerCase().includes(q) ||
      p.flavor.toLowerCase().includes(q)
    );
  }, [products, search, showOutOfStock]);

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
      model: p.model || '',
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
      model: editForm.model.trim(),
      flavor: editForm.flavor.trim(),
      purchasePrice: Number(editForm.purchasePrice) || 0,
      salePrice: Number(editForm.salePrice) || 0,
      stock: Number(editForm.stock) || 0,
    });
    setEditId(null);
  };

  // Lista única de modelos (e marcas) presentes no catálogo
  const availableModels = useMemo(() => {
    const set = new Set<string>();
    products.forEach(p => { if (p.model && p.model.trim()) set.add(p.model.trim()); });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [products]);

  const availableBrands = useMemo(() => {
    const set = new Set<string>();
    products.forEach(p => { if (p.brand && p.brand.trim()) set.add(p.brand.trim()); });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [products]);

  // Produtos que serão afetados pela atualização em massa
  const bulkAffected = useMemo(() => {
    if (!bulkForm.model) return [];
    return products.filter(p =>
      p.model.trim().toLowerCase() === bulkForm.model.trim().toLowerCase() &&
      (bulkForm.brand === "all" || p.brand.trim().toLowerCase() === bulkForm.brand.trim().toLowerCase())
    );
  }, [products, bulkForm.model, bulkForm.brand]);

  const handleBulkUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bulkForm.model) {
      toast.error("Selecione um modelo");
      return;
    }
    const newPurchase = bulkForm.purchasePrice.trim() === "" ? null : Number(bulkForm.purchasePrice);
    const newSale = bulkForm.salePrice.trim() === "" ? null : Number(bulkForm.salePrice);
    if (newPurchase === null && newSale === null) {
      toast.error("Informe ao menos um preço");
      return;
    }
    if (bulkAffected.length === 0) {
      toast.error("Nenhum produto encontrado para esse modelo");
      return;
    }
    const updates: Partial<Product> = {};
    if (newPurchase !== null && !isNaN(newPurchase)) updates.purchasePrice = newPurchase;
    if (newSale !== null && !isNaN(newSale)) updates.salePrice = newSale;

    await Promise.all(bulkAffected.map(p => updateProduct(p.id, updates)));
    toast.success(`${bulkAffected.length} produto(s) atualizado(s)`);
    setBulkOpen(false);
    setBulkForm({ model: "", brand: "all", purchasePrice: "", salePrice: "" });
  };

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-xl md:text-2xl font-bold">Produtos</h1>
          <p className="text-muted-foreground text-xs md:text-sm">Catálogo de pods descartáveis</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setBulkOpen(true)} className="gap-1.5">
            <Tag size={14} /> <span className="hidden sm:inline">Preço por Modelo</span><span className="sm:hidden">Modelo</span>
          </Button>
          <AddProductDialog />
        </div>
      </div>

      {/* Dialog de atualização em massa por modelo */}
      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Alterar Preço por Modelo</DialogTitle>
            <DialogDescription>
              Atualize o preço de compra e/ou venda de todos os produtos de um determinado modelo de uma só vez.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleBulkUpdate} className="space-y-4">
            <div>
              <Label>Modelo</Label>
              <Select value={bulkForm.model} onValueChange={v => setBulkForm(f => ({ ...f, model: v }))}>
                <SelectTrigger><SelectValue placeholder="Selecione um modelo (ex: 10K, V155)" /></SelectTrigger>
                <SelectContent>
                  {availableModels.length === 0 ? (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">Nenhum modelo cadastrado</div>
                  ) : availableModels.map(m => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Marca (opcional)</Label>
              <Select value={bulkForm.brand} onValueChange={v => setBulkForm(f => ({ ...f, brand: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as marcas</SelectItem>
                  {availableBrands.map(b => (
                    <SelectItem key={b} value={b}>{b}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Preço Compra (R$)</Label>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="Deixe vazio para manter"
                  value={bulkForm.purchasePrice}
                  onChange={e => setBulkForm(f => ({ ...f, purchasePrice: e.target.value }))}
                />
              </div>
              <div>
                <Label>Preço Venda (R$)</Label>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="Deixe vazio para manter"
                  value={bulkForm.salePrice}
                  onChange={e => setBulkForm(f => ({ ...f, salePrice: e.target.value }))}
                />
              </div>
            </div>
            {bulkForm.model && (
              <div className="rounded-md border border-border bg-secondary/30 p-3 text-xs">
                <p className="text-muted-foreground mb-1">
                  Produtos afetados: <span className="text-foreground font-medium">{bulkAffected.length}</span>
                </p>
                {bulkAffected.length > 0 && (
                  <ul className="space-y-0.5 max-h-32 overflow-auto">
                    {bulkAffected.slice(0, 8).map(p => (
                      <li key={p.id} className="truncate">• {p.brand} {p.name} {p.flavor && `· ${p.flavor}`}</li>
                    ))}
                    {bulkAffected.length > 8 && (
                      <li className="text-muted-foreground">+ {bulkAffected.length - 8} outros…</li>
                    )}
                  </ul>
                )}
              </div>
            )}
            <Button type="submit" className="w-full" disabled={bulkAffected.length === 0}>
              Atualizar {bulkAffected.length > 0 && `(${bulkAffected.length})`}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog de edição */}
      <Dialog open={!!editId} onOpenChange={v => { if (!v) setEditId(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Editar Produto</DialogTitle></DialogHeader>
          <form onSubmit={handleEdit} className="space-y-4">
            <div><Label>Nome</Label><Input value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div><Label>Marca</Label><Input value={editForm.brand} onChange={e => setEditForm(f => ({ ...f, brand: e.target.value }))} placeholder="Auto: primeira palavra do nome" /></div>
            <div><Label>Modelo / Puffs</Label><Input value={editForm.model} onChange={e => setEditForm(f => ({ ...f, model: e.target.value }))} placeholder="Ex: V155, 30K" /></div>
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
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 md:gap-3">
        <div className="stat-card !p-3 md:!p-5">
          <div className="flex items-center gap-1.5 text-muted-foreground text-[10px] md:text-xs mb-1">
            <DollarSign size={12} />
            <span>Investido</span>
          </div>
          <p className="mono text-sm md:text-lg font-semibold">{formatCurrency(totals.invested)}</p>
        </div>
        <div className="stat-card !p-3 md:!p-5">
          <div className="flex items-center gap-1.5 text-muted-foreground text-[10px] md:text-xs mb-1">
            <TrendingUp size={12} />
            <span>Potencial</span>
          </div>
          <p className="mono text-sm md:text-lg font-semibold text-primary">{formatCurrency(totals.saleValue)}</p>
        </div>
        <div className="stat-card stat-card-accent !p-3 md:!p-5">
          <div className="flex items-center gap-1.5 text-muted-foreground text-[10px] md:text-xs mb-1">
            <TrendingUp size={12} />
            <span>Lucro</span>
          </div>
          <p className="mono text-sm md:text-lg font-semibold" style={{ color: totals.profit >= 0 ? 'hsl(var(--success))' : 'hsl(var(--destructive))' }}>
            {formatCurrency(totals.profit)}
          </p>
        </div>
        <div className="stat-card !p-3 md:!p-5">
          <div className="flex items-center gap-1.5 text-muted-foreground text-[10px] md:text-xs mb-1">
            <Package size={12} />
            <span>Estoque</span>
          </div>
          <p className="mono text-sm md:text-lg font-semibold">{totals.stock}</p>
        </div>
      </div>

      {/* Busca */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome, marca ou sabor..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button
          type="button"
          variant={showOutOfStock ? "default" : "outline"}
          size="sm"
          onClick={() => setShowOutOfStock(v => !v)}
          className="shrink-0"
        >
          {showOutOfStock ? "Ocultar zerados" : `Mostrar zerados${outOfStockCount > 0 ? ` (${outOfStockCount})` : ""}`}
        </Button>
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
                  className="w-full flex items-center justify-between p-3 md:p-4 hover:bg-secondary/50 transition-colors text-left"
                >
                  <div className="flex items-center gap-2 md:gap-3">
                    {isCollapsed ? <ChevronRight size={16} className="text-muted-foreground" /> : <ChevronDown size={16} className="text-muted-foreground" />}
                    <div>
                      <h2 className="text-base md:text-lg font-bold">{group.brand}</h2>
                      <p className="text-[10px] md:text-xs text-muted-foreground">{group.products.length} produto{group.products.length !== 1 ? 's' : ''} · {group.totalStock} un.</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 md:gap-5 text-[10px] md:text-xs">
                    <div className="text-right hidden sm:block">
                      <p className="text-muted-foreground">Investido</p>
                      <p className="mono font-medium text-white">{formatCurrency(group.totalInvested)}</p>
                    </div>
                    <div className="text-right hidden sm:block">
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
                      <div key={p.id} className="px-3 md:px-4 py-2.5 md:py-3 border-b border-border/50 last:border-b-0 hover:bg-secondary/30 transition-colors">
                        <div className="flex items-center justify-between">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <h3 className="font-medium text-sm truncate">{p.flavor || p.name}</h3>
                              {p.flavor && p.name && <span className="text-xs text-muted-foreground shrink-0">· {p.name}</span>}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0 ml-2">
                            <Button variant="ghost" size="icon" onClick={() => startEdit(p)} className="text-muted-foreground hover:text-primary h-7 w-7">
                              <Pencil size={14} />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => deleteProduct(p.id)} className="text-muted-foreground hover:text-destructive h-7 w-7">
                              <Trash2 size={14} />
                            </Button>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 md:gap-5 mt-1 text-[10px] md:text-xs">
                          <div>
                            <span className="text-muted-foreground">Compra </span>
                            <span className="mono text-foreground">{formatCurrency(p.purchasePrice)}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Venda </span>
                            <span className="mono text-primary">{formatCurrency(p.salePrice)}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Lucro </span>
                            <span className="mono font-medium" style={{ color: (p.salePrice - p.purchasePrice) >= 0 ? 'hsl(var(--success))' : 'hsl(var(--destructive))' }}>
                              {formatCurrency(p.salePrice - p.purchasePrice)}
                            </span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Est. </span>
                            <span className="mono font-semibold">{p.stock}</span>
                          </div>
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
