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
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
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

export default function SellerStorePage() {
  const { sellerId } = useParams<{ sellerId: string }>();
  const validId = !!sellerId && UUID_RE.test(sellerId);
  const [rows, setRows] = useState<CatalogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [qtys, setQtys] = useState<Record<string, number>>({});
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
    const map = new Map<string, { key: string; brand: string; model: string; flavors: CatalogRow[] }>();
    rows.forEach((r, idx) => {
      const hasKey = (r.brand || "").trim() !== "" || (r.model || "").trim() !== "";
      const key = hasKey ? `${r.brand}|||${r.model}` : `__sem_modelo__${idx}`;
      if (!map.has(key)) map.set(key, { key, brand: r.brand, model: r.model, flavors: [] });
      map.get(key)!.flavors.push(r);
    });
    let list = Array.from(map.values());
    if (q) {
      list = list.filter(g =>
        g.flavors.some(r =>
          [r.brand, r.model, r.flavor, r.name].some(v => (v || "").toLowerCase().includes(q))
        )
      );
    }
    list.forEach(g => g.flavors.sort((a, b) => (a.flavor || "").localeCompare(b.flavor || "")));
    return list.sort((a, b) =>
      `${a.brand} ${a.model}`.localeCompare(`${b.brand} ${b.model}`)
    );
  }, [rows, query]);


  const total = useMemo(
    () => cart.reduce((a, i) => a + i.sale_price * i.quantity, 0),
    [cart]
  );
  const cartCount = useMemo(() => cart.reduce((a, i) => a + i.quantity, 0), [cart]);

  const addToCart = (row: CatalogRow) => {
    const qty = Math.min(Math.max(1, qtys[row.product_id] ?? 1), row.available);
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
    setQtys(p => ({ ...p, [row.product_id]: 1 }));
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
          <Button onClick={() => setCartOpen(true)} size="sm" className="gap-2 relative">
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {groups.map(g => (
              <ModelCard key={g.key} group={g} onAdd={addToCart} />
            ))}
          </div>
        )}

      </main>

      {cartCount > 0 && (
        <div className="fixed bottom-0 inset-x-0 z-40 border-t border-border bg-background/90 backdrop-blur-xl">
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
