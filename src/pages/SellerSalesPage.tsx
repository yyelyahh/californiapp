import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { format, subMonths } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Check, ChevronDown, Clock, Copy, LogOut, MessageCircle, Package, Plus, Share2, X } from "lucide-react";

import { useStore } from "@/context/StoreContext";
import { useAuth } from "@/context/AuthContext";
import {
  usePendingOrders, ORDER_NOTE_MAX,
  type Order, type OrderActionResult,
} from "@/hooks/usePendingOrders";
import { useOrderCustomers } from "@/hooks/useOrderCustomers";
import {
  computeSellerBalance, computeSellerConsumption, currentBalanceContext, getNextTier, isCommissionSeller,
  PROJECT_START, type ConsumptionEntry,
} from "@/lib/commissions";
import { buildSellerStock } from "@/lib/seller-stock";
import { groupOpenSales, saleOpenAmount, tagOrderLines, whatsappLink, type OpenSaleGroup, type OrderLineTag } from "@/lib/seller-orders";
import { formatDateBR } from "@/lib/date-utils";
import { orderRef } from "@/lib/order-ref";
import { EASE_OUT, fadeUp, stagger } from "@/lib/motion";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import type { Product, Sale } from "@/types";
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
 * O dinheiro chega na ENTREGA, depois da confirmação, e quem diz que ele
 * chegou é o DONO, na tela de Vendas, depois de ver o dinheiro na conta. Por
 * isso confirmar não pergunta forma de pagamento (a venda entra sempre como
 * "falta receber", `pendente`) e o vendedor não marca nada como recebido: a
 * lista "A receber" daqui é só leitura. Escolher "Pix" na confirmação gravava
 * a venda como quitada sem que ninguém da loja tivesse visto o dinheiro.
 *
 * Convenções de estilo (tokens, escala, movimento): ver src/pages/CLAUDE.md.
 */

const COLUMN = "mx-auto w-full max-w-[480px]";

/**
 * A reserva do pedido, em horas. Espelha `order_reservation_ttl()` (24h) — o
 * banco é quem recusa (`pedido_expirado`); aqui só avisa antes, no card.
 */
const RESERVATION_HOURS = 24;
/** A partir de quanto falta o card passa a dizer "vence em". */
const EXPIRY_WARNING_HOURS = 6;
/** Pedido com menos disto é "novo" e pulsa. Depois, pulsar é mentir. */
const NEW_ORDER_MINUTES = 60;
/** Quanto a confirmação fica na tela antes de sair sozinha. */
const NOTICE_MS = 5000;

/** Rótulos pequenos da tela: 11.5px, o piso da escala da loja (§4). */
const LABEL = "text-[11.5px] font-bold uppercase tracking-[0.08em]";

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

/** Quanto falta para a reserva vencer, em minutos (negativo = já venceu). */
const minutesLeft = (createdAt: string) =>
  RESERVATION_HOURS * 60 - (Date.now() - new Date(createdAt).getTime()) / 60000;

function leftLabel(minutes: number) {
  if (minutes <= 0) return "Venceu";
  if (minutes < 60) return `Vence em ${Math.max(1, Math.floor(minutes))} min`;
  return `Vence em ${Math.floor(minutes / 60)}h`;
}

const isMySale = (s: Sale, sellerId?: string | null) =>
  s.sellerId === sellerId && (s.type || "venda") !== "retirada_funcionario";
const byDateDesc = (a: { date: string }, b: { date: string }) =>
  new Date(b.date).getTime() - new Date(a.date).getTime();

/** "Grape Ice · Ignite V80" — o mesmo rótulo no pedido, no a receber e nas vendas. */
function productParts(p: { flavor?: string | null; brand?: string | null; model?: string | null } | null | undefined) {
  const flavor = p?.flavor?.trim() || "Produto";
  const device = [p?.brand, p?.model].filter(Boolean).join(" ");
  return { flavor, device };
}

function ProductName({ flavor, device }: { flavor: string; device: string }) {
  return (
    <>
      <span className="font-bold">{flavor}</span>
      {device && <span className="font-semibold" style={{ color: "var(--sf-text-muted)" }}> · {device}</span>}
    </>
  );
}

type SellerPeriod = "month" | "lastMonth";

const PERIODS: { id: SellerPeriod; label: string }[] = [
  { id: "month", label: "Este mês" },
  { id: "lastMonth", label: "Mês passado" },
];

/* ------------------------------------------------------------------ */
/* Peças                                                                */
/* ------------------------------------------------------------------ */

/**
 * Mesmo padrão do `BrandChips` da loja: o preenchimento accent é uma peça só,
 * renderizada apenas pelo chip ativo, e o motion desliza ela de um para o
 * outro em vez de apagar aqui e acender ali.
 *
 * Só "Este mês" e "Mês passado": a comissão fecha por MÊS e a faixa é do mês,
 * então um trimestre mostrava a faixa de um mês ao lado das unidades de três.
 */
function PeriodChips({ active, onChange }: { active: SellerPeriod; onChange: (id: SellerPeriod) => void }) {
  const reduce = useReducedMotion();
  const pillId = useId();

  return (
    <div className="mt-3 flex gap-2" role="group" aria-label="Período">
      {PERIODS.map(p => {
        const isActive = p.id === active;
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onChange(p.id)}
            aria-pressed={isActive}
            className="relative min-h-11 flex-none rounded-full px-4 text-[12.5px] font-bold transition-colors duration-200"
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
    </div>
  );
}

function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="text-[13px] font-extrabold uppercase tracking-[0.08em]" style={{ color: "var(--sf-text-muted)" }}>
        {children}
      </h2>
      {aside}
    </div>
  );
}

