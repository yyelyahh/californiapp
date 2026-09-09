import { useMemo, useState } from "react";
import { useStore } from "@/context/StoreContext";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetFooter } from "@/components/ui/sheet";
import { Plus, Trash2, Truck, PackageCheck, History } from "lucide-react";
import { todayDateString, formatDateBR } from "@/lib/date-utils";
import { toast } from "sonner";
import { useConfirm } from "@/components/ConfirmProvider";
import type { PurchaseOrder } from "@/types";
import { sortNames } from "@/lib/catalog-order";
import { NcButton, NcSheetHeader, EYEBROW } from "@/components/nocturne";

type DraftItem = { brand: string; brandNew: string; model: string; modelNew: string; quantity: string; unitPrice: string };
type FlavorRow = { flavor: string; quantity: string };

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Caixa interna dos painéis: fundo do tema com o fio de 1px, como no cadastro rápido. */
const INSET_BOX: React.CSSProperties = {
  background: "var(--nc-bg)",
  boxShadow: "inset 0 0 0 1px var(--nc-track)",
};

/**
 * Uma compra, como linha de lista (`nc-row`) e não como card dentro de card: a
 * seção já é um `nc-card`, e uma moldura dentro da outra era o que mais
 * destoava do Dashboard nesta tela.
 *
 * Aguardando recebimento sai em `--nc-alert` — é o mesmo papel do "a receber"
 * do painel: já saiu dinheiro, ainda não chegou a mercadoria.
 */
