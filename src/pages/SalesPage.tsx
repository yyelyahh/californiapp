import { useStore } from "@/context/StoreContext";
import { useMemo, useState, type ReactNode } from "react";
import { Plus, Pencil, Trash2, AlertCircle, X, ArrowUpDown, Clock, Check, Ban, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetFooter, SheetTrigger } from "@/components/ui/sheet";
import { NcButton, NcSheetHeader, NcTabsList, SegmentedChips, Rule, EYEBROW } from "@/components/nocturne";
import { Label } from "@/components/ui/label";
import { todayDateString, localDateToISO, formatDateBR, isoDay, currentMonthRange } from "@/lib/date-utils";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { Stagger } from "@/components/motion/Stagger";
import { AnimatePresence, motion } from "motion/react";
import { listItem, transitionBase } from "@/lib/motion";
import { useConfirm } from "@/components/ConfirmProvider";
import BatchSaleForm from "@/components/BatchSaleForm";
import SegmentedToggle from "@/components/motion/SegmentedToggle";
import AnimatedNumber from "@/components/motion/AnimatedNumber";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  usePendingOrders,
  ORDER_PAYMENT_CHOICES,
  ORDER_NOTE_MAX,
  type Order,
  type PaymentMethodValue,
} from "@/hooks/usePendingOrders";
import { formatCurrency, formatCurrencyShort } from "@/lib/currency";
import { orderRef } from "@/lib/order-ref";

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;
  if (hours < 24) return `há ${hours}h`;
  if (days === 1) return "há 1 dia";
  return `há ${days} dias`;
}

/**
 * Popover portado pelo Radix: mesma regra do SheetContent e do SelectContent —
 * `nocturne` repetido na classe, porque o portal sai da árvore da página e os
 * tokens não chegam por herança. O fundo é o --nc-surface, não o --nc-bg: o
 * popover flutua SOBRE a tela e não pode ser da mesma cor dela.
 */
const POPOVER_CLASS = "nocturne border-0";
const POPOVER_STYLE: React.CSSProperties = {
  background: "var(--nc-surface)",
  boxShadow: "0 0 0 1px var(--nc-divider), 0 10px 30px rgba(0,0,0,0.5)",
};

type DateRangePreset = "all" | "today" | "7d" | "month" | "lastMonth" | "custom";

/**
 * Os mesmos chips do Dashboard e da Entrada (`SegmentedChips`). "custom" não está
 * aqui de propósito: ele não é um chip, é o que sobra quando a pessoa digita um
 * intervalo à mão — e aí nenhum chip fica aceso.
 */
const PERIOD_OPTIONS: { value: DateRangePreset; label: string; short: string }[] = [
  { value: "all", label: "Todo o período", short: "Tudo" },
  { value: "today", label: "Hoje", short: "Hoje" },
  { value: "7d", label: "Últimos 7 dias", short: "7d" },
  { value: "month", label: "Este mês", short: "Mês" },
  { value: "lastMonth", label: "Mês passado", short: "Mês ant." },
];

/**
 * A tela abre no mês corrente, não em "Tudo".
 *
 * Motivo é desempenho, não gosto: a lista monta uma linha por venda, sem
 * virtualização nem paginação, e "Tudo" cresce para sempre — hoje já trava
 * perceptivelmente ao carregar. O recorte padrão é o paliativo; a correção de
 * verdade está no roadmap (virtualizar a lista ou paginar no banco).
 *
 * Como consequência, "Limpar" volta para o mês, e não para "Tudo": o botão
 * devolve a tela ao estado em que ela abre, senão limpar filtro seria a ação
 * mais pesada da tela.
 */
const DEFAULT_PRESET: DateRangePreset = "month";

/** Quantas linhas cabem na lista do trilho antes de virar "+ N outros". */
const MAX_TOP_ROWS = 6;

/** Acima disso a linha entra sem cascata — lista longa não precisa animar item a item. */
const MAX_STAGGERED_ROWS = 20;

type TabValue = "vendas" | "retiradas" | "pedidos";

const TABS: { value: TabValue; label: string }[] = [
  { value: "vendas", label: "Vendas" },
  { value: "retiradas", label: "Retiradas" },
  { value: "pedidos", label: "Pedidos" },
];

/**
 * Faixa de abas desta tela. O desenho (e o traço accent que desliza com
 * `layoutId`) mora no `NcTabsList` compartilhado desde que o Extrato do vendedor
 * passou a precisar das mesmas abas; aqui só se decide o que cada uma conta.
 */
function SalesTabs({ value, counts }: { value: TabValue; counts: Record<TabValue, number> }) {
  return <NcTabsList value={value} tabs={TABS.map(t => ({ ...t, count: counts[t.value] }))} />;
}

/**
 * Confirmar pedido: forma de pagamento + observação curta.
 *
 * Mesma peça que a `PaymentPicker` da tela do vendedor, no tema do ERP — as
 * duas portas de entrada de venda não podem divergir. A observação vai acima
 * porque o clique no método é o que confirma; fechar o popover apaga o que foi
 * digitado, para reabrir ser um recomeço.
 */
