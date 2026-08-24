import { useStore } from "@/context/StoreContext";
import type { Product } from "@/types";
import { useState, useMemo } from "react";
import { Trash2, Search, Package, TrendingUp, DollarSign, ChevronDown, ChevronRight, Pencil, Tag, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import AddProductDialog from "@/components/AddProductDialog";
import { cn } from "@/lib/utils";
import { StaggerAuto } from "@/components/motion/Stagger";
import { AnimatePresence, motion } from "motion/react";
import { transitionBase } from "@/lib/motion";

function formatCurrency(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

export default function ProductsPage() {
  const { products, updateProduct, deleteProduct } = useStore();
  const [search, setSearch] = useState("");
  const [collapsedBrands, setCollapsedBrands] = useState<Set<string>>(new Set());
  const [showOutOfStock, setShowOutOfStock] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [editForm, setEditForm] = useState({ name: "", brand: "", model: "", flavor: "", purchasePrice: "", salePrice: "", stock: "", minStock: "" });
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkForm, setBulkForm] = useState({ model: "", brand: "all", purchasePrice: "", salePrice: "" });
  const [bulkMinOpen, setBulkMinOpen] = useState(false);
  const [bulkMinForm, setBulkMinForm] = useState({ model: "", brand: "all", minStock: "" });

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
      .map(([brand, prods]) => {
        const sorted = prods.sort((a, b) => a.salePrice - b.salePrice);
        const modelMap = new Map<string, typeof filtered>();
        sorted.forEach(p => {
          const model = (p.model || "").trim() || "Sem Modelo";
          if (!modelMap.has(model)) modelMap.set(model, []);
          modelMap.get(model)!.push(p);
        });
        const models = Array.from(modelMap.entries())
          .map(([model, mProds]) => ({
            model,
            products: mProds,
            totalInvested: mProds.reduce((s, p) => s + p.purchasePrice * p.stock, 0),
            totalSaleValue: mProds.reduce((s, p) => s + p.salePrice * p.stock, 0),
            totalProfit: mProds.reduce((s, p) => s + (p.salePrice - p.purchasePrice) * p.stock, 0),
            totalStock: mProds.reduce((s, p) => s + p.stock, 0),
          }))
          .sort((a, b) => (a.products[0]?.salePrice ?? 0) - (b.products[0]?.salePrice ?? 0) || a.model.localeCompare(b.model));
        return {
          brand,
          products: sorted,
          models,
          totalInvested: prods.reduce((s, p) => s + p.purchasePrice * p.stock, 0),
          totalSaleValue: prods.reduce((s, p) => s + p.salePrice * p.stock, 0),
          totalProfit: prods.reduce((s, p) => s + (p.salePrice - p.purchasePrice) * p.stock, 0),
          totalStock: prods.reduce((s, p) => s + p.stock, 0),
        };
      })
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
      if (next.has(brand)) next.delete(brand); else next.add(brand);
      return next;
    });
  };

  const toggleModel = (key: string) => {
    setExpandedModels(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };


  const startEdit = (p: typeof products[0]) => {
    setEditId(p.id);
    setEditForm({
      name: p.name, brand: p.brand, model: p.model || '', flavor: p.flavor,
      purchasePrice: String(p.purchasePrice), salePrice: String(p.salePrice), stock: String(p.stock),
      minStock: String(p.minStock ?? 0),
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
      minStock: Number(editForm.minStock) || 0,
    });
    setEditId(null);
  };

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

  const bulkAffected = useMemo(() => {
    if (!bulkForm.model) return [];
    return products.filter(p =>
      p.model.trim().toLowerCase() === bulkForm.model.trim().toLowerCase() &&
      (bulkForm.brand === "all" || p.brand.trim().toLowerCase() === bulkForm.brand.trim().toLowerCase())
    );
  }, [products, bulkForm.model, bulkForm.brand]);

  const handleBulkUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bulkForm.model) { toast.error("Selecione um modelo"); return; }
    const newPurchase = bulkForm.purchasePrice.trim() === "" ? null : Number(bulkForm.purchasePrice);
    const newSale = bulkForm.salePrice.trim() === "" ? null : Number(bulkForm.salePrice);
    if (newPurchase === null && newSale === null) { toast.error("Informe ao menos um preço"); return; }
    if (bulkAffected.length === 0) { toast.error("Nenhum produto encontrado para esse modelo"); return; }
    const updates: Partial<Product> = {};
    if (newPurchase !== null && !isNaN(newPurchase)) updates.purchasePrice = newPurchase;
    if (newSale !== null && !isNaN(newSale)) updates.salePrice = newSale;
    await Promise.all(bulkAffected.map(p => updateProduct(p.id, updates)));
    toast.success(`${bulkAffected.length} produto(s) atualizado(s)`);
    setBulkOpen(false);
    setBulkForm({ model: "", brand: "all", purchasePrice: "", salePrice: "" });
  };

  const bulkMinAffected = useMemo(() => {
    if (!bulkMinForm.model) return [];
    return products.filter(p =>
      p.model.trim().toLowerCase() === bulkMinForm.model.trim().toLowerCase() &&
      (bulkMinForm.brand === "all" || p.brand.trim().toLowerCase() === bulkMinForm.brand.trim().toLowerCase())
    );
  }, [products, bulkMinForm.model, bulkMinForm.brand]);

  const handleBulkMinUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bulkMinForm.model) { toast.error("Selecione um modelo"); return; }
    if (bulkMinForm.minStock.trim() === "") { toast.error("Informe o estoque mínimo"); return; }
    const min = Number(bulkMinForm.minStock);
    if (isNaN(min) || min < 0) { toast.error("Valor inválido"); return; }
    if (bulkMinAffected.length === 0) { toast.error("Nenhum produto encontrado para esse modelo"); return; }
    await Promise.all(bulkMinAffected.map(p => updateProduct(p.id, { minStock: min })));
    toast.success(`Mínimo aplicado a ${bulkMinAffected.length} produto(s)`);
    setBulkMinOpen(false);
    setBulkMinForm({ model: "", brand: "all", minStock: "" });
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Produtos</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setBulkOpen(true)} className="h-9 gap-1.5">
            <Tag size={14} /> <span className="hidden sm:inline">Preço por Modelo</span><span className="sm:hidden">Preço</span>
          </Button>
          <Button variant="outline" size="sm" onClick={() => setBulkMinOpen(true)} className="h-9 gap-1.5">
            <Package size={14} /> <span className="hidden sm:inline">Mínimo por Modelo</span><span className="sm:hidden">Mínimo</span>
          </Button>
          <AddProductDialog />
        </div>
      </div>

      {/* Bulk price dialog */}
      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Alterar Preço por Modelo</DialogTitle>
            <DialogDescription>Atualize o preço de compra e/ou venda de todos os produtos de um modelo de uma só vez.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleBulkUpdate} className="space-y-4">
            <div>
              <Label className="text-xs">Modelo</Label>
              <Select value={bulkForm.model} onValueChange={v => setBulkForm(f => ({ ...f, model: v }))}>
                <SelectTrigger><SelectValue placeholder="Selecione um modelo (ex: 10K, V155)" /></SelectTrigger>
                <SelectContent>
                  {availableModels.length === 0 ? (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">Nenhum modelo cadastrado</div>
                  ) : availableModels.map(m => (<SelectItem key={m} value={m}>{m}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Marca (opcional)</Label>
              <Select value={bulkForm.brand} onValueChange={v => setBulkForm(f => ({ ...f, brand: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as marcas</SelectItem>
                  {availableBrands.map(b => (<SelectItem key={b} value={b}>{b}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Preço Compra (R$)</Label>
                <Input type="number" step="0.01" placeholder="Manter" value={bulkForm.purchasePrice} onChange={e => setBulkForm(f => ({ ...f, purchasePrice: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs">Preço Venda (R$)</Label>
                <Input type="number" step="0.01" placeholder="Manter" value={bulkForm.salePrice} onChange={e => setBulkForm(f => ({ ...f, salePrice: e.target.value }))} />
              </div>
            </div>
            {bulkForm.model && (
              <div className="rounded-xl border border-border bg-secondary/30 p-3 text-xs">
                <p className="text-muted-foreground mb-1">
                  Produtos afetados: <span className="text-foreground font-medium mono">{bulkAffected.length}</span>
                </p>
                {bulkAffected.length > 0 && (
                  <ul className="space-y-0.5 max-h-32 overflow-auto">
                    {bulkAffected.slice(0, 8).map(p => (
                      <li key={p.id} className="truncate text-muted-foreground">• {p.brand} {p.name} {p.flavor && `· ${p.flavor}`}</li>
                    ))}
                    {bulkAffected.length > 8 && (<li className="text-muted-foreground">+ {bulkAffected.length - 8} outros…</li>)}
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

      {/* Bulk min-stock dialog */}
      <Dialog open={bulkMinOpen} onOpenChange={setBulkMinOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Estoque Mínimo por Modelo</DialogTitle>
            <DialogDescription>Defina o estoque mínimo de um modelo. O valor será aplicado a todos os sabores desse modelo.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleBulkMinUpdate} className="space-y-4">
            <div>
              <Label className="text-xs">Modelo</Label>
              <Select value={bulkMinForm.model} onValueChange={v => setBulkMinForm(f => ({ ...f, model: v }))}>
                <SelectTrigger><SelectValue placeholder="Selecione um modelo" /></SelectTrigger>
                <SelectContent>
                  {availableModels.length === 0 ? (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">Nenhum modelo cadastrado</div>
                  ) : availableModels.map(m => (<SelectItem key={m} value={m}>{m}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Marca (opcional)</Label>
              <Select value={bulkMinForm.brand} onValueChange={v => setBulkMinForm(f => ({ ...f, brand: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as marcas</SelectItem>
                  {availableBrands.map(b => (<SelectItem key={b} value={b}>{b}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Estoque mínimo (unidades)</Label>
              <Input type="number" min="0" placeholder="Ex: 10" value={bulkMinForm.minStock} onChange={e => setBulkMinForm(f => ({ ...f, minStock: e.target.value }))} />
              <p className="text-[11px] text-muted-foreground mt-1">Alerta será exibido quando o estoque total do modelo ficar abaixo desse valor.</p>
            </div>
            {bulkMinForm.model && (
              <div className="rounded-xl border border-border bg-secondary/30 p-3 text-xs">
                <p className="text-muted-foreground">
                  Produtos afetados: <span className="text-foreground font-medium mono">{bulkMinAffected.length}</span>
                </p>
              </div>
            )}
            <Button type="submit" className="w-full" disabled={bulkMinAffected.length === 0}>
              Aplicar {bulkMinAffected.length > 0 && `(${bulkMinAffected.length})`}
            </Button>
          </form>
        </DialogContent>
      </Dialog>


      {/* Edit dialog */}
      <Dialog open={!!editId} onOpenChange={v => { if (!v) setEditId(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Editar Produto</DialogTitle></DialogHeader>
          <form onSubmit={handleEdit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Marca</Label><Input value={editForm.brand} onChange={e => setEditForm(f => ({ ...f, brand: e.target.value }))} /></div>
              <div><Label className="text-xs">Modelo</Label><Input value={editForm.model} onChange={e => setEditForm(f => ({ ...f, model: e.target.value }))} /></div>
            </div>
            <div><Label className="text-xs">Sabor</Label><Input value={editForm.flavor} onChange={e => setEditForm(f => ({ ...f, flavor: e.target.value }))} /></div>
            <div><Label className="text-xs">Nome interno</Label><Input value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div className="grid grid-cols-4 gap-3">
              <div><Label className="text-xs">Compra (R$)</Label><Input type="number" step="0.01" value={editForm.purchasePrice} onChange={e => setEditForm(f => ({ ...f, purchasePrice: e.target.value }))} /></div>
              <div><Label className="text-xs">Venda (R$)</Label><Input type="number" step="0.01" value={editForm.salePrice} onChange={e => setEditForm(f => ({ ...f, salePrice: e.target.value }))} /></div>
              <div><Label className="text-xs">Estoque</Label><Input type="number" value={editForm.stock} onChange={e => setEditForm(f => ({ ...f, stock: e.target.value }))} /></div>
              <div><Label className="text-xs">Mín.</Label><Input type="number" value={editForm.minStock} onChange={e => setEditForm(f => ({ ...f, minStock: e.target.value }))} /></div>
            </div>
            <Button type="submit" className="w-full">Salvar Alterações</Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* KPIs */}
      <StaggerAuto className="grid gap-2 grid-cols-2 lg:grid-cols-4">
        <Kpi icon={DollarSign} label="Investido" value={formatCurrency(totals.invested)} />
        <Kpi icon={TrendingUp} label="Potencial" value={formatCurrency(totals.saleValue)} />
        <Kpi icon={TrendingUp} label="Lucro previsto" value={formatCurrency(totals.profit)} tone={totals.profit >= 0 ? "income" : "destructive"} />
        <Kpi icon={Package} label="Estoque" value={`${totals.stock} un.`} />
      </StaggerAuto>

      {/* Toolbar */}
      <div className="rounded-xl border border-border bg-card/40 px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome, marca ou sabor..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8 h-8 text-xs"
            />
          </div>
          <button
            type="button"
            onClick={() => setShowOutOfStock(v => !v)}
            className={cn(
              "px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors",
              showOutOfStock
                ? "bg-primary/15 text-primary border-primary/40"
                : "bg-transparent text-muted-foreground border-border hover:text-foreground"
            )}
          >
            {showOutOfStock ? "Ocultando zerados não" : `Mostrar zerados${outOfStockCount > 0 ? ` (${outOfStockCount})` : ""}`}
          </button>
          {search && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setSearch("")} className="h-8 text-xs text-muted-foreground hover:text-foreground">
              <X size={13} className="mr-1" />Limpar
            </Button>
          )}
        </div>
      </div>

      {/* Brand groups */}
      {brandGroups.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <p className="text-sm text-muted-foreground">{products.length === 0 ? "Nenhum produto cadastrado ainda." : "Nenhum produto encontrado."}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {brandGroups.map(group => {
            const isCollapsed = collapsedBrands.has(group.brand);
            return (
              <div key={group.brand} className="rounded-xl border border-border bg-card overflow-hidden">
                <button
                  onClick={() => toggleBrand(group.brand)}
                  className="w-full flex items-center justify-between px-3.5 py-2.5 hover:bg-secondary/40 transition-colors text-left"
                >
                  <div className="flex items-center gap-2.5">
                    {isCollapsed ? <ChevronRight size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
                    <div>
                      <h2 className="text-sm font-semibold tracking-tight">{group.brand}</h2>
                      <p className="text-[10px] text-muted-foreground mono">{group.products.length} produto{group.products.length !== 1 ? 's' : ''} · {group.totalStock} un.</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-[11px]">
                    <div className="text-right hidden sm:block">
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Investido</p>
                      <p className="mono font-medium text-foreground">{formatCurrency(group.totalInvested)}</p>
                    </div>
                    <div className="text-right hidden md:block">
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Potencial</p>
                      <p className="mono font-medium text-foreground">{formatCurrency(group.totalSaleValue)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Lucro</p>
                      <p className={cn("mono font-medium", group.totalProfit >= 0 ? "text-income" : "text-destructive")}>
                        {formatCurrency(group.totalProfit)}
                      </p>
                    </div>
                  </div>
                </button>

                <AnimatePresence initial={false}>
                {!isCollapsed && (
                  <motion.div
                    key="body"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={transitionBase}
                    className="border-t border-border overflow-x-auto"
                  >
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border bg-secondary/30 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                          <th className="text-left py-2 px-2 sm:px-3">Sabor · Modelo</th>
                          <th className="text-right py-2 px-2 sm:px-3 w-[60px] sm:w-[90px]">Est.</th>
                          <th className="text-right py-2 px-2 sm:px-3 w-[90px] sm:w-[110px] hidden sm:table-cell">Compra</th>
                          <th className="text-right py-2 px-2 sm:px-3 w-[90px] sm:w-[110px]">Venda</th>
                          <th className="text-right py-2 px-2 sm:px-3 w-[90px] sm:w-[110px]">Lucro</th>
                          <th className="py-2 px-2 sm:px-3 w-[40px] sm:w-[70px]"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.products.map(p => {
                          const profit = p.salePrice - p.purchasePrice;
                          const lowStock = p.stock > 0 && p.stock <= 3;
                          return (
                            <tr key={p.id} className="border-b border-border/40 last:border-0 hover:bg-secondary/40 transition-colors group">
                              <td className="py-2 px-2 sm:px-3">
                                <div className="font-medium text-foreground leading-tight">{p.flavor || p.name}</div>
                                {p.flavor && p.model && (
                                  <div className="text-[11px] text-muted-foreground mt-0.5">{p.model}</div>
                                )}
                              </td>
                              <td className="py-2 px-2 sm:px-3 text-right mono text-sm">
                                <span className={cn("font-semibold", p.stock === 0 ? "text-muted-foreground/50" : lowStock ? "text-warning" : "text-foreground")}>{p.stock}</span>
                              </td>
                              <td className="py-2 px-2 sm:px-3 text-right mono text-xs text-muted-foreground hidden sm:table-cell">{formatCurrency(p.purchasePrice)}</td>
                              <td className="py-2 px-2 sm:px-3 text-right mono text-xs text-foreground">{formatCurrency(p.salePrice)}</td>
                              <td className={cn("py-2 px-2 sm:px-3 text-right mono text-xs font-medium", profit >= 0 ? "text-income" : "text-destructive")}>{formatCurrency(profit)}</td>
                              <td className="py-2 px-2 sm:px-3">
                                <div className="flex gap-0.5 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => startEdit(p)}><Pencil size={13} /></Button>
                                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => setDeleteTarget(p)}><Trash2 size={13} /></Button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </motion.div>
                )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={v => { if (!v) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir produto?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget && (<>Tem certeza que deseja excluir <strong>{deleteTarget.flavor || deleteTarget.name}</strong>
                {deleteTarget.flavor && deleteTarget.name && <> · {deleteTarget.name}</>}? Esta ação ficará registrada na auditoria.</>)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => { if (deleteTarget) await deleteProduct(deleteTarget.id); setDeleteTarget(null); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Kpi({ icon: Icon, label, value, tone }: { icon: any; label: string; value: string; tone?: "income" | "destructive" }) {
  const toneClass = tone === "income" ? "text-income" : tone === "destructive" ? "text-destructive" : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-card px-3.5 py-2.5">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Icon size={11} />
        <p className="text-[10px] uppercase tracking-wider font-medium">{label}</p>
      </div>
      <p className={cn("mt-0.5 text-lg font-semibold mono", toneClass)}>{value}</p>
    </div>
  );
}