/** Uma linha de consumo dentro da conta do saldo: sempre um desconto. */
function ConsumptionRow({ entry, productLabel }: { entry: ConsumptionEntry; productLabel: (id: string) => ReactNode }) {
  const title =
    entry.kind === "retirada" && entry.sale
      ? productLabel(entry.sale.productId)
      : `Dívida${entry.debt?.notes ? ` · ${entry.debt.notes}` : ""}`;
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 pl-3">
      <div className="min-w-0">
        <p className="break-words text-[12.5px] leading-snug">{title}</p>
        <p className="text-[11.5px]" style={{ color: "var(--sf-text-muted)" }}>
          {formatDateBR(entry.date)}
          {entry.kind === "retirada" && entry.sale ? ` · ${entry.sale.quantity} un. pelo custo` : ""}
        </p>
      </div>
      <span className="flex-none text-[12.5px] tabular-nums" style={{ color: "var(--sf-text-muted)" }}>
        −{fmt(entry.amount)}
      </span>
    </div>
  );
}

/** Uma venda recebida do período. A em aberto não passa por aqui: mora em "A receber". */
function SaleRow({ sale, label, divider }: { sale: Sale; label: ReactNode; divider?: boolean }) {
  return (
    <div
      className="flex items-baseline justify-between gap-3 px-3.5 py-3"
      style={divider ? { borderTop: "1px solid var(--sf-hairline)" } : undefined}
    >
      <div className="min-w-0">
        {/* O nome QUEBRA, não corta: "Blueberry Ice · Elf…" não diz de qual
            aparelho é. Duas linhas custam 18px; a informação que falta custa
            uma pergunta no WhatsApp. */}
        <p className="break-words text-[13.5px] leading-snug">{label}</p>
        <p className="mt-0.5 text-xs" style={{ color: "var(--sf-text-muted)" }}>
          {formatDateBR(sale.date)} · {sale.quantity} un.
        </p>
      </div>
      <span className="flex-none text-[13.5px] font-extrabold tabular-nums" style={{ color: "var(--sf-accent)" }}>
        {fmt(sale.totalPrice)}
      </span>
    </div>
  );
}

const TAG_LABEL: Record<Exclude<OrderLineTag, null>, string> = {
  premio: "prêmio fidelidade",
  combo: "combo",
  desconto: "com desconto",
};

