import { useStore } from "@/context/StoreContext";
import { useState, useMemo } from "react";
import { Plus, Trash2, Package, Search, Pencil, ArrowRightLeft, ChevronDown, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

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

  // Pending receivable per seller = unpaid amount on regular sales (type=venda)
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
    if (editingSellerId) {
      await updateSeller(editingSellerId, { name: sellerName.trim(), debtPercentage: pct });
    } else {
      await addSeller({ name: sellerName.trim(), debtPercentage: pct });
    }
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
      if (quantity > 0) {
        await addProductAssignment({ sellerId: assignForm.sellerId, productId, quantity });
      }
    }
    setAssignForm({ sellerId: "", selectedProducts: {} });
    setAssignOpen(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">Vendedores</h1>
          <p className="text-muted-foreground text-sm">Gerencie vendedores e produtos atribuídos</p>
        </div>
        <div className="flex gap-2">
          <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm"><Package size={14} className="mr-2" />Atribuir</Button>
            </DialogTrigger>
            <DialogContent className="max-h-[85vh] overflow-y-auto">
              <DialogHeader><DialogTitle>Atribuir Produtos a Vendedor</DialogTitle></DialogHeader>
              <form onSubmit={handleAssign} className="space-y-4">
                <div>
                  <Label>Vendedor</Label>
                  <Select value={assignForm.sellerId} onValueChange={v => setAssignForm(f => ({ ...f, sellerId: v }))}>
                    <SelectTrigger><SelectValue placeholder="Selecione o vendedor" /></SelectTrigger>
                    <SelectContent>
                      {sellers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="mb-2 block">Produtos</Label>
                  <div className="space-y-2 max-h-60 overflow-y-auto rounded-md border p-3">
                    {availableProducts.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Todos os produtos já estão totalmente atribuídos.</p>
                    ) : (
                      availableProducts.map(p => {
                        const isChecked = assignForm.selectedProducts.hasOwnProperty(p.id);
                        return (
                          <div key={p.id} className="space-y-1">
                            <div className="flex items-center gap-2">
                              <Checkbox id={`prod-${p.id}`} checked={isChecked} onCheckedChange={(c) => toggleProduct(p.id, !!c)} />
                              <label htmlFor={`prod-${p.id}`} className="text-sm cursor-pointer flex-1">
                                {`${p.model} * ${p.flavor}`} <span className="text-muted-foreground">({p.availableToAssign} disp.)</span>
                              </label>
                            </div>
                            {isChecked && (
                              <Input type="number" min="1" max={p.availableToAssign} placeholder="Qtd"
                                value={assignForm.selectedProducts[p.id]}
                                onChange={e => setAssignForm(f => ({
                                  ...f,
                                  selectedProducts: { ...f.selectedProducts, [p.id]: String(Math.max(1, Math.min(Number(e.target.value) || 1, p.availableToAssign))) }
                                }))}
                                className="ml-6 w-32 h-8 text-sm" />
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
                <Button type="submit" className="w-full" disabled={Object.keys(assignForm.selectedProducts).length === 0 || availableProducts.length === 0}>
                  Atribuir ({Object.keys(assignForm.selectedProducts).length})
                </Button>
              </form>
            </DialogContent>
          </Dialog>
          <Dialog open={sellerOpen} onOpenChange={(v) => { setSellerOpen(v); if (!v) { setEditingSellerId(null); setSellerName(""); setSellerPct("10"); } }}>
            <DialogTrigger asChild>
              <Button size="sm" onClick={() => { setEditingSellerId(null); setSellerName(""); setSellerPct("10"); }}><Plus size={14} className="mr-2" />Novo</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>{editingSellerId ? "Editar Vendedor" : "Adicionar Vendedor"}</DialogTitle></DialogHeader>
              <form onSubmit={handleAddSeller} className="space-y-4">
                <div><Label>Nome</Label><Input value={sellerName} onChange={e => setSellerName(e.target.value)} placeholder="Nome do vendedor" /></div>
                <div>
                  <Label>% de cada venda para abater dívida</Label>
                  <Input type="number" min="0" max="100" step="1" value={sellerPct} onChange={e => setSellerPct(e.target.value)} />
                  <p className="text-xs text-muted-foreground mt-1">A cada venda, esse % é descontado automaticamente do saldo devedor.</p>
                </div>
                <Button type="submit" className="w-full">{editingSellerId ? "Salvar" : "Adicionar"}</Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Visão geral */}
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><Package size={12} /> Itens atribuídos</div>
            <p className="text-base font-bold mono">{totals.items}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><Wallet size={12} /> A receber</div>
            <p className="text-base font-bold text-primary mono">{formatCurrency(totals.receivable)}</p>
          </CardContent>
        </Card>
        <Card className={totals.debt > 0 ? "border-amber-500/30" : ""}>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><Wallet size={12} /> Saldo devedor</div>
            <p className="text-base font-bold text-amber-400 mono">{formatCurrency(totals.debt)}</p>
          </CardContent>
        </Card>
      </div>

      <div className="relative max-w-sm">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Buscar vendedor..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
      </div>

      {filteredSellers.length === 0 ? (
        <div className="glass-card p-12 text-center"><p className="text-muted-foreground">Nenhum vendedor cadastrado.</p></div>
      ) : (
        <div className="space-y-2">
          {sellersSummary.map(({ seller, assignments, totalItems, receivable, debt }) => {
            const isExpanded = expandedIds.has(seller.id);
            return (
              <Card key={seller.id} className="overflow-hidden">
                <Collapsible open={isExpanded} onOpenChange={() => toggleExpanded(seller.id)}>
                  <CollapsibleTrigger className="w-full text-left">
                    <div className="flex items-center gap-3 px-4 py-3 hover:bg-secondary/30 transition-colors">
                      <ChevronDown size={16} className={`shrink-0 text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                      <div className="font-semibold flex-1 min-w-0 truncate">{seller.name}</div>
                      <div className="flex items-center gap-1.5 flex-wrap justify-end">
                        <Badge variant="secondary" className="gap-1 text-xs">
                          <Package size={10} />{totalItems}
                        </Badge>
                        <Badge variant="outline" className="border-primary/40 text-primary text-xs mono" title="A receber das vendas">
                          {formatCurrency(receivable)}
                        </Badge>
                        <Badge variant="outline" className={`text-xs mono ${debt > 0 ? "border-amber-500/40 text-amber-400" : "border-border text-muted-foreground"}`} title="Saldo devedor">
                          {formatCurrency(debt)}
                        </Badge>
                      </div>
                    </div>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="border-t border-border px-4 py-3 space-y-3">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <Badge variant="outline" className="border-amber-500/40 text-amber-400 text-xs">Abate {seller.debtPercentage ?? 10}%</Badge>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="sm" className="h-7" onClick={(e) => { e.stopPropagation(); openEditSeller(seller); }}>
                            <Pencil size={12} className="mr-1" />Editar
                          </Button>
                          <Button variant="ghost" size="sm" className="h-7 text-destructive" onClick={(e) => {
                            e.stopPropagation();
                            if (confirm("Excluir vendedor?")) deleteSeller(seller.id);
                          }}>
                            <Trash2 size={12} className="mr-1" />Excluir
                          </Button>
                        </div>
                      </div>
                      {assignments.length === 0 ? (
                        <p className="text-sm text-muted-foreground">Nenhum produto atribuído</p>
                      ) : (
                        <div className="space-y-1.5">
                          {assignments.map(a => (
                            <div key={a.id} className="flex items-center justify-between rounded-md bg-secondary/50 px-3 py-2 text-sm">
                              <div className="min-w-0 flex-1">
                                <span className="font-medium">{(() => { const p = products.find(p => p.id === a.productId); return p ? `${p.model} * ${p.flavor}` : getProductName(a.productId); })()}</span>
                                <span className="ml-2 text-muted-foreground">×{a.quantity}</span>
                                {a.notes && <p className="text-xs text-muted-foreground mt-0.5">{a.notes}</p>}
                              </div>
                              <div className="flex gap-1 shrink-0">
                                <Button variant="ghost" size="icon" className="h-6 w-6 text-primary" title="Transferir"
                                  onClick={() => setTransferState({ assignmentId: a.id, toSellerId: "", quantity: String(a.quantity) })}>
                                  <ArrowRightLeft size={12} />
                                </Button>
                                <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive"
                                  onClick={() => { if (confirm("Remover atribuição?")) deleteProductAssignment(a.id); }}>
                                  <Trash2 size={12} />
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!transferState} onOpenChange={(v) => { if (!v) setTransferState(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Transferir Atribuição</DialogTitle></DialogHeader>
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
                <div className="text-sm text-muted-foreground">
                  <p><span className="font-medium text-foreground">Produto:</span> {product ? `${product.model} * ${product.flavor}` : getProductName(a.productId)}</p>
                  <p><span className="font-medium text-foreground">De:</span> {fromSeller?.name} ({max} disponível{max !== 1 ? 'eis' : ''})</p>
                </div>
                <div>
                  <Label>Para vendedor</Label>
                  <Select value={transferState.toSellerId} onValueChange={v => setTransferState(s => s ? { ...s, toSellerId: v } : s)}>
                    <SelectTrigger><SelectValue placeholder="Selecione o destino" /></SelectTrigger>
                    <SelectContent>
                      {sellers.filter(s => s.id !== a.sellerId).map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Quantidade</Label>
                  <Input type="number" min="1" max={max} value={transferState.quantity}
                    onChange={e => setTransferState(s => s ? { ...s, quantity: e.target.value } : s)} />
                </div>
                <Button type="submit" className="w-full" disabled={!transferState.toSellerId}>Transferir</Button>
              </form>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
