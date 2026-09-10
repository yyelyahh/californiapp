import { useId, useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { startOfMonth, endOfMonth, startOfQuarter, endOfQuarter, subMonths, parseISO } from "date-fns";
import { Clock, Check, Ban, ChevronDown, LogOut, Inbox, X } from "lucide-react";

import { useStore } from "@/context/StoreContext";
import { useAuth } from "@/context/AuthContext";
import { usePendingOrders, ORDER_PAYMENT_CHOICES, ORDER_NOTE_MAX, type Order, type PaymentMethodValue } from "@/hooks/usePendingOrders";
import { computeSellerBalance, computeSellerConsumption, PROJECT_START, type ConsumptionEntry } from "@/lib/commissions";
import { buildSellerStock } from "@/lib/seller-stock";
import { formatDateBR } from "@/lib/date-utils";
import { EASE_OUT, fadeUp, stagger } from "@/lib/motion";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import type { Sale } from "@/types";
import { formatCurrency as fmt } from "@/lib/currency";

/**
 * Visão do vendedor — tema da loja (`.storefront`), não o Nocturne do ERP.
 *
 * Mora fora do `AppLayout` de propósito: o vendedor tem uma tela só, então a
 * sidebar e a barra inferior do ERP existiriam para navegar entre uma opção, e
 * o shell de tela cheia da loja brigaria com o shell do ERP por cima dele. O
 * único que se perde ao sair de lá é o botão de sair, que reaparece no header
 * daqui.
 *
 * Aqui o vendedor NÃO registra venda: as vendas dele nascem de pedido do
 * catálogo, confirmado nesta tela. O formulário manual ficou só com o admin.
 *
 * Convenções de estilo (tokens, escala, movimento): ver src/pages/CLAUDE.md.
 */

const COLUMN = "mx-auto w-full max-w-[480px]";

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

const isMySale = (s: Sale, sellerId?: string | null) =>
  s.sellerId === sellerId && (s.type || "venda") !== "retirada_funcionario";
const openAmount = (s: Sale) => Math.max(0, s.totalPrice - s.paidAmount);
const byDateDesc = (a: { date: string }, b: { date: string }) =>
  new Date(b.date).getTime() - new Date(a.date).getTime();

type SellerPeriod = "month" | "lastMonth" | "quarter";

const PERIODS: { id: SellerPeriod; label: string }[] = [
  { id: "month", label: "Este mês" },
  { id: "lastMonth", label: "Mês passado" },
  { id: "quarter", label: "Trimestre" },
];

/* ------------------------------------------------------------------ */
/* Peças                                                                */
/* ------------------------------------------------------------------ */

/**
 * Mesmo padrão do `BrandChips` da loja: o preenchimento accent é uma peça só,
 * renderizada apenas pelo chip ativo, e o motion desliza ela de um para o
 * outro em vez de apagar aqui e acender ali.
 *
 * `trailing` fica FORA do trilho que rola: é ação, não filtro, e num celular
 * estreito ele sairia da tela junto com os chips justamente quando o vendedor
 * precisa dele. `layoutScroll` é obrigatório porque o trilho rola e hospeda um
 * `layoutId` — sem ele o motion mede a posição sem descontar o scroll.
 */
function PeriodChips({
  active,
  onChange,
  trailing,
}: {
  active: SellerPeriod;
  onChange: (id: SellerPeriod) => void;
  trailing?: ReactNode;
}) {
  const reduce = useReducedMotion();
  const pillId = useId();

  return (
    <div className="mt-3.5 flex items-center gap-2">
      <motion.div layoutScroll className="flex min-w-0 flex-1 gap-2 overflow-x-auto overscroll-x-contain pb-0.5">
        {PERIODS.map(p => {
          const isActive = p.id === active;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onChange(p.id)}
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
              <span className="relative z-10">{p.label}</span>
            </button>
          );
        })}
      </motion.div>
      {trailing}
    </div>
  );
}