/** Pedido chegando: o essencial visível sem rolar e as duas ações no polegar. */
function OrderCard({
  order,
  processing,
  busy,
  basePrice,
  onConfirm,
  onDecline,
}: {
  order: Order;
  processing: boolean;
  /** Outro pedido está sendo processado: este espera, e diz por quê. */
  busy: boolean;
  basePrice: (productId: string) => number | undefined;
  onConfirm: (order: Order, note: string) => Promise<OrderActionResult>;
  onDecline: (order: Order) => Promise<OrderActionResult>;
}) {
  const reduce = useReducedMotion();
  const noteId = useId();
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const ageMinutes = (Date.now() - new Date(order.created_at).getTime()) / 60000;
  const left = minutesLeft(order.created_at);
  const expiring = left <= EXPIRY_WARNING_HOURS * 60;
  const isNew = ageMinutes < NEW_ORDER_MINUTES;
  const tags = useMemo(() => tagOrderLines(order.order_items ?? [], basePrice), [order.order_items, basePrice]);
  const wa = whatsappLink(order.customers?.whatsapp);
  const name = order.customers?.name?.trim() || "Sem nome";
  const disabled = processing || busy;

  const run = async (action: () => Promise<OrderActionResult>) => {
    setError(null);
    const result = await action();
    if (!result.ok && "message" in result) setError(result.message);
  };

  return (
    <motion.article
      layout={!reduce}
      initial={reduce ? false : { opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
      aria-labelledby={`${noteId}-name`}
      className="rounded-[20px] p-4"
      style={{
        background: "var(--sf-surface)",
        border: `1px solid ${expiring ? "var(--sf-warn)" : "var(--sf-accent-line)"}`,
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {expiring ? (
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 ${LABEL}`}
              style={{ background: "var(--sf-surface-2)", color: "var(--sf-warn)" }}
            >
              <Clock size={12} aria-hidden />
              {leftLabel(left)}
            </span>
          ) : (
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 ${LABEL}`}
              style={
                isNew
                  ? { background: "var(--sf-accent-tint)", color: "var(--sf-accent)" }
                  : { background: "var(--sf-surface-2)", color: "var(--sf-text-muted)" }
              }
            >
              {isNew && (
                <span className="relative flex h-1.5 w-1.5" aria-hidden>
                  <span
                    className="absolute inline-flex h-full w-full rounded-full opacity-70 motion-safe:animate-ping"
                    style={{ background: "var(--sf-accent)" }}
                  />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ background: "var(--sf-accent)" }} />
                </span>
              )}
              {isNew ? "Novo pedido" : "Pedido"}
            </span>
          )}
          {/* Nome composto cortado é o vendedor sem saber para quem vai
              entregar — mesmo motivo dos itens logo abaixo. */}
          <h3 id={`${noteId}-name`} className="mt-2 break-words text-base font-bold leading-tight">
            {name}
          </h3>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs" style={{ color: "var(--sf-text-muted)" }}>
            {wa ? (
              <a
                href={wa}
                target="_blank"
                rel="noreferrer"
                className="-my-1 inline-flex items-center gap-1 py-1 font-semibold underline decoration-dotted underline-offset-4"
                style={{ color: "var(--sf-text)" }}
                aria-label={`Abrir conversa com ${name} no WhatsApp`}
              >
                <MessageCircle size={13} aria-hidden />
                {order.customers?.whatsapp}
              </a>
            ) : (
              <span>{order.customers?.whatsapp ?? "Sem WhatsApp"}</span>
            )}
            {/* A mesma referência que vai na mensagem que o cliente encaminha:
                é ela que casa o WhatsApp com o card quando a mesma pessoa faz
                dois pedidos no mesmo dia. */}
            <span className="tabular-nums">{orderRef(order.id)}</span>
          </p>
        </div>
        <div className="flex-none text-right">
          <p className="text-lg font-extrabold leading-tight tabular-nums" style={{ color: "var(--sf-accent)" }}>
            {fmt(order.total_amount)}
          </p>
          <p className="mt-0.5 text-xs" style={{ color: "var(--sf-text-muted)" }}>
            {timeAgo(order.created_at)}
          </p>
        </div>
      </div>

      <ul className="mt-3 space-y-2 rounded-2xl px-3.5 py-2.5" style={{ background: "var(--sf-surface-2)" }}>
        {order.order_items?.map(item => {
          const tag = tags.get(item.id);
          return (
            <li key={item.id} className="flex items-baseline justify-between gap-2 text-[13px]">
              {/* Sem `truncate`: esta lista é o que o cliente pediu, e é por
                  ela que o vendedor decide. Item cortado vira chute. */}
              <span className="min-w-0 flex-1 break-words leading-snug">
                <span className="font-extrabold">{item.quantity}×</span>{" "}
                <ProductName {...productParts(item.products)} />
                {tag && (
                  <span
                    className="ml-1.5 inline-flex whitespace-nowrap rounded-full px-2 py-0.5 align-middle text-[11px] font-bold"
                    style={{ background: "var(--sf-accent-tint)", color: "var(--sf-accent)" }}
                  >
                    {TAG_LABEL[tag]}
                  </span>
                )}
              </span>
              <span className="flex-none tabular-nums" style={{ color: "var(--sf-text-muted)" }}>
                {fmt(item.quantity * item.unit_price)}
              </span>
            </li>
          );
        })}
      </ul>

      {order.freight_notes && (
        <p
          className="mt-2 rounded-2xl px-3.5 py-2 text-[12.5px] leading-snug"
          style={{ background: "var(--sf-surface-2)", color: "var(--sf-text-muted)" }}
        >
          <span className="font-bold" style={{ color: "var(--sf-text)" }}>
            Recado do cliente:
          </span>{" "}
          {order.freight_notes}
        </p>
      )}

      {/* Anotação da venda: o que o vendedor quer lembrar ("dia 20", "fiado").
          Fechada por padrão — é exceção, e aberta ela empurraria as ações para
          fora do polegar. Vai para a nota da venda, antes da referência. */}
      {noteOpen ? (
        <div className="mt-3">
          <label htmlFor={noteId} className="text-xs font-semibold" style={{ color: "var(--sf-text-muted)" }}>
            Anotação na venda (opcional)
          </label>
          <div className="mt-1.5 flex items-center gap-2">
            <input
              id={noteId}
              value={note}
              onChange={e => setNote(e.target.value)}
              maxLength={ORDER_NOTE_MAX}
              placeholder="dia 20, fiado..."
              autoFocus
              className="h-11 min-w-0 flex-1 rounded-[14px] px-3 text-[15px] outline-none"
              style={{ background: "var(--sf-surface-2)", border: "1px solid var(--sf-border)", color: "var(--sf-text)" }}
            />
            <button
              type="button"
              onClick={() => {
                setNote("");
                setNoteOpen(false);
              }}
              aria-label="Tirar a anotação"
              className="flex h-11 w-11 flex-none items-center justify-center rounded-full"
              style={{ background: "var(--sf-surface-2)", color: "var(--sf-text-muted)" }}
            >
              <X size={16} />
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setNoteOpen(true)}
          className="mt-2 inline-flex min-h-11 items-center gap-1.5 text-[12.5px] font-bold"
          style={{ color: "var(--sf-text-muted)" }}
        >
          <Plus size={14} aria-hidden />
          Anotar algo na venda
        </button>
      )}

      <div className={`${noteOpen ? "mt-3" : "mt-1"} grid grid-cols-3 gap-2`}>
        <button
          type="button"
          disabled={disabled}
          onClick={() => run(() => onDecline(order))}
          className="flex h-12 items-center justify-center rounded-full text-[13px] font-bold disabled:opacity-40"
          style={{ background: "var(--sf-surface-2)", color: "var(--sf-text-muted)" }}
        >
          Recusar
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => run(() => onConfirm(order, note))}
          className="col-span-2 flex h-12 items-center justify-center gap-2 rounded-full text-[13.5px] font-extrabold"
          style={{
            background: disabled ? "var(--sf-accent-soft)" : "var(--sf-accent)",
            color: "var(--sf-accent-ink)",
          }}
        >
          <Check size={16} strokeWidth={2.6} aria-hidden />
          {processing ? "Confirmando..." : "Confirmar pedido"}
        </button>
      </div>
      {error ? (
        <p role="alert" className="mt-2.5 text-[12.5px] font-semibold leading-snug" style={{ color: "var(--sf-danger)" }}>
          {error}
        </p>
      ) : (
        <p className="mt-2.5 text-xs leading-snug" style={{ color: "var(--sf-text-muted)" }}>
          {busy
            ? "Esperando o outro pedido terminar."
            : "Confirmar tira do seu estoque. A venda fica em A receber até a loja registrar o pagamento."}
        </p>
      )}
    </motion.article>
  );
}

