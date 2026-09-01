import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";

import { toast } from "sonner";
import { ShoppingCart, Trash2, Minus, Plus, Search, CheckCircle2, MessageCircle, Package } from "lucide-react";

interface CatalogRow {
  seller_name: string;
  product_id: string;
  name: string;
  brand: string;
  model: string;
  flavor: string;
  sale_price: number;
  available: number;
  image_url?: string | null;
}

interface CartItem {
  product_id: string;
  name: string;
  brand: string;
  model: string;
  flavor: string;
  sale_price: number;
  available: number;
  quantity: number;
}

const fmt = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v || 0);

function friendlyError(message: string) {
  if (message.includes("nome_invalido")) return "Informe seu nome";
  if (message.includes("whatsapp_invalido")) return "Informe seu WhatsApp";
  if (message.includes("carrinho_vazio")) return "Seu carrinho está vazio";
  if (message.includes("quantidade_invalida")) return "Quantidade inválida";
  if (message.includes("estoque_insuficiente"))
    return "Um dos itens não tem mais estoque suficiente, atualize a página e tente novamente";
  return message || "Não foi possível enviar o pedido. Tente novamente.";
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ModelGroup {
  key: string;
  brand: string;
  model: string;
  flavors: CatalogRow[];
}

interface BrandGroup {
  key: string;
  brand: string;
  models: ModelGroup[];
}

const BRAND_SWATCHES = [
  { bg: "bg-slate-700", text: "text-slate-100" },
  { bg: "bg-zinc-700", text: "text-zinc-100" },
  { bg: "bg-stone-700", text: "text-stone-100" },
  { bg: "bg-emerald-900", text: "text-emerald-100" },
  { bg: "bg-teal-900", text: "text-teal-100" },
  { bg: "bg-indigo-950", text: "text-indigo-100" },
];

function brandColor(brand: string) {
  const key = (brand || "").trim().toLowerCase();
  if (!key) return BRAND_SWATCHES[0];
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return BRAND_SWATCHES[hash % BRAND_SWATCHES.length];
}

function firstModelImage(rows: CatalogRow[]) {
  for (const r of rows) if (r.image_url) return r.image_url;
  return null;
}

function ModelCard({
  model,
  onAdd,
}: {
  model: ModelGroup;
  onAdd: (row: CatalogRow, qty: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string>("");
  const [qty, setQty] = useState(1);

  const allRows = model.flavors;
  const inStock = allRows.filter(r => r.available > 0);
  const prices = (inStock.length ? inStock : allRows).map(r => r.sale_price);
  const minPrice = prices.length ? Math.min(...prices) : 0;
  const samePrice = prices.every(p => p === prices[0]);
  const flavorCount = allRows.length;
  const allOut = inStock.length === 0;

  const selected = model.flavors.find(f => f.product_id === selectedId) ??
    model.flavors.find(f => f.available > 0) ??
    model.flavors[0];
  const available = selected?.available ?? 0;
  const clampedQty = Math.min(Math.max(1, qty), Math.max(available, 1));

  const imageUrl = firstModelImage(model.flavors);
  const color = brandColor(model.brand);

  const openDialog = () => {
    const first = model.flavors.find(f => f.available > 0) ?? model.flavors[0];
    setSelectedId(first?.product_id ?? "");
    setQty(1);
    setOpen(true);
  };

  return (
    <>
      <Card
        role="button"
        tabIndex={0}
        onClick={openDialog}
        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDialog(); } }}
        className="border-border/60 cursor-pointer overflow-hidden transition-all hover:border-primary/40 hover:shadow-md"
      >
        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-t-xl">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={model.model || "Produto"}
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className={`h-full w-full ${color.bg} flex items-center justify-center`}>
              <Package size={40} className={`${color.text} opacity-70`} />
            </div>
          )}
          {allOut && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/70 backdrop-blur-sm">
              <span className="text-xs font-medium text-muted-foreground">Esgotado</span>
            </div>
          )}
        </div>

        <CardContent className="p-4">
          <h3 className="text-lg font-bold leading-tight truncate">
            {model.model || "Sem modelo"}
          </h3>
          <p className="text-sm text-muted-foreground truncate">
            {model.brand || "Sem marca"} · {flavorCount} {flavorCount === 1 ? "sabor" : "sabores"}
          </p>

          <div className="mt-4 flex items-center justify-between gap-3">
            <div>
              {!samePrice && (
                <span className="block text-[11px] text-muted-foreground">A partir de</span>
              )}
              <span className="text-xl font-bold">{fmt(minPrice)}</span>
            </div>
            <Button size="sm" variant="secondary" onClick={e => { e.stopPropagation(); openDialog(); }}>
              Ver opções
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md w-[calc(100%-1.5rem)] max-h-[90vh] p-0 gap-0 flex flex-col">
          <DialogHeader className="p-5 pb-3 text-left">
            <DialogTitle className="text-lg">{model.model || "Sem modelo"}</DialogTitle>
            <DialogDescription>{model.brand || "Sem marca"}</DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-5 pb-4 space-y-4">
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Sabor</p>
              {model.flavors.map(f => {
                const out = f.available <= 0;
                const active = f.product_id === selectedId;
                return (
                  <button
                    key={f.product_id}
                    type="button"
                    disabled={out}
                    onClick={() => { setSelectedId(f.product_id); setQty(1); }}
                    className={`w-full min-h-[56px] flex items-center justify-between gap-3 rounded-lg border px-4 py-3 text-left transition-colors disabled:opacity-45 ${
                      active ? "border-primary bg-primary/10" : "border-border hover:bg-muted/50"
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{f.flavor || "Sem sabor"}</p>
                      <p className="text-xs text-muted-foreground">
                        {out ? "Esgotado" : `${f.available} disp.`}
                      </p>
                    </div>
                    <span className="text-sm font-semibold shrink-0">{fmt(f.sale_price)}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="border-t border-border p-5 space-y-3 bg-background">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Preço</span>
              <span className="text-xl font-bold">{fmt(selected?.sale_price ?? 0)}</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center border border-border rounded-md">
                <button
                  type="button"
                  disabled={!selected || available <= 0 || clampedQty <= 1}
                  onClick={() => setQty(Math.max(1, clampedQty - 1))}
                  className="px-3 py-2.5 disabled:opacity-40"
                >
                  <Minus size={14} />
                </button>
                <span className="w-9 text-center text-sm font-medium">
                  {available <= 0 ? 0 : clampedQty}
                </span>
                <button
                  type="button"
                  disabled={!selected || clampedQty >= available}
                  onClick={() => setQty(Math.min(available, clampedQty + 1))}
                  className="px-3 py-2.5 disabled:opacity-40"
                >
                  <Plus size={14} />
                </button>
              </div>
              <Button
                className="flex-1 h-11"
                disabled={!selected || available <= 0}
                onClick={() => {
                  if (!selected) return;
                  onAdd(selected, clampedQty);
                  setOpen(false);
                }}
              >
                {available <= 0 ? "Esgotado" : "Adicionar ao carrinho"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}




export default function SellerStorePage() {
  const { sellerId } = useParams<{ sellerId: string }>();
  const validId = !!sellerId && UUID_RE.test(sellerId);
  const [rows, setRows] = useState<CatalogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [checkout, setCheckout] = useState(false);
  const [name, setName] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [freight, setFreight] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!validId) { setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase.rpc("get_seller_catalog", { p_seller_id: sellerId });
    if (error) toast.error("Erro ao carregar catálogo", { description: error.message });
    setRows((data as CatalogRow[]) ?? []);
    setLoading(false);
  }, [sellerId, validId]);

  useEffect(() => { load(); }, [load]);





  const sellerName = rows[0]?.seller_name ?? "";

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const modelMap = new Map<string, ModelGroup>();
    rows.forEach((r, idx) => {
      const hasKey = (r.brand || "").trim() !== "" || (r.model || "").trim() !== "";
      const key = hasKey ? `${r.brand}|||${r.model}` : `__sem_modelo__${idx}`;
      if (!modelMap.has(key)) modelMap.set(key, { key, brand: r.brand, model: r.model, flavors: [] });
      modelMap.get(key)!.flavors.push(r);
    });

    let models = Array.from(modelMap.values());
    if (q) {
      models = models
        .map(m => ({
          ...m,
          flavors: m.flavors.filter(r =>
            [r.brand, r.model, r.flavor, r.name].some(v => (v || "").toLowerCase().includes(q))
          ),
        }))
        .filter(m => m.flavors.length > 0);
    }
    models.forEach(m => m.flavors.sort((a, b) => (a.flavor || "").localeCompare(b.flavor || "")));
    models.sort((a, b) => (a.model || "").localeCompare(b.model || ""));

    const brandMap = new Map<string, BrandGroup>();
    models.forEach(m => {
      const bKey = (m.brand || "").trim() || "__sem_marca__";
      if (!brandMap.has(bKey)) brandMap.set(bKey, { key: bKey, brand: m.brand, models: [] });
      brandMap.get(bKey)!.models.push(m);
    });

    return Array.from(brandMap.values()).sort((a, b) =>
      (a.brand || "").localeCompare(b.brand || "")
    );
  }, [rows, query]);



  const total = useMemo(
    () => cart.reduce((a, i) => a + i.sale_price * i.quantity, 0),
    [cart]
  );
  const cartCount = useMemo(() => cart.reduce((a, i) => a + i.quantity, 0), [cart]);

  const addToCart = (row: CatalogRow, requested = 1) => {
    const qty = Math.min(Math.max(1, requested), row.available);
    setCart(prev => {
      const existing = prev.find(i => i.product_id === row.product_id);
      if (existing) {
        return prev.map(i =>
          i.product_id === row.product_id
            ? { ...i, quantity: Math.min(i.quantity + qty, row.available) }
            : i
        );
      }
      return [...prev, { ...row, quantity: qty }];
    });
    toast.success("Adicionado ao carrinho", { description: `${row.flavor} · ${row.model}` });
  };


  const setItemQty = (productId: string, qty: number) => {
    setCart(prev =>
      prev.map(i =>
        i.product_id === productId
          ? { ...i, quantity: Math.min(Math.max(1, qty), i.available) }
          : i
      )
    );
  };

  const removeItem = (productId: string) =>
    setCart(prev => prev.filter(i => i.product_id !== productId));

  const buildMessage = () => {
    const lines: string[] = [];
    lines.push(`🛒 Novo pedido`);
    lines.push(``);
    if (sellerName) lines.push(`👤 Vendedor: ${sellerName}`);
    lines.push(`🙋 Cliente: ${name}`);
    lines.push(`📱 WhatsApp: ${whatsapp}`);
    lines.push(``);
    lines.push(`📦 ITENS`);
    cart.forEach(i => {
      lines.push(`• ${i.flavor} · ${i.model} (${i.quantity}x) • ${fmt(i.sale_price)} = ${fmt(i.sale_price * i.quantity)}`);
    });
    lines.push(`──────────────────────────────`);
    lines.push(`💰 Total: ${fmt(total)}`);
    if (freight.trim()) {
      lines.push(``);
      lines.push(`🚚 Frete/Entrega: ${freight.trim()}`);
    }
    return lines.join("\n");
  };

  const submit = async () => {
    if (!name.trim()) return toast.error("Informe seu nome");
    if (!whatsapp.trim()) return toast.error("Informe seu WhatsApp");
    if (cart.length === 0) return toast.error("Seu carrinho está vazio");
    setSubmitting(true);
    try {
      const { error } = await supabase.rpc("create_pending_order", {
        p_seller_id: sellerId,
        p_customer_name: name.trim(),
        p_customer_whatsapp: whatsapp.trim(),
        p_freight_notes: freight.trim() || null,
        p_items: cart.map(item => ({
          product_id: item.product_id,
          quantity: item.quantity,
          unit_price: item.sale_price,
        })) as any,
      });
      if (error) throw error;

      const message = buildMessage();
      window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, "_blank");
      setSuccessMessage(message);
      setCart([]);
      setCheckout(false);
      setName(""); setWhatsapp(""); setFreight("");
      load();
    } catch (err: any) {
      const msg = String(err?.message ?? "");
      toast.error(friendlyError(msg));
      if (msg.includes("estoque_insuficiente")) load();
    } finally {
      setSubmitting(false);
    }
  };

  if (!validId) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="text-center space-y-2 max-w-md">
          <h1 className="text-xl font-semibold">Link inválido</h1>
          <p className="text-sm text-muted-foreground">
            Este endereço de loja não é válido. Peça ao vendedor o link correto do catálogo.
          </p>
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground pb-24">
      <header className="sticky top-0 z-40 backdrop-blur-xl bg-background/70 border-b border-border">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg font-bold tracking-tight truncate">
              {sellerName ? `Loja de ${sellerName}` : "Loja"}
            </h1>
          </div>
          <Button onClick={() => setCartOpen(true)} size="sm" className="gap-2 relative hidden sm:flex">
            <ShoppingCart size={15} />
            Carrinho
            {cartCount > 0 && (
              <span className="ml-1 rounded-full bg-primary-foreground text-primary text-[11px] font-bold px-2 py-0.5">
                {cartCount}
              </span>
            )}
          </Button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6">
        <div className="relative mb-5">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por marca, modelo ou sabor..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="pl-9 h-11"
          />
        </div>

        {loading ? (
          <p className="text-center py-20 text-sm text-muted-foreground">Carregando catálogo...</p>
        ) : groups.length === 0 ? (
          <p className="text-center py-20 text-sm text-muted-foreground">Nenhum produto encontrado.</p>
        ) : (
          <div className="space-y-10">
            {groups.map(g => (
              <section key={g.key}>
                <h2 className="text-sm font-medium text-muted-foreground mb-4">
                  {g.brand || "Sem marca"}
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                  {g.models.map(m => (
                    <ModelCard key={m.key} model={m} onAdd={addToCart} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}

      </main>

      {/* Barra fixa mobile */}
      <div className="sm:hidden fixed bottom-0 inset-x-0 z-40 border-t border-border bg-background/95 backdrop-blur-xl">
        <div className="px-4 py-3">
          <Button onClick={() => setCartOpen(true)} className="w-full h-12 gap-2">
            <ShoppingCart size={16} />
            Ver carrinho ({cartCount} {cartCount === 1 ? "item" : "itens"}) · {fmt(total)}
          </Button>
        </div>
      </div>

      {cartCount > 0 && (
        <div className="hidden sm:block fixed bottom-0 inset-x-0 z-40 border-t border-border bg-background/90 backdrop-blur-xl">
          <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
            <div className="text-sm">
              <span className="text-muted-foreground">{cartCount} item(ns) · </span>
              <span className="font-bold">{fmt(total)}</span>
            </div>
            <Button onClick={() => setCartOpen(true)} className="gap-2">
              <ShoppingCart size={15} /> Ver carrinho
            </Button>
          </div>
        </div>
      )}


      {/* Cart */}
      <Sheet open={cartOpen} onOpenChange={setCartOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader className="text-left">
            <SheetTitle>Seu carrinho</SheetTitle>
            <SheetDescription>{cartCount} item(ns) selecionado(s)</SheetDescription>
          </SheetHeader>

          {cart.length === 0 ? (
            <p className="mt-8 text-sm text-muted-foreground">Seu carrinho está vazio.</p>
          ) : (
            <div className="mt-5 divide-y divide-border/60">
              {cart.map(i => (
                <div key={i.product_id} className="py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{i.flavor}</p>
                      <p className="text-xs text-muted-foreground">{i.brand} · {i.model}</p>
                    </div>
                    <button onClick={() => removeItem(i.product_id)} className="text-muted-foreground hover:text-destructive">
                      <Trash2 size={15} />
                    </button>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <div className="flex items-center border border-border rounded-md">
                      <button
                        type="button"
                        onClick={() => setItemQty(i.product_id, i.quantity - 1)}
                        disabled={i.quantity <= 1}
                        className="px-2 py-1.5 disabled:opacity-40"
                      >
                        <Minus size={13} />
                      </button>
                      <span className="w-8 text-center text-sm font-medium">{i.quantity}</span>
                      <button
                        type="button"
                        onClick={() => setItemQty(i.product_id, i.quantity + 1)}
                        disabled={i.quantity >= i.available}
                        className="px-2 py-1.5 disabled:opacity-40"
                      >
                        <Plus size={13} />
                      </button>
                    </div>
                    <span className="text-sm font-semibold">{fmt(i.sale_price * i.quantity)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-6 border-t border-border pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Total</span>
              <span className="text-xl font-bold">{fmt(total)}</span>
            </div>
            <Button
              className="w-full h-11"
              disabled={cart.length === 0}
              onClick={() => { setCartOpen(false); setCheckout(true); }}
            >
              Finalizar pedido
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* Checkout */}
      <Sheet open={checkout} onOpenChange={(o) => !submitting && setCheckout(o)}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader className="text-left">
            <SheetTitle>Finalizar pedido</SheetTitle>
            <SheetDescription>Preencha seus dados para enviar o pedido.</SheetDescription>
          </SheetHeader>
          <div className="mt-5 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="cliente-nome">Nome *</Label>
              <Input id="cliente-nome" value={name} onChange={e => setName(e.target.value)} placeholder="Seu nome" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cliente-whats">WhatsApp *</Label>
              <Input id="cliente-whats" value={whatsapp} onChange={e => setWhatsapp(e.target.value)} placeholder="(11) 90000-0000" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cliente-frete">Observação de frete/entrega</Label>
              <Textarea id="cliente-frete" value={freight} onChange={e => setFreight(e.target.value)} placeholder="Opcional" rows={3} />
            </div>
            <div className="flex items-center justify-between border-t border-border pt-3">
              <span className="text-sm text-muted-foreground">Total</span>
              <span className="text-lg font-bold">{fmt(total)}</span>
            </div>
            <Button className="w-full h-11" onClick={submit} disabled={submitting || cart.length === 0}>
              {submitting ? "Enviando..." : "Confirmar pedido"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* Success */}
      <Sheet open={!!successMessage} onOpenChange={(o) => !o && setSuccessMessage(null)}>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader className="text-left">
            <SheetTitle className="flex items-center gap-2">
              <CheckCircle2 size={18} className="text-primary" /> Pedido enviado!
            </SheetTitle>
            <SheetDescription>
              Confirme o envio no WhatsApp que abriu.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-6 space-y-3">
            <Button
              className="w-full h-11 gap-2"
              onClick={() =>
                successMessage &&
                window.open(`https://wa.me/?text=${encodeURIComponent(successMessage)}`, "_blank")
              }
            >
              <MessageCircle size={16} /> Reabrir WhatsApp
            </Button>
            <Button variant="outline" className="w-full" onClick={() => setSuccessMessage(null)}>
              Voltar ao catálogo
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
