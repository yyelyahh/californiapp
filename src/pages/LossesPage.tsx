import { useStore } from "@/context/StoreContext";
import { useMemo, useState } from "react";
import { Plus, Trash2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { todayDateString, localDateToISO, formatDateBR } from "@/lib/date-utils";
import { useConfirm } from "@/components/ConfirmProvider";

function formatCurrency(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

export default function LossesPage() {
  const { products, stockLosses, addStockLoss, deleteStockLoss, getProductName, getTotalLossValue } = useStore();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [reason, setReason] = useState("");
  const [date, setDate] = useState(todayDateString());
  const [submitting, setSubmitting] = useState(false);

  const selectedProduct = products.find(p => p.id === productId);
  const totalLoss = getTotalLossValue();

  const sortedProducts = useMemo(
    () => [...products].sort((a, b) => `${a.flavor} ${a.brand} ${a.model}`.localeCompare(`${b.flavor} ${b.brand} ${b.model}`)),
    [products]
  );

  const sortedLosses = useMemo(() => [...stockLosses].sort((a, b) => b.date.localeCompare(a.date)), [stockLosses]);

  const reset = () => {
    setProductId(""); setQuantity("1"); setReason(""); setDate(todayDateString());
  };

  const handleSubmit = async () => {
    if (!productId || !Number(quantity)) return;
    setSubmitting(true);
    await addStockLoss({
      productId,
      quantity: Number(quantity),
      reason: reason || undefined,
      date: localDateToISO(date),
    });
    setSubmitting(false);
    reset();
    setOpen(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Perdas de Estoque</h1>
          <p className="text-muted-foreground text-sm">Registrar produtos quebrados, vencidos ou extraviados</p>
        </div>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
          <DialogTrigger asChild>
            <Button><Plus size={16} className="mr-2" />Nova Perda</Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Registrar Perda</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Produto</Label>
                <Select value={productId} onValueChange={setProductId}>
                  <SelectTrigger><SelectValue placeholder="Selecione o produto" /></SelectTrigger>
                  <SelectContent>
                    {sortedProducts.map(p => (
                      <SelectItem key={p.id} value={p.id} disabled={p.stock <= 0}>
                        {p.flavor} · {p.brand} {p.model} ({p.stock} un.)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Quantidade</Label>
                  <Input type="number" min="1" max={selectedProduct?.stock || undefined} value={quantity} onChange={e => setQuantity(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Data</Label>
                  <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Motivo</Label>
                <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="Ex: quebrado, vencido, extraviado" />
              </div>

              {selectedProduct && Number(quantity) > 0 && (
                <div className="rounded-md border border-border p-3 text-sm space-y-1">
                  <div className="flex justify-between"><span className="text-muted-foreground">Custo unitário</span><span className="mono">{formatCurrency(selectedProduct.purchasePrice)}</span></div>
                  <div className="flex justify-between font-semibold"><span>Valor da perda</span><span className="mono text-[#ff4242]">{formatCurrency(selectedProduct.purchasePrice * Number(quantity))}</span></div>
                </div>
              )}

              <Button onClick={handleSubmit} disabled={!productId || !Number(quantity) || submitting} className="w-full">
                {submitting ? "Registrando..." : "Registrar Perda"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="glass-card p-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <AlertTriangle className="text-[#ff4242]" size={20} />
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Perda Total Acumulada</p>
            <p className="text-xl font-bold mono">{formatCurrency(totalLoss)}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Unidades Perdidas</p>
          <p className="text-xl font-bold mono">{stockLosses.reduce((s, l) => s + l.quantity, 0)}</p>
        </div>
      </div>

      {sortedLosses.length === 0 ? (
        <div className="glass-card p-12 text-center"><p className="text-muted-foreground">Nenhuma perda registrada.</p></div>
      ) : (
        <div className="glass-card overflow-hidden">
          {sortedLosses.map(l => (
            <div key={l.id} className="flex items-center justify-between px-4 py-3 border-b border-border/50 last:border-b-0 hover:bg-secondary/30 transition-colors">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm truncate">{getProductName(l.productId)}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {formatDateBR(l.date)}{l.reason ? ` · ${l.reason}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-5 text-sm shrink-0">
                <div className="text-right">
                  <p className="text-[10px] text-muted-foreground">Qtd</p>
                  <p className="mono text-xs font-semibold">{l.quantity}</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] text-muted-foreground">Valor</p>
                  <p className="mono text-xs font-semibold text-[#ff4242]">{formatCurrency(l.totalCost)}</p>
                </div>
                <Button variant="ghost" size="icon" onClick={async () => { if (await confirm({ title: "Excluir perda", description: "Excluir este registro de perda? O estoque será restaurado." })) deleteStockLoss(l.id); }} className="text-muted-foreground hover:text-destructive h-7 w-7">
                  <Trash2 size={14} />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
