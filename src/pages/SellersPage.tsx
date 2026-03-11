import { useStore } from "@/context/StoreContext";
import { useState, useMemo } from "react";
import { Plus, Trash2, Package, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";

export default function SellersPage() {
  const { sellers, products, productAssignments, addSeller, deleteSeller, addProductAssignment, deleteProductAssignment, getProductName } = useStore();
  const [sellerOpen, setSellerOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [sellerName, setSellerName] = useState("");
  const [assignForm, setAssignForm] = useState({ sellerId: "", productId: "", quantity: "", notes: "" });
  const [search, setSearch] = useState("");

  const filteredSellers = useMemo(() => {
    if (!search) return sellers;
    const q = search.toLowerCase();
    return sellers.filter(s => s.name.toLowerCase().includes(q));
  }, [sellers, search]);

  const handleAddSeller = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sellerName.trim()) return;
    await addSeller({ name: sellerName.trim() });
    setSellerName("");
    setSellerOpen(false);
  };

  const handleAssign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assignForm.sellerId || !assignForm.productId || !assignForm.quantity) return;
    await addProductAssignment({
      sellerId: assignForm.sellerId,
      productId: assignForm.productId,
      quantity: Number(assignForm.quantity),
      notes: assignForm.notes || undefined,
    });
    setAssignForm({ sellerId: "", productId: "", quantity: "", notes: "" });
    setAssignOpen(false);
  };

  const getSellerAssignments = (sellerId: string) =>
    productAssignments.filter(a => a.sellerId === sellerId);

  const getSellerTotalItems = (sellerId: string) =>
    getSellerAssignments(sellerId).reduce((sum, a) => sum + a.quantity, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Vendedores</h1>
          <p className="text-muted-foreground text-sm">Gerencie vendedores e produtos atribuídos</p>
        </div>
        <div className="flex gap-2">
          <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
            <DialogTrigger asChild>
              <Button variant="outline"><Package size={16} className="mr-2" />Atribuir Produto</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Atribuir Produto a Vendedor</DialogTitle></DialogHeader>
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
                  <Label>Produto</Label>
                  <Select value={assignForm.productId} onValueChange={v => setAssignForm(f => ({ ...f, productId: v }))}>
                    <SelectTrigger><SelectValue placeholder="Selecione o produto" /></SelectTrigger>
                    <SelectContent>
                      {products.map(p => <SelectItem key={p.id} value={p.id}>{p.name} ({p.stock} em estoque)</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Quantidade</Label>
                  <Input type="number" min="1" value={assignForm.quantity} onChange={e => setAssignForm(f => ({ ...f, quantity: e.target.value }))} />
                </div>
                <div>
                  <Label>Observações</Label>
                  <Input value={assignForm.notes} onChange={e => setAssignForm(f => ({ ...f, notes: e.target.value }))} />
                </div>
                <Button type="submit" className="w-full">Atribuir</Button>
              </form>
            </DialogContent>
          </Dialog>
          <Dialog open={sellerOpen} onOpenChange={setSellerOpen}>
            <DialogTrigger asChild>
              <Button><Plus size={16} className="mr-2" />Novo Vendedor</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Adicionar Vendedor</DialogTitle></DialogHeader>
              <form onSubmit={handleAddSeller} className="space-y-4">
                <div><Label>Nome</Label><Input value={sellerName} onChange={e => setSellerName(e.target.value)} placeholder="Nome do vendedor" /></div>
                <Button type="submit" className="w-full">Adicionar</Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Buscar vendedor..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
      </div>

      {filteredSellers.length === 0 ? (
        <div className="glass-card p-12 text-center"><p className="text-muted-foreground">Nenhum vendedor cadastrado.</p></div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredSellers.map(seller => {
            const assignments = getSellerAssignments(seller.id);
            const totalItems = getSellerTotalItems(seller.id);
            return (
              <Card key={seller.id} className="relative">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">{seller.name}</CardTitle>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => {
                      if (confirm("Excluir vendedor?")) deleteSeller(seller.id);
                    }}><Trash2 size={14} /></Button>
                  </div>
                  <Badge variant="secondary" className="w-fit">{totalItems} itens</Badge>
                </CardHeader>
                <CardContent>
                  {assignments.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nenhum produto atribuído</p>
                  ) : (
                    <div className="space-y-2">
                      {assignments.map(a => (
                        <div key={a.id} className="flex items-center justify-between rounded-md bg-secondary/50 px-3 py-2 text-sm">
                          <div>
                            <span className="font-medium">{getProductName(a.productId)}</span>
                            <span className="ml-2 text-muted-foreground">×{a.quantity}</span>
                            {a.notes && <p className="text-xs text-muted-foreground mt-0.5">{a.notes}</p>}
                          </div>
                          <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive shrink-0" onClick={() => {
                            if (confirm("Remover atribuição?")) deleteProductAssignment(a.id);
                          }}><Trash2 size={12} /></Button>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