/** A confirmação, no lugar onde o card estava — não num toast do ERP por cima do cabeçalho. */
function ConfirmedNotice({ name, total, onClose }: { name: string; total: number; onClose: () => void }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      layout={!reduce}
      initial={reduce ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="flex items-center gap-3 rounded-[20px] px-4 py-3"
      style={{ background: "var(--sf-accent-tint)", border: "1px solid var(--sf-accent-line)" }}
    >
      <span
        className="flex h-8 w-8 flex-none items-center justify-center rounded-full"
        style={{ background: "var(--sf-accent)", color: "var(--sf-accent-ink)" }}
        aria-hidden
      >
        <Check size={16} strokeWidth={2.8} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="break-words text-[13.5px] font-bold leading-snug">Pedido de {name} confirmado!</p>
        <p className="text-xs" style={{ color: "var(--sf-text-muted)" }}>
          {fmt(total)} foi para A receber.
        </p>
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Fechar aviso"
        className="flex h-11 w-11 flex-none items-center justify-center rounded-full"
        style={{ color: "var(--sf-text-muted)" }}
      >
        <X size={15} />
      </button>
    </motion.div>
  );
}

/**
 * Uma linha de "A receber": um pedido (todos os sabores dele), SÓ LEITURA.
 *
 * O vendedor não marca recebimento: quem diz que o dinheiro chegou é o dono,
 * na tela de Vendas, depois de ver o dinheiro na conta. Aqui a linha serve para
 * o vendedor saber quem ainda deve e cobrar — por isso o nome e o WhatsApp do
 * cliente, e não só a referência do pedido.
 *
 * `dinheiro_com_vendedor` diz outra coisa: o cliente já pagou, em dinheiro, e
 * o dinheiro está com o vendedor esperando o acerto com a loja.
 */
function OpenGroupRow({
  group,
  customer,
  itemsLabel,
  divider,
}: {
  group: OpenSaleGroup;
  customer: { name: string; whatsapp: string } | null | undefined;
  itemsLabel: ReactNode;
  divider: boolean;
}) {
  const withSeller = group.sales.every(s => s.paymentMethod === "dinheiro_com_vendedor");
  const name = customer?.name?.trim();
  const title = name || (group.orderId ? `Pedido ${orderRef(group.orderId)}` : "Venda sem pedido");
  const wa = withSeller ? null : whatsappLink(customer?.whatsapp);

  return (
    <div className="px-3.5 py-3" style={divider ? { borderTop: "1px solid var(--sf-hairline)" } : undefined}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-words text-[13.5px] font-bold leading-snug">{title}</p>
          <p className="mt-0.5 break-words text-[12.5px] leading-snug">{itemsLabel}</p>
          <p className="mt-0.5 text-xs" style={{ color: "var(--sf-text-muted)" }}>
            {formatDateBR(group.date)} · {group.units} un.
            {group.orderId && name ? ` · ${orderRef(group.orderId)}` : ""}
            {group.note ? ` · ${group.note}` : ""}
          </p>
        </div>
        <div className="flex flex-none flex-col items-end">
          <p className="text-[14px] font-extrabold tabular-nums" style={{ color: "var(--sf-warn)" }}>
            {fmt(group.open)}
          </p>
          {withSeller ? (
            <p className="mt-0.5 max-w-[120px] text-right text-[11.5px] leading-snug" style={{ color: "var(--sf-text-muted)" }}>
              Dinheiro com você. Acerte com a loja.
            </p>
          ) : (
            wa && (
              <a
                href={wa}
                target="_blank"
                rel="noreferrer"
                aria-label={`Cobrar ${name ?? "o cliente"} no WhatsApp`}
                className="-mr-1 mt-0.5 inline-flex min-h-11 items-center gap-1 px-1 text-[12.5px] font-bold"
                style={{ color: "var(--sf-text-muted)" }}
              >
                <MessageCircle size={14} aria-hidden />
                Cobrar
              </a>
            )
          )}
        </div>
      </div>
    </div>
  );
}

/** O link da loja, para quem ainda não vendeu nada: é por ele que o pedido chega. */
function StoreLinkCard({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <section className="mt-4 rounded-[20px] p-4" style={{ background: "var(--sf-surface)", border: "1px solid var(--sf-accent-line)" }}>
      <h2 className="text-base font-bold">Sua loja está no ar</h2>
      <p className="mt-1 text-[13px] leading-relaxed" style={{ color: "var(--sf-text-muted)" }}>
        Mande este link para os seus clientes. Cada pedido que eles fizerem aparece aqui para você confirmar.
      </p>
      <p
        className="mt-3 break-all rounded-[14px] px-3 py-2.5 text-[13px] font-semibold"
        style={{ background: "var(--sf-surface-2)" }}
      >
        {url}
      </p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={copy}
          className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-full text-[13px] font-extrabold"
          style={{ background: "var(--sf-accent)", color: "var(--sf-accent-ink)" }}
        >
          {copied ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />}
          {copied ? "Copiado" : "Copiar link"}
        </button>
        {canShare && (
          <button
            type="button"
            onClick={() => navigator.share({ title: "Minha loja", url }).catch(() => {})}
            className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-full text-[13px] font-bold"
            style={{ background: "var(--sf-surface-2)", color: "var(--sf-text)" }}
          >
            <Share2 size={15} aria-hidden />
            Compartilhar
          </button>
        )}
      </div>
      <span className="sr-only" aria-live="polite">{copied ? "Link copiado" : ""}</span>
    </section>
  );
}