function ConfirmOrderPopover({
  children, disabled, onConfirm,
}: {
  children: ReactNode;
  disabled?: boolean;
  onConfirm: (method: PaymentMethodValue, notes: string) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");

  const change = (next: boolean) => {
    if (disabled) return;
    if (!next) setNote("");
    setOpen(next);
  };

  const pick = async (method: PaymentMethodValue) => {
    const typed = note.trim();
    setOpen(false);
    setNote("");
    await onConfirm(method, typed);
  };

  return (
    <Popover open={open} onOpenChange={change}>
      <PopoverTrigger asChild disabled={disabled}>{children}</PopoverTrigger>
      <PopoverContent align="end" className={cn(POPOVER_CLASS, "w-60 space-y-2.5 p-3")} style={POPOVER_STYLE}>
        <div className="space-y-1.5">
          <p className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>Observação (opcional)</p>
          <input
            value={note}
            onChange={e => setNote(e.target.value)}
            maxLength={ORDER_NOTE_MAX}
            placeholder="dia 20, fiado…"
            className="nc-input h-8 w-full px-2.5 text-xs"
          />
        </div>
        <div className="nc-rule-top space-y-1.5 pt-2.5">
          <p className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>Recebido agora</p>
          <div className="grid grid-cols-2 gap-1.5">
            {ORDER_PAYMENT_CHOICES.filter(c => c.paid).map(c => (
              <NcButton key={c.id} variant="quiet" onClick={() => pick(c.id)}>{c.label}</NcButton>
            ))}
          </div>
        </div>
        <div className="nc-rule-top space-y-1.5 pt-2.5">
          <p className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>Falta receber</p>
          <div className="grid gap-1">
            {ORDER_PAYMENT_CHOICES.filter(c => !c.paid).map(c => (
              <NcButton key={c.id} variant="ghost" className="justify-start" onClick={() => pick(c.id)}>{c.label}</NcButton>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Selo de situação da venda que TAMBÉM é o botão de dar baixa.
 *
 * Antes a baixa morava num "Marcar como recebido" que só existia no hover da
 * linha: invisível no toque (onde hover não existe) e escondido de quem não
 * passasse o mouse exatamente na linha certa. Agora o alvo é o selo que já
 * estava ali dizendo "Aberto" — no hover ele vira o selo "Pago", que é
 * exatamente o estado que o clique produz. O hover é a pré-visualização do
 * resultado, não um rótulo novo.
 *
 * Os dois rótulos ocupam a MESMA célula de grid, empilhados: a pílula nasce com
 * a largura do maior e não muda de tamanho ao trocar de texto. Mesma razão do
 * "Limpar" que fica sempre montado na barra de filtros.
 *
 * A forma de pagamento continua sendo perguntada: `payment_method` tem
 * vocabulário fechado e um valor chutado aqui apareceria como "—" na própria
 * coluna ao lado.
 */
function OpenStatusButton({ onConfirm }: { onConfirm: (method: "pix" | "dinheiro") => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const handle = async (method: "pix" | "dinheiro") => {
    if (saving) return;
    setSaving(true);
    try {
      await onConfirm(method);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Marcar como recebido"
          aria-label="Marcar venda como recebida"
          className="nc-pill nc-pill--open nc-pill--action group/paid"
        >
          <span className="grid">
            <span className="col-start-1 row-start-1 text-center transition-opacity group-hover/paid:opacity-0 group-data-[state=open]/paid:opacity-0">
              Aberto
            </span>
            <span className="col-start-1 row-start-1 text-center opacity-0 transition-opacity group-hover/paid:opacity-100 group-data-[state=open]/paid:opacity-100">
              Pago
            </span>
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className={cn(POPOVER_CLASS, "w-48 space-y-2 p-2.5")} style={POPOVER_STYLE}>
        <p className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>Recebido em</p>
        <div className="grid grid-cols-2 gap-1.5">
          <NcButton variant="quiet" disabled={saving} onClick={() => handle("pix")}>Pix</NcButton>
          <NcButton variant="quiet" disabled={saving} onClick={() => handle("dinheiro")}>Dinheiro</NcButton>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function PendingOrdersList({
  orders, loading, processingOrder, onConfirm, onDecline,
}: {
  orders: Order[];
  loading: boolean;
  processingOrder: string | null;
  onConfirm: (orderId: string, method: PaymentMethodValue, notes?: string) => void;
  onDecline: (orderId: string) => void;
}) {
  if (loading) {
    return (
      <div className="nc-card py-16 text-center text-[13px]" style={{ color: "var(--nc-text-3)" }}>
        Carregando pedidos…
      </div>
    );
  }
  if (orders.length === 0) {
    return (
      <div className="nc-card py-16 text-center text-[13px]" style={{ color: "var(--nc-text-3)" }}>
        Nenhum pedido pendente no momento.
      </div>
    );
  }
  return (
    <Stagger className="flex flex-col gap-3">
      <AnimatePresence initial={false}>
        {orders.map(order => (
          <motion.div
            key={order.id}
            layout
            variants={listItem}
            exit={{ opacity: 0, height: 0 }}
            transition={transitionBase}
            className="nc-card overflow-hidden"
          >
            <div className="flex flex-wrap items-start justify-between gap-3 px-4 pb-3 pt-3.5">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2 text-[14px]">
                  <span>{order.sellers?.name ?? "Sem vendedor"}</span>
                  <span style={{ color: "var(--nc-text-3)" }}>→</span>
                  <span>{order.customers?.name ?? "Sem cliente"}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[11px]" style={{ color: "var(--nc-text-3)" }}>
                  <span className="nc-num">{order.customers?.whatsapp ?? "—"}</span>
                  <span>·</span>
                  {/* A mesma referência que a loja manda na mensagem do
                      cliente e que vira o começo da nota da venda. */}
                  <span className="nc-num">{orderRef(order.id)}</span>
                  <span>·</span>
                  <span className="flex items-center gap-1"><Clock size={11} />{timeAgo(order.created_at)}</span>
                </div>
              </div>
              <div className="min-w-[100px] text-right">
                <p className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>Total</p>
                <p className="nc-num text-base font-semibold">{formatCurrency(order.total_amount)}</p>
              </div>
            </div>

            {order.freight_notes && (
              <div
                className="mx-4 mb-3 rounded-lg px-3 py-2 text-xs"
                style={{ background: "var(--nc-bg)", boxShadow: "inset 0 0 0 1px var(--nc-track)", color: "var(--nc-text-2)" }}
              >
                <span style={{ color: "var(--nc-text)" }}>Frete:</span> {order.freight_notes}
              </div>
            )}

            {/* Mesma tabela das outras telas migradas: cabeçalho em texto
                terciário e peso normal, sem faixa de fundo e sem caixa alta. */}
            <div className="overflow-x-auto px-3 pb-1 pt-1" style={{ borderTop: "1px solid var(--nc-track)" }}>
              <table className="w-full min-w-[380px] text-[13px]">
                <thead>
                  <tr style={{ color: "var(--nc-text-3)" }}>
                    <th className="px-2 py-1.5 text-left font-normal">Produto</th>
                    <th className="px-2 py-1.5 text-left font-normal">Sabor</th>
                    <th className="w-[50px] px-2 py-1.5 text-right font-normal">Qtd</th>
                    <th className="w-[90px] px-2 py-1.5 text-right font-normal">Unitário</th>
                  </tr>
                </thead>
                <tbody>
                  {order.order_items?.map(item => (
                    <tr key={item.id} className="nc-row">
                      <td className="px-2 py-1.5">{item.products ? `${item.products.brand} · ${item.products.name}` : "—"}</td>
                      <td className="px-2 py-1.5" style={{ color: "var(--nc-text-2)" }}>{item.products?.flavor ?? "—"}</td>
                      <td className="nc-num px-2 py-1.5 text-right">{item.quantity}</td>
                      <td className="nc-num px-2 py-1.5 text-right">{formatCurrency(item.unit_price)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-end gap-2 px-4 pb-3.5 pt-2.5">
              <NcButton
                variant="quiet"
                size="md"
                disabled={processingOrder === order.id}
                onClick={() => onDecline(order.id)}
              >
                <Ban size={13} />Recusar
              </NcButton>
              <ConfirmOrderPopover
                disabled={processingOrder === order.id}
                onConfirm={(method, notes) => onConfirm(order.id, method, notes)}
              >
                <NcButton variant="solid" size="md" disabled={processingOrder === order.id}>
                  <Check size={13} />Confirmar
                </NcButton>
              </ConfirmOrderPopover>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </Stagger>
  );
}

const emptyForm = { productId: "", quantity: "", unitPrice: "", date: todayDateString(), notes: "", installments: "1", paidAmount: "0", sellerId: "", type: "venda" as "venda" | "retirada_funcionario", paymentMethod: "pix" as PaymentMethodValue, paidDate: todayDateString() };

/**
 * O corpo do formulário e o botão que o envia moram em lugares diferentes: o
 * corpo rola, o rodapé fica preso no --nc-rail. O `form=` amarra os dois sem
 * precisar de estado nenhum — é o que permite o rodapé do painel ter o resumo à
 * esquerda e a ação à direita, como nas outras telas migradas.
 */
const SALE_FORM_ID = "sale-form";

export default function SalesPage() {
  const {
    products, sales, sellers, productAssignments, addSale, updateSale, deleteSale, getProductName, getSellerName,
  } = useStore();
  const confirm = useConfirm();

  // Pedidos do catálogo esperando decisão. O vendedor decide os dele na
  // SellerSalesPage, pelo MESMO hook: confirmar e recusar são uma regra só, em
  // um lugar só.
  const {
    pendingOrders,
    loadingOrders,
    processingOrder,
    confirmOrder: handleConfirmOrder,
    declineOrder: handleDeclineOrder,
  } = usePendingOrders();

  const [tab, setTab] = useState<TabValue>("vendas");
  const [open, setOpen] = useState(false);
  const [modalTab, setModalTab] = useState<"unica" | "lote">("unica");
  const [editingSale, setEditingSale] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);

  // Esta tela é só do admin — o vendedor tem a SellerSalesPage e não registra
  // venda —, então o vendedor da venda é sempre o escolhido no formulário.
  const effectiveSellerId = form.sellerId || null;

  const productMap = useMemo(() => new Map(products.map(p => [p.id, p])), [products]);

  const availableProducts = effectiveSellerId
    ? products.filter(p => {
        const assignment = productAssignments.find(a => a.productId === p.id && a.sellerId === effectiveSellerId);
        return assignment && assignment.quantity > 0;
      })
    : products.filter(p => p.stock > 0);

  const getAssignedQuantity = (productId: string) => {
    if (!effectiveSellerId) return null;
    const assignment = productAssignments.find(a => a.productId === productId && a.sellerId === effectiveSellerId);
    return assignment?.quantity ?? 0;
  };

  const selectedProduct = products.find(p => p.id === form.productId);

  // === Filtros (somente aba Vendas, admin) ===
  type PaymentStatus = "all" | "paid" | "partial" | "open";
  type SortKey = "date" | "total" | "remaining";
  const [fSeller, setFSeller] = useState<string>("all"); // all | none | <id>
  const [fStatus, setFStatus] = useState<PaymentStatus>("all");
  const [fProduct, setFProduct] = useState("");
  const [fPreset, setFPreset] = useState<DateRangePreset>(DEFAULT_PRESET);
  // Uma leitura só do relógio alimenta os dois campos. Com `currentMonthRange()`
  // chamado duas vezes, uma montagem em cima da virada da meia-noite do último
  // dia do mês devolve o "de" de um mês e o "até" de outro — e o helper existe
  // justamente para o estado inicial e o chip "Mês" produzirem o MESMO intervalo.
  const [defaultRange] = useState(currentMonthRange);
  const [fFrom, setFFrom] = useState(defaultRange.from);
  const [fTo, setFTo] = useState(defaultRange.to);
  const [fSortKey, setFSortKey] = useState<SortKey>("date");
  const [fSortDir, setFSortDir] = useState<"asc" | "desc">("desc");

  const applyPreset = (p: DateRangePreset) => {
    setFPreset(p);
    const now = new Date();
    if (p === "all") { setFFrom(""); setFTo(""); return; }
    if (p === "today") { const t = isoDay(now); setFFrom(t); setFTo(t); return; }
    if (p === "7d") { const past = new Date(now); past.setDate(past.getDate() - 6); setFFrom(isoDay(past)); setFTo(isoDay(now)); return; }
    if (p === "month") { const m = currentMonthRange(); setFFrom(m.from); setFTo(m.to); return; }
    if (p === "lastMonth") { setFFrom(isoDay(new Date(now.getFullYear(), now.getMonth() - 1, 1))); setFTo(isoDay(new Date(now.getFullYear(), now.getMonth(), 0))); return; }
  };

  const clearFilters = () => {
    setFSeller("all"); setFStatus("all"); setFProduct(""); setFSortKey("date"); setFSortDir("desc");
    applyPreset(DEFAULT_PRESET);
  };

  // O período só conta como filtro quando NÃO é o padrão da tela: senão o
  // "Limpar" nasceria aceso, oferecendo limpar o estado em que a tela abriu.
  const hasActiveFilters = fSeller !== "all" || fStatus !== "all" || fProduct !== "" || fPreset !== DEFAULT_PRESET || fSortKey !== "date" || fSortDir !== "desc";

  const periodLabel = PERIOD_OPTIONS.find(o => o.value === fPreset)?.label ?? "Intervalo personalizado";

  const getProductDisplayName = (productId: string) => {
    const product = productMap.get(productId);
    return product ? `${product.flavor} · ${product.model}` : getProductName(productId);
  };

  // === Recortes da lista ===
  const baseSales = useMemo(
    () => sales.filter(s => (s.type || "venda") !== "retirada_funcionario"),
    [sales],
  );

  const sortedRetiradas = useMemo(
    () => sales.filter(s => s.type === "retirada_funcionario").sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [sales],
  );

  const sortedSales = useMemo(() => {
    const fromTs = fFrom ? new Date(fFrom + "T00:00:00").getTime() : null;
    const toTs = fTo ? new Date(fTo + "T23:59:59").getTime() : null;
    const productQ = fProduct.trim().toLowerCase();

    const filtered = baseSales.filter(s => {
      if (fSeller === "none" && s.sellerId) return false;
      if (fSeller !== "all" && fSeller !== "none" && s.sellerId !== fSeller) return false;
      const ts = new Date(s.date).getTime();
      if (fromTs !== null && ts < fromTs) return false;
      if (toTs !== null && ts > toTs) return false;
      const remaining = Math.max(0, s.totalPrice - s.paidAmount);
      if (fStatus === "paid" && remaining > 0) return false;
      if (fStatus === "open" && s.paidAmount > 0) return false;
      if (fStatus === "partial" && (s.paidAmount === 0 || remaining === 0)) return false;
      if (productQ) {
        const p = productMap.get(s.productId);
        const name = (p ? `${p.flavor} · ${p.model}` : getProductName(s.productId)).toLowerCase();
        if (!name.includes(productQ)) return false;
      }
      return true;
    });

    const dirMul = fSortDir === "asc" ? 1 : -1;
    return filtered.sort((a, b) => {
      if (fSortKey === "date") return (new Date(a.date).getTime() - new Date(b.date).getTime()) * dirMul;
      if (fSortKey === "total") return (a.totalPrice - b.totalPrice) * dirMul;
      const ra = Math.max(0, a.totalPrice - a.paidAmount);
      const rb = Math.max(0, b.totalPrice - b.paidAmount);
      return (ra - rb) * dirMul;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseSales, productMap, fSeller, fStatus, fProduct, fFrom, fTo, fSortKey, fSortDir]);

  // === Números do trilho ===
  const totals = useMemo(() => {
    let revenue = 0, paid = 0, units = 0;
    sortedSales.forEach(s => { revenue += s.totalPrice; paid += s.paidAmount; units += s.quantity; });
    return {
      revenue,
      paid,
      open: Math.max(0, revenue - paid),
      units,
      count: sortedSales.length,
      ticket: sortedSales.length > 0 ? revenue / sortedSales.length : 0,
      paidPct: revenue > 0 ? (paid / revenue) * 100 : 0,
    };
  }, [sortedSales]);

  /** Modelos que mais faturam no recorte atual, do maior para o menor. */
  const topModels = useMemo(() => {
    const map = new Map<string, { key: string; brand: string; model: string; units: number; revenue: number }>();
    sortedSales.forEach(s => {
      const p = productMap.get(s.productId);
      const brand = (p?.brand || "").trim() || "Sem marca";
      const model = (p?.model || "").trim() || "Sem modelo";
      const key = `${brand}|${model}`;
      const cur = map.get(key);
      if (cur) {
        cur.units += s.quantity;
        cur.revenue += s.totalPrice;
      } else {
        map.set(key, { key, brand, model, units: s.quantity, revenue: s.totalPrice });
      }
    });
    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
  }, [sortedSales, productMap]);

  const retiradaStats = useMemo(() => {
    let value = 0, units = 0;
    const bySeller = new Map<string, { key: string; name: string; value: number; units: number }>();
    sortedRetiradas.forEach(s => {
      value += s.totalPrice;
      units += s.quantity;
      const key = s.sellerId ?? "sem";
      const cur = bySeller.get(key);
      if (cur) {
        cur.value += s.totalPrice;
        cur.units += s.quantity;
      } else {
        bySeller.set(key, {
          key,
          name: s.sellerId ? getSellerName(s.sellerId) : "Sem funcionário",
          value: s.totalPrice,
          units: s.quantity,
        });
      }
    });
    return {
      value,
      units,
      count: sortedRetiradas.length,
      last: sortedRetiradas[0]?.date ?? null,
      bySeller: Array.from(bySeller.values()).sort((a, b) => b.value - a.value),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortedRetiradas]);

  const orderStats = useMemo(() => {
    let value = 0, units = 0;
    const bySeller = new Map<string, { key: string; name: string; count: number; value: number }>();
    pendingOrders.forEach(o => {
      value += o.total_amount;
      units += (o.order_items ?? []).reduce((sum, i) => sum + i.quantity, 0);
      const key = o.seller_id ?? "sem";
      const cur = bySeller.get(key);
      if (cur) {
        cur.count += 1;
        cur.value += o.total_amount;
      } else {
        bySeller.set(key, { key, name: o.sellers?.name ?? "Sem vendedor", count: 1, value: o.total_amount });
      }
    });
    const oldest = pendingOrders.reduce<string | null>((acc, o) => (!acc || o.created_at < acc ? o.created_at : acc), null);
    return { value, units, count: pendingOrders.length, oldest, bySeller: Array.from(bySeller.values()).sort((a, b) => b.value - a.value) };
  }, [pendingOrders]);

  const openNew = () => {
    setEditingSale(null);
    setForm(emptyForm);
    setOpen(true);
  };

  const openEdit = (s: typeof sales[number]) => {
    setEditingSale(s.id);
    setForm({
      productId: s.productId,
      quantity: String(s.quantity),
      unitPrice: String(s.unitPrice),
      date: s.date?.split("T")[0] || todayDateString(),
      notes: s.notes || "",
      installments: String(s.installments || 1),
      paidAmount: String(s.paidAmount || 0),
      sellerId: s.sellerId || "",
      type: s.type || "venda",
      paymentMethod: s.paymentMethod || "pix",
      paidDate: (s.paidAt || s.date)?.split("T")[0] || todayDateString(),
    });
    setOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (!form.productId || !form.quantity) return;

    // Retirada exige vendedor
    if (form.type === "retirada_funcionario" && !form.sellerId) {
      alert("Selecione o funcionário para a retirada.");
      return;
    }

    setSubmitting(true);
    try {
      const totalPriceForm = Number(form.quantity) * Number(form.unitPrice);
      const fullyPaid = form.type === "venda" && (Number(form.paidAmount) || 0) >= totalPriceForm - 0.01;
      const paidAtISO = fullyPaid ? localDateToISO(form.paidDate || form.date) : undefined;
      if (editingSale) {
        await updateSale(editingSale, {
          quantity: Number(form.quantity),
          unitPrice: Number(form.unitPrice) || 0,
          totalPrice: totalPriceForm,
          date: localDateToISO(form.date),
          notes: form.notes || undefined,
          installments: Number(form.installments) || 1,
          paidAmount: form.type === "retirada_funcionario" ? 0 : (Number(form.paidAmount) || 0),
          paidAt: paidAtISO,
          sellerId: form.sellerId || undefined,
          type: form.type,
          paymentMethod: form.type === "venda" ? form.paymentMethod : undefined,
        });
      } else {
        await addSale({
          productId: form.productId,
          quantity: Number(form.quantity),
          unitPrice: Number(form.unitPrice) || 0,
          date: localDateToISO(form.date),
          notes: form.notes || undefined,
          installments: Number(form.installments) || 1,
          paidAmount: form.type === "retirada_funcionario" ? 0 : (Number(form.paidAmount) || 0),
          paidAt: paidAtISO,
          sellerId: form.sellerId || undefined,
          type: form.type,
          paymentMethod: form.type === "venda" ? form.paymentMethod : undefined,
        });
      }
      setForm(emptyForm);
      setEditingSale(null);
      setOpen(false);
    } catch {
      // erro já reportado via toast pelo store; mantém o painel aberto para correção
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (await confirm({ title: "Excluir venda", description: "Tem certeza que deseja excluir esta venda? O estoque será restaurado." })) {
      deleteSale(id);
    }
  };

  const isRetirada = form.type === "retirada_funcionario";
  const formTotal = (Number(form.quantity) || 0) * (Number(form.unitPrice) || 0);
  const formPaid = Number(form.paidAmount) || 0;
  const formRemaining = Math.max(0, formTotal - formPaid);

  const saleForm = (
    <form id={SALE_FORM_ID} onSubmit={handleSubmit} className="space-y-5">
      <section className="space-y-3">
        <p className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>Tipo de registro</p>
        <SegmentedToggle
          value={form.type}
          onChange={(v) => setForm(f => ({ ...f, type: v }))}
          options={[
            { id: "venda" as const, label: "Venda" },
            { id: "retirada_funcionario" as const, label: "Retirada de funcionário" },
          ]}
        />
        {isRetirada && (
          <div
            className="flex items-start gap-2 rounded-lg px-3 py-2 text-xs"
            style={{ background: "color-mix(in srgb, var(--nc-alert) 10%, transparent)", color: "var(--nc-alert)" }}
          >
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <span>Não entra no faturamento. Vai para o saldo devedor do funcionário.</span>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <p className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>O que saiu</p>
        <div className="space-y-1.5">
          <Label className="text-xs">Funcionário {isRetirada && <span style={{ color: "var(--nc-crit)" }}>*</span>}</Label>
          <Select value={form.sellerId} onValueChange={v => setForm(f => ({ ...f, sellerId: v, productId: "" }))} disabled={!!editingSale}>
            <SelectTrigger><SelectValue placeholder={isRetirada ? "Obrigatório" : "Selecione o vendedor"} /></SelectTrigger>
            <SelectContent className="nocturne">
              {sellers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
          {!form.sellerId && !editingSale && (
            <p className="text-[11px]" style={{ color: "var(--nc-text-3)" }}>
              Selecione um vendedor para ver os produtos atribuídos a ele.
            </p>
          )}
        </div>

        <motion.div
          key={!form.sellerId ? "produto-off" : "produto-on"}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          className="space-y-1.5"
        >
          <Label className="text-xs">Produto</Label>
          <Select
            value={form.productId}
            onValueChange={v => {
              const prod = products.find(p => p.id === v);
              setForm(f => ({ ...f, productId: v, unitPrice: prod?.salePrice?.toString() || f.unitPrice }));
            }}
            disabled={!!editingSale || !form.sellerId}
          >
            <SelectTrigger><SelectValue placeholder={!form.sellerId ? "Selecione o vendedor primeiro" : "Selecione"} /></SelectTrigger>
            <SelectContent className="nocturne">
              {availableProducts.length === 0 && (
                <div className="px-2 py-1.5 text-xs" style={{ color: "var(--nc-text-3)" }}>
                  {effectiveSellerId ? "Nenhum produto atribuído a este vendedor." : "Nenhum produto disponível."}
                </div>
              )}
              {availableProducts.map(p => {
                const assignedQty = getAssignedQuantity(p.id);
                const displayStock = assignedQty !== null ? assignedQty : p.stock;
                return <SelectItem key={p.id} value={p.id}>{getProductDisplayName(p.id)} ({displayStock} disponível)</SelectItem>;
              })}
            </SelectContent>
          </Select>
          {selectedProduct && !editingSale && (
            <p className="text-[11px]" style={{ color: "var(--nc-text-3)" }}>
              Disponível:{" "}
              <span className="nc-num" style={{ color: "var(--nc-text)" }}>
                {effectiveSellerId ? getAssignedQuantity(selectedProduct.id) : selectedProduct.stock}
              </span>
            </p>
          )}
        </motion.div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Quantidade</Label>
            <Input type="number" value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} className="nc-num" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Preço unitário (R$)</Label>
            <Input type="number" step="0.01" value={form.unitPrice} onChange={e => setForm(f => ({ ...f, unitPrice: e.target.value }))} className="nc-num" />
          </div>
        </div>
      </section>

      {!isRetirada && (
        <section className="space-y-3">
          <p className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>Pagamento</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Parcelas</Label>
              <Input type="number" min="1" value={form.installments} onChange={e => setForm(f => ({ ...f, installments: e.target.value }))} className="nc-num" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Valor recebido (R$)</Label>
              <Input type="number" step="0.01" value={form.paidAmount} onChange={e => setForm(f => ({ ...f, paidAmount: e.target.value }))} className="nc-num" />
            </div>
          </div>

          {(() => {
            const isPending = formTotal > 0 ? formPaid < formTotal - 0.01 : false;
            const sellerName = form.sellerId ? getSellerName(form.sellerId) : "";
            const paidOpts: { id: PaymentMethodValue; label: string; disabled?: boolean }[] = [
              { id: "pix", label: "Pix" },
              { id: "dinheiro", label: "Dinheiro" },
            ];
            const pendingOpts: { id: PaymentMethodValue; label: string; disabled?: boolean }[] = [
              { id: "pix_pendente", label: "Falta receber Pix" },
              { id: "dinheiro_pendente", label: "Falta receber Dinheiro" },
              { id: "dinheiro_com_vendedor", label: sellerName ? `Dinheiro com ${sellerName}` : "Dinheiro com vendedor", disabled: !sellerName },
              { id: "pendente", label: "Falta receber (a definir)" },
            ];
            const opts = isPending ? pendingOpts : paidOpts;
            const currentValid = opts.some(o => o.id === form.paymentMethod && !o.disabled);
            if (!currentValid) {
              const fallback = opts.find(o => !o.disabled)?.id ?? "pix";
              if (form.paymentMethod !== fallback) {
                setTimeout(() => setForm(f => ({ ...f, paymentMethod: fallback })), 0);
              }
            }
            return (
              <div className="space-y-1.5">
                <Label className="text-xs">Forma de pagamento</Label>
                <SegmentedToggle
                  value={form.paymentMethod}
                  onChange={(v) => setForm(f => ({ ...f, paymentMethod: v }))}
                  align="left"
                  options={opts.map(o => ({
                    id: o.id,
                    label: o.label,
                    disabled: o.disabled,
                    title: o.disabled ? "Selecione um vendedor para usar esta opção" : undefined,
                  }))}
                />
              </div>
            );
          })()}

          {formTotal > 0 && formPaid >= formTotal - 0.01 && (
            <div className="space-y-1.5">
              <Label className="text-xs">Data do recebimento</Label>
              <Input type="date" value={form.paidDate} onChange={e => setForm(f => ({ ...f, paidDate: e.target.value }))} />
              <p className="text-[11px]" style={{ color: "var(--nc-text-3)" }}>
                A comissão entra no mês em que o valor foi recebido.
              </p>
            </div>
          )}
        </section>
      )}

      <section className="space-y-3">
        <p className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>Registro</p>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Data</Label>
            <Input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Observações</Label>
            <Input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Opcional" />
          </div>
        </div>
      </section>

      {formTotal > 0 && (
        <div className="space-y-1 rounded-lg p-3 text-xs" style={{ background: "var(--nc-bg)", boxShadow: "inset 0 0 0 1px var(--nc-track)" }}>
          <div className="flex justify-between">
            <span style={{ color: "var(--nc-text-2)" }}>Total</span>
            <AnimatedNumber className="nc-num" value={formTotal} format={formatCurrency} duration={0.25} />
          </div>
          {!isRetirada && Number(form.installments) > 1 && (
            <div className="flex justify-between">
              <span style={{ color: "var(--nc-text-2)" }}>Valor por parcela</span>
              <span className="nc-num">{formatCurrency(formTotal / Number(form.installments))}</span>
            </div>
          )}
          <div className="nc-rule-top flex justify-between pt-1.5">
            {isRetirada ? (
              <>
                <span style={{ color: "var(--nc-text-2)" }}>Saldo devedor do funcionário</span>
                <span className="nc-num" style={{ color: "var(--nc-alert)" }}>{formatCurrency(formTotal)}</span>
              </>
            ) : (
              <>
                <span style={{ color: "var(--nc-text-2)" }}>Falta receber</span>
                <span className="nc-num" style={{ color: formRemaining > 0 ? "var(--nc-alert)" : "var(--nc-ok)" }}>
                  {formatCurrency(formRemaining)}
                </span>
              </>
            )}
          </div>
        </div>
      )}
    </form>
  );

  // === Linha da tabela, compartilhada por Vendas e Retiradas ===
  const renderRow = (s: typeof sales[number], rowIndex = 0) => {
    const remaining = Math.max(0, s.totalPrice - s.paidAmount);
    const isRet = s.type === "retirada_funcionario";
    const sellerName = s.sellerId ? getSellerName(s.sellerId) : "Sem funcionário";
    const label = getProductDisplayName(s.productId);

    return (
      <motion.tr
        key={s.id}
        layout
        variants={rowIndex < MAX_STAGGERED_ROWS ? listItem : undefined}
        exit={{ opacity: 0 }}
        transition={transitionBase}
        className="nc-row nc-hover group"
      >
        <td className="px-3 py-2.5">
          <div className="truncate text-[13px]">{label}</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px]" style={{ color: "var(--nc-text-3)" }}>
            <span>{sellerName}</span>
            <span>·</span>
            <span className="nc-num">{formatDateBR(s.date)}</span>
            {s.notes && (<><span>·</span><span className="max-w-[140px] truncate" title={s.notes}>{s.notes}</span></>)}
          </div>
        </td>
        <td className="nc-num px-3 py-2.5 text-right" style={{ color: "var(--nc-text-2)" }}>{s.quantity}</td>
        <td className="nc-num px-3 py-2.5 text-right" style={isRet ? { color: "var(--nc-alert)" } : undefined}>
          {formatCurrency(s.totalPrice)}
        </td>
        {!isRet && (
          <td className="px-3 py-2.5 text-center">
            {(() => {
              if (!s.paymentMethod) return <span className="text-[11px]" style={{ color: "var(--nc-text-3)" }}>—</span>;
              const map: Record<string, { label: string; tone: string }> = {
                pix: { label: "Pix", tone: "nc-pill--paid" },
                dinheiro: { label: "Dinheiro", tone: "nc-pill--paid" },
                pix_pendente: { label: "Falta Pix", tone: "nc-pill--partial" },
                dinheiro_pendente: { label: "Falta Dinheiro", tone: "nc-pill--partial" },
                dinheiro_com_vendedor: { label: `Dinheiro c/ ${s.sellerId ? getSellerName(s.sellerId) : "vendedor"}`, tone: "nc-pill--partial" },
                pendente: { label: "Falta receber", tone: "nc-pill--mute" },
              };
              // Valor fora do vocabulário fechado aparece CRU, não como "—":
              // "—" já é o estado de venda sem forma de pagamento, e os dois
              // juntos escondiam o `combinado` que o confirm_order gravava.
              const info = map[s.paymentMethod] ?? { label: s.paymentMethod, tone: "nc-pill--mute" };
              return <span className={cn("nc-pill", info.tone)}>{info.label}</span>;
            })()}
          </td>
        )}
        {!isRet && (
          <td className="nc-num px-3 py-2.5 text-right">
            {/* Verde é o dinheiro que já entrou; laranja é o que falta. A coluna
                inteira responde uma pergunta só ("quanto desta venda está na
                mão?"), e a cor responde antes de a pessoa ler o número. */}
            {remaining > 0
              ? <span style={{ color: "var(--nc-alert)" }}>{formatCurrency(remaining)}</span>
              : <span style={{ color: "var(--nc-ok)" }}>{formatCurrency(s.paidAmount)}</span>}
          </td>
        )}
        {!isRet && (
          <td className="px-3 py-2.5">
            {remaining === 0 ? (
              <span className="nc-pill nc-pill--paid">Pago</span>
            ) : s.paidAmount > 0 ? (
              <span className="nc-pill nc-pill--partial">Parcial</span>
            ) : (
              // Totalmente em aberto: aqui o selo também é o botão que dá baixa.
              <OpenStatusButton
                onConfirm={async (method) => {
                  await updateSale(s.id, {
                    paidAmount: s.totalPrice,
                    paymentMethod: method,
                    paidAt: new Date().toISOString(),
                  });
                }}
              />
            )}
          </td>
        )}
        <td className="px-3 py-2">
          {/* No desktop a ação só aparece no hover da linha; no toque não há
              hover, então fica sempre visível abaixo de sm. */}
          <div className="flex items-center justify-end gap-0.5 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
            <NcButton variant="ghost" size="icon" aria-label={`Editar ${label}`} onClick={() => openEdit(s)}>
              <Pencil size={13} />
            </NcButton>
            <NcButton variant="danger" size="icon" aria-label={`Excluir ${label}`} onClick={() => handleDelete(s.id)}>
              <Trash2 size={13} />
            </NcButton>
          </div>
        </td>
      </motion.tr>
    );
  };

  const headerEyebrow = tab === "vendas" ? periodLabel : tab === "retiradas" ? "Saldo devedor de funcionário" : "Pedidos do catálogo";

  return (
    // `/sales` está em `fullBleedRoutes` (AppLayout): chega sem padding e sem
    // max-width, e é a tela que cuida do próprio espaçamento. Mesmo esqueleto do
    // Dashboard, do Produtos, da Entrada e das Perdas — coluna principal + trilho.
    <div className="nocturne flex flex-1 flex-col xl:flex-row xl:items-stretch">
      {/* ---------------- Coluna principal ----------------
          O `Tabs` do Radix é a própria coluna: o trilho fica FORA dele, porque
          o resumo não é conteúdo de aba nenhuma — ele acompanha a aba ativa,
          mas por leitura do estado, não por montagem. */}
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as TabValue)}
        className="flex min-w-0 flex-1 flex-col gap-4 p-4 md:p-6"
      >
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className={EYEBROW} style={{ color: "var(--nc-accent)" }}>{headerEyebrow}</span>
            <h1 className="mt-1 text-xl sm:text-[22px]">Vendas</h1>
          </div>

          <Sheet open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditingSale(null); }}>
            <SheetTrigger asChild>
              <NcButton onClick={openNew} variant="solid" size="md"><Plus size={14} />Nova venda</NcButton>
            </SheetTrigger>
            {/* `nocturne` repetido aqui pelo mesmo motivo do SheetContent da loja:
                o Radix porta o painel para o <body> e os tokens não chegam por
                herança. */}
            <SheetContent side="right" className="nocturne flex w-full flex-col p-0 sm:max-w-xl">
              <NcSheetHeader
                eyebrow="Vendas"
                title={editingSale ? "Editar registro" : "Novo registro"}
                description={editingSale ? "Ajuste os dados do registro." : "Registre uma venda/retirada ou várias de uma vez."}
              />

              <div className="flex-1 overflow-y-auto px-5 py-5">
                {editingSale ? saleForm : (
                  <div className="space-y-5">
                    <SegmentedToggle
                      value={modalTab}
                      onChange={(v) => setModalTab(v)}
                      options={[
                        { id: "unica" as const, label: "Registro único" },
                        { id: "lote" as const, label: "Em lote" },
                      ]}
                    />
                    {modalTab === "unica" ? saleForm : <BatchSaleForm onDone={() => setOpen(false)} />}
                  </div>
                )}
              </div>

              {/* O lote traz o próprio botão (o rótulo dele conta as linhas
                  válidas), então o rodapé é só do registro único. */}
              {(editingSale || modalTab === "unica") && (
                <SheetFooter className="px-5 py-3" style={{ borderTop: "1px solid var(--nc-track)", background: "var(--nc-rail)" }}>
                  <div className="flex w-full items-center justify-between gap-3">
                    <p className="text-[11px]" style={{ color: "var(--nc-text-2)" }}>
                      {formTotal > 0 ? (
                        isRetirada
                          ? <>Vai para o saldo devedor <span className="nc-num font-medium" style={{ color: "var(--nc-alert)" }}>{formatCurrency(formTotal)}</span></>
                          : <>Total <span className="nc-num font-medium" style={{ color: "var(--nc-text)" }}>{formatCurrency(formTotal)}</span> · falta <span className="nc-num font-medium" style={{ color: formRemaining > 0 ? "var(--nc-alert)" : "var(--nc-ok)" }}>{formatCurrency(formRemaining)}</span></>
                      ) : "Escolha o produto e a quantidade"}
                    </p>
                    <NcButton
                      type="submit"
                      form={SALE_FORM_ID}
                      variant="solid"
                      size="md"
                      disabled={submitting || !form.productId || !form.quantity}
                    >
                      {submitting ? "Salvando…" : editingSale ? "Salvar alterações" : isRetirada ? "Registrar retirada" : "Registrar venda"}
                    </NcButton>
                  </div>
                </SheetFooter>
              )}
            </SheetContent>
          </Sheet>
        </header>

        <SalesTabs
          value={tab}
          counts={{ vendas: baseSales.length, retiradas: sortedRetiradas.length, pedidos: pendingOrders.length }}
        />

        {/* ---------------- Vendas ---------------- */}
        <TabsContent value="vendas" className="mt-0 flex flex-col gap-4">
          <div className="nc-card flex flex-col gap-2 px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[180px] flex-1">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: "var(--nc-text-3)" }} />
                <input
                  type="text"
                  placeholder="Buscar produto…"
                  value={fProduct}
                  onChange={e => setFProduct(e.target.value)}
                  aria-label="Buscar venda por produto"
                  className="nc-input h-8 w-full pl-8 pr-2.5 text-[12.5px]"
                />
              </div>
              <Select value={fSeller} onValueChange={setFSeller}>
                <SelectTrigger className="h-8 w-auto min-w-[130px] text-[12.5px]"><SelectValue placeholder="Funcionário" /></SelectTrigger>
                <SelectContent className="nocturne">
                  <SelectItem value="all">Todos funcionários</SelectItem>
                  <SelectItem value="none">Sem funcionário</SelectItem>
                  {sellers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={fStatus} onValueChange={(v) => setFStatus(v as PaymentStatus)}>
                <SelectTrigger className="h-8 w-auto min-w-[110px] text-[12.5px]"><SelectValue /></SelectTrigger>
                <SelectContent className="nocturne">
                  <SelectItem value="all">Todos status</SelectItem>
                  <SelectItem value="paid">Pagas</SelectItem>
                  <SelectItem value="partial">Parcial</SelectItem>
                  <SelectItem value="open">Em aberto</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex items-center gap-1">
                <Select value={fSortKey} onValueChange={(v) => setFSortKey(v as SortKey)}>
                  <SelectTrigger className="h-8 w-auto min-w-[100px] text-[12.5px]"><SelectValue /></SelectTrigger>
                  <SelectContent className="nocturne">
                    <SelectItem value="date">Data</SelectItem>
                    <SelectItem value="total">Valor</SelectItem>
                    <SelectItem value="remaining">Falta</SelectItem>
                  </SelectContent>
                </Select>
                <NcButton
                  variant="ghost"
                  size="icon"
                  aria-label={fSortDir === "asc" ? "Ordenar do maior para o menor" : "Ordenar do menor para o maior"}
                  onClick={() => setFSortDir(d => d === "asc" ? "desc" : "asc")}
                >
                  <ArrowUpDown size={13} className={cn("transition-transform", fSortDir === "asc" && "rotate-180")} />
                </NcButton>
              </div>
              {/* O "Limpar" fica SEMPRE na linha e só some da vista quando não há
                  filtro: montar e desmontar ele mudava a largura de todo mundo a
                  cada clique, porque a busca é `flex-1` e engolia (ou devolvia) o
                  espaço dele. Mesma regra da tela de Entrada. */}
              <NcButton
                variant="ghost"
                onClick={clearFilters}
                disabled={!hasActiveFilters}
                className={cn("ml-auto flex-none", !hasActiveFilters && "invisible")}
              >
                <X size={13} />Limpar
              </NcButton>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <SegmentedChips options={PERIOD_OPTIONS} value={fPreset} onChange={v => applyPreset(v as DateRangePreset)} />
              <div className="flex items-center gap-1.5">
                <input
                  type="date"
                  value={fFrom}
                  onChange={e => { setFFrom(e.target.value); setFPreset("custom"); }}
                  aria-label="Data inicial"
                  className="nc-input nc-num h-8 w-[132px] px-2 text-[12px]"
                />
                <span className="text-xs" style={{ color: "var(--nc-text-3)" }}>–</span>
                <input
                  type="date"
                  value={fTo}
                  onChange={e => { setFTo(e.target.value); setFPreset("custom"); }}
                  aria-label="Data final"
                  className="nc-input nc-num h-8 w-[132px] px-2 text-[12px]"
                />
              </div>
            </div>
          </div>

          {sortedSales.length === 0 ? (
            <div className="nc-card py-16 text-center text-[13px]" style={{ color: "var(--nc-text-3)" }}>
              {baseSales.length === 0
                ? "Nenhuma venda registrada."
                : fProduct.trim()
                  ? `Nenhuma venda encontrada para “${fProduct.trim()}”.`
                  : "Nenhuma venda encontrada com os filtros aplicados."}
            </div>
          ) : (
            <div className="nc-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-[13px]">
                  <thead>
                    <tr style={{ color: "var(--nc-text-3)" }}>
                      <th className="px-3 py-2 text-left font-normal">Produto</th>
                      <th className="w-[50px] px-3 py-2 text-right font-normal">Qtd</th>
                      <th className="w-[100px] px-3 py-2 text-right font-normal">Total</th>
                      <th className="w-[120px] px-3 py-2 text-center font-normal">Pagamento</th>
                      <th className="w-[110px] px-3 py-2 text-right font-normal">Valor</th>
                      <th className="w-[80px] px-3 py-2 text-left font-normal">Situação</th>
                      <th className="w-[70px] px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    <AnimatePresence initial={false}>{sortedSales.map(renderRow)}</AnimatePresence>
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </TabsContent>

        {/* ---------------- Retiradas ---------------- */}
        <TabsContent value="retiradas" className="mt-0">
          {sortedRetiradas.length === 0 ? (
            <div className="nc-card py-16 text-center text-[13px]" style={{ color: "var(--nc-text-3)" }}>
              Nenhuma retirada registrada.
            </div>
          ) : (
            <div className="nc-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[440px] text-[13px]">
                  <thead>
                    <tr style={{ color: "var(--nc-text-3)" }}>
                      <th className="px-3 py-2 text-left font-normal">Produto</th>
                      <th className="w-[60px] px-3 py-2 text-right font-normal">Qtd</th>
                      <th className="w-[140px] px-3 py-2 text-right font-normal">Valor</th>
                      <th className="w-[80px] px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    <AnimatePresence initial={false}>{sortedRetiradas.map(renderRow)}</AnimatePresence>
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </TabsContent>

        {/* ---------------- Pedidos pendentes ---------------- */}
        <TabsContent value="pedidos" className="mt-0">
          <PendingOrdersList
            orders={pendingOrders}
            loading={loadingOrders}
            processingOrder={processingOrder}
            onConfirm={handleConfirmOrder}
            onDecline={handleDeclineOrder}
          />
        </TabsContent>
      </Tabs>

      {/* ---------------- Coluna direita: o dinheiro da aba ----------------
          O trilho acompanha a aba: cada uma tem UM número grande, e ele é o
          número daquela lista. Um resumo de vendas parado ao lado dos pedidos
          pendentes falaria de outra coisa que não a tela na frente.

          No celular ele vem ANTES da lista (`order-first`), como nas outras
          telas migradas: a lista rola por telas e um resumo embaixo dela não
          seria lido. */}
      <aside
        className="order-first flex w-full flex-none flex-col gap-3.5 p-4 md:p-6 xl:order-none xl:w-[312px]"
        style={{ background: "var(--nc-rail)" }}
      >
        {tab === "vendas" && (
          <>
            <span className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>Vendas no filtro</span>

            <div>
              <span className="text-[11.5px]" style={{ color: "var(--nc-text-2)" }}>Receita</span>
              <div className="flex flex-wrap items-baseline gap-2">
                <AnimatedNumber
                  value={totals.revenue}
                  format={formatCurrencyShort}
                  duration={0.7}
                  animateOnMount
                  className="nc-num text-[30px] font-semibold tracking-[-0.025em]"
                />
              </div>
              {/* Divisão REAL do total, como no Dashboard: cada real vendido está
                  de um lado ou do outro da barra. Aqui os dois lados são as duas
                  cores da coluna "Valor" da tabela — verde entrou, laranja falta
                  —, então o trilho e a lista contam a mesma história. */}
              <div className="mt-2 flex h-[5px] gap-0.5">
                <div style={{ flex: Math.max(totals.paid, 0.001), background: "var(--nc-ok)", borderRadius: 2 }} />
                <div style={{ flex: Math.max(totals.open, 0.001), background: "var(--nc-alert)", borderRadius: 2 }} />
              </div>
              <div className="nc-num mt-1.5 flex justify-between gap-2 text-[11px]">
                <span style={{ color: "var(--nc-ok)" }}>recebido {formatCurrencyShort(totals.paid)}</span>
                <span style={{ color: "var(--nc-alert)" }}>a receber {formatCurrencyShort(totals.open)}</span>
              </div>
              <p className="nc-num mt-1.5 text-[11px]" style={{ color: "var(--nc-text-2)" }}>
                {totals.count} venda{totals.count === 1 ? "" : "s"} · {totals.units} un.
              </p>
            </div>

            <Rule />

            <div className="flex flex-col gap-2.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[12.5px]" style={{ color: "var(--nc-text-2)" }}>Unidades vendidas</span>
                <span className="nc-num text-sm">{totals.units}</span>
              </div>
              <div className="nc-rule-top flex items-baseline justify-between gap-2 pt-2.5">
                <span className="text-[12.5px]">Ticket médio</span>
                <AnimatedNumber
                  value={totals.ticket}
                  format={formatCurrency}
                  duration={0.7}
                  animateOnMount
                  className="nc-num text-xl font-semibold"
                />
              </div>
              <div className="nc-num flex items-baseline justify-between gap-2 text-[11.5px]" style={{ color: "var(--nc-text-3)" }}>
                <span>da receita já recebida</span>
                <span>{totals.paidPct.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</span>
              </div>
            </div>

            <Rule />

            {/* Pedido pendente é venda que ainda não aconteceu: sai no alerta,
                fora dos números acima, e a aba ao lado é onde ele se decide. */}
            <div>
              <div className="mb-1.5 flex items-center gap-1.5">
                <Clock size={12} style={{ color: "var(--nc-alert)" }} />
                <span className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>Esperando decisão</span>
              </div>
              {orderStats.count === 0 ? (
                <p className="py-2 text-xs" style={{ color: "var(--nc-text-3)" }}>Nenhum pedido do catálogo pendente.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[12.5px]" style={{ color: "var(--nc-text-2)" }}>
                      {orderStats.count} pedido{orderStats.count === 1 ? "" : "s"} · {orderStats.units} un.
                    </span>
                    <span className="nc-num text-base font-semibold" style={{ color: "var(--nc-alert)" }}>
                      {formatCurrencyShort(orderStats.value)}
                    </span>
                  </div>
                  <p className="text-[11px]" style={{ color: "var(--nc-text-3)" }}>
                    Não entra nos números acima: ainda não virou venda.
                  </p>
                </div>
              )}
            </div>

            <Rule />

            <div>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>Modelos que mais vendem</span>
                <span className="nc-num text-[10.5px]" style={{ color: "var(--nc-text-3)" }}>
                  {topModels.length} no filtro
                </span>
              </div>
              {topModels.length === 0 ? (
                <p className="py-4 text-center text-xs" style={{ color: "var(--nc-text-3)" }}>
                  Nenhuma venda no filtro.
                </p>
              ) : (
                <Stagger className="flex flex-col">
                  {topModels.slice(0, MAX_TOP_ROWS).map(m => (
                    <motion.div key={m.key} variants={listItem} className="nc-row flex items-center justify-between gap-2 py-1.5 text-xs">
                      <span className="min-w-0 flex-1 truncate">
                        {m.model}
                        <span style={{ color: "var(--nc-text-3)" }}> · {m.brand}</span>
                      </span>
                      <span className="nc-num flex-none">
                        {formatCurrencyShort(m.revenue)}
                        <span style={{ color: "var(--nc-text-3)" }}> · {m.units} un.</span>
                      </span>
                    </motion.div>
                  ))}
                  {topModels.length > MAX_TOP_ROWS && (
                    <p className="pt-2 text-[11px]" style={{ color: "var(--nc-text-3)" }}>
                      + {topModels.length - MAX_TOP_ROWS} outros modelos
                    </p>
                  )}
                </Stagger>
              )}
            </div>
          </>
        )}

        {tab === "retiradas" && (
          <>
            <span className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>Retiradas de funcionário</span>

            <div>
              <span className="text-[11.5px]" style={{ color: "var(--nc-text-2)" }}>Valor retirado</span>
              <div className="flex flex-wrap items-baseline gap-2">
                {/* Retirada não é receita: nasce no alerta, o tom do que ainda
                    precisa de acerto. Aqui não há barra de propósito — não
                    existe divisão real desse total para mostrar, e uma barra
                    inventada mentiria (mesma decisão da tela de Entrada). */}
                <span style={{ color: "var(--nc-alert)" }}>
                  <AnimatedNumber
                    value={retiradaStats.value}
                    format={formatCurrencyShort}
                    duration={0.7}
                    animateOnMount
                    className="nc-num text-[30px] font-semibold tracking-[-0.025em]"
                  />
                </span>
              </div>
              <p className="nc-num mt-1.5 text-[11px]" style={{ color: "var(--nc-text-2)" }}>
                {retiradaStats.count} retirada{retiradaStats.count === 1 ? "" : "s"} · {retiradaStats.units} un.
              </p>
            </div>

            <Rule />

            <div className="flex flex-col gap-2.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[12.5px]" style={{ color: "var(--nc-text-2)" }}>Unidades retiradas</span>
                <span className="nc-num text-sm">{retiradaStats.units}</span>
              </div>
              <div className="nc-rule-top flex items-baseline justify-between gap-2 pt-2.5">
                <span className="text-[12.5px]">Última retirada</span>
                <span className="nc-num text-xl font-semibold">
                  {retiradaStats.last ? formatDateBR(retiradaStats.last) : "—"}
                </span>
              </div>
              <p className="text-[11.5px]" style={{ color: "var(--nc-text-3)" }}>
                Não entra no faturamento: vira saldo devedor do funcionário.
              </p>
            </div>

            <Rule />

            <div>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>Quem mais retirou</span>
                <span className="nc-num text-[10.5px]" style={{ color: "var(--nc-text-3)" }}>
                  {retiradaStats.bySeller.length} no total
                </span>
              </div>
              {retiradaStats.bySeller.length === 0 ? (
                <p className="py-4 text-center text-xs" style={{ color: "var(--nc-text-3)" }}>
                  Nenhuma retirada registrada.
                </p>
              ) : (
                <Stagger className="flex flex-col">
                  {retiradaStats.bySeller.slice(0, MAX_TOP_ROWS).map(s => (
                    <motion.div key={s.key} variants={listItem} className="nc-row flex items-center justify-between gap-2 py-1.5 text-xs">
                      <span className="min-w-0 flex-1 truncate">{s.name}</span>
                      <span className="nc-num flex-none">
                        {formatCurrencyShort(s.value)}
                        <span style={{ color: "var(--nc-text-3)" }}> · {s.units} un.</span>
                      </span>
                    </motion.div>
                  ))}
                  {retiradaStats.bySeller.length > MAX_TOP_ROWS && (
                    <p className="pt-2 text-[11px]" style={{ color: "var(--nc-text-3)" }}>
                      + {retiradaStats.bySeller.length - MAX_TOP_ROWS} outros
                    </p>
                  )}
                </Stagger>
              )}
            </div>
          </>
        )}

        {tab === "pedidos" && (
          <>
            <span className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>Pedidos do catálogo</span>

            <div>
              <span className="text-[11.5px]" style={{ color: "var(--nc-text-2)" }}>Reservado esperando decisão</span>
              <div className="flex flex-wrap items-baseline gap-2">
                <span style={{ color: "var(--nc-alert)" }}>
                  <AnimatedNumber
                    value={orderStats.value}
                    format={formatCurrencyShort}
                    duration={0.7}
                    animateOnMount
                    className="nc-num text-[30px] font-semibold tracking-[-0.025em]"
                  />
                </span>
              </div>
              <p className="nc-num mt-1.5 text-[11px]" style={{ color: "var(--nc-text-2)" }}>
                {orderStats.count} pedido{orderStats.count === 1 ? "" : "s"} · {orderStats.units} un.
              </p>
            </div>

            <Rule />

            <div className="flex flex-col gap-2.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[12.5px]" style={{ color: "var(--nc-text-2)" }}>Unidades reservadas</span>
                <span className="nc-num text-sm">{orderStats.units}</span>
              </div>
              <div className="nc-rule-top flex items-baseline justify-between gap-2 pt-2.5">
                <span className="text-[12.5px]">Pedido mais antigo</span>
                <span className="nc-num text-xl font-semibold" style={{ color: orderStats.oldest ? "var(--nc-alert)" : undefined }}>
                  {orderStats.oldest ? timeAgo(orderStats.oldest) : "—"}
                </span>
              </div>
              {/* O prazo é o que segura o estoque: passadas as 24h a reserva sai
                  sozinha do cálculo do catálogo e confirmar deixa de ser possível. */}
              <p className="text-[11.5px]" style={{ color: "var(--nc-text-3)" }}>
                A reserva expira em 24h e o estoque volta ao catálogo sozinho.
              </p>
            </div>

            <Rule />

            <div>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>Por vendedor</span>
                <span className="nc-num text-[10.5px]" style={{ color: "var(--nc-text-3)" }}>
                  {orderStats.bySeller.length} no total
                </span>
              </div>
              {orderStats.bySeller.length === 0 ? (
                <p className="py-4 text-center text-xs" style={{ color: "var(--nc-text-3)" }}>
                  Nenhum pedido pendente.
                </p>
              ) : (
                <Stagger className="flex flex-col">
                  {orderStats.bySeller.slice(0, MAX_TOP_ROWS).map(s => (
                    <motion.div key={s.key} variants={listItem} className="nc-row flex items-center justify-between gap-2 py-1.5 text-xs">
                      <span className="min-w-0 flex-1 truncate">{s.name}</span>
                      <span className="nc-num flex-none">
                        {formatCurrencyShort(s.value)}
                        <span style={{ color: "var(--nc-text-3)" }}> · {s.count} ped.</span>
                      </span>
                    </motion.div>
                  ))}
                  {orderStats.bySeller.length > MAX_TOP_ROWS && (
                    <p className="pt-2 text-[11px]" style={{ color: "var(--nc-text-3)" }}>
                      + {orderStats.bySeller.length - MAX_TOP_ROWS} outros
                    </p>
                  )}
                </Stagger>
              )}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
