import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
import { supabase } from "@/integrations/supabase/client";
import { EASE_OUT } from "@/lib/motion";
import { formatPhoneDisplay, onlyDigits } from "@/lib/phone";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet";

import { toast } from "sonner";
import {
  ShoppingCart,
  Trash2,
  Minus,
  Plus,
  Search,
  MessageCircle,
  Package,
  Check,
  ArrowLeft,
  ArrowRight,
  X,
} from "lucide-react";

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
  image_url?: string | null;
}

const fmt = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v || 0);

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

/** Chip "Todos" — valor sentinela do filtro de marca. */
const ALL = "__all__";

/**
 * A loja é da empresa, não de cada vendedor: o cabeçalho mostra sempre a marca
 * da casa. O nome do vendedor continua indo na mensagem de WhatsApp do pedido,
 * que é onde ele importa.
 */
const COMPANY = "California Company";

/** Marca da casa: vem sempre primeiro no catálogo e com a cor de destaque. */
const FEATURED_BRAND = "ignite";

const isFeatured = (brand: string) => (brand || "").trim().toLowerCase() === FEATURED_BRAND;

/** Ordena marcas em ordem alfabética, mas com a marca de destaque no topo. */
function compareBrands(a: string, b: string) {
  const fa = isFeatured(a);
  const fb = isFeatured(b);
  if (fa !== fb) return fa ? -1 : 1;
  return (a || "").localeCompare(b || "", undefined, { numeric: true });
}

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

interface Loyalty {
  customer_id: string;
  customer_name: string;
  whatsapp: string;
  total_units: number;
  units_until_next_gift: number;
  gifts_earned: number;
  loyalty_tier: string;
}

function firstModelImage(rows: CatalogRow[]) {
  for (const r of rows) if (r.image_url) return r.image_url;
  return null;
}

/**
 * A loja é desenhada para o telefone (o cliente chega por um link de WhatsApp).
 * No desktop a coluna fica centralizada nessa largura em vez de esticar.
 */
const COLUMN = "mx-auto w-full max-w-[480px]";

/**
 * Proporção única de toda foto de produto da loja. Antes cada tela travava uma
 * ALTURA em pixels e deixava a largura esticar com a coluna, então o mesmo card
 * era 1,59:1 num celular pequeno e 2,50:1 num grande — a foto ficava recortada
 * diferente em cada aparelho. Com a proporção fixa o quadro só muda de tamanho,
 * nunca de formato.
 */
const MEDIA_RATIO = "4 / 3";

/* ------------------------------------------------------------------ */
/* Peças de UI do tema                                                  */
/* ------------------------------------------------------------------ */

/**
 * Botão principal da loja: pílula, fundo accent, texto escuro. Desabilitado
 * esmaece o PREENCHIMENTO (não o botão inteiro), como no protótipo — por isso
 * não reaproveita o `Button` do shadcn, que aplica `disabled:opacity-50`.
 */
function PillButton({
  children,
  onClick,
  disabled,
  height = 50,
  className = "",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  height?: number;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        height,
        background: disabled ? "var(--sf-accent-soft)" : "var(--sf-accent)",
        color: "var(--sf-accent-ink)",
      }}
      className={`flex w-full items-center justify-center gap-2 rounded-full text-sm font-extrabold transition-opacity ${className}`}
    >
      {children}
    </button>
  );
}

/**
 * Foto do produto. Preenche o quadro que o pai definir, sempre com
 * `object-contain`: as URLs são coladas à mão no ModelImagesDialog e vêm em
 * qualquer proporção, então cortar (`cover`) decepava justamente os packshots
 * verticais. O que sobra fica com o fundo do placeholder, sem emenda visível.
 */
function ProductMedia({ src, alt, iconSize }: { src: string | null; alt: string; iconSize: number }) {
  // Link quebrado cai no mesmo placeholder do produto sem foto, em vez de
  // mostrar o ícone de imagem partida do navegador.
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);

  return (
    <div
      className="flex h-full w-full items-center justify-center overflow-hidden"
      style={{ background: "var(--sf-surface-2)" }}
    >
      {src && !failed ? (
        <img
          src={src}
          alt={alt}
          onError={() => setFailed(true)}
          className="h-full w-full object-contain"
          loading="lazy"
          decoding="async"
        />
      ) : (
        <Package size={iconSize} style={{ color: "var(--sf-text-dim)" }} />
      )}
    </div>
  );
}

/** Cabeçalho comum aos sheets de carrinho e checkout. */
function SheetTopBar({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div
      className="flex flex-shrink-0 items-center justify-between px-5 pb-3.5 pt-5"
      style={{ borderBottom: "1px solid var(--sf-hairline)" }}
    >
      <SheetTitle className="text-[19px] font-extrabold" style={{ color: "var(--sf-text)" }}>
        {title}
      </SheetTitle>
      <button
        type="button"
        onClick={onClose}
        aria-label="Fechar"
        className="flex h-8 w-8 items-center justify-center rounded-full"
        style={{ background: "var(--sf-surface)", color: "var(--sf-text)" }}
      >
        <X size={15} />
      </button>
    </div>
  );
}