function Money({ value, tone }: { value: number; tone: "accent" | "warn" | "plain" }) {
  const color = tone === "accent" ? "var(--sf-accent)" : tone === "warn" ? "var(--sf-warn)" : "var(--sf-text)";
  return <span className="tabular-nums" style={{ color }}>{fmt(value)}</span>;
}

function LedgerLine({ label, value, sign, strong }: { label: ReactNode; value: number; sign?: "+" | "−"; strong?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 ${strong ? "pt-2 text-[13.5px] font-extrabold" : "py-1 text-[12.5px]"}`}>
      <span className="min-w-0" style={strong ? undefined : { color: "var(--sf-text-muted)" }}>{label}</span>
      <span className="flex-none tabular-nums" style={strong ? undefined : { color: "var(--sf-text-muted)" }}>
        {sign ?? ""}{fmt(Math.abs(value))}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Página                                                               */
/* ------------------------------------------------------------------ */

export default function SellerSalesPage() {
  const {
    loading, products, sales, sellers, getProductName, productAssignments,
    commissionPayments, sellerDebtPayments, sellerManualDebts,
  } = useStore();
  const { sellerId, signOut } = useAuth();
  // `storefront`: o diálogo de recusar é portado para fora da árvore desta
  // página, e sem o aviso ele sai com o tema do ERP no meio da loja. Também
  // desliga os toasts do hook: o desfecho aparece aqui, no card.
  const {
    pendingOrders, loadingOrders, ordersError, processingOrder, fetchPendingOrders, confirmOrder, declineOrder,
  } = usePendingOrders({ storefront: true });
  const reduceMotion = useReducedMotion();

  const [period, setPeriod] = useState<SellerPeriod>("month");
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [stockOpen, setStockOpen] = useState(false);
  const [confirmed, setConfirmed] = useState<{ id: string; name: string; total: number }[]>([]);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(t => window.clearTimeout(t)), []);
  const later = (fn: () => void) => {
    timers.current.push(window.setTimeout(fn, NOTICE_MS));
  };

  const mySeller = sellers.find(s => s.id === sellerId) ?? null;
  const productById = useMemo(() => new Map<string, Product>(products.map(p => [p.id, p])), [products]);
  const basePrice = useCallback((id: string) => productById.get(id)?.salePrice, [productById]);

  const productLabel = useCallback(
    (productId: string): ReactNode => {
      const p = productById.get(productId);
      return p ? <ProductName {...productParts(p)} /> : <span className="font-bold">{getProductName(productId)}</span>;
    },
    [productById, getProductName],
  );

  // O mês da tela. O contexto é o MESMO `currentBalanceContext` da
  // Distribuição e do Dashboard: com "Este mês" o saldo aqui é, por
  // construção, o número que o admin vê do outro lado.
  const anchor = useMemo(() => (period === "lastMonth" ? subMonths(new Date(), 1) : new Date()), [period]);
  const monthName = format(anchor, "MMMM", { locale: ptBR });
  const balanceCtx = useMemo(
    () => currentBalanceContext({ sales, commissionPayments, sellerDebtPayments, sellerManualDebts }, anchor),
    [sales, commissionPayments, sellerDebtPayments, sellerManualDebts, anchor],
  );

  const commission = useMemo(() => {
    if (!mySeller) return null;
    return computeSellerBalance(mySeller, balanceCtx);
  }, [mySeller, balanceCtx]);
  const showCommission = !!mySeller && isCommissionSeller(mySeller);

  // Consumo do mês, lançamento a lançamento: é o detalhe da linha "Consumo" da
  // conta do saldo, e soma exatamente o `consumoTotal` dela (mesmo mês, mesmo
  // corte de legado). O que ficou em aberto de antes já está no saldo trazido.
  const consumoEntries = useMemo(() => {
    if (!sellerId) return [];
    return computeSellerConsumption(sellerId, {
      sales, sellerManualDebts, sellerDebtPayments, start: balanceCtx.start, end: balanceCtx.end,
    }).entries.filter(e => e.inPeriod);
  }, [sellerId, sales, sellerManualDebts, sellerDebtPayments, balanceCtx]);

  // Só as QUITADAS, pela data da venda — o mesmo recorte da comissão (venda
  // paga, fechada no mês em que foi feita). Por isso as unidades daqui batem
  // com o "N/11 un. pagas" do bloco de cima. A que falta pagar mora em "A
  // receber", uma vez só.
  const receivedSales = useMemo(() => {
    const startTs = balanceCtx.start.getTime();
    const endTs = balanceCtx.end.getTime();
    return sales
      .filter(s => {
        if (!isMySale(s, sellerId) || saleOpenAmount(s) > 0.01) return false;
        const ts = new Date(s.date).getTime();
        return !isNaN(ts) && ts >= startTs && ts <= endTs;
      })
      .sort(byDateDesc);
  }, [sales, sellerId, balanceCtx]);
  const receivedUnits = receivedSales.reduce((a, s) => a + s.quantity, 0);
  const receivedTotal = receivedSales.reduce((a, s) => a + s.totalPrice, 0);

  // "A receber" não segue o período: venda em aberto não some na virada do
  // mês, e é justamente ela que falta marcar. Legado (antes do PROJECT_START)
  // não é cobrança de ninguém.
  const openGroups = useMemo(() => groupOpenSales(sales, sellerId, PROJECT_START), [sales, sellerId]);
  const openTotal = openGroups.reduce((a, g) => a + g.open, 0);
  const customers = useOrderCustomers(
    useMemo(
      () => openGroups.map(g => g.orderId).filter((id): id is string => !!id),
      [openGroups],
    ),
  );

  // Mais antigo primeiro: é o que está mais perto de vencer a reserva.
  const orders = useMemo(
    () => [...pendingOrders].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()),
    [pendingOrders],
  );

  const stock = useMemo(
    () => buildSellerStock(sellerId, { productAssignments, products, pendingOrders, productName: getProductName }),
    [sellerId, productAssignments, products, pendingOrders, getProductName],
  );

  const neverSold = !sales.some(s => isMySale(s, sellerId));
  const storeUrl = mySeller ? `${window.location.origin}/loja/${mySeller.slug || mySeller.id}` : null;

  const handleConfirm = async (order: Order, note: string) => {
    const result = await confirmOrder(order.id, "pendente", note);
    if (result.ok) {
      const entry = { id: order.id, name: order.customers?.name?.trim() || "cliente", total: order.total_amount };
      setConfirmed(prev => [entry, ...prev]);
      later(() => setConfirmed(prev => prev.filter(c => c.id !== entry.id)));
    }
    return result;
  };

  const groupItems = (g: OpenSaleGroup): ReactNode =>
    g.sales.map((s, i) => (
      <span key={s.id}>
        {i > 0 && <span style={{ color: "var(--sf-text-muted)" }}>, </span>}
        {s.quantity > 1 && <span className="font-extrabold">{s.quantity}× </span>}
        {productLabel(s.productId)}
      </span>
    ));

  const nextTier = commission ? getNextTier(commission.tier) : null;
  const balance = commission?.balance ?? 0;
  const gain = commission ? commission.projectedBalance - commission.balance : 0;

  return (
    // App-shell: a raiz ocupa a janela e não rola; só o <main> rola. Mesmo
    // esqueleto da loja pública — ver src/pages/CLAUDE.md. `colorScheme` pinta
    // a barra de rolagem nativa do desktop no escuro, não na do navegador.
    <div className="storefront flex h-[100dvh] flex-col overflow-hidden" style={{ colorScheme: "dark" }}>
      <header className="flex-shrink-0">
        <div className={`${COLUMN} px-5 pb-3 pt-4`}>
          <div className="flex items-center justify-between gap-2.5">
            <div className="min-w-0">
              <h1
                className="truncate text-sm font-extrabold uppercase tracking-[0.03em]"
                style={{ color: "var(--sf-accent)" }}
              >
                Minhas vendas
              </h1>
              <p className="mt-0.5 truncate text-xs" style={{ color: "var(--sf-text-muted)" }}>
                {mySeller ? `Oi, ${mySeller.name}` : "Seus pedidos e sua comissão"}
              </p>
            </div>

            <div className="flex flex-none items-center gap-2">
              {/* Estoque é consulta, não filtro: fica ao lado de "sair", fora
                  da fileira de períodos, onde parecia um terceiro período. */}
              <button
                type="button"
                onClick={() => setStockOpen(true)}
                className="flex h-11 items-center gap-1.5 rounded-full px-4 text-[12.5px] font-bold"
                style={{ background: "var(--sf-surface)", border: "1px solid var(--sf-border)", color: "var(--sf-text)" }}
              >
                <Package size={15} aria-hidden />
                Estoque
              </button>
              <button
                type="button"
                onClick={signOut}
                aria-label="Sair da conta"
                className="flex h-11 w-11 items-center justify-center rounded-full"
                style={{ background: "var(--sf-surface)", border: "1px solid var(--sf-border)", color: "var(--sf-text-muted)" }}
              >
                <LogOut size={16} />
              </button>
            </div>
          </div>

          <PeriodChips active={period} onChange={setPeriod} />
        </div>
      </header>

      <main className={`${COLUMN} flex-1 overflow-y-auto overscroll-contain px-5 pb-10 pt-1.5`}>
        {/* Pedidos — antes de tudo: é o que pede uma ação agora. Não segue o
            período (pedido pendente é de hoje). */}
        <section className="mt-4" aria-label="Pedidos esperando">
          {orders.length > 0 && (
            <SectionTitle>
              {orders.length === 1 ? "1 pedido esperando" : `${orders.length} pedidos esperando`}
            </SectionTitle>
          )}
          <div className="flex flex-col gap-3" aria-live="polite">
            <AnimatePresence initial={false}>
              {confirmed.map(c => (
                <ConfirmedNotice
                  key={`ok-${c.id}`}
                  name={c.name}
                  total={c.total}
                  onClose={() => setConfirmed(prev => prev.filter(x => x.id !== c.id))}
                />
              ))}
              {orders.map(order => (
                <OrderCard
                  key={order.id}
                  order={order}
                  processing={processingOrder === order.id}
                  busy={!!processingOrder && processingOrder !== order.id}
                  basePrice={basePrice}
                  onConfirm={handleConfirm}
                  onDecline={o => declineOrder(o.id)}
                />
              ))}
            </AnimatePresence>
          </div>
          {ordersError ? (
            <div className="rounded-[20px] px-4 py-8 text-center" style={{ background: "var(--sf-surface)" }}>
              <p className="text-[13px]" style={{ color: "var(--sf-text-muted)" }}>
                {ordersError}
              </p>
              <button
                type="button"
                onClick={() => fetchPendingOrders()}
                className="mt-3 h-11 rounded-full px-5 text-[13px] font-extrabold"
                style={{ background: "var(--sf-accent)", color: "var(--sf-accent-ink)" }}
              >
                Tentar de novo
              </button>
            </div>
          ) : (
            orders.length === 0 && (
              <p className="text-[13px]" style={{ color: "var(--sf-text-dim)" }}>
                {loadingOrders ? "Procurando pedidos novos…" : "Nenhum pedido esperando agora."}
              </p>
            )
          )}
        </section>

        {loading ? (
          <p className="py-16 text-center text-[13px]" style={{ color: "var(--sf-text-dim)" }}>
            Carregando suas vendas…
          </p>
        ) : (
          <motion.div variants={stagger()} initial={reduceMotion ? "visible" : "hidden"} animate="visible">
            {neverSold && orders.length === 0 && storeUrl && (
              <motion.div variants={fadeUp}>
                <StoreLinkCard url={storeUrl} />
              </motion.div>
            )}

            {/* Ordem da tela, do dono: comissão → a receber → vendas recebidas.
                O que o vendedor vem ver primeiro é quanto tem para receber da
                loja; depois o que ainda falta os clientes pagarem (e que, pago,
                sobe a comissão); por último o que já entrou. */}
            {showCommission && commission && (
              <motion.section variants={fadeUp} className="mt-7">
                <SectionTitle>Sua comissão · {monthName}</SectionTitle>
                <div
                  className="rounded-[20px] p-4"
                  style={{ background: "var(--sf-surface)", border: "1px solid var(--sf-hairline)" }}
                >
                  {/* O número do acerto, dito em frase: "saldo" solto e laranja
                      parecia dívida justamente quando era dinheiro a receber. */}
                  <p className="text-[19px] font-extrabold leading-snug">
                    {balance > 0.01 ? (
                      <>
                        {period === "lastMonth" ? `No fim de ${monthName}, você tinha ` : "Você tem "}
                        <Money value={balance} tone="accent" /> para receber no acerto.
                      </>
                    ) : balance < -0.01 ? (
                      <>
                        {period === "lastMonth" ? `No fim de ${monthName}, você devia ` : "Você deve "}
                        <Money value={-balance} tone="warn" /> à loja.
                      </>
                    ) : (
                      "Nada a acertar com a loja."
                    )}
                  </p>
                  {balance < -0.01 && (
                    <p className="mt-1 text-xs" style={{ color: "var(--sf-text-muted)" }}>
                      Sai da sua próxima comissão.
                    </p>
                  )}

                  {/* A faixa, com a distância até a próxima. Unidade PAGA, e a
                      tela diz isso: "10 un." ao lado de 12 vendas parecia erro. */}
                  <p className="mt-3 text-[13px] leading-snug">
                    <span className="font-bold">Faixa {commission.tier.label}</span>
                    <span style={{ color: "var(--sf-text-muted)" }}>
                      {nextTier
                        ? ` · ${commission.units}/${nextTier.min} un. pagas para ${nextTier.label}`
                        : ` · ${commission.units} un. pagas, a faixa mais alta`}
                    </span>
                  </p>

                  {period === "month" && commission.pendingToReceive > 0.01 && gain > 0.01 && (
                    <p className="mt-1.5 text-[13px] leading-snug" style={{ color: "var(--sf-text-muted)" }}>
                      Quando a loja receber os {fmt(commission.pendingToReceive)} em aberto, o saldo sobe{" "}
                      <span className="font-extrabold" style={{ color: "var(--sf-accent)" }}>+{fmt(gain)}</span>
                      {commission.projectedTier.rate > commission.tier.rate
                        ? ` e você passa para ${commission.projectedTier.label}.`
                        : "."}
                    </p>
                  )}

                  <button
                    type="button"
                    onClick={() => setLedgerOpen(o => !o)}
                    aria-expanded={ledgerOpen}
                    aria-controls="conta-do-saldo"
                    className="mt-2 inline-flex min-h-11 items-center gap-1 text-[12.5px] font-bold"
                    style={{ color: "var(--sf-text-muted)" }}
                  >
                    {ledgerOpen ? "Esconder a conta" : "Ver a conta"}
                    <ChevronDown size={14} aria-hidden className={`transition-transform ${ledgerOpen ? "rotate-180" : ""}`} />
                  </button>

                  <AnimatePresence initial={false}>
                    {ledgerOpen && (
                      <motion.div
                        id="conta-do-saldo"
                        key="conta"
                        initial={reduceMotion ? false : { opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={reduceMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
                        className="overflow-hidden"
                      >
                        {/* A conta do `computeSellerBalance`, linha por linha:
                            anterior + comissão − consumo + dívida paga − já pago. */}
                        <div className="pt-1" style={{ borderTop: "1px solid var(--sf-hairline)" }}>
                          {Math.abs(commission.priorBalance) > 0.01 && (
                            <LedgerLine
                              label="Dos meses anteriores"
                              value={commission.priorBalance}
                              sign={commission.priorBalance < 0 ? "−" : "+"}
                            />
                          )}
                          <LedgerLine
                            label={`Comissão de ${monthName} (${commission.tier.label} sobre venda paga)`}
                            value={commission.accrued}
                            sign="+"
                          />
                          {commission.consumoTotal > 0.01 && (
                            <>
                              <LedgerLine label="Seu consumo" value={commission.consumoTotal} sign="−" />
                              {consumoEntries.map(e => (
                                <ConsumptionRow key={`${e.kind}-${e.id}`} entry={e} productLabel={productLabel} />
                              ))}
                            </>
                          )}
                          {commission.debtPaymentsTotal > 0.01 && (
                            <LedgerLine label="Dívida que você pagou" value={commission.debtPaymentsTotal} sign="+" />
                          )}
                          {commission.commPaid > 0.01 && (
                            <LedgerLine label="Já pago a você" value={commission.commPaid} sign="−" />
                          )}
                          <div style={{ borderTop: "1px solid var(--sf-hairline)" }} className="mt-1">
                            <LedgerLine
                              label="Saldo"
                              value={balance}
                              sign={balance < -0.01 ? "−" : undefined}
                              strong
                            />
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </motion.section>
            )}

            {openGroups.length > 0 && (
              <motion.section variants={fadeUp} className="mt-7">
                <SectionTitle aside={
                  <span className="text-[15px] font-extrabold tabular-nums" style={{ color: "var(--sf-warn)" }}>
                    {fmt(openTotal)}
                  </span>
                }>
                  A receber
                </SectionTitle>
                <p className="-mt-1.5 mb-3 text-xs leading-snug" style={{ color: "var(--sf-text-muted)" }}>
                  De todos os meses. Sai daqui quando a loja registrar o pagamento, e só venda paga conta para a
                  sua faixa.
                </p>
                <div
                  className="overflow-hidden rounded-[18px]"
                  style={{ background: "var(--sf-surface)", border: "1px solid var(--sf-hairline)" }}
                >
                  {openGroups.map((g, i) => (
                    <OpenGroupRow
                      key={g.key}
                      group={g}
                      customer={customers[g.orderId ?? ""]}
                      itemsLabel={groupItems(g)}
                      divider={i > 0}
                    />
                  ))}
                </div>
              </motion.section>
            )}

            <motion.section variants={fadeUp} className="mt-7">
              <SectionTitle>Vendas recebidas · {monthName}</SectionTitle>
              {receivedSales.length === 0 ? (
                <p
                  className="rounded-[18px] py-12 text-center text-[13px]"
                  style={{ background: "var(--sf-surface)", color: "var(--sf-text-dim)" }}
                >
                  Nenhuma venda recebida em {monthName}.
                </p>
              ) : (
                <>
                  <p className="-mt-1.5 mb-3 text-xs" style={{ color: "var(--sf-text-muted)" }}>
                    {receivedSales.length === 1 ? "1 venda" : `${receivedSales.length} vendas`} · {receivedUnits} un. ·{" "}
                    <span className="tabular-nums" style={{ color: "var(--sf-accent)" }}>{fmt(receivedTotal)}</span>
                  </p>
                  <div
                    className="overflow-hidden rounded-[18px]"
                    style={{ background: "var(--sf-surface)", border: "1px solid var(--sf-hairline)" }}
                  >
                    {receivedSales.map((s, i) => (
                      <SaleRow key={s.id} sale={s} label={productLabel(s.productId)} divider={i > 0} />
                    ))}
                  </div>
                </>
              )}
            </motion.section>
          </motion.div>
        )}
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
          style={{ background: "var(--sf-bg)", colorScheme: "dark" }}
        >
          <div
            className="flex flex-shrink-0 items-center justify-between px-5 pb-3.5 pt-5"
            style={{ borderBottom: "1px solid var(--sf-hairline)" }}
          >
            <div className="min-w-0">
              <SheetTitle className="text-[19px] font-extrabold" style={{ color: "var(--sf-text)" }}>
                Meu estoque
              </SheetTitle>
              <p className="mt-0.5 truncate text-xs" style={{ color: "var(--sf-text-muted)" }}>
                {stock.units} un. · {stock.flavors} {stock.flavors === 1 ? "sabor" : "sabores"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setStockOpen(false)}
              aria-label="Fechar"
              className="flex h-10 w-10 flex-none items-center justify-center rounded-full"
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
                Nenhum produto com você ainda.
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
                      {/* Marca + modelo é o cabeçalho do grupo: cortado, dois
                          modelos da mesma marca viram o mesmo título. */}
                      <h3 className="min-w-0 break-words text-[12.5px] font-extrabold uppercase leading-snug tracking-[0.06em]">
                        {group.brand}
                        {group.model && <span style={{ color: "var(--sf-text-muted)" }}> {group.model}</span>}
                      </h3>
                      <span className="flex-none text-xs font-bold" style={{ color: "var(--sf-text-muted)" }}>
                        {group.units} un.
                      </span>
                    </div>
                    {group.lines.map((line, i) => (
                      <div
                        key={line.productId}
                        className="flex items-baseline justify-between gap-3 px-3.5 py-2.5"
                        style={i > 0 ? { borderTop: "1px solid var(--sf-hairline)" } : undefined}
                      >
                        <div className="min-w-0">
                          {/* Esta tela existe para CONFERIR o que está na mão
                              com o que o sistema diz. Sabor cortado é
                              exatamente a conferência que não dá para fazer. */}
                          <p className="break-words text-[13.5px] font-bold leading-snug">{line.flavor}</p>
                          {line.reserved > 0 && (
                            <p className="mt-0.5 text-xs" style={{ color: "var(--sf-warn)" }}>
                              {line.reserved} em pedido esperando
                            </p>
                          )}
                        </div>
                        <span className="flex-none text-[15px] font-extrabold tabular-nums">{line.quantity}</span>
                      </div>
                    ))}
                  </div>
                ))}

                <p className="px-1 text-xs leading-relaxed" style={{ color: "var(--sf-text-muted)" }}>
                  É o que o sistema diz que está com você. Pedido esperando ainda conta aqui:
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