/** Número de resumo. `tone` escolhe a cor do valor, nunca do card. */
function StatCard({
  label,
  value,
  tone = "plain",
  children,
  onClick,
  expanded,
}: {
  label: string;
  value: string;
  tone?: "plain" | "accent" | "warn";
  children?: ReactNode;
  onClick?: () => void;
  expanded?: boolean;
}) {
  const color =
    tone === "accent" ? "var(--sf-accent)" : tone === "warn" ? "var(--sf-warn)" : "var(--sf-text)";

  const inner = (
    <>
      <p
        className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.08em]"
        style={{ color: "var(--sf-text-faint)" }}
      >
        {label}
        {children}
      </p>
      <p className="mt-1 truncate text-[17px] font-extrabold" style={{ color }}>
        {value}
      </p>
    </>
  );

  const className = "min-w-0 rounded-[18px] px-3.5 py-3 text-left";
  const style = {
    background: "var(--sf-surface)",
    border: `1px solid ${expanded ? "var(--sf-accent-line)" : "var(--sf-hairline)"}`,
  };

  return onClick ? (
    <button type="button" onClick={onClick} aria-expanded={expanded} className={className} style={style}>
      {inner}
    </button>
  ) : (
    <div className={className} style={style}>
      {inner}
    </div>
  );
}

/**
 * Pílula de "isto veio de antes". Lançamento em aberto não sai da lista na
 * virada do mês, então precisa dizer que não é do período que está no título —
 * senão o total da lista não bate com o card e parece erro de conta.
 */
function CarriedTag() {
  return (
    <span
      className="ml-1.5 flex-none rounded-full px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.08em]"
      style={{ background: "var(--sf-surface-2)", color: "var(--sf-text-faint)" }}
    >
      de antes
    </span>
  );
}

/** Uma retirada ou dívida. Valor em warn enquanto sobra saldo, accent quando quitado. */
function ConsumptionRow({
  entry,
  productLabel,
}: {
  entry: ConsumptionEntry;
  productLabel: (productId: string) => string;
}) {
  const open = entry.remaining > 0.01;
  const title =
    entry.kind === "retirada" && entry.sale
      ? productLabel(entry.sale.productId)
      : `Dívida${entry.debt?.notes ? ` · ${entry.debt.notes}` : ""}`;

  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center">
          <p className="truncate text-[13px] font-semibold">{title}</p>
          {!entry.inPeriod && <CarriedTag />}
        </div>
        <p className="mt-0.5 text-[11px]" style={{ color: "var(--sf-text-muted)" }}>
          {formatDateBR(entry.date)}
          {entry.kind === "retirada" && entry.sale ? ` · ${entry.sale.quantity} un.` : ""}
        </p>
      </div>
      <span
        className="flex-none text-[13px] font-extrabold"
        style={{ color: open ? "var(--sf-warn)" : "var(--sf-accent)" }}
      >
        {fmt(entry.amount)}
      </span>
    </div>
  );
}

/** Uma venda da lista. Mesma leitura de cor do consumo: warn = falta receber. */
function SaleRow({
  sale,
  productLabel,
  carried,
  divider,
}: {
  sale: Sale;
  productLabel: (productId: string) => string;
  carried?: boolean;
  divider?: boolean;
}) {
  const received = openAmount(sale) <= 0.01;
  return (
    <div
      className="flex items-center justify-between gap-3 px-3.5 py-3"
      style={divider ? { borderTop: "1px solid var(--sf-hairline)" } : undefined}
    >
      <div className="min-w-0">
        <div className="flex min-w-0 items-center">
          <p className="truncate text-[13.5px] font-bold">{productLabel(sale.productId)}</p>
          {carried && <CarriedTag />}
        </div>
        <p className="mt-0.5 text-[11px]" style={{ color: "var(--sf-text-muted)" }}>
          {formatDateBR(sale.date)} · {sale.quantity} un.
        </p>
      </div>
      <span
        className="flex-none text-[13.5px] font-extrabold"
        style={{ color: received ? "var(--sf-accent)" : "var(--sf-warn)" }}
      >
        {fmt(sale.totalPrice)}
      </span>
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-3 text-[13px] font-extrabold uppercase tracking-[0.08em]" style={{ color: "var(--sf-text-faint)" }}>
      {children}
    </h2>
  );
}

/**
 * Escolha da forma de pagamento ao confirmar. O valor recebido é DERIVADO
 * dela — pedido de catálogo é o total ou nada — e o vocabulário é o mesmo do
 * formulário manual do admin, de propósito: as duas portas de entrada de venda
 * não podem divergir.
 *
 * A observação é o que NÃO cabe nesse vocabulário fechado ("dia 20", "fiado").
 * Ela fica acima dos métodos porque o clique no método é o que confirma: quem
 * digita primeiro e escolhe depois faz um gesto só. Fechar o popover apaga o
 * que foi digitado — reabrir é um recomeço, não a continuação da tentativa
 * anterior (mesma regra do §8 de src/pages/CLAUDE.md).
 */