/** Controle de quantidade em pílula. `compact` é a versão do carrinho. */
function QtyStepper({
  qty,
  onDec,
  onInc,
  decDisabled,
  incDisabled,
  compact = false,
}: {
  qty: number;
  onDec: () => void;
  onInc: () => void;
  decDisabled: boolean;
  incDisabled: boolean;
  compact?: boolean;
}) {
  const pad = compact ? "px-2.5 py-1.5" : "px-3.5 py-[11px]";
  const icon = compact ? 11 : 13;
  return (
    <div
      className="flex w-fit items-center rounded-full"
      style={{ background: "var(--sf-surface)", color: "var(--sf-text)" }}
    >
      <button type="button" onClick={onDec} disabled={decDisabled} className={`${pad} disabled:opacity-40`}>
        <Minus size={icon} />
      </button>
      <span
        className={`text-center font-bold ${compact ? "w-[22px] text-[12.5px]" : "w-7 text-sm"}`}
        aria-live="polite"
      >
        {qty}
      </span>
      <button type="button" onClick={onInc} disabled={incDisabled} className={`${pad} disabled:opacity-40`}>
        <Plus size={icon} />
      </button>
    </div>
  );
}

/**
 * Chips de marca com o preenchimento accent como peça única: em vez de cada
 * chip pintar o próprio fundo, só o ativo renderiza o `motion.span` com
 * `layoutId`, então o motion anima a peça deslizando do chip antigo pro novo.
 * Mesmo padrão do `SegmentedToggle`, adaptado ao tema da loja.
 */
