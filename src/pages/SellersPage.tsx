import { useStore } from "@/context/StoreContext";
import { useState, useMemo } from "react";
import { Plus, Trash2, Package, Search, Pencil, ArrowRightLeft, ChevronDown, Wallet, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetFooter } from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

function formatCurrency(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

export default function SellersPage() {
  const {
    sellers, products, productAssignments, sales,
    addSeller, updateSeller, deleteSeller,
    addProductAssignment, deleteProductAssignment, transferProductAssignment,
    getProductName, getSellerBalance,
  } = useStore();
  const [sellerOpen, setSellerOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [sellerName, setSellerName] = useState("");
  const [sellerPct, setSellerPct] = useState("10");
  const [editingSellerId, setEditingSellerId] = useState<string | null>(null);
  const [assignForm, setAssignForm] = useState<{ sellerId: string; selectedProducts: Record<string, string> }>({ sellerId: "", selectedProducts: {} });
  const [search, setSearch] = useState("");
  const [transferState, setTransferState] = useState<{ assignmentId: string; toSellerId: string; quantity: string } | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const filteredSellers = useMemo(() => {
    if (!search) return sellers;
    const q = search.toLowerCase();
    return sellers.filter(s => s.name.toLowerCase().includes(q));
  }, [sellers, search]);

  const availableProducts = useMemo(() => {
    return products
      .map(product => {
        const assignedQuantity = productAssignments
          .filter(assignment => assignment.productId === product.id)
          .reduce((sum, assignment) => sum + assignment.quantity, 0);
        return { ...product, availableToAssign: Math.max(0, product.stock - assignedQuantity) };
      })
      .filter(product => product.availableToAssign > 0);
  }, [products, productAssignments]);

  const getSellerReceivable = (sellerId: string) => {
    return sales
      .filter(s => s.sellerId === sellerId && s.type === "venda")
      .reduce((sum, s) => sum + Math.max(0, s.totalPrice - (s.paidAmount || 0)), 0);
  };

  const sellersSummary = useMemo(() => {
    return filteredSellers.map(s => {
      const assignments = productAssignments.filter(a => a.sellerId === s.id);
      const totalItems = assignments.reduce((sum, a) => sum + a.quantity, 0);
      const receivable = getSellerReceivable(s.id);
      const debt = getSellerBalance(s.id);
      return { seller: s, assignments, totalItems, receivable, debt };
    });
  }, [filteredSellers, productAssignments, sales, getSellerBalance]);

  const formatBalance = (v: number) => {
    const sign = v > 0 ? "-" : "+";
    return `${sign} ${formatCurrency(Math.abs(v))}`;
  };

  const totals = useMemo(() => {
    return sellersSummary.reduce((acc, s) => ({
      receivable: acc.receivable + s.receivable,
      debt: acc.debt + s.debt,
      items: acc.items + s.totalItems,
    }), { receivable: 0, debt: 0, items: 0 });
  }, [sellersSummary]);

  const toggleExpanded = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleAddSeller = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sellerName.trim()) return;
    const pct = Number(sellerPct) || 0;
    if (editingSellerId) await updateSeller(editingSellerId, { name: sellerName.trim(), debtPercentage: pct });
    else await addSeller({ name: sellerName.trim(), debtPercentage: pct });
    setSellerName(""); setSellerPct("10"); setEditingSellerId(null); setSellerOpen(false);
  };

  const openEditSeller = (s: typeof sellers[0]) => {
    setEditingSellerId(s.id); setSellerName(s.name);
    setSellerPct(String(s.debtPercentage ?? 10)); setSellerOpen(true);
  };

  const toggleProduct = (productId: string, checked: boolean) => {
    setAssignForm(f => {
      const next = { ...f.selectedProducts };
      if (checked) next[productId] = "1"; else delete next[productId];
      return { ...f, selectedProducts: next };
    });
  };

  const handleAssign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assignForm.sellerId || Object.keys(assignForm.selectedProducts).length === 0) return;
    for (const [productId, qty] of Object.entries(assignForm.selectedProducts)) {
      const product = availableProducts.find(item => item.id === productId);
      const quantity = Math.min(Number(qty), product?.availableToAssign ?? 0);
      if (quantity > 0) await addProductAssignment({ sellerId: assignForm.sellerId, productId, quantity });
    }
    setAssignForm({ sellerId: "", selectedProducts: {} });
    setAssignOpen(false);
  };

  const selectedCount = Object.keys(assignForm.selectedProducts).length;
  const totalUnitsAssign = Object.values(assignForm.selectedProducts).reduce((s, v) => s + (Number(v) || 0), 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Vendedores</h1>
          <p className="text-xs text-muted-foreground">Gerencie vendedores e produtos atribuídos</p>
        </div>
        <div className="flex gap-2">
          {/* Sheet para atribuir produtos (formulário longo) */}
          <Sheet open={assignOpen} onOpenChange={setAssignOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="sm" className="h-9"><Package size={14} className="mr-1.5" />Atribuir</Button>
            </SheetTrigger>
            <SheetContent className="w-full sm:max-w-lg overflow-y-auto p-0 flex flex-col">
              <SheetHeader className="px-6 py-4 border-b border-border">
                <SheetTitle className="text-base font-semibold">Atribuir Produtos</SheetTitle>
                <p className="text-xs text-muted-foreground">Selecione vendedor e produtos a consignar</p>
              </SheetHeader>
              <form onSubmit={handleAssign} className="flex-1 px-6 py-5 space-y-5">
                <div className="space-y-1.5">
                  <Label className="text-xs">Vendedor</Label>
                  <Select value={assignForm.sellerId} onValueChange={v => setAssignForm(f => ({ ...f, sellerId: v }))}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="Selecione o vendedor" /></SelectTrigger>
                    <SelectContent>
                      {sellers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Produtos disponíveis</Label>
                    <span className="text-[10px] text-muted-foreground">{selectedCount} selecionado{selectedCount !== 1 ? "s" : ""}</span>
                  </div>
                  <div className="rounded-lg border border-border divide-y divide-border/60 max-h-72 overflow-y-auto">
                    {availableProducts.length === 0 ? (
                      <p className="text-xs text-muted-foreground p-4 text-center">Todos os produtos já estão totalmente atribuídos.</p>
                    ) : (
                      availableProducts.map(p => {
                        const isChecked = assignForm.selectedProducts.hasOwnProperty(p.id);
                        return (
                          <div key={p.id} className={cn("px-3 py-2 transition-colors", isChecked && "bg-primary/5")}>
                            <div className="flex items-center gap-2">
                              <Checkbox id={`prod-${p.id}`} checked={isChecked} onCheckedChange={(c) => toggleProduct(p.id, !!c)} />
                              <label htmlFor={`prod-${p.id}`} className="text-xs cursor-pointer flex-1 flex items-center justify-between">
                                <span className="font-medium">{p.flavor} <span className="text-muted-foreground font-normal">· {p.model}</span></span>
                                <span className="mono text-[10px] text-muted-foreground">{p.availableToAssign} disp.</span>
                              </label>
                            </div>
                            {isChecked && (
                              <Input type="number" min="1" max={p.availableToAssign} placeholder="Qtd"
                                value={assignForm.selectedProducts[p.id]}
                                onChange={e => setAssignForm(f => ({
                                  ...f,
                                  selectedProducts: { ...f.selectedProducts, [p.id]: String(Math.max(1, Math.min(Number(e.target.value) || 1, p.availableToAssign))) }
                                }))}
                                className="ml-6 mt-1.5 w-24 h-7 text-xs mono" />
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
                {selectedCount > 0 && (
                  <div className="rounded-lg border border-border bg-secondary/30 p-3 space-y-1">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Resumo</p>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Produtos</span>
                      <span className="mono font-medium">{selectedCount}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Unidades</span>
                      <span className="mono font-semibold">{totalUnitsAssign}</span>
                    </div>
                  </div>
                )}
                <SheetFooter className="px-0">
                  <Button type="submit" className="w-full h-10" disabled={selectedCount === 0 || availableProducts.length === 0}>
                    Atribuir {selectedCount > 0 && `(${selectedCount})`}
                  </Button>
                </SheetFooter>
              </form>
            </SheetContent>
          </Sheet>
          <Dialog open={sellerOpen} onOpenChange={(v) => { setSellerOpen(v); if (!v) { setEditingSellerId(null); setSellerName(""); setSellerPct("10"); } }}>
            <DialogTrigger asChild>
              <Button size="sm" className="h-9" onClick={() => { setEditingSellerId(null); setSellerName(""); setSellerPct("10"); }}>
                <Plus size={15} className="mr-1.5" />Novo
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle className="text-base font-semibold">{editingSellerId ? "Editar Vendedor" : "Adicionar Vendedor"}</DialogTitle></DialogHeader>
              <form onSubmit={handleAddSeller} className="space-y-4">
                <div className="space-y-1.5"><Label className="text-xs">Nome</Label><Input value={sellerName} onChange={e => setSellerName(e.target.value)} placeholder="Nome do vendedor" className="h-9" /></div>
                <div className="space-y-1.5">
                  <Label className="text-xs">% de cada venda para abater dívida</Label>
                  <Input type="number" min="0" max="100" step="1" value={sellerPct} onChange={e => setSellerPct(e.target.value)} className="h-9 mono" />
                  <p className="text-[11px] text-muted-foreground">A cada venda, esse % é descontado automaticamente do saldo devedor.</p>
                </div>
                <Button type="submit" className="w-full h-10">{editingSellerId ? "Salvar" : "Adicionar"}</Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid gap-2 grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-border bg-card px-3.5 py-2.5">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-medium"><Users size={11} /> Vendedores</div>
          <p className="mt-0.5 text-lg font-semibold mono">{sellers.length}</p>
        </div>
        <div className="rounded-xl border border-border bg-card px-3.5 py-2.5">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-medium"><Package size={11} /> Itens atribuídos</div>
          <p className="mt-0.5 text-lg font-semibold mono">{totals.items}</p>
        </div>
        <div className="rounded-xl border border-border bg-card px-3.5 py-2.5">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-medium"><Wallet size={11} /> A receber</div>
          <p className="mt-0.5 text-lg font-semibold mono text-income">{formatCurrency(totals.receivable)}</p>
        </div>
        <div className={cn("rounded-xl border bg-card px-3.5 py-2.5", totals.debt > 0 ? "border-destructive/40" : totals.debt < 0 ? "border-income/40" : "border-border")}>
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-medium"><Wallet size={11} /> Saldo</div>
          <p className={cn("mt-0.5 text-lg font-semibold mono", totals.debt > 0 ? "text-destructive" : totals.debt < 0 ? "text-income" : "text-muted-foreground")}>{formatBalance(totals.debt)}</p>
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Buscar vendedor..." value={search} onChange={e => setSearch(e.target.value)} className="pl-8 h-9 text-sm" />
      </div>

      {filteredSellers.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center"><p className="text-sm text-muted-foreground">Nenhum vendedor cadastrado.</p></div>
      ) : (
        <div className="space-y-2">
          {sellersSummary.map(({ seller, assignments, totalItems, receivable, debt }) => {
            const isExpanded = expandedIds.has(seller.id);
            return (
              <div key={seller.id} className="rounded-xl border border-border bg-card overflow-hidden">
                <Collapsible open={isExpanded} onOpenChange={() => toggleExpanded(seller.id)}>
                  <CollapsibleTrigger className="w-full text-left">
                    <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-secondary/40 transition-colors">
                      <ChevronDown size={14} className={cn("shrink-0 text-muted-foreground transition-transform", isExpanded && "rotate-180")} />
                      <div className="font-medium text-sm flex-1 min-w-0 truncate">{seller.name}</div>
                      <div className="flex items-center gap-3 sm:gap-4 text-xs shrink-0">
                        <div className="text-right min-w-[48px] sm:min-w-[56px]">
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Itens</p>
                          <p className="mono font-medium">{totalItems}</p>
                        </div>
                        <div className="text-right min-w-[80px] sm:min-w-[96px]">
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">A receber</p>
                          <p className="mono font-semibold text-income">{formatCurrency(receivable)}</p>
                        </div>
                        <div className="text-right min-w-[80px] sm:min-w-[96px]">
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Saldo</p>
                          <p className={cn("mono font-semibold", debt > 0 ? "text-destructive" : debt < 0 ? "text-income" : "text-muted-foreground")}>{formatBalance(debt)}</p>
                        </div>
                      </div>
                    </div>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="border-t border-border/60 px-4 py-3 space-y-3">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-warning/10 text-warning">Abate {seller.debtPercentage ?? 10}%</span>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="sm" className="h-7 text-[11px]" onClick={(e) => { e.stopPropagation(); openEditSeller(seller); }}>
                            <Pencil size={11} className="mr-1" />Editar
                          </Button>
                          <Button variant="ghost" size="sm" className="h-7 text-[11px] text-destructive hover:text-destructive" onClick={(e) => {
                            e.stopPropagation();
                            if (confirm("Excluir vendedor?")) deleteSeller(seller.id);
                          }}>
                            <Trash2 size={11} className="mr-1" />Excluir
                          </Button>
                        </div>
                      </div>
                      {assignments.length === 0 ? (
                        <p className="text-[11px] text-muted-foreground italic">Nenhum produto atribuído</p>
                      ) : (
                        <div className="rounded-lg border border-border/60 divide-y divide-border/40">
                          {assignments.map(a => {
                            const p = products.find(p => p.id === a.productId);
                            return (
                              <div key={a.id} className="flex items-center justify-between px-3 py-2 text-xs hover:bg-secondary/30 transition-colors group">
                                <div className="min-w-0 flex-1">
                                  <span className="font-medium">{p ? p.flavor : getProductName(a.productId)}</span>
                                  {p?.model && <span className="text-muted-foreground"> · {p.model}</span>}
                                  <span className="ml-2 mono text-muted-foreground">×{a.quantity}</span>
                                </div>
                                <div className="flex gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-primary" title="Transferir"
                                    onClick={() => setTransferState({ assignmentId: a.id, toSellerId: "", quantity: String(a.quantity) })}>
                                    <ArrowRightLeft size={11} />
                                  </Button>
                                  <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive"
                                    onClick={() => { if (confirm("Remover atribuição?")) deleteProductAssignment(a.id); }}>
                                    <Trash2 size={11} />
                                  </Button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={!!transferState} onOpenChange={(v) => { if (!v) setTransferState(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle className="text-base font-semibold">Transferir Atribuição</DialogTitle></DialogHeader>
          {transferState && (() => {
            const a = productAssignments.find(x => x.id === transferState.assignmentId);
            if (!a) return null;
            const product = products.find(p => p.id === a.productId);
            const fromSeller = sellers.find(s => s.id === a.sellerId);
            const max = a.quantity;
            return (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const qty = Math.max(1, Math.min(Number(transferState.quantity) || 0, max));
                  if (!transferState.toSellerId) return;
                  await transferProductAssignment(transferState.assignmentId, transferState.toSellerId, qty);
                  setTransferState(null);
                }}
                className="space-y-4"
              >
                <div className="rounded-lg border border-border bg-secondary/30 p-3 text-xs space-y-1">
                  <p><span className="text-muted-foreground">Produto:</span> <span className="font-medium">{product ? `${product.flavor} · ${product.model}` : getProductName(a.productId)}</span></p>
                  <p><span className="text-muted-foreground">De:</span> <span className="font-medium">{fromSeller?.name}</span> <span className="text-muted-foreground mono">({max} disp.)</span></p>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Para vendedor</Label>
                  <Select value={transferState.toSellerId} onValueChange={v => setTransferState(s => s ? { ...s, toSellerId: v } : s)}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="Selecione o destino" /></SelectTrigger>
                    <SelectContent>
                      {sellers.filter(s => s.id !== a.sellerId).map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Quantidade</Label>
                  <Input type="number" min="1" max={max} value={transferState.quantity}
                    onChange={e => setTransferState(s => s ? { ...s, quantity: e.target.value } : s)} className="h-9 mono" />
                </div>
                <Button type="submit" className="w-full h-10" disabled={!transferState.toSellerId}>Transferir</Button>
              </form>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