function PaymentPicker({
  children,
  disabled,
  onPick,
}: {
  children: ReactNode;
  disabled?: boolean;
  onPick: (method: PaymentMethodValue, notes: string) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const noteId = useId();

  const change = (next: boolean) => {
    if (disabled) return;
    if (!next) setNote("");
    setOpen(next);
  };

  const pick = async (method: PaymentMethodValue) => {
    const typed = note.trim();
    setOpen(false);
    setNote("");
    await onPick(method, typed);
  };

  const Option = ({ id, label }: { id: PaymentMethodValue; label: string }) => (
    <button
      type="button"
      onClick={() => pick(id)}
      className="h-9 rounded-full px-2 text-[12px] font-bold"
      style={{ background: "var(--sf-surface-2)", color: "var(--sf-text)" }}
    >
      {label}
    </button>
  );

  return (
    <Popover open={open} onOpenChange={change}>
      <PopoverTrigger asChild disabled={disabled}>
        {children}
      </PopoverTrigger>
      {/* A classe `storefront` precisa ser repetida: o Radix porta o popover
          para fora da árvore da página e os tokens não chegam por herança. */}
      <PopoverContent
        align="end"
        className="storefront w-[264px] space-y-3 rounded-[20px] border-0 p-3.5"
        style={{ background: "var(--sf-surface)", border: "1px solid var(--sf-hairline)" }}
      >
        <div className="space-y-2">
          <label
            htmlFor={noteId}
            className="block text-[10px] font-bold uppercase tracking-[0.08em]"
            style={{ color: "var(--sf-text-faint)" }}
          >
            Observação (opcional)
          </label>
          <input
            id={noteId}
            value={note}
            onChange={e => setNote(e.target.value)}
            maxLength={ORDER_NOTE_MAX}
            placeholder="dia 20, fiado..."
            className="h-[42px] w-full rounded-[14px] px-3 text-[13px] outline-none"
            style={{
              background: "var(--sf-surface-2)",
              border: "1px solid var(--sf-border)",
              color: "var(--sf-text)",
            }}
          />
        </div>
        <div className="space-y-2 pt-3" style={{ borderTop: "1px solid var(--sf-hairline)" }}>
          <p className="text-[10px] font-bold uppercase tracking-[0.08em]" style={{ color: "var(--sf-text-faint)" }}>
            Recebido agora
          </p>
          <div className="grid grid-cols-2 gap-2">
            {ORDER_PAYMENT_CHOICES.filter(c => c.paid).map(c => (
              <Option key={c.id} id={c.id} label={c.label} />
            ))}
          </div>
        </div>
        <div className="space-y-2 pt-3" style={{ borderTop: "1px solid var(--sf-hairline)" }}>
          <p className="text-[10px] font-bold uppercase tracking-[0.08em]" style={{ color: "var(--sf-text-faint)" }}>
            Falta receber
          </p>
          <div className="grid grid-cols-2 gap-2">
            {ORDER_PAYMENT_CHOICES.filter(c => !c.paid).map(c => (
              <Option key={c.id} id={c.id} label={c.label} />
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Pedido chegando: o essencial visível sem rolar e as duas ações no polegar. */
function OrderCard({
  order,
  processing,
  onConfirm,
  onDecline,
}: {
  order: Order;
  processing: boolean;
  onConfirm: (orderId: string, method: PaymentMethodValue, notes?: string) => void;
  onDecline: (orderId: string) => void;
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      className="rounded-[20px] p-4"
      style={{ background: "var(--sf-surface)", border: "1px solid var(--sf-accent-line)" }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[0.08em]"
            style={{ background: "var(--sf-accent-tint)", color: "var(--sf-accent)" }}
          >
            <span className="relative flex h-1.5 w-1.5">
              <span
                className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-70"
                style={{ background: "var(--sf-accent)" }}
              />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ background: "var(--sf-accent)" }} />
            </span>
            Novo pedido
          </span>
          <p className="mt-2 truncate text-base font-bold leading-tight">{order.customers?.name ?? "Sem cliente"}</p>
          <p className="mt-0.5 truncate text-[11.5px]" style={{ color: "var(--sf-text-muted)" }}>
            {order.customers?.whatsapp ?? "—"}
          </p>
        </div>
        <div className="flex-none text-right">
          <p className="text-lg font-extrabold leading-tight" style={{ color: "var(--sf-accent)" }}>
            {fmt(order.total_amount)}
          </p>
          <p
            className="mt-0.5 flex items-center justify-end gap-1 text-[10px]"
            style={{ color: "var(--sf-text-faint)" }}
          >
            <Clock size={11} />
            {timeAgo(order.created_at)}
          </p>
        </div>
      </div>

      <ul className="mt-3 space-y-1.5 rounded-2xl px-3.5 py-2.5" style={{ background: "var(--sf-surface-2)" }}>
        {order.order_items?.map(item => (
          <li key={item.id} className="flex items-baseline justify-between gap-2 text-[13px]">
            <span className="min-w-0 flex-1 truncate">
              <span className="font-extrabold">{item.quantity}×</span>{" "}
              <span className="font-semibold">{item.products?.flavor ?? "Produto"}</span>
              {item.products?.brand && (
                <span style={{ color: "var(--sf-text-muted)" }}> · {item.products.brand}</span>
              )}
            </span>
            <span className="flex-none" style={{ color: "var(--sf-text-muted)" }}>
              {fmt(item.quantity * item.unit_price)}
            </span>
          </li>
        ))}
      </ul>

      {order.freight_notes && (
        <p
          className="mt-2 rounded-2xl px-3.5 py-2 text-[12px]"
          style={{ background: "var(--sf-surface-2)", color: "var(--sf-text-muted)" }}
        >
          <span className="font-bold" style={{ color: "var(--sf-text)" }}>
            Entrega:
          </span>{" "}
          {order.freight_notes}
        </p>
      )}

      <div className="mt-3.5 grid grid-cols-3 gap-2">
        <button
          type="button"
          disabled={processing}
          onClick={() => onDecline(order.id)}
          className="flex h-12 items-center justify-center gap-1.5 rounded-full text-[13px] font-bold disabled:opacity-40"
          style={{ background: "var(--sf-surface-2)", color: "var(--sf-text-muted)" }}
        >
          <Ban size={14} />
          Recusar
        </button>
        <PaymentPicker disabled={processing} onPick={(method, notes) => onConfirm(order.id, method, notes)}>
          <button
            type="button"
            disabled={processing}
            className="col-span-2 flex h-12 items-center justify-center gap-2 rounded-full text-[13.5px] font-extrabold"
            style={{
              background: processing ? "var(--sf-accent-soft)" : "var(--sf-accent)",
              color: "var(--sf-accent-ink)",
            }}
          >
            <Check size={16} strokeWidth={2.6} />
            {processing ? "Confirmando..." : "Confirmar pedido"}
          </button>
        </PaymentPicker>
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Página                                                               */
/* ------------------------------------------------------------------ */

export default function SellerSalesPage() {
  const {
    products, sales, sellers, getProductName, productAssignments,
    commissionPayments, sellerDebtPayments, sellerManualDebts,
  } = useStore();
  const { sellerId, signOut } = useAuth();
  // `storefront`: o diálogo de recusar é portado para fora da árvore desta
  // página, e sem o aviso ele sai com o tema do ERP no meio da loja.
  const { pendingOrders, processingOrder, confirmOrder, declineOrder } = usePendingOrders({ storefront: true });
  const reduceMotion = useReducedMotion();

  const [period, setPeriod] = useState<SellerPeriod>("month");
  const [consumoOpen, setConsumoOpen] = useState(false);
  const [stockOpen, setStockOpen] = useState(false);

  const mySeller = sellers.find(s => s.id === sellerId) ?? null;

  const range = useMemo(() => {
    const now = new Date();
    if (period === "lastMonth") {
      const prev = subMonths(now, 1);
      return { start: startOfMonth(prev), end: endOfMonth(prev) };
    }
    if (period === "quarter") {
      return { start: startOfQuarter(now), end: endOfQuarter(now) };
    }
    return { start: startOfMonth(now), end: endOfMonth(now) };
  }, [period]);

  // Mesmo cálculo da página de Distribuição (admin), restrito ao período.
  const commission = useMemo(() => {
    if (!sellerId || !mySeller) return null;
    const { start, end } = range;
    // Comissão fecha por mês: a faixa acumula do dia 1 ao último dia de cada mês tocado pelo período.
    const closedStart = startOfMonth(start);
    const closedEnd = endOfMonth(end);
    const isLegacy = (iso: string) => {
      try { return parseISO(iso) < PROJECT_START; } catch { return false; }
    };
    const inClosedPeriod = (iso: string) => {
      try {
        const d = parseISO(iso);
        return d >= closedStart && d <= closedEnd;
      } catch { return false; }
    };
    return computeSellerBalance(mySeller, {
      sales, commissionPayments, sellerDebtPayments, sellerManualDebts,
      start, end, closedStart, PROJECT_START, isLegacy, inClosedPeriod,
    });
  }, [sellerId, mySeller, sales, commissionPayments, sellerDebtPayments, sellerManualDebts, range]);

  // Consumo próprio (retiradas + dívidas − pagamentos). O CARD é do período; o
  // "em aberto" continua acumulado, porque dívida não zera na virada do mês.
  const consumo = useMemo(() => {
    if (!sellerId) return null;
    return computeSellerConsumption(sellerId, {
      sales, sellerManualDebts, sellerDebtPayments,
      start: range.start, end: range.end,
    });
  }, [sellerId, sales, sellerManualDebts, sellerDebtPayments, range]);

  const mySales = useMemo(() => {
    const startTs = range.start.getTime();
    const endTs = range.end.getTime();
    return [...sales]
      .filter(s => {
        if (!isMySale(s, sellerId)) return false;
        const ts = new Date(s.date).getTime();
        return !isNaN(ts) && ts >= startTs && ts <= endTs;
      })
      .sort(byDateDesc);
  }, [sales, sellerId, range]);

  // Venda em aberto não sai da lista na virada do mês: enquanto o dinheiro não
  // entrou ela ainda é cobrança do vendedor, e some daqui só quando for paga.
  // Recorte por PROJECT_START pelo mesmo motivo do consumo: antes disso é
  // legado, e legado não é cobrança de ninguém.
  const carriedOpenSales = useMemo(() => {
    const startTs = range.start.getTime();
    const endTs = range.end.getTime();
    const historyTs = PROJECT_START.getTime();
    return [...sales]
      .filter(s => {
        if (!isMySale(s, sellerId) || openAmount(s) <= 0.01) return false;
        const ts = new Date(s.date).getTime();
        if (isNaN(ts) || ts < historyTs) return false;
        return ts < startTs || ts > endTs;
      })
      .sort(byDateDesc);
  }, [sales, sellerId, range]);

  const sumPaid = mySales.reduce((acc, s) => acc + s.paidAmount, 0);
  const sumOpenPeriod = mySales.reduce((acc, s) => acc + openAmount(s), 0);
  const sumOpenCarried = carriedOpenSales.reduce((acc, s) => acc + openAmount(s), 0);
  const sumOpen = sumOpenPeriod + sumOpenCarried;
  const periodLabel = PERIODS.find(p => p.id === period)?.label ?? "";

  // Conferência de estoque: o que o sistema diz que está com o vendedor.
  const stock = useMemo(
    () => buildSellerStock(sellerId, { productAssignments, products, pendingOrders, productName: getProductName }),
    [sellerId, productAssignments, products, pendingOrders, getProductName],
  );

  const productLabel = (productId: string) => {
    const product = products.find(p => p.id === productId);
    return product ? `${product.flavor} · ${product.model}` : getProductName(productId);
  };

  return (
    // App-shell: a raiz ocupa a janela e não rola; só o <main> rola. Mesmo
    // esqueleto da loja pública — ver src/pages/CLAUDE.md.
    <div className="storefront flex h-[100dvh] flex-col overflow-hidden">
      <header className="flex-shrink-0">
        <div className={`${COLUMN} px-5 pb-3 pt-4`}>
          <div className="flex items-start justify-between gap-2.5">
            <div className="min-w-0">
              <p
                className="truncate text-sm font-extrabold tracking-[0.03em]"
                style={{ color: "var(--sf-accent)" }}
              >
                MINHAS VENDAS
              </p>
              <p className="mt-0.5 truncate text-xs" style={{ color: "var(--sf-text-muted)" }}>
                {mySeller ? `Oi, ${mySeller.name}` : "Acompanhe seus pedidos e sua comissão"}
              </p>
            </div>

            <button
              type="button"
              onClick={signOut}
              aria-label="Sair da conta"
              className="flex h-10 w-10 flex-none items-center justify-center rounded-full"
              style={{
                background: "var(--sf-surface)",
                border: "1px solid var(--sf-border)",
                color: "var(--sf-text-muted)",
              }}
            >
              <LogOut size={16} />
            </button>
          </div>

          <PeriodChips
            active={period}
            onChange={setPeriod}
            trailing={
              <button
                type="button"
                onClick={() => setStockOpen(true)}
                className="flex-none rounded-full px-4 py-2 text-[12.5px] font-bold"
                style={{
                  background: "var(--sf-surface)",
                  border: "1px solid var(--sf-border)",
                  color: "var(--sf-text-muted)",
                }}
              >
                Estoque
              </button>
            }
          />
        </div>
      </header>

      <main className={`${COLUMN} flex-1 overflow-y-auto overscroll-contain px-5 pb-10 pt-1.5`}>
        {/* Pedidos novos — antes de tudo: é a única coisa aqui que pede uma ação. */}
        {pendingOrders.length > 0 && (
          <section className="mt-4">
            <SectionTitle>
              {pendingOrders.length === 1 ? "1 pedido esperando" : `${pendingOrders.length} pedidos esperando`}
            </SectionTitle>
            <div className="flex flex-col gap-3">
              <AnimatePresence initial={false}>
                {pendingOrders.map(order => (
                  <OrderCard
                    key={order.id}
                    order={order}
                    processing={processingOrder === order.id}
                    onConfirm={confirmOrder}
                    onDecline={declineOrder}
                  />
                ))}
              </AnimatePresence>
            </div>
          </section>
        )}

        <motion.div
          variants={stagger()}
          initial={reduceMotion ? "visible" : "hidden"}
          animate="visible"
        >
          <motion.section variants={fadeUp} className="mt-6">
            <SectionTitle>Resumo · {periodLabel}</SectionTitle>
            <div className="grid grid-cols-2 gap-2.5">
              <StatCard label="Vendas" value={String(mySales.length)} />
              <StatCard label="Recebido" value={fmt(sumPaid)} tone="accent" />
              <StatCard label="Em aberto" value={fmt(sumOpen)} tone={sumOpen > 0.01 ? "warn" : "plain"} />
              <StatCard
                label="Consumo"
                value={fmt(consumo?.periodTotal ?? 0)}
                tone={(consumo?.periodTotal ?? 0) > 0.01 ? "warn" : "plain"}
                onClick={() => setConsumoOpen(o => !o)}
                expanded={consumoOpen}
              >
                <ChevronDown
                  size={11}
                  className={`transition-transform ${consumoOpen ? "rotate-180" : ""}`}
                />
              </StatCard>
            </div>

            <AnimatePresence initial={false}>
              {consumoOpen && consumo && (
                <motion.div
                  key="consumo"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div
                    className="mt-2.5 rounded-[18px] p-4"
                    style={{ background: "var(--sf-surface)", border: "1px solid var(--sf-hairline)" }}
                  >
                    {consumo.visible.length === 0 ? (
                      <p className="py-4 text-center text-[13px]" style={{ color: "var(--sf-text-dim)" }}>
                        Nenhum consumo no período.
                      </p>
                    ) : (
                      <div className="flex flex-col">
                        {consumo.visible.map(e => (
                          <ConsumptionRow key={`${e.kind}-${e.id}`} entry={e} productLabel={productLabel} />
                        ))}
                      </div>
                    )}

                    <div className="mt-2 space-y-1 pt-3" style={{ borderTop: "1px solid var(--sf-hairline)" }}>
                      <div className="flex items-center justify-between text-[12px]" style={{ color: "var(--sf-text-muted)" }}>
                        <span>Consumo do período</span>
                        <span>{fmt(consumo.periodTotal)}</span>
                      </div>
                      {consumo.debtPaymentsTotal > 0 && (
                        <div className="flex items-center justify-between text-[12px]" style={{ color: "var(--sf-text-muted)" }}>
                          <span>Pagamentos</span>
                          <span style={{ color: "var(--sf-accent)" }}>−{fmt(consumo.debtPaymentsTotal)}</span>
                        </div>
                      )}
                      <div className="flex items-center justify-between pt-1 text-[13px] font-extrabold">
                        <span>Em aberto</span>
                        <span style={{ color: consumo.openTotal > 0.01 ? "var(--sf-warn)" : "var(--sf-accent)" }}>
                          {fmt(consumo.openTotal)}
                        </span>
                      </div>
                      {consumo.otherOpen > 0.01 && (
                        <p className="pt-0.5 text-[11px]" style={{ color: "var(--sf-text-faint)" }}>
                          Inclui {fmt(consumo.otherOpen)} de outros meses.
                        </p>
                      )}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.section>

          <motion.section variants={fadeUp} className="mt-6">
            <SectionTitle>Minha comissão · {periodLabel}</SectionTitle>
            <div className="grid grid-cols-2 gap-2.5">
              <StatCard label="Faixa atual" value={commission?.tier.label ?? "—"} />
              <StatCard label="Unidades" value={String(commission?.units ?? 0)} />
              <StatCard label="Acumulada" value={fmt(commission?.accrued ?? 0)} tone="accent" />
              <StatCard
                label="Saldo"
                value={fmt(commission?.balance ?? 0)}
                tone={(commission?.balance ?? 0) > 0.01 ? "warn" : "plain"}
              />
            </div>

            {/* Projeção: a comissão só conta venda quitada, então quem tem venda
                em aberto vê um saldo menor do que ele vai ser. Aqui as mesmas
                vendas entram pelo valor de venda normal e no fechamento do mês em
                que foram feitas (= pagamento no dia da venda), e a faixa é
                reapurada — que é justamente o que muda quando o dinheiro entra.
                O número grande é o quanto o SALDO cresce, não o saldo inteiro:
                o total já está no card acima e repetir só confunde. */}
            {commission && commission.pendingToReceive > 0.01 && (
              <div
                className="mt-2.5 flex items-center justify-between gap-3 rounded-[18px] px-3.5 py-3"
                style={{ background: "var(--sf-surface)", border: "1px solid var(--sf-accent-line)" }}
              >
                <div className="min-w-0">
                  <p
                    className="text-[10px] font-bold uppercase tracking-[0.08em]"
                    style={{ color: "var(--sf-text-faint)" }}
                  >
                    Se receber o que falta
                  </p>
                  <p className="mt-0.5 truncate text-[11.5px]" style={{ color: "var(--sf-text-muted)" }}>
                    {commission.projectedUnits} un. · faixa {commission.projectedTier.label}
                    {commission.projectedTier.rate > commission.tier.rate ? " · sobe de faixa" : ""}
                  </p>
                  <p className="mt-0.5 truncate text-[11px]" style={{ color: "var(--sf-text-faint)" }}>
                    {fmt(commission.pendingToReceive)} em aberto, de todos os meses.
                  </p>
                </div>
                <div className="flex-none text-right">
                  <p className="text-[17px] font-extrabold" style={{ color: "var(--sf-accent)" }}>
                    +{fmt(commission.projectedBalance - commission.balance)}
                  </p>
                  <p className="mt-0.5 text-[11px]" style={{ color: "var(--sf-text-muted)" }}>
                    no saldo
                  </p>
                </div>
              </div>
            )}
          </motion.section>

          <motion.section variants={fadeUp} className="mt-6">
            <SectionTitle>Vendas · {periodLabel}</SectionTitle>
            {mySales.length === 0 && carriedOpenSales.length === 0 ? (
              <div
                className="flex flex-col items-center gap-2 rounded-[18px] py-12"
                style={{ background: "var(--sf-surface)", border: "1px solid var(--sf-hairline)" }}
              >
                <Inbox size={26} style={{ color: "var(--sf-text-dim)" }} />
                <p className="text-[13px]" style={{ color: "var(--sf-text-dim)" }}>
                  Nenhuma venda no período.
                </p>
              </div>
            ) : (
              <>
                <div
                  className="overflow-hidden rounded-[18px]"
                  style={{ background: "var(--sf-surface)", border: "1px solid var(--sf-hairline)" }}
                >
                  {mySales.map((s, i) => (
                    <SaleRow key={s.id} sale={s} productLabel={productLabel} divider={i > 0} />
                  ))}
                  {carriedOpenSales.map((s, i) => (
                    <SaleRow
                      key={s.id}
                      sale={s}
                      productLabel={productLabel}
                      carried
                      divider={i > 0 || mySales.length > 0}
                    />
                  ))}
                </div>
                <p className="mt-2.5 flex items-center gap-3.5 px-1 text-[11px]" style={{ color: "var(--sf-text-muted)" }}>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full" style={{ background: "var(--sf-accent)" }} />
                    Recebido
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full" style={{ background: "var(--sf-warn)" }} />
                    Falta receber
                  </span>
                </p>
                {carriedOpenSales.length > 0 && (
                  <p className="mt-1.5 px-1 text-[11px]" style={{ color: "var(--sf-text-faint)" }}>
                    “De antes” são vendas de outros meses ainda em aberto — elas ficam aqui até
                    serem pagas.
                  </p>
                )}
              </>
            )}
          </motion.section>
        </motion.div>
      </main>

      {/* Conferência de estoque. Sheet e não tela nova: é consulta de conferir e
          fechar, e sair da tela perderia o período que o vendedor tinha escolhido.
          A classe `storefront` se repete porque o Radix porta isto para fora da
          árvore da página — ver src/pages/CLAUDE.md §2. */}
      <Sheet open={stockOpen} onOpenChange={setStockOpen}>
        <SheetContent
          side="bottom"
          hideClose
          className={`storefront ${COLUMN} inset-x-0 flex h-[76vh] flex-col gap-0 rounded-b-none rounded-t-[28px] border-0 p-0`}
          style={{ background: "var(--sf-bg)" }}
        >
          <div
            className="flex flex-shrink-0 items-center justify-between px-5 pb-3.5 pt-5"
            style={{ borderBottom: "1px solid var(--sf-hairline)" }}
          >
            <div className="min-w-0">
              <SheetTitle className="text-[19px] font-extrabold" style={{ color: "var(--sf-text)" }}>
                Meu estoque
              </SheetTitle>
              <p className="mt-0.5 truncate text-[11.5px]" style={{ color: "var(--sf-text-muted)" }}>
                {stock.units} un. · {stock.flavors} {stock.flavors === 1 ? "sabor" : "sabores"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setStockOpen(false)}
              aria-label="Fechar"
              className="flex h-8 w-8 flex-none items-center justify-center rounded-full"
              style={{ background: "var(--sf-surface)", color: "var(--sf-text)" }}
            >
              <X size={15} />
            </button>
          </div>
          <SheetDescription className="sr-only">
            O que o sistema diz que está com você, para conferir com o que tem em mãos.
          </SheetDescription>

          <div className="flex-1 overflow-y-auto overscroll-contain px-5 pb-7 pt-3">
            {stock.groups.length === 0 ? (
              <p className="py-16 text-center text-[13px]" style={{ color: "var(--sf-text-dim)" }}>
                Nenhum produto atribuído a você.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {stock.groups.map(group => (
                  <div
                    key={group.key}
                    className="overflow-hidden rounded-[18px]"
                    style={{ background: "var(--sf-surface)", border: "1px solid var(--sf-hairline)" }}
                  >
                    <div
                      className="flex items-baseline justify-between gap-3 px-3.5 py-2.5"
                      style={{ background: "var(--sf-surface-2)" }}
                    >
                      <p className="min-w-0 truncate text-[12.5px] font-extrabold uppercase tracking-[0.06em]">
                        {group.brand}
                        {group.model && (
                          <span style={{ color: "var(--sf-text-muted)" }}> · {group.model}</span>
                        )}
                      </p>
                      <span
                        className="flex-none text-[12px] font-bold"
                        style={{ color: "var(--sf-text-muted)" }}
                      >
                        {group.units} un.
                      </span>
                    </div>
                    {group.lines.map((line, i) => (
                      <div
                        key={line.productId}
                        className="flex items-center justify-between gap-3 px-3.5 py-2.5"
                        style={i > 0 ? { borderTop: "1px solid var(--sf-hairline)" } : undefined}
                      >
                        <div className="min-w-0">
                          <p className="truncate text-[13.5px] font-bold">{line.flavor}</p>
                          {line.reserved > 0 && (
                            <p className="mt-0.5 truncate text-[11px]" style={{ color: "var(--sf-warn)" }}>
                              {line.reserved} em pedido pendente
                            </p>
                          )}
                        </div>
                        <span className="flex-none text-[15px] font-extrabold">{line.quantity}</span>
                      </div>
                    ))}
                  </div>
                ))}

                <p className="px-1 text-[11px] leading-relaxed" style={{ color: "var(--sf-text-faint)" }}>
                  É o que o sistema diz que está com você. Pedido pendente ainda conta aqui —
                  a peça só sai do seu estoque quando você confirma o pedido.
                  {stock.reserved > 0 && ` Hoje há ${stock.reserved} un. prometida${stock.reserved === 1 ? "" : "s"} em pedido.`}
                </p>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
