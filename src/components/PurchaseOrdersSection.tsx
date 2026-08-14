import { useMemo, useState } from "react";
import { useStore } from "@/context/StoreContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import { Plus, Trash2, Truck, PackageCheck } from "lucide-react";
import { todayDateString, formatDateBR } from "@/lib/date-utils";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useConfirm } from "@/components/ConfirmProvider";
import type { PurchaseOrder } from "@/types";

type DraftItem = { brand: string; brandNew: string; model: string; modelNew: string; quantity: string; unitPrice: string };
type FlavorRow = { flavor: string; quantity: string };

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const emptyItem = (): DraftItem => ({ brand: "", brandNew: "", model: "", modelNew: "", quantity: "", unitPrice: "" });

export default function PurchaseOrdersSection() {
  const { products, purchaseOrders, addPurchaseOrder, deletePurchaseOrder, receivePurchaseOrder } = useStore();
  const confirm = useConfirm();

  const [newOpen, setNewOpen] = useState(false);
  const [date, setDate] = useState(todayDateString());
  const [notes, setNotes] = useState("");
  const [freightNew, setFreightNew] = useState("");
  const [items, setItems] = useState<DraftItem[]>([emptyItem()]);
  const [saving, setSaving] = useState(false);

  const [receiving, setReceiving] = useState<PurchaseOrder | null>(null);
  const [receiptDate, setReceiptDate] = useState(todayDateString());
  const [costs, setCosts] = useState<Record<string, string>>({});
  const [freight, setFreight] = useState("");
  const [flavors, setFlavors] = useState<Record<string, FlavorRow[]>>({});
  const [confirming, setConfirming] = useState(false);

  const brands = useMemo(() => {
    const set = new Set<string>();
    products.forEach(p => p.brand && set.add(p.brand));
    return Array.from(set).sort();
  }, [products]);

  const modelsFor = (brand: string) => {
    const set = new Set<string>();
    products.filter(p => p.brand.toLowerCase() === brand.toLowerCase()).forEach(p => p.model && set.add(p.model));
    return Array.from(set).sort();
  };

  const pending = purchaseOrders.filter(o => o.status === "pending");
  const received = purchaseOrders.filter(o => o.status === "received");

  const draftItemsTotal = items.reduce((s, i) => s + (Number(i.unitPrice.replace(",", ".")) || 0) * (parseInt(i.quantity, 10) || 0), 0);
  const draftFreight = Number(freightNew.replace(",", ".")) || 0;

  const resolveBrand = (i: DraftItem) => (i.brand === "__new__" ? i.brandNew : i.brand).trim();
  const resolveModel = (i: DraftItem) => (i.model === "__new__" ? i.modelNew : i.model).trim();

  const resetNew = () => { setDate(todayDateString()); setNotes(""); setFreightNew(""); setItems([emptyItem()]); };

  const handleCreate = async () => {
    const payload = items
      .map(i => ({
        brand: resolveBrand(i),
        model: resolveModel(i),
        expectedQuantity: parseInt(i.quantity, 10) || 0,
        unitPrice: Number(i.unitPrice.replace(",", ".")) || 0,
      }))
      .filter(i => i.brand && i.model);
    if (payload.length === 0) { toast.error("Informe marca e modelo"); return; }
    if (payload.some(i => i.expectedQuantity <= 0)) { toast.error("Quantidade esperada deve ser maior que zero"); return; }
    setSaving(true);
    await addPurchaseOrder({
      date,
      notes: notes || undefined,
      freightCost: Number(freightNew.replace(",", ".")) || 0,
      items: payload,
    });
    setSaving(false);
    resetNew();
    setNewOpen(false);
  };

  const openReceive = (order: PurchaseOrder) => {
    if (order.status === "received") return;
    setReceiving(order);
    setReceiptDate(todayDateString());
    const c: Record<string, string> = {};
    const f: Record<string, FlavorRow[]> = {};
    order.items.forEach(it => {
      const ref = products.find(p => p.brand.toLowerCase() === it.brand.toLowerCase() && (p.model || "").toLowerCase() === it.model.toLowerCase());
      c[it.id] = it.unitPrice > 0 ? String(it.unitPrice) : (ref?.purchasePrice ? String(ref.purchasePrice) : "");
      f[it.id] = [{ flavor: "", quantity: "" }];
    });
    setCosts(c);
    setFlavors(f);
    setFreight(order.freightCost > 0 ? String(order.freightCost) : "");
  };

  const setRow = (itemId: string, idx: number, patch: Partial<FlavorRow>) => {
    setFlavors(prev => ({ ...prev, [itemId]: prev[itemId].map((r, i) => i === idx ? { ...r, ...patch } : r) }));
  };
  const addRow = (itemId: string) => setFlavors(prev => ({ ...prev, [itemId]: [...prev[itemId], { flavor: "", quantity: "" }] }));
  const removeRow = (itemId: string, idx: number) =>
    setFlavors(prev => ({ ...prev, [itemId]: prev[itemId].filter((_, i) => i !== idx) }));

  const totalFor = (itemId: string) => (flavors[itemId] ?? []).reduce((s, r) => s + (parseInt(r.quantity, 10) || 0), 0);

  const receiptUnits = receiving ? receiving.items.reduce((s, it) => s + totalFor(it.id), 0) : 0;
  const freightValue = Number(freight.replace(",", ".")) || 0;
  const freightPerUnit = receiptUnits > 0 ? freightValue / receiptUnits : 0;

  const allMatch = receiving
    ? receiving.items.every(it => totalFor(it.id) === it.expectedQuantity)
    : false;

  const handleConfirmReceipt = async () => {
    if (!receiving || confirming || !allMatch) return;
    setConfirming(true);
    const ok = await receivePurchaseOrder(
      receiving.id,
      receiving.items.map(it => ({
        itemId: it.id,
        unitCost: (Number(costs[it.id]) || 0) + freightPerUnit,
        flavors: (flavors[it.id] ?? [])
          .filter(r => r.flavor.trim())
          .map(r => ({ flavor: r.flavor.trim(), quantity: parseInt(r.quantity, 10) || 0 })),
      })),
      receiptDate,
    );
    setConfirming(false);
    if (ok) setReceiving(null);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">Compras aguardando recebimento</h2>
          <p className="text-[11px] text-muted-foreground">Registro do que está previsto para chegar — não altera o estoque</p>
        </div>
        <Button size="sm" variant="outline" className="h-9" onClick={() => setNewOpen(true)}>
          <Plus size={15} className="mr-1.5" />Nova compra
        </Button>
      </div>

      {pending.length === 0 && received.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-6 text-center">
          <p className="text-xs text-muted-foreground">Nenhuma compra registrada.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {[...pending, ...received].map(order => (
            <div key={order.id} className="rounded-xl border border-border bg-card px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <span className="text-sm font-semibold mono">Compra #{order.number}</span>
                  <span className="text-[11px] text-muted-foreground">{formatDateBR(order.date)}</span>
                  <Badge variant={order.status === "pending" ? "secondary" : "outline"} className={cn("text-[10px]", order.status === "received" && "text-income border-income/40")}>
                    {order.status === "pending" ? "Aguardando recebimento" : "Recebida"}
                  </Badge>
                </div>
                <div className="flex items-center gap-1.5">
                  {order.status === "pending" ? (
                    <>
                      <Button size="sm" className="h-8" onClick={() => openReceive(order)}>
                        <Truck size={14} className="mr-1.5" />Receber
                      </Button>
                      <Button
                        variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={async () => { if (await confirm({ title: "Excluir compra", description: "Excluir esta compra aguardando recebimento?" })) deletePurchaseOrder(order.id); }}
                      >
                        <Trash2 size={13} />
                      </Button>
                    </>
                  ) : (
                    <span className="flex items-center gap-1.5 text-[11px] text-income">
                      <PackageCheck size={13} />
                      {order.receivedAt ? `Recebida em ${formatDateBR(order.receivedAt)}` : "Recebida"}
                    </span>
                  )}
                </div>
              </div>
              <div className="mt-2 space-y-1">
                {order.items.map(it => (
                  <div key={it.id} className="text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{it.brand} {it.model}</span>
                      <span className="mono text-muted-foreground">
                        {it.expectedQuantity} un.{it.unitPrice > 0 ? ` · ${brl(it.unitPrice)}` : ""}
                      </span>
                    </div>
                    {it.receivedFlavors.length > 0 && (
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {it.receivedFlavors.map(f => `${f.flavor} ${f.quantity}`).join(" · ")}
                      </p>
                    )}
                  </div>
                ))}
                {(order.paidAmount > 0 || order.freightCost > 0) && (
                  <p className="text-[11px] text-muted-foreground pt-1 mono">
                    {order.paidAmount > 0 && `Pago ${order.paidAmount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`}
                    {order.paidAmount > 0 && order.freightCost > 0 && " · "}
                    {order.freightCost > 0 && `Frete ${order.freightCost.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`}
                  </p>
                )}
                {order.notes && <p className="text-[11px] text-muted-foreground pt-1">{order.notes}</p>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Nova compra */}
      <Sheet open={newOpen} onOpenChange={(v) => { setNewOpen(v); if (!v) resetNew(); }}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto p-0 flex flex-col">
          <SheetHeader className="px-6 py-4 border-b border-border">
            <SheetTitle className="text-base font-semibold">Nova compra</SheetTitle>
            <p className="text-xs text-muted-foreground">Somente marca, modelo e quantidade esperada</p>
          </SheetHeader>
          <div className="flex-1 px-6 py-5 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Data</Label>
                <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Observações</Label>
                <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Opcional" className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Frete (R$)</Label>
                <Input type="number" step="0.01" min={0} value={freightNew} onChange={e => setFreightNew(e.target.value)} placeholder="0,00" className="h-9 mono" />
              </div>
            </div>

            <div className="space-y-2.5">
              {items.map((item, idx) => (
                <div key={idx} className="rounded-lg border border-border p-3 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Produto esperado {idx + 1}</Label>
                    {items.length > 1 && (
                      <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive"
                        onClick={() => setItems(prev => prev.filter((_, i) => i !== idx))}>
                        <Trash2 size={12} />
                      </Button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Select value={item.brand} onValueChange={v => setItems(prev => prev.map((it, i) => i === idx ? { ...it, brand: v, model: "", modelNew: "" } : it))}>
                      <SelectTrigger className="h-9"><SelectValue placeholder="Marca" /></SelectTrigger>
                      <SelectContent>
                        {brands.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                        <SelectItem value="__new__">+ Nova marca</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select value={item.model} onValueChange={v => setItems(prev => prev.map((it, i) => i === idx ? { ...it, model: v } : it))}>
                      <SelectTrigger className="h-9"><SelectValue placeholder="Modelo" /></SelectTrigger>
                      <SelectContent>
                        {modelsFor(resolveBrand(item)).map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                        <SelectItem value="__new__">+ Novo modelo</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {item.brand === "__new__" && (
                    <Input value={item.brandNew} placeholder="Nome da nova marca" className="h-9"
                      onChange={e => setItems(prev => prev.map((it, i) => i === idx ? { ...it, brandNew: e.target.value } : it))} />
                  )}
                  {item.model === "__new__" && (
                    <Input value={item.modelNew} placeholder="Nome do novo modelo" className="h-9"
                      onChange={e => setItems(prev => prev.map((it, i) => i === idx ? { ...it, modelNew: e.target.value } : it))} />
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <Input type="number" min={1} value={item.quantity} placeholder="Qtd esperada" className="h-9 mono"
                      onChange={e => setItems(prev => prev.map((it, i) => i === idx ? { ...it, quantity: e.target.value } : it))} />
                    <Input type="number" step="0.01" min={0} value={item.unitPrice} placeholder="Valor unitário" className="h-9 mono"
                      onChange={e => setItems(prev => prev.map((it, i) => i === idx ? { ...it, unitPrice: e.target.value } : it))} />
                  </div>
                </div>
              ))}
              <Button variant="outline" size="sm" className="w-full h-9" onClick={() => setItems(prev => [...prev, emptyItem()])}>
                <Plus size={14} className="mr-1.5" />Adicionar produto
              </Button>
              <div className="rounded-lg border border-border px-3 py-2 space-y-1 text-xs">
                <div className="flex justify-between"><span className="text-muted-foreground">Produtos</span><span className="mono">{brl(draftItemsTotal)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Frete</span><span className="mono">{brl(draftFreight)}</span></div>
                <div className="flex justify-between font-semibold"><span>Total pago</span><span className="mono">{brl(draftItemsTotal + draftFreight)}</span></div>
              </div>
            </div>
          </div>
          <SheetFooter className="px-6 py-4 border-t border-border bg-card sticky bottom-0">
            <Button className="w-full h-10" onClick={handleCreate} disabled={saving}>
              {saving ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" />
                  Salvando…
                </span>
              ) : "Registrar compra"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Receber compra */}
      <Sheet open={!!receiving} onOpenChange={(v) => { if (!v) setReceiving(null); }}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto p-0 flex flex-col">
          <SheetHeader className="px-6 py-4 border-b border-border">
            <SheetTitle className="text-base font-semibold">Receber compra #{receiving?.number}</SheetTitle>
            <p className="text-xs text-muted-foreground">Informe os sabores recebidos</p>
          </SheetHeader>
          <div className="flex-1 px-6 py-5 space-y-5">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Data do recebimento</Label>
                <Input type="date" value={receiptDate} onChange={e => setReceiptDate(e.target.value)} className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Frete total (R$)</Label>
                <Input type="number" step="0.01" min={0} value={freight} onChange={e => setFreight(e.target.value)} placeholder="0,00" className="h-9 mono" />
              </div>
            </div>
            {freightValue > 0 && (
              <p className="text-[11px] text-muted-foreground -mt-2">
                Frete rateado: +{freightPerUnit.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} por unidade ({receiptUnits} un.)
              </p>
            )}
            {receiving?.items.map(it => {
              const total = totalFor(it.id);
              const ok = total === it.expectedQuantity;
              return (
                <div key={it.id} className="rounded-lg border border-border p-3 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{it.brand} {it.model}</span>
                    <span className={cn("text-xs mono font-semibold", ok ? "text-income" : "text-warning")}>
                      {total}/{it.expectedQuantity}
                    </span>
                  </div>
                  {!ok && (
                    <p className="text-[11px] text-warning">
                      {total < it.expectedQuantity
                        ? `Faltam ${it.expectedQuantity - total} unidades`
                        : `${total - it.expectedQuantity} unidades a mais que o esperado`}
                    </p>
                  )}
                  <div className="space-y-1.5">
                    <Label className="text-xs">Custo unitário (R$)</Label>
                    <Input type="number" step="0.01" className="h-9 mono" value={costs[it.id] ?? ""}
                      onChange={e => setCosts(prev => ({ ...prev, [it.id]: e.target.value }))} placeholder="0,00" />
                    {freightPerUnit > 0 && (
                      <p className="text-[11px] text-muted-foreground">
                        Com frete: {(((Number(costs[it.id]) || 0) + freightPerUnit)).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    {(flavors[it.id] ?? []).map((row, i) => (
                      <div key={i} className="flex items-center gap-1.5">
                        <Input value={row.flavor} placeholder="Sabor" className="h-9 flex-1"
                          onChange={e => setRow(it.id, i, { flavor: e.target.value })} />
                        <Input type="number" min={0} value={row.quantity} placeholder="Qtd" className="h-9 w-20 mono"
                          onChange={e => setRow(it.id, i, { quantity: e.target.value })} />
                        <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-destructive"
                          onClick={() => removeRow(it.id, i)} disabled={(flavors[it.id] ?? []).length === 1}>
                          <Trash2 size={13} />
                        </Button>
                      </div>
                    ))}
                    <Button variant="outline" size="sm" className="w-full h-9" onClick={() => addRow(it.id)}>
                      <Plus size={14} className="mr-1.5" />Adicionar sabor
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
          <SheetFooter className="px-6 py-4 border-t border-border bg-card sticky bottom-0">
            <Button className="w-full h-10" onClick={handleConfirmReceipt} disabled={!allMatch || confirming}>
              {confirming ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" />
                  Confirmando…
                </span>
              ) : "Confirmar recebimento"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