function BrandChips({
  chips,
  active,
  onChange,
}: {
  chips: { key: string; label: string }[];
  active: string;
  onChange: (key: string) => void;
}) {
  const reduce = useReducedMotion();
  const pillId = useId();
  const activeRef = useRef<HTMLButtonElement>(null);

  // A linha rola na horizontal: sem isso, tocar numa marca fora da área
  // visível faz o pill viajar pra fora da tela.
  useEffect(() => {
    const el = activeRef.current;
    if (!el) return;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "nearest", inline: "center" });
  }, [active, reduce]);

  return (
    // overscroll-x-contain: sem isso, arrastar os chips até o fim dispara
    // o gesto de "voltar" do navegador no celular.
    // layoutScroll: avisa o motion que este container rola, senão ele mede a
    // posição do pill sem descontar o scroll e a peça pousa no lugar errado.
    <motion.div layoutScroll className="mt-3.5 flex gap-2 overflow-x-auto overscroll-x-contain pb-0.5">
      {chips.map(c => {
        const isActive = c.key === active;
        return (
          <button
            key={c.key}
            ref={isActive ? activeRef : undefined}
            type="button"
            onClick={() => onChange(c.key)}
            aria-pressed={isActive}
            className="relative flex-none rounded-full px-4 py-2 text-[12.5px] font-bold transition-colors duration-200"
            style={{
              background: "var(--sf-surface)",
              color: isActive ? "var(--sf-accent-ink)" : "var(--sf-text-muted)",
            }}
          >
            {isActive && (
              <motion.span
                layoutId={reduce ? undefined : pillId}
                className="absolute inset-0 rounded-full"
                style={{ background: "var(--sf-accent)" }}
                transition={{ duration: 0.28, ease: EASE_OUT }}
              />
            )}
            <span className="relative z-10">{c.label}</span>
          </button>
        );
      })}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Card do catálogo                                                     */
/* ------------------------------------------------------------------ */

function ProductCard({ model, onOpen }: { model: ModelGroup; onOpen: () => void }) {
  const allRows = model.flavors;
  const inStock = allRows.filter(r => r.available > 0);
  const prices = (inStock.length ? inStock : allRows).map(r => r.sale_price);
  const minPrice = prices.length ? Math.min(...prices) : 0;
  const samePrice = prices.every(p => p === prices[0]);
  const flavorCount = allRows.length;
  const allOut = inStock.length === 0;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={e => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className="cursor-pointer overflow-hidden rounded-[20px]"
      style={{ background: "var(--sf-surface)", border: "1px solid var(--sf-hairline)" }}
    >
      <div className="relative w-full" style={{ aspectRatio: MEDIA_RATIO }}>
        <ProductMedia src={firstModelImage(allRows)} alt={model.model || "Produto"} iconSize={56} />

        {allOut && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-[2px]">
            <span className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--sf-text-muted)" }}>
              Esgotado
            </span>
          </div>
        )}

        {/* Abre o mesmo sheet do card: o sabor sempre tem que ser escolhido,
            então não existe "adicionar às cegas". */}
        <button
          type="button"
          aria-label={`Ver opções de ${model.model || "produto"}`}
          onClick={e => {
            e.stopPropagation();
            onOpen();
          }}
          className="absolute bottom-3 right-3 flex h-9 w-9 items-center justify-center rounded-full shadow-[0_4px_12px_rgba(0,0,0,0.4)]"
          style={{
            background: "var(--sf-accent)",
            color: "var(--sf-accent-ink)",
            border: "2px solid var(--sf-bg)",
          }}
        >
          <Plus size={15} strokeWidth={2.4} />
        </button>
      </div>

      <div className="px-4 pb-4 pt-3.5">
        <p className="truncate text-base font-bold">{model.model || "Sem modelo"}</p>
        <div className="mt-2.5 flex items-center justify-between gap-3">
          <span
            className="flex-none rounded-full px-2.5 py-1 text-[11px] font-semibold"
            style={{ background: "var(--sf-surface-2)", color: "var(--sf-text-faint)" }}
          >
            {flavorCount} {flavorCount === 1 ? "sabor" : "sabores"}
          </span>
          <span className="text-[15px] font-extrabold" style={{ color: "var(--sf-accent)" }}>
            {samePrice ? fmt(minPrice) : `A partir de ${fmt(minPrice)}`}
          </span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Página                                                               */
/* ------------------------------------------------------------------ */

export default function SellerStorePage() {
  const { sellerId } = useParams<{ sellerId: string }>();
  const validId = !!sellerId && UUID_RE.test(sellerId);
  const [rows, setRows] = useState<CatalogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [activeBrand, setActiveBrand] = useState<string>(ALL);

  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [checkout, setCheckout] = useState(false);
  const [name, setName] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [freight, setFreight] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Detalhe do produto: um único sheet na página, não um por card.
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string>("");
  const [qty, setQty] = useState(1);

  // Passo 1: identificação por WhatsApp
  const [identified, setIdentified] = useState(false);
  const [phoneInput, setPhoneInput] = useState("");
  const [loyalty, setLoyalty] = useState<Loyalty | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupDone, setLookupDone] = useState(false);
  const [newName, setNewName] = useState("");

  const phoneDigits = onlyDigits(phoneInput);
  const phoneComplete = phoneDigits.length >= 10 && phoneDigits.length <= 11;

  useEffect(() => {
    if (!phoneComplete) {
      setLoyalty(null);
      setLookupDone(false);
      return;
    }
    let cancelled = false;
    setLookupLoading(true);
    (async () => {
      const { data, error } = await supabase.rpc("get_customer_loyalty", { p_whatsapp: phoneDigits });
      if (cancelled) return;
      if (error) toast.error("Erro ao buscar cadastro", { description: error.message });
      const row = ((data as unknown as Loyalty[] | null) ?? [])[0] ?? null;
      setLoyalty(row);
      setLookupDone(true);
      setLookupLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [phoneDigits, phoneComplete]);

  const load = useCallback(async () => {
    if (!validId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase.rpc("get_seller_catalog", { p_seller_id: sellerId });
    if (error) toast.error("Erro ao carregar catálogo", { description: error.message });
    setRows((data as CatalogRow[]) ?? []);
    setLoading(false);
  }, [sellerId, validId]);

  useEffect(() => {
    load();
  }, [load]);

  const sellerName = rows[0]?.seller_name ?? "";

  /** Marcas para os chips — do catálogo inteiro, não do resultado filtrado. */
  const brands = useMemo(() => {
    const set = new Set<string>();
    rows.forEach(r => {
      const b = (r.brand || "").trim();
      if (b) set.add(b);
    });
    return Array.from(set).sort(compareBrands);
  }, [rows]);

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
    if (activeBrand !== ALL) models = models.filter(m => (m.brand || "").trim() === activeBrand);
    if (q) {
      models = models
        .map(m => ({
          ...m,
          flavors: m.flavors.filter(r =>
            [r.brand, r.model, r.flavor, r.name].some(v => (v || "").toLowerCase().includes(q)),
          ),
        }))
        .filter(m => m.flavors.length > 0);
    }
    models.forEach(m =>
      m.flavors.sort((a, b) => (a.flavor || "").localeCompare(b.flavor || "", undefined, { numeric: true })),
    );
    models.sort((a, b) => (a.model || "").localeCompare(b.model || "", undefined, { numeric: true }));

    const brandMap = new Map<string, BrandGroup>();
    models.forEach(m => {
      const bKey = (m.brand || "").trim() || "__sem_marca__";
      if (!brandMap.has(bKey)) brandMap.set(bKey, { key: bKey, brand: m.brand, models: [] });
      brandMap.get(bKey)!.models.push(m);
    });

    return Array.from(brandMap.values()).sort((a, b) => compareBrands(a.brand, b.brand));
  }, [rows, query, activeBrand]);

  const total = useMemo(() => cart.reduce((a, i) => a + i.sale_price * i.quantity, 0), [cart]);
  const cartCount = useMemo(() => cart.reduce((a, i) => a + i.quantity, 0), [cart]);

  /** Modelo aberto no sheet de detalhe, achado entre os grupos já montados. */
  const detailModel = useMemo(() => {
    if (!detailKey) return null;
    for (const g of groups) {
      const m = g.models.find(mm => mm.key === detailKey);
      if (m) return m;
    }
    return null;
  }, [detailKey, groups]);

  const selectedFlavor =
    detailModel?.flavors.find(f => f.product_id === selectedId) ??
    detailModel?.flavors.find(f => f.available > 0) ??
    detailModel?.flavors[0] ??
    null;
  const available = selectedFlavor?.available ?? 0;
  const clampedQty = Math.min(Math.max(1, qty), Math.max(available, 1));

  const openDetail = (model: ModelGroup) => {
    const first = model.flavors.find(f => f.available > 0) ?? model.flavors[0];
    setSelectedId(first?.product_id ?? "");
    setQty(1);
    setDetailKey(model.key);
  };

  const addToCart = (row: CatalogRow, requested = 1) => {
    const qtyToAdd = Math.min(Math.max(1, requested), row.available);
    setCart(prev => {
      const existing = prev.find(i => i.product_id === row.product_id);
      if (existing) {
        return prev.map(i =>
          i.product_id === row.product_id ? { ...i, quantity: Math.min(i.quantity + qtyToAdd, row.available) } : i,
        );
      }
      return [...prev, { ...row, quantity: qtyToAdd }];
    });
    // Curto de propósito: o padrão do sonner (4s) fica na frente de quem está
    // adicionando um item atrás do outro.
    toast.success("Adicionado ao carrinho", {
      description: `${row.flavor} · ${row.model}`,
      duration: 1500,
    });
  };

  const setItemQty = (productId: string, q: number) => {
    setCart(prev =>
      prev.map(i => (i.product_id === productId ? { ...i, quantity: Math.min(Math.max(1, q), i.available) } : i)),
    );
  };

  const removeItem = (productId: string) => setCart(prev => prev.filter(i => i.product_id !== productId));

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
      lines.push(
        `• ${i.flavor} · ${i.model} (${i.quantity}x) • ${fmt(i.sale_price)} = ${fmt(i.sale_price * i.quantity)}`,
      );
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
      setFreight("");

      load();
    } catch (err: any) {
      const msg = String(err?.message ?? "");
      toast.error(friendlyError(msg));
      if (msg.includes("estoque_insuficiente")) load();
    } finally {
      setSubmitting(false);
    }
  };

  /* ---------------- Link inválido ---------------- */

  if (!validId) {
    return (
      <main className="storefront flex h-[100dvh] items-center justify-center overflow-hidden p-6">
        <div className={`${COLUMN} space-y-2 text-center`}>
          <h1 className="text-xl font-bold">Link inválido</h1>
          <p className="text-sm" style={{ color: "var(--sf-text-muted)" }}>
            Este endereço de loja não é válido. Peça ao vendedor o link correto do catálogo.
          </p>
        </div>
      </main>
    );
  }

  /* ---------------- 1. Identificação ---------------- */

  if (!identified) {
    const needsName = lookupDone && !loyalty;
    const canContinue = phoneComplete && !lookupLoading && (loyalty ? true : newName.trim().length > 1);
    const continuar = () => {
      if (!canContinue) return;
      setName((loyalty?.customer_name ?? newName).trim());
      setWhatsapp(phoneDigits);
      setIdentified(true);
    };

    const fieldClass = "h-[50px] rounded-[14px] px-4 text-[15px]";
    const fieldStyle = {
      background: "var(--sf-surface)",
      border: "1px solid var(--sf-border)",
      color: "var(--sf-text)",
    };
    const labelClass = "text-xs font-semibold";
    const labelStyle = { color: "var(--sf-text-muted)" };

    return (
      // `my-auto` no filho centraliza sem cortar: com `justify-center` no pai,
      // se o teclado do celular espremer a tela, o topo do formulário fica
      // inalcançável pela rolagem.
      <main className="storefront flex h-[100dvh] flex-col overflow-y-auto overscroll-contain px-[26px] pb-10 pt-20">
        <div className={`${COLUMN} my-auto flex flex-col gap-6`}>
          <div>
            <div className="mb-1.5 text-xl font-extrabold tracking-[0.02em]" style={{ color: "var(--sf-accent)" }}>
              {COMPANY.toUpperCase()}
            </div>
            <h1 className="mb-2 text-[23px] font-bold">Bem-vindo ao catálogo</h1>
            <p className="text-sm leading-relaxed" style={{ color: "var(--sf-text-muted)" }}>
              Informe seus dados para ver os produtos e finalizar seu pedido direto pelo WhatsApp.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ident-whats" className={labelClass} style={labelStyle}>
              Seu WhatsApp
            </Label>
            <Input
              id="ident-whats"
              inputMode="numeric"
              autoFocus
              value={formatPhoneDisplay(phoneInput)}
              onChange={e => setPhoneInput(onlyDigits(e.target.value))}
              placeholder="(11) 90000-0000"
              className={fieldClass}
              style={fieldStyle}
            />
          </div>

          {lookupLoading && (
            <p className="text-[13px]" style={{ color: "var(--sf-text-muted)" }}>
              Buscando seu cadastro...
            </p>
          )}

          {!lookupLoading && loyalty && (
            <div
              className="rounded-2xl p-4"
              style={{ background: "var(--sf-surface)", border: "1px solid var(--sf-hairline)" }}
            >
              <p className="text-[15px] font-bold">Oi, {loyalty.customer_name}!</p>
              <p className="mt-1 text-[13px]" style={{ color: "var(--sf-text-muted)" }}>
                Nível <span style={{ color: "var(--sf-accent)" }}>{loyalty.loyalty_tier}</span> · {loyalty.total_units}{" "}
                {loyalty.total_units === 1 ? "unidade" : "unidades"} compradas
              </p>
              <p className="mt-1 text-[13px]" style={{ color: "var(--sf-text-muted)" }}>
                {loyalty.units_until_next_gift === 0
                  ? `Você já garantiu ${loyalty.gifts_earned > 1 ? `${loyalty.gifts_earned} brindes` : "um brinde"}! 🎁`
                  : `Faltam ${loyalty.units_until_next_gift} ${
                      loyalty.units_until_next_gift === 1 ? "unidade" : "unidades"
                    } para o próximo brinde`}
              </p>
            </div>
          )}

          {!lookupLoading && needsName && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ident-nome" className={labelClass} style={labelStyle}>
                Seu nome
              </Label>
              <Input
                id="ident-nome"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="ex: Jordan Lee"
                className={fieldClass}
                style={fieldStyle}
              />
            </div>
          )}

          <PillButton height={52} disabled={!canContinue} onClick={continuar} className="text-[15px] font-bold">
            Continuar
            <ArrowRight size={15} />
          </PillButton>
        </div>
      </main>
    );
  }

  /* ---------------- 6. Sucesso (tela cheia) ---------------- */

  if (successMessage) {
    return (
      <main className="storefront flex h-[100dvh] flex-col items-center overflow-y-auto overscroll-contain px-[30px] py-10 text-center">
        <div className={`${COLUMN} my-auto flex flex-col items-center gap-[18px]`}>
          <div
            className="flex h-[68px] w-[68px] items-center justify-center rounded-full"
            style={{ background: "var(--sf-accent)", color: "var(--sf-accent-ink)" }}
          >
            <Check size={30} strokeWidth={2.6} />
          </div>
          <div>
            <h2 className="mb-2 text-[21px] font-extrabold">Pedido enviado!</h2>
            <p className="text-[13.5px] leading-relaxed" style={{ color: "var(--sf-text-muted)" }}>
              Confirme o envio no WhatsApp que abriu para o vendedor.
            </p>
          </div>
          <div className="mt-2.5 flex w-full flex-col gap-2.5">
            <PillButton
              onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(successMessage)}`, "_blank")}
            >
              <MessageCircle size={15} />
              Reabrir WhatsApp
            </PillButton>
            <button
              type="button"
              onClick={() => setSuccessMessage(null)}
              className="h-11 text-[13.5px] font-bold"
              style={{ color: "var(--sf-accent)" }}
            >
              Voltar ao catálogo
            </button>
          </div>
        </div>
      </main>
    );
  }

  /* ---------------- 2. Catálogo ---------------- */

  const overlayOpen = detailKey !== null || cartOpen || checkout;
  const chips = [{ key: ALL, label: "Todos" }, ...brands.map(b => ({ key: b, label: b }))];

  return (
    // App-shell: a raiz ocupa exatamente a altura da janela e não rola. Só o
    // <main> rola, então o cabeçalho fica parado sem precisar de `sticky`, e o
    // documento não tem o que arrastar — nem na horizontal nem no repique
    // vertical. `dvh` acompanha a barra de endereço recolhendo no celular.
    <div className="storefront flex h-[100dvh] flex-col overflow-hidden">
      <header className="flex-shrink-0">
        <div className={`${COLUMN} px-5 pb-3 pt-4`}>
        <div className="flex items-start justify-between gap-2.5">
          <div className="min-w-0">
            <p className="truncate text-sm font-extrabold tracking-[0.03em]" style={{ color: "var(--sf-accent)" }}>
              {COMPANY.toUpperCase()}
            </p>
            <p className="mt-0.5 truncate text-xs" style={{ color: "var(--sf-text-muted)" }}>
              Oi, {name} — escolha seu produto
            </p>
          </div>

          <button
            type="button"
            onClick={() => setCartOpen(true)}
            aria-label={`Abrir carrinho${cartCount > 0 ? ` com ${cartCount} item(ns)` : ""}`}
            className="relative flex h-10 w-10 flex-none items-center justify-center rounded-full"
            style={{ background: "var(--sf-surface)", border: "1px solid var(--sf-border)", color: "var(--sf-text)" }}
          >
            <ShoppingCart size={17} />
            {cartCount > 0 && (
              <span
                className="absolute -right-1.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-extrabold"
                style={{ background: "var(--sf-accent)", color: "var(--sf-accent-ink)" }}
              >
                {cartCount}
              </span>
            )}
          </button>
        </div>

        <div className="relative mt-3.5">
          <Search
            size={14}
            className="absolute left-3.5 top-1/2 -translate-y-1/2"
            style={{ color: "var(--sf-text-faint)" }}
          />
          <Input
            placeholder="Buscar produtos..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="h-[42px] rounded-full border-0 pl-[38px] pr-4 text-[13.5px]"
            style={{ background: "var(--sf-surface)", color: "var(--sf-text)" }}
          />
        </div>

        {chips.length > 1 && <BrandChips chips={chips} active={activeBrand} onChange={setActiveBrand} />}
        </div>
      </header>

      <main className={`${COLUMN} flex-1 overflow-y-auto overscroll-contain px-5 pb-[100px] pt-1.5`}>
        {loading ? (
          <p className="py-16 text-center text-[13px]" style={{ color: "var(--sf-text-dim)" }}>
            Carregando catálogo...
          </p>
        ) : groups.length === 0 ? (
          <p className="py-16 text-center text-[13px]" style={{ color: "var(--sf-text-dim)" }}>
            {query.trim() ? `Nenhum produto encontrado para "${query.trim()}".` : "Nenhum produto encontrado."}
          </p>
        ) : (
          groups.map(g => (
            <section key={g.key} className="mt-5">
              <h2
                className="mb-3 text-[15px] font-extrabold uppercase tracking-[0.06em]"
                style={{ color: isFeatured(g.brand) ? "var(--sf-accent)" : "var(--sf-text)" }}
              >
                {g.brand || "Sem marca"}
              </h2>
              <div className="flex flex-col gap-4">
                {g.models.map(m => (
                  <ProductCard key={m.key} model={m} onOpen={() => openDetail(m)} />
                ))}
              </div>
            </section>
          ))
        )}
      </main>

      {/* Barra do carrinho — some enquanto um sheet está aberto. */}
      {cartCount > 0 && !overlayOpen && (
        <div
          className="fixed inset-x-0 bottom-0 z-40"
          style={{ background: "linear-gradient(to top, var(--sf-bg) 70%, transparent)" }}
        >
          <div className={`${COLUMN} px-5 pb-[26px] pt-3`}>
            <PillButton height={52} onClick={() => setCartOpen(true)} className="shadow-[0_8px_24px_rgba(0,0,0,0.4)]">
              <ShoppingCart size={15} />
              Ver carrinho · {cartCount} · {fmt(total)}
            </PillButton>
          </div>
        </div>
      )}

      {/* ---------------- 3. Detalhe do produto ---------------- */}
      <Sheet open={detailKey !== null} onOpenChange={o => !o && setDetailKey(null)}>
        <SheetContent
          side="bottom"
          hideClose
          className={`storefront ${COLUMN} inset-x-0 flex h-[88vh] flex-col gap-0 rounded-b-none rounded-t-[28px] border-0 p-0`}
          style={{ background: "var(--sf-bg)" }}
        >
          {detailModel && (
            <>
              <SheetTitle className="sr-only">{detailModel.model || "Produto"}</SheetTitle>
              <SheetDescription className="sr-only">Escolha o sabor e a quantidade.</SheetDescription>

              {/* Mesma proporção do card, com teto de altura: num aparelho
                  baixo o hero em 4:3 comeria a lista de sabores. Como a foto é
                  `contain`, o teto só encolhe o quadro — nunca corta a imagem. */}
              <div
                className="relative max-h-[34vh] w-full flex-shrink-0 overflow-hidden rounded-t-[28px]"
                style={{ aspectRatio: MEDIA_RATIO }}
              >
                <ProductMedia
                  src={firstModelImage(detailModel.flavors)}
                  alt={detailModel.model || "Produto"}
                  iconSize={72}
                />
                <button
                  type="button"
                  onClick={() => setDetailKey(null)}
                  aria-label="Voltar"
                  className="absolute left-3.5 top-3.5 flex h-9 w-9 items-center justify-center rounded-full backdrop-blur-md"
                  style={{ background: "rgba(20,20,26,0.7)", color: "var(--sf-text)" }}
                >
                  <ArrowLeft size={16} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-5 pb-3 pt-5">
                <p
                  className="mb-1 text-[11.5px] font-bold uppercase tracking-[0.06em]"
                  style={{ color: "var(--sf-accent)" }}
                >
                  {detailModel.brand || "Sem marca"}
                </p>
                <h2 className="mb-[18px] text-[22px] font-extrabold leading-tight">
                  {detailModel.model || "Sem modelo"}
                </h2>

                <p
                  className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.08em]"
                  style={{ color: "var(--sf-text-faint)" }}
                >
                  Sabor
                </p>
                <div className="flex flex-col gap-2">
                  {detailModel.flavors.map(f => {
                    const out = f.available <= 0;
                    const active = f.product_id === (selectedFlavor?.product_id ?? "");
                    const urgent = !out && f.available <= 2;
                    return (
                      <button
                        key={f.product_id}
                        type="button"
                        disabled={out}
                        onClick={() => {
                          setSelectedId(f.product_id);
                          setQty(1);
                        }}
                        className="flex w-full items-center justify-between gap-2.5 rounded-2xl px-3.5 py-3 text-left"
                        style={{
                          background: active ? "var(--sf-accent-tint)" : "transparent",
                          border: `1px solid ${active ? "var(--sf-accent-line)" : "var(--sf-border)"}`,
                          opacity: out ? 0.4 : 1,
                        }}
                      >
                        <div className="flex min-w-0 items-center gap-[11px]">
                          <span
                            className="flex h-[19px] w-[19px] flex-none items-center justify-center rounded-full"
                            style={{
                              background: active ? "var(--sf-accent)" : "transparent",
                              border: `1.5px solid ${active ? "var(--sf-accent)" : "var(--sf-text-dim)"}`,
                              color: "var(--sf-accent-ink)",
                            }}
                          >
                            {active && <Check size={10} strokeWidth={3} />}
                          </span>
                          <span className="min-w-0">
                            <p className="truncate text-sm font-semibold">{f.flavor || "Sem sabor"}</p>
                            <p
                              className="mt-0.5 text-[11.5px]"
                              style={{
                                color: out
                                  ? "var(--sf-text-dim)"
                                  : urgent
                                    ? "var(--sf-warn)"
                                    : "var(--sf-text-faint)",
                              }}
                            >
                              {out ? "Esgotado" : urgent ? `Só restam ${f.available}` : `${f.available} em estoque`}
                            </p>
                          </span>
                        </div>
                        <span className="flex-none text-sm font-bold">{fmt(f.sale_price)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div
                className="flex flex-shrink-0 items-center gap-2.5 px-5 pb-7 pt-3.5"
                style={{ borderTop: "1px solid var(--sf-hairline)", background: "var(--sf-bg)" }}
              >
                <QtyStepper
                  qty={available <= 0 ? 0 : clampedQty}
                  onDec={() => setQty(Math.max(1, clampedQty - 1))}
                  onInc={() => setQty(Math.min(available, clampedQty + 1))}
                  decDisabled={available <= 0 || clampedQty <= 1}
                  incDisabled={clampedQty >= available}
                />
                <PillButton
                  disabled={!selectedFlavor || available <= 0}
                  onClick={() => {
                    if (!selectedFlavor) return;
                    addToCart(selectedFlavor, clampedQty);
                    setDetailKey(null);
                  }}
                >
                  {available <= 0 ? "Esgotado" : `Adicionar · ${fmt((selectedFlavor?.sale_price ?? 0) * clampedQty)}`}
                </PillButton>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* ---------------- 4. Carrinho ---------------- */}
      <Sheet open={cartOpen} onOpenChange={setCartOpen}>
        <SheetContent
          side="bottom"
          hideClose
          className={`storefront ${COLUMN} inset-x-0 flex h-[76vh] flex-col gap-0 rounded-b-none rounded-t-[28px] border-0 p-0`}
          style={{ background: "var(--sf-bg)" }}
        >
          <SheetTopBar title="Seu carrinho" onClose={() => setCartOpen(false)} />
          <SheetDescription className="sr-only">{cartCount} item(ns) selecionado(s).</SheetDescription>

          <div className="flex-1 overflow-y-auto px-5 pt-2">
            {cart.length === 0 ? (
              <p className="py-16 text-center text-[13px]" style={{ color: "var(--sf-text-dim)" }}>
                Seu carrinho está vazio.
              </p>
            ) : (
              cart.map(i => (
                <div
                  key={i.product_id}
                  className="flex items-start gap-3 py-3.5"
                  style={{ borderBottom: "1px solid var(--sf-hairline)" }}
                >
                  <div className="h-14 w-14 flex-none overflow-hidden rounded-xl">
                    <ProductMedia src={i.image_url ?? null} alt={i.model} iconSize={22} />
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-bold">{i.model || "Sem modelo"}</p>
                    <p className="mb-2 mt-0.5 truncate text-xs" style={{ color: "var(--sf-text-muted)" }}>
                      {i.flavor || "Sem sabor"}
                    </p>
                    <QtyStepper
                      compact
                      qty={i.quantity}
                      onDec={() => setItemQty(i.product_id, i.quantity - 1)}
                      onInc={() => setItemQty(i.product_id, i.quantity + 1)}
                      decDisabled={i.quantity <= 1}
                      incDisabled={i.quantity >= i.available}
                    />
                  </div>

                  <div className="flex flex-none flex-col items-end gap-3">
                    <span className="text-[13.5px] font-extrabold" style={{ color: "var(--sf-accent)" }}>
                      {fmt(i.sale_price * i.quantity)}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeItem(i.product_id)}
                      aria-label={`Remover ${i.flavor || i.model}`}
                      style={{ color: "var(--sf-text-faint)" }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div
            className="flex flex-shrink-0 flex-col gap-3 px-5 pb-7 pt-4"
            style={{ borderTop: "1px solid var(--sf-hairline)" }}
          >
            <div className="flex items-center justify-between">
              <span className="text-[13px]" style={{ color: "var(--sf-text-muted)" }}>
                Total
              </span>
              <span className="text-[19px] font-extrabold" style={{ color: "var(--sf-accent)" }}>
                {fmt(total)}
              </span>
            </div>
            <PillButton
              disabled={cart.length === 0}
              onClick={() => {
                setCartOpen(false);
                setCheckout(true);
              }}
            >
              Finalizar pedido
            </PillButton>
          </div>
        </SheetContent>
      </Sheet>

      {/* ---------------- 5. Checkout ---------------- */}
      <Sheet open={checkout} onOpenChange={o => !submitting && setCheckout(o)}>
        <SheetContent
          side="bottom"
          hideClose
          className={`storefront ${COLUMN} inset-x-0 flex h-[70vh] flex-col gap-0 rounded-b-none rounded-t-[28px] border-0 p-0`}
          style={{ background: "var(--sf-bg)" }}
        >
          <SheetTopBar title="Finalizar pedido" onClose={() => !submitting && setCheckout(false)} />
          <SheetDescription className="sr-only">Confirme seus dados e envie o pedido.</SheetDescription>

          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-[18px]">
            <div
              className="flex items-center justify-between gap-2.5 rounded-2xl px-4 py-3.5"
              style={{ background: "var(--sf-surface)", border: "1px solid var(--sf-hairline)" }}
            >
              <div className="min-w-0">
                <p className="truncate text-[13.5px] font-bold">{name}</p>
                <p className="mt-0.5 text-xs" style={{ color: "var(--sf-text-muted)" }}>
                  {formatPhoneDisplay(whatsapp)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setCheckout(false);
                  setPhoneInput(whatsapp);
                  setNewName(name);
                  setIdentified(false);
                }}
                className="flex-none text-[12.5px] font-bold"
                style={{ color: "var(--sf-accent)" }}
              >
                Editar
              </button>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cliente-frete" className="text-xs font-semibold" style={{ color: "var(--sf-text-muted)" }}>
                Observações de entrega
              </Label>
              <Textarea
                id="cliente-frete"
                value={freight}
                onChange={e => setFreight(e.target.value)}
                placeholder="Opcional — horário, endereço, etc."
                rows={3}
                className="resize-none rounded-[14px] px-3.5 py-3 text-sm"
                style={{
                  background: "var(--sf-surface)",
                  border: "1px solid var(--sf-border)",
                  color: "var(--sf-text)",
                }}
              />
            </div>

            <div
              className="flex items-center justify-between pt-3.5"
              style={{ borderTop: "1px solid var(--sf-hairline)" }}
            >
              <span className="text-[13px]" style={{ color: "var(--sf-text-muted)" }}>
                Total
              </span>
              <span className="text-lg font-extrabold" style={{ color: "var(--sf-accent)" }}>
                {fmt(total)}
              </span>
            </div>
          </div>

          <div className="flex-shrink-0 px-5 pb-7 pt-3.5" style={{ borderTop: "1px solid var(--sf-hairline)" }}>
            <PillButton onClick={submit} disabled={submitting || cart.length === 0}>
              {submitting ? "Enviando..." : "Confirmar pedido"}
            </PillButton>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