function OrderRow({ order, onReceive, onDelete }: {
  order: PurchaseOrder;
  onReceive?: (o: PurchaseOrder) => void;
  onDelete?: (id: string) => void;
}) {
  const isPending = order.status === "pending";
  const total = order.items.reduce((s, it) => s + it.unitPrice * it.expectedQuantity, 0) + order.freightCost;

  return (
    <div className="nc-row px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="nc-num text-[13.5px]">Compra #{order.number}</span>
          <span className="nc-num text-[11px]" style={{ color: "var(--nc-text-3)" }}>{formatDateBR(order.date)}</span>
          <span
            className="rounded-full px-2 py-0.5 text-[10.5px]"
            style={isPending
              ? { color: "var(--nc-alert)", boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--nc-alert) 45%, transparent)" }
              : { color: "var(--nc-accent)", boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--nc-accent) 45%, transparent)" }}
          >
            {isPending ? "Aguardando" : "Recebida"}
          </span>
        </div>
        <div className="flex flex-none items-center gap-1.5">
          {isPending && onReceive && onDelete ? (
            <>
              <NcButton variant="outline" onClick={() => onReceive(order)}>
                <Truck size={13} />Receber
              </NcButton>
              <NcButton variant="danger" size="icon" aria-label={`Excluir compra #${order.number}`} onClick={() => onDelete(order.id)}>
                <Trash2 size={13} />
              </NcButton>
            </>
          ) : (
            <span className="flex items-center gap-1.5 text-[11px]" style={{ color: "var(--nc-accent)" }}>
              <PackageCheck size={13} />
              {order.receivedAt ? `Recebida em ${formatDateBR(order.receivedAt)}` : "Recebida"}
            </span>
          )}
        </div>
      </div>

      <div className="mt-2 space-y-1">
        {order.items.map(it => (
          <div key={it.id} className="text-xs">
            <div className="flex items-center justify-between gap-3">
              <span className="truncate">{it.brand} {it.model}</span>
              <span className="nc-num flex-none" style={{ color: "var(--nc-text-2)" }}>
                {it.expectedQuantity} un.{it.unitPrice > 0 ? ` · ${brl(it.unitPrice)}` : ""}
              </span>
            </div>
            {it.receivedFlavors.length > 0 && (
              <p className="mt-0.5 text-[11px]" style={{ color: "var(--nc-text-3)" }}>
                {it.receivedFlavors.map(f => `${f.flavor} ${f.quantity}`).join(" · ")}
              </p>
            )}
          </div>
        ))}

        <div className="nc-num flex items-center justify-between gap-3 pt-1 text-[11px]" style={{ color: "var(--nc-text-3)" }}>
          <span>
            {order.paidAmount > 0 && `Pago ${brl(order.paidAmount)}`}
            {order.paidAmount > 0 && order.freightCost > 0 && " · "}
            {order.freightCost > 0 && `Frete ${brl(order.freightCost)}`}
          </span>
          {total > 0 && <span>total {brl(total)}</span>}
        </div>
        {order.notes && <p className="text-[11px]" style={{ color: "var(--nc-text-3)" }}>{order.notes}</p>}
      </div>
    </div>
  );
}

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
  const [historyOpen, setHistoryOpen] = useState(false);

  const [receiving, setReceiving] = useState<PurchaseOrder | null>(null);
  const [receiptDate, setReceiptDate] = useState(todayDateString());
  const [costs, setCosts] = useState<Record<string, string>>({});
  const [freight, setFreight] = useState("");
  const [flavors, setFlavors] = useState<Record<string, FlavorRow[]>>({});
  const [confirming, setConfirming] = useState(false);

  const brands = useMemo(() => {
    const set = new Set<string>();
    products.forEach(p => p.brand && set.add(p.brand));
    return sortNames(Array.from(set));
  }, [products]);

  const modelsFor = (brand: string) => {
    const set = new Set<string>();
    products.filter(p => p.brand.toLowerCase() === brand.toLowerCase()).forEach(p => p.model && set.add(p.model));
    return sortNames(Array.from(set));
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
    <>
      {/* Mesmo cabeçalho do "Repor agora" do Dashboard: ícone no accent, título
          de 15px e a pílula de contagem à direita. */}
      <section className="nc-card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 pb-3 pt-3.5">
          <div className="flex items-center gap-2">
            <Truck size={16} style={{ color: "var(--nc-accent)" }} />
            <h2 className="text-[15px]">Compras a caminho</h2>
            {pending.length > 0 && (
              <span
                className="nc-num rounded-full px-2 py-0.5 text-[11px]"
                style={{ color: "var(--nc-accent)", boxShadow: "inset 0 0 0 1px var(--nc-accent)" }}
              >
                {pending.length} aguardando
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {received.length > 0 && (
              <NcButton variant="ghost" onClick={() => setHistoryOpen(true)}>
                <History size={13} />Histórico
              </NcButton>
            )}
            <NcButton onClick={() => setNewOpen(true)}>
              <Plus size={13} />Nova compra
            </NcButton>
          </div>
        </div>

        {pending.length === 0 ? (
          <p className="px-4 pb-5 pt-1 text-center text-xs" style={{ color: "var(--nc-text-3)" }}>
            Nenhuma compra aguardando recebimento.
          </p>
        ) : (
          <div style={{ borderTop: "1px solid var(--nc-track)" }}>
            {pending.map(order => (
              <OrderRow
                key={order.id}
                order={order}
                onReceive={openReceive}
                onDelete={async (id) => { if (await confirm({ title: "Excluir compra", description: "Excluir esta compra aguardando recebimento?" })) deletePurchaseOrder(id); }}
              />
            ))}
          </div>
        )}
      </section>

      {/* Histórico de compras recebidas */}
      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent className="nocturne w-full sm:max-w-xl overflow-y-auto p-0 flex flex-col">
          <NcSheetHeader
            eyebrow="Compras"
            title="Histórico de recebimentos"
            description="Compras que já viraram estoque."
          />
          <div className="flex-1 overflow-y-auto">
            {received.length === 0 ? (
              <p className="py-16 text-center text-[13px]" style={{ color: "var(--nc-text-3)" }}>
                Nenhuma compra recebida ainda.
              </p>
            ) : (
              received.map(order => <OrderRow key={order.id} order={order} />)
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Nova compra */}
      <Sheet open={newOpen} onOpenChange={(v) => { setNewOpen(v); if (!v) resetNew(); }}>
        <SheetContent className="nocturne w-full sm:max-w-xl overflow-y-auto p-0 flex flex-col">
          <NcSheetHeader
            eyebrow="Compras"
            title="Nova compra"
            description="Registre o pedido agora; os sabores entram no recebimento."
          />
          <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
            <section className="space-y-3">
              <p className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>Pedido</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Data</Label>
                  <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Frete (R$)</Label>
                  <Input type="number" step="0.01" min={0} value={freightNew} onChange={e => setFreightNew(e.target.value)} placeholder="0,00" className="nc-num" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Observações</Label>
                <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Opcional" />
              </div>
            </section>

            <section className="space-y-3">
              <p className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>Produtos esperados</p>
              {items.map((item, idx) => (
                <div key={idx} className="space-y-2.5 rounded-lg p-3" style={INSET_BOX}>
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Produto {idx + 1}</Label>
                    {items.length > 1 && (
                      <NcButton
                        variant="danger"
                        size="icon"
                        aria-label={`Remover produto ${idx + 1}`}
                        onClick={() => setItems(prev => prev.filter((_, i) => i !== idx))}
                      >
                        <Trash2 size={12} />
                      </NcButton>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Select value={item.brand} onValueChange={v => setItems(prev => prev.map((it, i) => i === idx ? { ...it, brand: v, model: "", modelNew: "" } : it))}>
                      <SelectTrigger><SelectValue placeholder="Marca" /></SelectTrigger>
                      <SelectContent className="nocturne">
                        {brands.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                        <SelectItem value="__new__">+ Nova marca</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select value={item.model} onValueChange={v => setItems(prev => prev.map((it, i) => i === idx ? { ...it, model: v } : it))}>
                      <SelectTrigger><SelectValue placeholder="Modelo" /></SelectTrigger>
                      <SelectContent className="nocturne">
                        {modelsFor(resolveBrand(item)).map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                        <SelectItem value="__new__">+ Novo modelo</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {item.brand === "__new__" && (
                    <Input value={item.brandNew} placeholder="Nome da nova marca"
                      onChange={e => setItems(prev => prev.map((it, i) => i === idx ? { ...it, brandNew: e.target.value } : it))} />
                  )}
                  {item.model === "__new__" && (
                    <Input value={item.modelNew} placeholder="Nome do novo modelo"
                      onChange={e => setItems(prev => prev.map((it, i) => i === idx ? { ...it, modelNew: e.target.value } : it))} />
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <Input type="number" min={1} value={item.quantity} placeholder="Qtd esperada" className="nc-num"
                      onChange={e => setItems(prev => prev.map((it, i) => i === idx ? { ...it, quantity: e.target.value } : it))} />
                    <Input type="number" step="0.01" min={0} value={item.unitPrice} placeholder="Valor unitário" className="nc-num"
                      onChange={e => setItems(prev => prev.map((it, i) => i === idx ? { ...it, unitPrice: e.target.value } : it))} />
                  </div>
                </div>
              ))}
              <NcButton variant="quiet" size="md" className="w-full" onClick={() => setItems(prev => [...prev, emptyItem()])}>
                <Plus size={14} />Adicionar produto
              </NcButton>

              <div className="space-y-1 rounded-lg px-3 py-2 text-xs" style={INSET_BOX}>
                <div className="flex justify-between">
                  <span style={{ color: "var(--nc-text-2)" }}>Produtos</span>
                  <span className="nc-num">{brl(draftItemsTotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: "var(--nc-text-2)" }}>Frete</span>
                  <span className="nc-num">{brl(draftFreight)}</span>
                </div>
                <div className="nc-rule-top flex justify-between pt-1.5 font-medium">
                  <span>Total pago</span>
                  <span className="nc-num">{brl(draftItemsTotal + draftFreight)}</span>
                </div>
              </div>
            </section>
          </div>
          <SheetFooter className="px-5 py-3" style={{ borderTop: "1px solid var(--nc-track)", background: "var(--nc-rail)" }}>
            <div className="flex w-full items-center justify-between gap-3">
              <p className="text-[11px]" style={{ color: "var(--nc-text-2)" }}>
                Total <span className="nc-num font-medium" style={{ color: "var(--nc-text)" }}>{brl(draftItemsTotal + draftFreight)}</span>
              </p>
              <NcButton variant="solid" size="md" onClick={handleCreate} disabled={saving}>
                {saving ? "Salvando…" : "Registrar compra"}
              </NcButton>
            </div>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Receber compra */}
      <Sheet open={!!receiving} onOpenChange={(v) => { if (!v) setReceiving(null); }}>
        <SheetContent className="nocturne w-full sm:max-w-xl overflow-y-auto p-0 flex flex-col">
          <NcSheetHeader
            eyebrow="Compras"
            title={`Receber compra #${receiving?.number ?? ""}`}
            description="Some os sabores até bater com a quantidade esperada de cada produto."
          />
          <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
            <section className="space-y-3">
              <p className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>Recebimento</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Data do recebimento</Label>
                  <Input type="date" value={receiptDate} onChange={e => setReceiptDate(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Frete total (R$)</Label>
                  <Input type="number" step="0.01" min={0} value={freight} onChange={e => setFreight(e.target.value)} placeholder="0,00" className="nc-num" />
                </div>
              </div>
              {freightValue > 0 && (
                <p className="text-[11px]" style={{ color: "var(--nc-text-3)" }}>
                  Frete rateado: +{brl(freightPerUnit)} por unidade ({receiptUnits} un.)
                </p>
              )}
            </section>

            {receiving?.items.map(it => {
              const total = totalFor(it.id);
              const ok = total === it.expectedQuantity;
              return (
                <div key={it.id} className="space-y-2.5 rounded-lg p-3" style={INSET_BOX}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate text-sm">{it.brand} {it.model}</span>
                    {/* Bateu vai para o accent; faltando ou sobrando fica no
                        alerta — o mesmo vocabulário do resto do painel. */}
                    <span className="nc-num flex-none text-xs font-semibold" style={{ color: ok ? "var(--nc-accent)" : "var(--nc-alert)" }}>
                      {total}/{it.expectedQuantity}
                    </span>
                  </div>
                  {!ok && (
                    <p className="text-[11px]" style={{ color: "var(--nc-alert)" }}>
                      {total < it.expectedQuantity
                        ? `Faltam ${it.expectedQuantity - total} unidades`
                        : `${total - it.expectedQuantity} unidades a mais que o esperado`}
                    </p>
                  )}
                  <div className="space-y-1.5">
                    <Label className="text-xs">Custo unitário (R$)</Label>
                    <Input type="number" step="0.01" className="nc-num" value={costs[it.id] ?? ""}
                      onChange={e => setCosts(prev => ({ ...prev, [it.id]: e.target.value }))} placeholder="0,00" />
                    {freightPerUnit > 0 && (
                      <p className="nc-num text-[11px]" style={{ color: "var(--nc-text-3)" }}>
                        Com frete: {brl((Number(costs[it.id]) || 0) + freightPerUnit)}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    {(flavors[it.id] ?? []).map((row, i) => (
                      <div key={i} className="flex items-center gap-1.5">
                        <Input value={row.flavor} placeholder="Sabor" className="flex-1"
                          onChange={e => setRow(it.id, i, { flavor: e.target.value })} />
                        <Input type="number" min={0} value={row.quantity} placeholder="Qtd" className="nc-num w-20"
                          onChange={e => setRow(it.id, i, { quantity: e.target.value })} />
                        <NcButton
                          variant="danger"
                          size="icon"
                          aria-label={`Remover sabor ${i + 1}`}
                          onClick={() => removeRow(it.id, i)}
                          disabled={(flavors[it.id] ?? []).length === 1}
                        >
                          <Trash2 size={13} />
                        </NcButton>
                      </div>
                    ))}
                    <NcButton variant="quiet" size="md" className="w-full" onClick={() => addRow(it.id)}>
                      <Plus size={14} />Adicionar sabor
                    </NcButton>
                  </div>
                </div>
              );
            })}
          </div>
          <SheetFooter className="px-5 py-3" style={{ borderTop: "1px solid var(--nc-track)", background: "var(--nc-rail)" }}>
            <div className="flex w-full items-center justify-between gap-3">
              <p className="text-[11px]" style={{ color: "var(--nc-text-2)" }}>
                {allMatch
                  ? <><span className="nc-num font-medium" style={{ color: "var(--nc-text)" }}>{receiptUnits}</span> un. conferidas</>
                  : "As quantidades ainda não batem"}
              </p>
              <NcButton variant="solid" size="md" onClick={handleConfirmReceipt} disabled={!allMatch || confirming}>
                {confirming ? "Confirmando…" : "Confirmar recebimento"}
              </NcButton>
            </div>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
