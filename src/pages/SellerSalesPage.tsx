import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { format, subMonths } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Ban, Check, ChevronDown, ChevronLeft, ChevronRight, Clock, Copy, LogOut, MessageCircle, Plus, Share2, X,
} from "lucide-react";

import { useStore } from "@/context/StoreContext";
import { useAuth } from "@/context/AuthContext";
import {
  usePendingOrders, ORDER_NOTE_MAX,
  type Order, type OrderActionResult,
} from "@/hooks/usePendingOrders";
import { useOrderCustomers } from "@/hooks/useOrderCustomers";
import {
  COMMISSION_TIERS, computeSellerBalance, computeSellerConsumption, currentBalanceContext, getNextTier,
  isCommissionSeller, PROJECT_START, unitsUntilNextTier, type ConsumptionEntry,
} from "@/lib/commissions";
import { buildSellerStock } from "@/lib/seller-stock";
import {
  firstName, groupOpenSales, mergeSaleLines, RESERVATION_HOURS, saleOpenAmount, tagOrderLines, tierLadder, tierUpgradeGain, whatsappLink,
  type OpenSaleGroup, type OrderLineTag,
} from "@/lib/seller-orders";
import { formatDateBR } from "@/lib/date-utils";
import { orderRef } from "@/lib/order-ref";
import { storeWhatsAppLink } from "@/lib/store-contact";
import { useRecentExpiredOrders } from "@/hooks/useRecentExpiredOrders";
import { fadeUp, stagger } from "@/lib/motion";
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
 * Vocabulário: "sua loja" é SÓ a vitrine do vendedor (/loja/<apelido>). O dono,
 * que registra pagamento e faz o acerto, é "a California" — com "loja" nos dois
 * papéis a tela chegou a dizer "a loja abre vazia até a loja te passar produto".
 *
 * Ordem da tela, do dono: pedidos esperando → comissão → a receber → vendas
 * recebidas do mês.
 *
 * Convenções de estilo (tokens, escala, movimento): ver src/pages/CLAUDE.md.
 */

const COLUMN = "mx-auto w-full max-w-[480px]";
/** O dono, nas frases da tela. Ver o bloco acima: "loja" é a vitrine do vendedor. */
const OWNER = "a California";

/** A partir de quanto falta o card passa a dizer "vence em". */
const EXPIRY_WARNING_HOURS = 6;
/** Abaixo disto o aviso de vencimento sobe de `--sf-warn` para `--sf-danger`. */
const EXPIRY_URGENT_MINUTES = 60;
/** Pedido com menos disto é "novo" e pulsa. Depois, pulsar é mentir. */
const NEW_ORDER_MINUTES = 60;
/** Quanto a confirmação fica na tela antes de sair sozinha. Recusa e vencido ficam até fechar. */
const CONFIRMED_NOTICE_MS = 8000;
/** Dívida com isto ou mais de idade mostra os dias ("há 34 dias") na linha. */
const OLD_DEBT_DAYS = 7;
/** Carregamento que passa disto ganha o "Recarregar" (§8: toda espera tem saída). */
const SLOW_LOAD_MS = 15000;
/** O relógio da tela: a contagem "vence em" e o "novo" andam sozinhos. */
const TICK_MS = 30000;

/** Rótulos pequenos da tela: 11.5px, o piso da escala da loja (§4). */
const LABEL = "text-[11.5px] font-bold uppercase tracking-[0.08em]";

function timeAgo(dateStr: string, now: number) {
  const diff = now - new Date(dateStr).getTime();
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
const minutesLeft = (createdAt: string, now: number) =>
  RESERVATION_HOURS * 60 - (now - new Date(createdAt).getTime()) / 60000;

/**
 * Arredonda para CIMA: com 1h20 sobrando, "Vence em 1h" encurtava o prazo que
 * o vendedor ainda tem. E mostra os minutos — "1h20" decide diferente de "1h".
 */
function leftLabel(minutes: number) {
  if (minutes <= 0) return "Venceu";
  const total = Math.ceil(minutes);
  if (total < 60) return `Vence em ${total} min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `Vence em ${h}h` : `Vence em ${h}h${String(m).padStart(2, "0")}`;
}

const isMySale = (s: Sale, sellerId?: string | null) =>
  s.sellerId === sellerId && (s.type || "venda") !== "retirada_funcionario";
const byDateDesc = (a: { date: string }, b: { date: string }) =>
  new Date(b.date).getTime() - new Date(a.date).getTime();
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const units = (order: Order) => (order.order_items ?? []).reduce((a, i) => a + i.quantity, 0);

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

/**
 * A mensagem que abre o WhatsApp do cliente. Já escrita porque é o momento em
 * que o vendedor está com pressa — e ele ainda edita antes de mandar.
 */
function customerMessage(kind: "declined" | "expired", order: Order, storeUrl: string | null) {
  const name = firstName(order.customers?.name);
  const hi = name ? `Oi, ${name}!` : "Oi!";
  const ref = orderRef(order.id);
  if (kind === "declined") return `${hi} Sobre o seu pedido ${ref}: não vou conseguir atender desta vez. Desculpa!`;
  return [
    `${hi} Seu pedido ${ref} passou de ${RESERVATION_HOURS}h e a reserva venceu.`,
    storeUrl ? `Se ainda quiser, é só fazer de novo no catálogo: ${storeUrl}` : "",
  ].filter(Boolean).join(" ");
}

type SellerPeriod = "month" | "lastMonth";

/* ------------------------------------------------------------------ */
/* Peças                                                                */
/* ------------------------------------------------------------------ */

/**
 * O mês da comissão e das vendas recebidas. Mora no cabeçalho da comissão, e
 * não no topo da tela: ali ele ficava em cima dos pedidos, que não seguem
 * período nenhum.
 *
 * Só este mês e o passado: a comissão fecha por MÊS e a faixa é do mês. A seta
 * da ponta fica `aria-disabled`, não `disabled`: desligar o botão que acabou de
 * ser apertado mandava o foco para o <body>.
 */
function MonthStepper({ period, label, onChange }: { period: SellerPeriod; label: string; onChange: (p: SellerPeriod) => void }) {
  const arrow = (target: SellerPeriod, aria: string, icon: ReactNode) => {
    const off = period === target;
    return (
      <button
        type="button"
        onClick={() => !off && onChange(target)}
        aria-disabled={off}
        aria-label={aria}
        className={`flex h-11 w-11 items-center justify-center rounded-full ${off ? "cursor-default opacity-30" : ""}`}
        style={{ color: "var(--sf-text)" }}
      >
        {icon}
      </button>
    );
  };
  return (
    <div className="-mr-2 flex flex-none items-center" role="group" aria-label="Mês">
      {arrow("lastMonth", "Mês anterior", <ChevronLeft size={18} />)}
      <span className="min-w-[80px] text-center text-[13px] font-bold" aria-live="polite">
        {label}
      </span>
      {arrow("month", "Próximo mês", <ChevronRight size={18} />)}
    </div>
  );
}

/** Seção: 15px caixa-alta, o papel "seção" da escala da loja (§4). */
function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className={`flex items-center justify-between gap-3 ${aside ? "mb-2" : "mb-3"}`}>
      <h2 className="text-[15px] font-extrabold uppercase tracking-[0.06em]">{children}</h2>
      {aside}
    </div>
  );
}

/** Uma linha de consumo dentro da conta do saldo: detalhe da linha "Seu consumo", mais apagado que ela. */
function ConsumptionRow({ entry, productLabel }: { entry: ConsumptionEntry; productLabel: (id: string) => ReactNode }) {
  const title =
    entry.kind === "retirada" && entry.sale
      ? productLabel(entry.sale.productId)
      : entry.debt?.notes?.trim() || "Dívida sem descrição";
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 pl-3" style={{ color: "var(--sf-text-muted)" }}>
      <div className="min-w-0">
        <p className="break-words text-xs leading-snug">{title}</p>
        <p className="text-xs">
          {formatDateBR(entry.date)}
          {entry.kind === "retirada" && entry.sale ? ` · ${entry.sale.quantity} un. pelo custo` : ""}
        </p>
      </div>
      <span className="flex-none text-xs tabular-nums">−{fmt(entry.amount)}</span>
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

/**
 * Link de WhatsApp em pílula. `solid` quando é A ação que sobrou (avisar da
 * recusa); secundário quando é consequência de algo que já acabou (vencido no
 * fim da lista, que não pode disputar o polegar com um pedido vivo).
 */
function WhatsAppPill({
  href, label, linkRef, variant = "solid",
}: { href: string; label: string; linkRef?: Ref<HTMLAnchorElement>; variant?: "solid" | "quiet" }) {
  return (
    <a
      ref={linkRef}
      href={href}
      target="_blank"
      rel="noreferrer"
      className={`flex items-center justify-center gap-2 rounded-full font-extrabold ${
        variant === "solid" ? "h-12 text-[13.5px]" : "min-h-11 flex-none whitespace-nowrap px-4 text-[12.5px]"
      }`}
      style={
        variant === "solid"
          ? { background: "var(--sf-accent)", color: "var(--sf-accent-ink)" }
          : { background: "var(--sf-surface-2)", color: "var(--sf-text)" }
      }
    >
      <MessageCircle size={variant === "solid" ? 16 : 14} aria-hidden />
      {label}
    </a>
  );
}

/**
 * Pedido vencido, recolhido no fim da lista: não há o que decidir (o banco
 * recusa), só avisar o cliente. Inteiro e no topo, ele empurrava para baixo o
 * pedido que vencia em 9 minutos.
 */
function ExpiredOrderRow({
  order, storeUrl, away, onDismiss,
}: {
  order: Order;
  storeUrl: string | null;
  /** Venceu com a tela fechada: vem da busca de vencidos, e o vendedor dispensa quando quiser. */
  away?: boolean;
  onDismiss?: () => void;
}) {
  const reduce = useReducedMotion();
  const name = order.customers?.name?.trim() || "Sem nome";
  const wa = whatsappLink(order.customers?.whatsapp, customerMessage("expired", order, storeUrl));
  return (
    <motion.article
      layout={!reduce}
      initial={reduce ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      aria-label={`Pedido vencido de ${name}`}
      className="rounded-[20px] px-4 py-3"
      style={{ background: "var(--sf-surface)", border: "1px solid var(--sf-hairline)" }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="break-words text-[13.5px] font-bold leading-snug">{name}</h3>
          {/* "Venceu" sozinho não dizia o que aconteceu: diz o porquê, e o
              quanto e qual pedido, para o vendedor saber de quem se trata. */}
          <p className="text-xs leading-snug" style={{ color: "var(--sf-text-muted)" }}>
            <span className="inline-flex items-center gap-1 font-semibold" style={{ color: "var(--sf-danger)" }}>
              <Clock size={12} aria-hidden />
              {away ? "Venceu enquanto você estava fora" : `Venceu: passou de ${RESERVATION_HOURS}h sem confirmar`}
            </span>{" "}
            · {fmt(order.total_amount)} · {orderRef(order.id)}
          </p>
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label={`Dispensar o aviso do pedido de ${name}`}
            className="flex h-11 w-11 flex-none items-center justify-center rounded-full"
            style={{ color: "var(--sf-text-muted)" }}
          >
            <X size={15} />
          </button>
        )}
      </div>
      {wa && (
        <div className="mt-2 flex">
          <WhatsAppPill href={wa} label={`Avisar ${firstName(name) || "o cliente"} no WhatsApp`} variant="quiet" />
        </div>
      )}
    </motion.article>
  );
}

/** Pedido chegando: o essencial visível sem rolar e as duas ações no polegar. */
function OrderCard({
  order,
  now,
  processing,
  busy,
  basePrice,
  onConfirm,
  onDecline,
}: {
  order: Order;
  now: number;
  processing: boolean;
  /** Outro pedido está sendo processado: este espera, e diz por quê. */
  busy: boolean;
  basePrice: (productId: string) => number | undefined;
  onConfirm: (order: Order, note: string) => Promise<OrderActionResult>;
  onDecline: (order: Order) => Promise<OrderActionResult>;
}) {
  const reduce = useReducedMotion();
  const baseId = useId();
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const ageMinutes = (now - new Date(order.created_at).getTime()) / 60000;
  const left = minutesLeft(order.created_at, now);
  const expiring = left <= EXPIRY_WARNING_HOURS * 60;
  const urgent = left < EXPIRY_URGENT_MINUTES;
  const isNew = ageMinutes < NEW_ORDER_MINUTES;
  const tags = useMemo(() => tagOrderLines(order.order_items ?? [], basePrice), [order.order_items, basePrice]);
  const name = order.customers?.name?.trim() || "Sem nome";
  const phone = order.customers?.whatsapp;
  const wa = whatsappLink(phone);
  const disabled = processing || busy;
  const alertColor = urgent ? "var(--sf-danger)" : "var(--sf-warn)";

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
      aria-labelledby={`${baseId}-name`}
      aria-busy={processing}
      className="rounded-[20px] p-4"
      style={{
        background: "var(--sf-surface)",
        border: `1px solid ${expiring ? alertColor : "var(--sf-accent-line)"}`,
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {expiring ? (
            // Urgência sobe de FORMA, não só de cor: o laranja e o vermelho da
            // loja ficam a ~10° um do outro, e "vence em 10 min" parecia igual a
            // "vence em 1h20". Abaixo de 1h o selo vira cheio.
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 ${LABEL}`}
              style={
                urgent
                  ? { background: "var(--sf-danger)", color: "var(--sf-accent-ink)" }
                  : { background: "var(--sf-surface-2)", color: alertColor }
              }
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
                    // Chama a atenção na chegada e para: pulsando para sempre
                    // ele deixava de dizer "chegou agora".
                    style={{ background: "var(--sf-accent)", animationIterationCount: 6 }}
                  />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ background: "var(--sf-accent)" }} />
                </span>
              )}
              {isNew ? "Novo pedido" : "Pedido"}
            </span>
          )}
          {/* Nome composto cortado é o vendedor sem saber para quem vai
              entregar — mesmo motivo dos itens logo abaixo. */}
          <h3 id={`${baseId}-name`} className="mt-2 break-words text-base font-bold leading-tight">
            {name}
          </h3>
          <p className="flex flex-wrap items-center gap-x-2 text-xs" style={{ color: "var(--sf-text-muted)" }}>
            {wa ? (
              // 44px de altura: é o alvo mais usado do card depois dos botões,
              // e fica colado no nome — dedo grande erra para o título.
              <a
                href={wa}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-11 items-center gap-1 font-semibold underline decoration-dotted underline-offset-4"
                style={{ color: "var(--sf-text)" }}
                aria-label={`WhatsApp de ${name}: ${phone}`}
              >
                <MessageCircle size={13} aria-hidden />
                {phone}
              </a>
            ) : (
              <span className="inline-flex min-h-11 items-center">{phone ?? "Sem WhatsApp"}</span>
            )}
            {/* A mesma referência que vai na mensagem que o cliente manda para
                a California: é ela que casa a conversa com o card quando a
                mesma pessoa faz dois pedidos no mesmo dia. */}
            <span className="tabular-nums" title="Número do pedido, o mesmo da mensagem que o cliente mandou para a California">
              {orderRef(order.id)}
            </span>
          </p>
        </div>
        <div className="flex-none text-right">
          <p className="text-lg font-extrabold leading-tight tabular-nums" style={{ color: "var(--sf-accent)" }}>
            {fmt(order.total_amount)}
          </p>
          {/* Uma hora só por card: quando o selo já diz "vence em", "há 22h"
              repetiria a mesma informação do outro lado. */}
          {!expiring && (
            <p className="mt-0.5 text-xs" style={{ color: "var(--sf-text-muted)" }}>
              {timeAgo(order.created_at, now)}
            </p>
          )}
        </div>
      </div>

      <ul className="mt-2 space-y-2 rounded-2xl px-3.5 py-2.5" style={{ background: "var(--sf-surface-2)" }}>
        {order.order_items?.map(item => {
          const tag = tags.get(item.id);
          return (
            <li key={item.id} className="flex items-baseline justify-between gap-2 text-[13px]">
              {/* Sem `truncate`: esta lista é o que o cliente pediu, e é por
                  ela que o vendedor decide. Item cortado vira chute. */}
              <span className="min-w-0 flex-1 break-words leading-snug">
                <span className="font-extrabold">{item.quantity}×</span>{" "}
                <ProductName {...productParts(item.products)} />
                {/* O selo tem linha própria: ao lado do nome ele ora cabia, ora
                    caía, e o mesmo pedido tinha duas caras. */}
                {tag && (
                  <span className="mt-1 flex">
                    <span
                      className="rounded-full px-2 py-0.5 text-[11.5px] font-bold"
                      style={{ background: "var(--sf-accent-tint)", color: "var(--sf-accent)" }}
                    >
                      {TAG_LABEL[tag]}
                    </span>
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

      {/* Anotação da venda: o que o vendedor quer que a California saiba
          ("pagou em dinheiro", "entrega dia 20"). Fechada por padrão — é
          exceção, e aberta ela empurraria as ações para fora do polegar. Vai
          para a nota da venda, antes da referência. */}
      {noteOpen ? (
        <div className="mt-3">
          <div className="flex items-baseline justify-between gap-2">
            <label htmlFor={`${baseId}-note`} className="text-xs font-semibold" style={{ color: "var(--sf-text-muted)" }}>
              Anotação para a California (opcional)
            </label>
            {/* O limite do banco (80) à vista, antes de a pessoa bater nele. */}
            <span
              id={`${baseId}-note-count`}
              className="flex-none text-xs tabular-nums"
              style={{ color: note.length >= ORDER_NOTE_MAX ? "var(--sf-warn)" : "var(--sf-text-muted)" }}
            >
              {note.length}/{ORDER_NOTE_MAX}
            </span>
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <input
              id={`${baseId}-note`}
              value={note}
              onChange={e => setNote(e.target.value)}
              maxLength={ORDER_NOTE_MAX}
              aria-describedby={`${baseId}-note-count`}
              placeholder="ex.: pagou em dinheiro"
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
          aria-label={`Anotar algo na venda de ${name}`}
          className="mt-1 inline-flex min-h-11 items-center gap-1.5 text-[12.5px] font-bold"
          style={{ color: "var(--sf-text-muted)" }}
        >
          <Plus size={14} aria-hidden />
          Anotar algo na venda
        </button>
      )}

      {/* `aria-disabled`, não `disabled`: desligar o botão que acabou de ser
          tocado mandava o foco para o <body> durante a confirmação, e o leitor
          de tela nunca ouvia o "Confirmando". O clique ocupado não faz nada. */}
      <div className={`${noteOpen ? "mt-3" : "mt-1"} grid grid-cols-3 gap-2`}>
        <button
          type="button"
          aria-disabled={disabled}
          onClick={() => !disabled && run(() => onDecline(order))}
          aria-label={`Recusar pedido de ${name}`}
          className={`flex h-12 items-center justify-center rounded-full text-[13px] font-bold ${disabled ? "cursor-default opacity-40" : ""}`}
          style={{ background: "var(--sf-surface-2)", color: "var(--sf-text-muted)" }}
        >
          Recusar
        </button>
        <button
          type="button"
          aria-disabled={disabled}
          onClick={() => !disabled && run(() => onConfirm(order, note))}
          aria-label={processing ? `Confirmando pedido de ${name}` : `Confirmar pedido de ${name}`}
          className="col-span-2 flex h-12 items-center justify-center gap-2 rounded-full text-[13.5px] font-extrabold"
          // Ocupado: o preenchimento esmaece (§6), mas a tinta passa a ser a
          // clara — a escura sobre o accent a 30% dava ~2:1 e "Confirmando…"
          // era justamente o que a pessoa precisava ler.
          style={{
            background: disabled ? "var(--sf-accent-soft)" : "var(--sf-accent)",
            color: disabled ? "var(--sf-text)" : "var(--sf-accent-ink)",
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
        busy && (
          <p className="mt-2.5 text-xs leading-snug" style={{ color: "var(--sf-text-muted)" }}>
            Esperando o outro pedido terminar.
          </p>
        )
      )}
    </motion.article>
  );
}

type NoticeKind = "confirmed" | "declined" | "expired" | "gone";
type Notice = {
  key: string;
  kind: NoticeKind;
  order: Order;
  /** O aviso nasceu de um gesto do vendedor (confirmar, recusar, confirmar vencido): o foco vai para ele. */
  focus?: boolean;
};

/**
 * O fim de um pedido, NO LUGAR do card — os avisos entram na mesma lista dos
 * pedidos, na posição do pedido que acabou. Num bloco acima da lista, a
 * confirmação do terceiro card nascia 600px acima da tela e sumia sem ser vista.
 *
 * Recusado e vencido trazem o "Avisar no WhatsApp" com a mensagem pronta e
 * ficam até o vendedor fechar. Confirmado sai sozinho, mas só depois que o
 * vendedor SAI dele: enquanto o foco está no aviso (e ele vai para lá depois do
 * toque em "Confirmar"), com o dedo ou o mouse em cima, o relógio não anda. Quem
 * foi interrompido volta e o aviso ainda está lá; quem usa leitor de tela lê no
 * ritmo dele.
 *
 * Confirmar não tem volta para o vendedor (estoque e venda já foram gravados),
 * então o aviso entrega o caminho de volta: avisar a California, com o pedido
 * já escrito na mensagem.
 */
function OrderNotice({ notice, storeUrl, onClose }: { notice: Notice; storeUrl: string | null; onClose: () => void }) {
  const reduce = useReducedMotion();
  const { kind, order } = notice;
  const name = order.customers?.name?.trim() || "cliente";
  const boxRef = useRef<HTMLDivElement>(null);
  const actionRef = useRef<HTMLAnchorElement>(null);
  const titleId = useId();
  const [paused, setPaused] = useState(false);
  const wa =
    kind === "declined" || kind === "expired"
      ? whatsappLink(order.customers?.whatsapp, customerMessage(kind, order, storeUrl))
      : null;
  const undoHref =
    kind === "confirmed"
      ? storeWhatsAppLink(
          `Oi! Confirmei por engano o pedido ${orderRef(order.id)} de ${name} (${fmt(order.total_amount)}). Pode desfazer?`,
        )
      : null;

  useEffect(() => {
    if (!notice.focus) return;
    // Recusado: o foco vai para a próxima ação (avisar). Confirmado: para o
    // próprio aviso, que o leitor de tela lê inteiro.
    (actionRef.current ?? boxRef.current)?.focus();
    // Só na montagem: o foco acompanha o gesto que criou o aviso, uma vez.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (kind !== "confirmed" || paused) return;
    const t = window.setTimeout(onClose, CONFIRMED_NOTICE_MS);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, paused]);

  const n = units(order);
  const copy: Record<NoticeKind, { title: string; body: string }> = {
    confirmed: {
      title: `Pedido de ${name} confirmado!`,
      body: `${n === 1 ? "1 un. saiu" : `${n} un. saíram`} do seu estoque · ${fmt(order.total_amount)} foi para A receber.`,
    },
    declined: { title: `Pedido de ${name} recusado.`, body: "A reserva voltou para o catálogo. Avise o cliente:" },
    expired: {
      title: `O pedido de ${name} venceu.`,
      body: `Passou de ${RESERVATION_HOURS}h e a reserva foi liberada.`,
    },
    gone: { title: `O pedido de ${name} saiu da lista.`, body: `${capitalize(OWNER)} já confirmou ou recusou por lá.` },
  };
  const good = kind === "confirmed";

  return (
    <motion.div
      ref={boxRef}
      layout={!reduce}
      initial={reduce ? false : { opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0 }}
      tabIndex={-1}
      // Sem `role`/`aria-label`: o rótulo repetia o título, e o leitor de tela
      // lia a frase duas vezes. Focado, o aviso é lido pelo conteúdo.
      aria-labelledby={titleId}
      data-notice={notice.key}
      onFocus={() => setPaused(true)}
      onBlur={e => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPaused(false);
      }}
      onPointerDown={() => setPaused(true)}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => {
        if (!boxRef.current?.contains(document.activeElement)) setPaused(false);
      }}
      className="rounded-[20px] px-4 py-3 outline-none"
      style={
        good
          ? { background: "var(--sf-accent-tint)", border: "1px solid var(--sf-accent-line)" }
          : { background: "var(--sf-surface)", border: "1px solid var(--sf-hairline)" }
      }
    >
      <div className="flex items-center gap-3">
        <span
          className="flex h-8 w-8 flex-none items-center justify-center rounded-full"
          style={
            good
              ? { background: "var(--sf-accent)", color: "var(--sf-accent-ink)" }
              : { background: "var(--sf-surface-2)", color: "var(--sf-text-muted)" }
          }
          aria-hidden
        >
          {/* O ícone do estado não repete o "X" de fechar ao lado. */}
          {kind === "expired" ? <Clock size={15} /> : kind === "declined" ? <Ban size={15} /> : <Check size={16} strokeWidth={2.8} />}
        </span>
        <div className="min-w-0 flex-1">
          <h3 id={titleId} className="break-words text-[13.5px] font-bold leading-snug">{copy[kind].title}</h3>
          <p className="text-xs leading-snug" style={{ color: "var(--sf-text-muted)" }}>
            {copy[kind].body}
          </p>
          {undoHref && (
            <a
              href={undoHref}
              target="_blank"
              rel="noreferrer"
              className="-my-1 inline-flex min-h-11 items-center text-xs font-bold underline underline-offset-4"
              style={{ color: "var(--sf-text)" }}
            >
              Confirmou por engano? Avise a California
            </a>
          )}
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
      </div>
      {wa && (
        <div className={kind === "declined" ? "mt-2.5" : "mt-2 flex"}>
          {/* Recusado: avisar é A ação que sobrou (cheia). Vencido: a mesma
              pílula discreta da linha de vencido — duas caras para o mesmo
              estado confundiam. */}
          <WhatsAppPill
            href={wa}
            label={`Avisar ${firstName(name) || "o cliente"} no WhatsApp`}
            linkRef={actionRef}
            variant={kind === "declined" ? "solid" : "quiet"}
          />
        </div>
      )}
    </motion.div>
  );
}

/**
 * Uma linha de "A receber": um pedido (todos os sabores dele), SÓ LEITURA.
 *
 * O vendedor não marca recebimento: quem diz que o dinheiro chegou é o dono,
 * na tela de Vendas, depois de ver o dinheiro na conta. Aqui a linha serve para
 * o vendedor saber quem ainda deve e cobrar — por isso o nome, a idade da
 * dívida e o "Cobrar" com a mensagem pronta.
 *
 * `withSeller` (`dinheiro_com_vendedor`) é outra conta: o cliente já pagou, em
 * dinheiro, e quem deve é o VENDEDOR, à California. Por isso mora em bloco
 * próprio, fora do total do que os clientes devem.
 */
function OpenGroupRow({
  group,
  customer,
  itemsLabel,
  now,
  divider,
  withSeller,
}: {
  group: OpenSaleGroup;
  customer: { name: string; whatsapp: string } | null | undefined;
  itemsLabel: ReactNode;
  now: number;
  divider: boolean;
  withSeller: boolean;
}) {
  const name = customer?.name?.trim();
  const title = name || (group.orderId ? `Pedido ${orderRef(group.orderId)}` : "Venda sem pedido");
  const days = Math.floor((now - new Date(group.date).getTime()) / 86400000);
  const first = firstName(name);
  const chargeText = [
    first ? `Oi, ${first}!` : "Oi!",
    `Passando para lembrar ${group.orderId ? `do pedido ${orderRef(group.orderId)}` : "da compra"} de ${formatDateBR(group.date)}:`,
    `ficou ${fmt(group.open)} em aberto. Me avisa quando puder acertar?`,
  ].join(" ");
  const wa = withSeller ? null : whatsappLink(customer?.whatsapp, chargeText);

  return (
    <div className="px-3.5 py-3" style={divider ? { borderTop: "1px solid var(--sf-hairline)" } : undefined}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-words text-[13.5px] font-bold leading-snug">{title}</p>
          <p className="mt-0.5 break-words text-[12.5px] leading-snug">{itemsLabel}</p>
          <p className="mt-0.5 text-xs" style={{ color: "var(--sf-text-muted)" }}>
            {formatDateBR(group.date)}
            {!withSeller && days >= OLD_DEBT_DAYS && (
              <span className="font-semibold" style={{ color: "var(--sf-text)" }}> · há {days} dias</span>
            )}
            {" "}· {group.units} un.
            {group.orderId && name ? ` · ${orderRef(group.orderId)}` : ""}
            {group.note ? ` · ${group.note}` : ""}
          </p>
        </div>
        <div className="flex flex-none flex-col items-end">
          <p
            className="text-[14px] font-extrabold tabular-nums"
            style={{ color: withSeller ? "var(--sf-text)" : "var(--sf-warn)" }}
          >
            {fmt(group.open)}
          </p>
          {wa && (
            <a
              href={wa}
              target="_blank"
              rel="noreferrer"
              aria-label={`Cobrar ${name ?? "o cliente"} no WhatsApp`}
              className="-mr-1 mt-0.5 inline-flex min-h-11 items-center gap-1 px-1 text-[12.5px] font-bold"
              style={{ color: "var(--sf-text)" }}
            >
              <MessageCircle size={14} aria-hidden />
              Cobrar
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

/** O link da loja com copiar e compartilhar. O mesmo no card de boas-vindas e no sheet "Minha loja". */
function StoreLinkPanel({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  // Navegador embutido do Instagram/WhatsApp costuma negar a área de
  // transferência: a falha era muda e o vendedor achava que tinha copiado.
  const [copyFailed, setCopyFailed] = useState(false);
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopyFailed(false);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
      setCopyFailed(true);
    }
  };
  return (
    <>
      {/* `select-all`: um toque seleciona o link inteiro, o plano B quando o
          copiar falha. */}
      <p
        className="mt-3 select-all break-all rounded-[14px] px-3 py-2.5 text-[13px] font-semibold"
        style={{ background: "var(--sf-surface-2)" }}
      >
        {url}
      </p>
      {copyFailed && (
        <p role="alert" className="mt-2 text-[12.5px] font-semibold leading-snug" style={{ color: "var(--sf-danger)" }}>
          Não deu para copiar daqui. Toque no link acima e segure para copiar.
        </p>
      )}
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
    </>
  );
}

function Money({ value, tone }: { value: number; tone: "accent" | "warn" | "plain" }) {
  const color = tone === "accent" ? "var(--sf-accent)" : tone === "warn" ? "var(--sf-warn)" : "var(--sf-text)";
  return <span className="tabular-nums" style={{ color }}>{fmt(value)}</span>;
}

/** Linha da conta do saldo. Em texto cheio: os detalhes (consumo) é que ficam apagados, embaixo dela. */
function LedgerLine({ label, value, sign, strong }: { label: ReactNode; value: number; sign?: "+" | "−"; strong?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 ${strong ? "pt-2 text-[13.5px] font-extrabold" : "py-1 text-[12.5px]"}`}>
      <span className="min-w-0">{label}</span>
      <span className="flex-none tabular-nums">
        {sign ?? ""}{fmt(Math.abs(value))}
      </span>
    </div>
  );
}

/** Topo de sheet da tela: título, resumo e fechar. */
function SheetTop({ title, subtitle, onClose }: { title: string; subtitle?: string; onClose: () => void }) {
  return (
    <div
      className="flex flex-shrink-0 items-center justify-between px-5 pb-3.5 pt-5"
      style={{ borderBottom: "1px solid var(--sf-hairline)" }}
    >
      <div className="min-w-0">
        <SheetTitle className="text-[19px] font-extrabold" style={{ color: "var(--sf-text)" }}>
          {title}
        </SheetTitle>
        {subtitle && (
          <p className="mt-0.5 truncate text-xs" style={{ color: "var(--sf-text-muted)" }}>
            {subtitle}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Fechar"
        className="flex h-11 w-11 flex-none items-center justify-center rounded-full"
        style={{ background: "var(--sf-surface)", color: "var(--sf-text)" }}
      >
        <X size={16} />
      </button>
    </div>
  );
}

const PILL_BUTTON =
  "flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-full px-4 text-[12.5px] font-bold";
const PILL_BUTTON_STYLE = { background: "var(--sf-surface)", border: "1px solid var(--sf-border)", color: "var(--sf-text)" };

type ListRow =
  | { type: "order"; key: string; createdAt: string; tail: boolean; order: Order }
  | { type: "notice"; key: string; createdAt: string; tail: boolean; notice: Notice }
  /** Venceu com a tela fechada (`useRecentExpiredOrders`). */
  | { type: "away"; key: string; createdAt: string; tail: true; order: Order };

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
  // Vencidos com a tela fechada: a lista só lê `pendente`, então sem isto eles
  // não existiam para o vendedor (ver o hook).
  const { expiredOrders: awayExpired, dismissExpired } = useRecentExpiredOrders(sellerId);
  // Quando o vendedor pediu a lista de novo: é o que o erro repetido mostra, e
  // o que diz que o "Tentar de novo" fez alguma coisa.
  const [retriedAt, setRetriedAt] = useState<Date | null>(null);
  const refreshOrders = () => {
    setRetriedAt(new Date());
    fetchPendingOrders();
  };

  const [period, setPeriod] = useState<SellerPeriod>("month");
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [stockOpen, setStockOpen] = useState(false);
  const [storeOpen, setStoreOpen] = useState(false);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [announcement, setAnnouncement] = useState("");
  const stockButtonRef = useRef<HTMLButtonElement>(null);
  const storeButtonRef = useRef<HTMLButtonElement>(null);

  // O relógio da tela: sem ele, "Vence em 1h" ficava parado até alguma outra
  // coisa redesenhar o card, e o pedido vencia com o botão ainda aceso.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(t);
  }, []);

  const [slowLoad, setSlowLoad] = useState(false);
  useEffect(() => {
    if (!loading) {
      setSlowLoad(false);
      return;
    }
    const t = window.setTimeout(() => setSlowLoad(true), SLOW_LOAD_MS);
    return () => window.clearTimeout(t);
  }, [loading]);

  // Aviso que sai com o foco dentro dele (fechado ou vencido o tempo) leva o
  // foco para o título dos pedidos: sem isso ele caía no <body> e quem navega
  // por teclado recomeçava do topo.
  const ordersTitleRef = useRef<HTMLDivElement>(null);
  const dismiss = useCallback((key: string) => {
    const box = document.querySelector(`[data-notice="${key}"]`);
    if (box?.contains(document.activeElement)) ordersTitleRef.current?.focus({ preventScroll: true });
    setNotices(prev => prev.filter(n => n.key !== key));
  }, []);

  const mySeller = sellers.find(s => s.id === sellerId) ?? null;
  const storeUrl = mySeller ? `${window.location.origin}/loja/${mySeller.slug || mySeller.id}` : null;
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
  // Distribuição e do Dashboard: com o mês corrente o saldo aqui é, por
  // construção, o número que o admin vê do outro lado.
  const anchor = useMemo(() => (period === "lastMonth" ? subMonths(new Date(), 1) : new Date()), [period]);
  const monthName = format(anchor, "MMMM", { locale: ptBR });
  const balanceCtx = useMemo(
    () => currentBalanceContext({ sales, commissionPayments, sellerDebtPayments, sellerManualDebts }, anchor),
    [sales, commissionPayments, sellerDebtPayments, sellerManualDebts, anchor],
  );
  const inMonth = useCallback(
    (iso: string) => {
      const ts = new Date(iso).getTime();
      return !isNaN(ts) && ts >= balanceCtx.start.getTime() && ts <= balanceCtx.end.getTime();
    },
    [balanceCtx],
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
  // com as "un. pagas" do bloco da comissão, e a receita daqui é a base do
  // que a próxima faixa reprecifica. A que falta pagar mora em "A receber".
  const receivedSales = useMemo(
    () => sales.filter(s => isMySale(s, sellerId) && saleOpenAmount(s) <= 0.01 && inMonth(s.date)).sort(byDateDesc),
    [sales, sellerId, inMonth],
  );
  const receivedUnits = receivedSales.reduce((a, s) => a + s.quantity, 0);
  const receivedTotal = receivedSales.reduce((a, s) => a + s.totalPrice, 0);
  // O mês ainda tem venda em aberto: a faixa dele pode mudar quando ela for paga.
  const monthStillOpen = sales.some(s => isMySale(s, sellerId) && saleOpenAmount(s) > 0.01 && inMonth(s.date));

  // "A receber" não segue o período: venda em aberto não some na virada do
  // mês, e é justamente ela que falta cobrar. Legado (antes do PROJECT_START)
  // não é cobrança de ninguém. Duas contas, dois sentidos do dinheiro: o que os
  // CLIENTES devem, e o que já está com o vendedor para acertar com a California.
  const openGroups = useMemo(() => groupOpenSales(sales, sellerId, PROJECT_START), [sales, sellerId]);
  const isWithSeller = (g: OpenSaleGroup) => g.sales.every(s => s.paymentMethod === "dinheiro_com_vendedor");
  const clientGroups = openGroups.filter(g => !isWithSeller(g));
  const withSellerGroups = openGroups.filter(isWithSeller);
  const clientTotal = clientGroups.reduce((a, g) => a + g.open, 0);
  const withSellerTotal = withSellerGroups.reduce((a, g) => a + g.open, 0);
  const customers = useOrderCustomers(
    useMemo(
      () => openGroups.map(g => g.orderId).filter((id): id is string => !!id),
      [openGroups],
    ),
  );

  const isExpired = useCallback((o: Order) => minutesLeft(o.created_at, now) <= 0, [now]);
  const waitingCount = pendingOrders.filter(o => !isExpired(o)).length;

  /**
   * Pedidos e avisos numa lista só, para o aviso nascer no lugar do card.
   * Vivos pelo tempo que falta (o mais perto de vencer no topo); vencidos, e o
   * aviso de vencido, no fim — eles não têm mais o que decidir.
   */
  const rows = useMemo<ListRow[]>(() => {
    // O que venceu com a tela fechada entra no fim, com os outros vencidos —
    // menos o que a própria sessão já está mostrando (card ou aviso).
    const shown = new Set([...pendingOrders.map(o => o.id), ...notices.map(n => n.order.id)]);
    const list: ListRow[] = [
      ...pendingOrders.map<ListRow>(o => ({ type: "order", key: o.id, createdAt: o.created_at, tail: isExpired(o), order: o })),
      ...notices.map<ListRow>(n => ({
        type: "notice", key: n.key, createdAt: n.order.created_at, tail: n.kind === "expired", notice: n,
      })),
      ...awayExpired
        .filter(o => !shown.has(o.id))
        .map<ListRow>(o => ({ type: "away", key: `away-${o.id}`, createdAt: o.created_at, tail: true, order: o })),
    ];
    return list.sort(
      (a, b) => Number(a.tail) - Number(b.tail) || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
  }, [pendingOrders, notices, awayExpired, isExpired]);

  /**
   * Pedido que sai da lista sem passar por um gesto daqui (venceu na
   * atualização, ou a California confirmou/recusou pelo ERP) não some calado:
   * vira aviso. E pedido novo que chega na atualização é anunciado para quem
   * usa leitor de tela. `handled` marca o que este vendedor está confirmando ou
   * recusando AGORA — marcado ANTES da chamada, porque o hook tira o pedido da
   * lista antes de devolver o resultado.
   *
   * A primeira carga não conta como "chegou": a linha de base só existe depois
   * que o hook terminou de carregar pela primeira vez.
   */
  const handled = useRef(new Set<string>());
  const expiredByServer = useRef(new Set<string>());
  const baseline = useRef<Order[] | null>(null);
  const sawLoading = useRef(false);
  useEffect(() => {
    if (loadingOrders) {
      sawLoading.current = true;
      return;
    }
    if (baseline.current === null) {
      if (sawLoading.current) baseline.current = pendingOrders;
      return;
    }
    const previous = baseline.current;
    baseline.current = pendingOrders;
    const current = new Set(pendingOrders.map(o => o.id));
    const before = new Set(previous.map(o => o.id));
    const vanished = previous.filter(o => !current.has(o.id) && !handled.current.has(o.id));
    const arrived = pendingOrders.filter(o => !before.has(o.id));

    const created = vanished.map<Notice>(o => {
      const byServer = expiredByServer.current.has(o.id);
      const expired = byServer || minutesLeft(o.created_at, Date.now()) <= 0;
      return { key: `${expired ? "expired" : "gone"}-${o.id}`, kind: expired ? "expired" : "gone", order: o, focus: byServer };
    });
    if (created.length > 0) {
      setNotices(prev => [...created, ...prev.filter(n => !vanished.some(o => o.id === n.order.id))]);
    }

    const said: string[] = [];
    if (arrived.length === 1) said.push(`Pedido novo de ${arrived[0].customers?.name?.trim() || "cliente"}.`);
    else if (arrived.length > 1) said.push(`${arrived.length} pedidos novos.`);
    for (const n of created) if (!n.focus) said.push(n.kind === "expired" ? `Pedido de ${n.order.customers?.name ?? "cliente"} venceu.` : `Pedido de ${n.order.customers?.name ?? "cliente"} saiu da lista.`);
    if (said.length > 0) setAnnouncement(said.join(" "));
  }, [pendingOrders, loadingOrders]);

  const stock = useMemo(
    () => buildSellerStock(sellerId, { productAssignments, products, pendingOrders, productName: getProductName }),
    [sellerId, productAssignments, products, pendingOrders, getProductName],
  );

  const neverSold = !sales.some(s => isMySale(s, sellerId));

  const handleConfirm = async (order: Order, note: string) => {
    handled.current.add(order.id);
    // O rótulo do botão muda para "Confirmando", mas leitor de tela não anuncia
    // troca de rótulo: a região viva diz.
    setAnnouncement(`Confirmando pedido de ${order.customers?.name?.trim() || "cliente"}…`);
    const result = await confirmOrder(order.id, "pendente", note);
    if (result.ok) {
      setNotices(prev => [{ key: `confirmed-${order.id}`, kind: "confirmed", order, focus: true }, ...prev]);
    } else {
      handled.current.delete(order.id);
      if ("expired" in result && result.expired) expiredByServer.current.add(order.id);
    }
    return result;
  };

  const handleDecline = async (order: Order) => {
    handled.current.add(order.id);
    const result = await declineOrder(order.id);
    if (result.ok) {
      setNotices(prev => [{ key: `declined-${order.id}`, kind: "declined", order, focus: true }, ...prev]);
    } else {
      handled.current.delete(order.id);
    }
    return result;
  };

  const groupItems = (g: OpenSaleGroup): ReactNode =>
    mergeSaleLines(g.sales).map((line, i) => (
      <span key={line.productId}>
        {i > 0 && <span style={{ color: "var(--sf-text-muted)" }}>, </span>}
        {line.quantity > 1 && <span className="font-extrabold">{line.quantity}× </span>}
        {productLabel(line.productId)}
      </span>
    ));

  const nextTier = commission ? getNextTier(commission.tier) : null;
  const gap = commission ? unitsUntilNextTier(commission.units) : null;
  const upgradeGain = commission ? tierUpgradeGain(receivedTotal, commission.tier, nextTier) : 0;
  const balance = commission?.balance ?? 0;
  const gain = commission ? commission.projectedBalance - commission.balance : 0;
  const hasLedger =
    !!commission &&
    [commission.priorBalance, commission.accrued, commission.consumoTotal, commission.debtPaymentsTotal, commission.commPaid]
      .some(v => Math.abs(v) > 0.01);

  const ordersTitle =
    waitingCount > 0
      ? waitingCount === 1 ? "1 pedido esperando" : `${waitingCount} pedidos esperando`
      : pendingOrders.length > 0 ? "Pedidos vencidos" : "Pedidos";

  return (
    // App-shell: a raiz ocupa a janela e não rola; só o <main> rola. Mesmo
    // esqueleto da loja pública — ver src/pages/CLAUDE.md. `colorScheme` pinta
    // a barra de rolagem nativa do desktop no escuro, não na do navegador.
    <div className="storefront flex h-[100dvh] flex-col overflow-hidden" style={{ colorScheme: "dark" }}>
      <header className="flex-shrink-0">
        <div className={`${COLUMN} px-5 pb-3 pt-4`}>
          <div className="flex items-center justify-between gap-2.5">
            <div className="min-w-0">
              <h1 className="truncate text-[22px] font-extrabold leading-tight">Minhas vendas</h1>
              <p className="mt-0.5 truncate text-xs" style={{ color: "var(--sf-text-muted)" }}>
                {mySeller ? `Oi, ${mySeller.name}` : "Seus pedidos e sua comissão"}
              </p>
            </div>
            <button
              type="button"
              onClick={signOut}
              aria-label="Sair da conta"
              className="flex h-11 w-11 flex-none items-center justify-center rounded-full"
              style={PILL_BUTTON_STYLE}
            >
              <LogOut size={16} style={{ color: "var(--sf-text-muted)" }} />
            </button>
          </div>

          {/* As duas consultas do vendedor, fixas no topo: o que está na mão
              e o link da loja (que antes sumia depois da primeira venda). */}
          <div className="mt-3 flex gap-2">
            <button ref={stockButtonRef} type="button" onClick={() => setStockOpen(true)} className={PILL_BUTTON} style={PILL_BUTTON_STYLE}>
              Estoque
            </button>
            {storeUrl && (
              <button ref={storeButtonRef} type="button" onClick={() => setStoreOpen(true)} className={PILL_BUTTON} style={PILL_BUTTON_STYLE}>
                Minha loja
              </button>
            )}
          </div>
        </div>
      </header>

      {/* O <main> ocupa a largura toda e a coluna mora DENTRO dele: com a coluna
          no próprio <main>, a roda do mouse nas margens do desktop não rolava. */}
      {/* `scrollbar-gutter`: no desktop a barra de rolagem do <main> empurrava
          a coluna para a esquerda, desalinhada da coluna do cabeçalho. Com o
          espaço reservado dos dois lados, as duas ficam no mesmo eixo. */}
      <main className="flex-1 overflow-y-auto overscroll-contain" style={{ scrollbarGutter: "stable both-edges" }}>
        <div className={`${COLUMN} px-5 pb-10 pt-1.5`}>
          <p className="sr-only" aria-live="polite">{announcement}</p>

          {/* A demora é dita NO TOPO: embaixo dos pedidos ela ficava fora da tela. */}
          {loading && slowLoad && (
            <div
              role="status"
              className="mt-3 flex items-center justify-between gap-3 rounded-[18px] px-4 py-2"
              style={{ background: "var(--sf-surface)", border: "1px solid var(--sf-hairline)" }}
            >
              <p className="text-[12.5px]" style={{ color: "var(--sf-text-muted)" }}>
                Suas vendas estão demorando para carregar.
              </p>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="min-h-11 flex-none px-1 text-[12.5px] font-extrabold"
                style={{ color: "var(--sf-accent)" }}
              >
                Recarregar
              </button>
            </div>
          )}

          {/* Pedidos — antes de tudo: é o que pede uma ação agora. Não segue o
              mês (pedido pendente é de hoje). */}
          <section className="mt-4" aria-labelledby="pedidos-titulo">
            <div className="flex items-start justify-between gap-3">
              <div id="pedidos-titulo" ref={ordersTitleRef} tabIndex={-1} className="min-w-0 outline-none">
                <SectionTitle>{ordersTitle}</SectionTitle>
              </div>
              {/* A lista se atualiza sozinha a cada minuto, mas quem acabou de
                  ouvir "mandei o pedido" não espera um minuto: aqui ele pede
                  agora. Fora do rótulo da seção, para não entrar no nome dela. */}
              {!ordersError && (
                <button
                  type="button"
                  aria-disabled={loadingOrders}
                  onClick={() => !loadingOrders && refreshOrders()}
                  className="-mr-2 -mt-[11px] min-h-11 min-w-[92px] flex-none px-2 text-[12.5px] font-bold"
                  style={{ color: "var(--sf-text-muted)" }}
                >
                  {loadingOrders ? "Atualizando…" : "Atualizar"}
                </button>
              )}
            </div>
            {waitingCount > 0 && (
              // Uma vez só, para a lista inteira — embaixo de cada card ela se
              // repetia seis vezes com seis pedidos.
              <p className="-mt-1.5 mb-3 text-xs leading-snug" style={{ color: "var(--sf-text-muted)" }}>
                Confirmar tira do seu estoque. A venda fica em A receber até {OWNER} registrar o pagamento.
              </p>
            )}

            <div className="flex flex-col gap-3">
              <AnimatePresence initial={false}>
                {rows.map(row =>
                  row.type === "notice" ? (
                    <OrderNotice
                      key={row.key}
                      notice={row.notice}
                      storeUrl={storeUrl}
                      onClose={() => {
                        // Fechar o aviso de vencido também vale como "já vi": ele
                        // não volta pela busca de vencidos na próxima visita.
                        if (row.notice.kind === "expired") dismissExpired(row.notice.order.id);
                        dismiss(row.key);
                      }}
                    />
                  ) : row.type === "away" ? (
                    <ExpiredOrderRow
                      key={row.key}
                      order={row.order}
                      storeUrl={storeUrl}
                      away
                      onDismiss={() => dismissExpired(row.order.id)}
                    />
                  ) : row.tail ? (
                    <ExpiredOrderRow key={row.key} order={row.order} storeUrl={storeUrl} />
                  ) : (
                    <OrderCard
                      key={row.key}
                      order={row.order}
                      now={now}
                      processing={processingOrder === row.order.id}
                      busy={!!processingOrder && processingOrder !== row.order.id}
                      basePrice={basePrice}
                      onConfirm={handleConfirm}
                      onDecline={handleDecline}
                    />
                  ),
                )}
              </AnimatePresence>
            </div>

            {ordersError ? (
              <div
                role="alert"
                className={`rounded-[20px] px-4 py-8 text-center ${rows.length > 0 ? "mt-3" : ""}`}
                style={{ background: "var(--sf-surface)" }}
              >
                <p className="text-[13px]" style={{ color: "var(--sf-text-muted)" }}>
                  {ordersError}
                  {/* Falhou de novo: a hora da tentativa é a prova de que o
                      botão fez alguma coisa. */}
                  {retriedAt && !loadingOrders && ` Última tentativa às ${format(retriedAt, "HH:mm")}.`}
                </p>
                <button
                  type="button"
                  aria-disabled={loadingOrders}
                  onClick={() => !loadingOrders && refreshOrders()}
                  className="mt-3 h-11 min-w-[148px] rounded-full px-5 text-[13px] font-extrabold"
                  style={{
                    background: loadingOrders ? "var(--sf-accent-soft)" : "var(--sf-accent)",
                    color: loadingOrders ? "var(--sf-text)" : "var(--sf-accent-ink)",
                  }}
                >
                  {loadingOrders ? "Procurando…" : "Tentar de novo"}
                </button>
              </div>
            ) : (
              rows.length === 0 && (
                <p className="text-[13px]" style={{ color: "var(--sf-text-muted)" }}>
                  {loadingOrders ? "Procurando pedidos novos…" : "Nenhum pedido esperando agora."}
                </p>
              )
            )}
          </section>

          {loading ? (
            <p className="py-16 text-center text-[13px]" style={{ color: "var(--sf-text-muted)" }}>
              Carregando suas vendas…
            </p>
          ) : (
            <motion.div variants={stagger()} initial={reduceMotion ? "visible" : "hidden"} animate="visible">
              {neverSold && pendingOrders.length === 0 && !ordersError && storeUrl && (
                <motion.section
                  variants={fadeUp}
                  className="mt-4 rounded-[20px] p-4"
                  style={{ background: "var(--sf-surface)", border: "1px solid var(--sf-accent-line)" }}
                >
                  {/* Loja sem estoque abre vazia: mandar o link agora seria
                      chamar o cliente para uma prateleira sem nada. */}
                  {stock.units > 0 ? (
                    <>
                      <h2 className="text-base font-bold">Sua loja está no ar</h2>
                      <p className="mt-1 text-[13px] leading-relaxed" style={{ color: "var(--sf-text-muted)" }}>
                        Mande este link para os seus clientes. Cada pedido que eles fizerem aparece aqui para você
                        confirmar.
                      </p>
                      <StoreLinkPanel url={storeUrl} />
                    </>
                  ) : (
                    <>
                      <h2 className="text-base font-bold">Sua loja abre quando tiver estoque</h2>
                      <p className="mt-1 text-[13px] leading-relaxed" style={{ color: "var(--sf-text-muted)" }}>
                        Assim que {OWNER} te passar produto, é só mandar o link para os clientes. Ele fica em Minha
                        loja, aqui em cima.
                      </p>
                    </>
                  )}
                </motion.section>
              )}

              {showCommission && commission && (
                <motion.section variants={fadeUp} className="mt-7">
                  <SectionTitle aside={<MonthStepper period={period} label={capitalize(monthName)} onChange={setPeriod} />}>
                    Sua comissão
                  </SectionTitle>
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
                          <Money value={balance} tone="accent" /> para receber.
                        </>
                      ) : balance < -0.01 ? (
                        <>
                          {period === "lastMonth" ? `No fim de ${monthName}, você devia ` : "Você deve "}
                          <Money value={-balance} tone="warn" />.
                        </>
                      ) : (
                        "Nada a acertar."
                      )}
                    </p>
                    {balance < -0.01 && (
                      <p className="mt-1 text-xs" style={{ color: "var(--sf-text-muted)" }}>
                        Sai da sua próxima comissão.
                      </p>
                    )}

                    {/* A faixa: a DISTÂNCIA é o assunto, e o que ela VALE vem
                        junto — a faixa reprecifica o mês inteiro, não só a
                        próxima venda. Sem o valor, "falta 1 unidade" não dizia
                        por que correr atrás dela. */}
                    <div className="mt-3.5 pt-3.5" style={{ borderTop: "1px solid var(--sf-hairline)" }}>
                      {period === "lastMonth" ? (
                        <>
                          <p className="text-[15px] font-extrabold leading-snug">
                            {monthStillOpen
                              ? `${capitalize(monthName)} está na faixa de ${commission.tier.label} por enquanto`
                              : `${capitalize(monthName)} fechou na faixa de ${commission.tier.label}`}
                          </p>
                          <p className="mt-0.5 text-[12.5px] leading-snug" style={{ color: "var(--sf-text-muted)" }}>
                            {commission.units} un. pagas em {monthName}.
                            {monthStillOpen && ` Ainda há venda de ${monthName} em aberto: paga, ela conta para ${monthName}.`}
                          </p>
                        </>
                      ) : commission.units === 0 ? (
                        // Vendedor sem venda paga no mês (o novo, sobretudo):
                        // "Faltam 11 unidades" sem a regra não ensinava nada. A
                        // regra primeiro, a escada logo abaixo.
                        <>
                          <p className="text-[15px] font-extrabold leading-snug">
                            Sua comissão começa em {COMMISSION_TIERS[0].label} e sobe com as unidades pagas do mês
                          </p>
                          <p className="mt-0.5 text-[12.5px] leading-snug" style={{ color: "var(--sf-text-muted)" }}>
                            {tierLadder(COMMISSION_TIERS)}.
                          </p>
                        </>
                      ) : nextTier && gap !== null ? (
                        <>
                          <p className="text-[15px] font-extrabold leading-snug">
                            {gap === 1 ? "Falta 1 unidade paga" : `Faltam ${gap} unidades pagas`} para {nextTier.label}
                          </p>
                          <p className="mt-0.5 text-[12.5px] leading-snug" style={{ color: "var(--sf-text-muted)" }}>
                            Hoje: {commission.tier.label}, com {commission.units} un. pagas. Chegando lá, todo o {monthName}{" "}
                            passa a {nextTier.label}
                            {upgradeGain > 0.01 ? (
                              <>
                                :{" "}
                                <span className="font-extrabold" style={{ color: "var(--sf-accent)" }}>+{fmt(upgradeGain)}</span>{" "}
                                no que já foi pago.
                              </>
                            ) : (
                              "."
                            )}
                          </p>
                        </>
                      ) : (
                        <p className="text-[15px] font-extrabold leading-snug">
                          Você está na faixa mais alta: {commission.tier.label}
                        </p>
                      )}
                      {/* Sem conta para abrir, a escada não teria onde aparecer. */}
                      {!hasLedger && commission.units > 0 && (
                        <p className="mt-1.5 text-xs leading-snug" style={{ color: "var(--sf-text-muted)" }}>
                          Faixas: {tierLadder(COMMISSION_TIERS)}. A faixa vale para todas as vendas pagas do mês.
                        </p>
                      )}
                    </div>

                    {/* A projeção fala nas MESMAS duas contas do "A receber" lá
                        embaixo e diz onde o saldo CHEGA, não quanto sobe: "R$ 445
                        em aberto" não batia com R$ 360 + R$ 85, e um "+R$ 81"
                        ao lado do "+R$ 25" da faixa parecia somar os dois. */}
                    {period === "month" && gain > 0.01 && (clientTotal > 0.01 || withSellerTotal > 0.01) && (
                      <p className="mt-2.5 text-[13px] leading-snug" style={{ color: "var(--sf-text-muted)" }}>
                        {clientTotal > 0.01 && withSellerTotal > 0.01
                          ? `Quando receber os ${fmt(clientTotal)} dos clientes e os ${fmt(withSellerTotal)} que estão com você, o saldo vai a `
                          : clientTotal > 0.01
                            ? `Quando receber os ${fmt(clientTotal)} dos clientes, o saldo vai a `
                            : `Quando acertar os ${fmt(withSellerTotal)} que estão com você, o saldo vai a `}
                        <span className="font-extrabold" style={{ color: "var(--sf-accent)" }}>
                          {fmt(commission.projectedBalance)}
                        </span>
                        {commission.projectedTier.rate > commission.tier.rate
                          ? `, já em ${commission.projectedTier.label}.`
                          : "."}
                      </p>
                    )}

                    {hasLedger && (
                      <>
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
                                {/* Consumo (retirada de produto, pelo custo) e
                                    dívida lançada (adiantamento, vale) são duas
                                    coisas: "Adiantamento" dentro de "Seu consumo"
                                    não dizia o que era. A soma das duas é o
                                    `consumoTotal` do saldo, como antes. */}
                                {commission.retiradasTotal > 0.01 && (
                                  <>
                                    <LedgerLine label="Seu consumo (pelo custo)" value={commission.retiradasTotal} sign="−" />
                                    {consumoEntries.filter(e => e.kind === "retirada").map(e => (
                                      <ConsumptionRow key={`${e.kind}-${e.id}`} entry={e} productLabel={productLabel} />
                                    ))}
                                  </>
                                )}
                                {commission.manualDebtsTotal > 0.01 && (
                                  <>
                                    <LedgerLine label="Dívidas lançadas" value={commission.manualDebtsTotal} sign="−" />
                                    {consumoEntries.filter(e => e.kind === "divida").map(e => (
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
                                {/* A escada mora aqui, na conta: no card ela era a
                                    quinta frase, e lida solta parecia imposto por
                                    faixa. */}
                                <p className="mt-2.5 text-xs leading-snug" style={{ color: "var(--sf-text-muted)" }}>
                                  Faixas: {tierLadder(COMMISSION_TIERS)}. A faixa vale para todas as vendas pagas do mês.
                                </p>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </>
                    )}
                  </div>
                </motion.section>
              )}

              {openGroups.length > 0 && (
                <motion.section variants={fadeUp} className="mt-7">
                  <SectionTitle aside={clientGroups.length > 0 && (
                    <span className="text-[15px] font-extrabold tabular-nums" style={{ color: "var(--sf-warn)" }}>
                      {fmt(clientTotal)}
                    </span>
                  )}>
                    A receber
                  </SectionTitle>
                  {clientGroups.length > 0 && (
                    <>
                      <p className="-mt-1 mb-3 text-xs leading-snug" style={{ color: "var(--sf-text-muted)" }}>
                        O que os clientes ainda devem, de todos os meses. Sai daqui quando {OWNER} registrar o
                        pagamento, e só venda paga conta para a sua faixa.
                      </p>
                      <div
                        className="overflow-hidden rounded-[18px]"
                        style={{ background: "var(--sf-surface)", border: "1px solid var(--sf-hairline)" }}
                      >
                        {clientGroups.map((g, i) => (
                          <OpenGroupRow
                            key={g.key}
                            group={g}
                            customer={customers[g.orderId ?? ""]}
                            itemsLabel={groupItems(g)}
                            now={now}
                            divider={i > 0}
                            withSeller={false}
                          />
                        ))}
                      </div>
                    </>
                  )}

                  {/* A outra direção do dinheiro: o cliente já pagou, quem deve
                      é o vendedor. Somado ao total de cima, ele inflava o que
                      "os clientes devem" com dinheiro que já está no bolso. */}
                  {withSellerGroups.length > 0 && (
                    <div className={clientGroups.length > 0 ? "mt-4" : ""}>
                      <div className="mb-1 flex items-baseline justify-between gap-3">
                        <h3 className="text-[13.5px] font-extrabold">Com você, para acertar</h3>
                        <span className="text-[13.5px] font-extrabold tabular-nums">{fmt(withSellerTotal)}</span>
                      </div>
                      <p className="mb-2.5 text-xs leading-snug" style={{ color: "var(--sf-text-muted)" }}>
                        O cliente já pagou em dinheiro. Acerte com {OWNER}.
                      </p>
                      <div
                        className="overflow-hidden rounded-[18px]"
                        style={{ background: "var(--sf-surface)", border: "1px solid var(--sf-hairline)" }}
                      >
                        {withSellerGroups.map((g, i) => (
                          <OpenGroupRow
                            key={g.key}
                            group={g}
                            customer={customers[g.orderId ?? ""]}
                            itemsLabel={groupItems(g)}
                            now={now}
                            divider={i > 0}
                            withSeller
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </motion.section>
              )}

              <motion.section variants={fadeUp} className="mt-7">
                <SectionTitle>Vendas recebidas · {monthName}</SectionTitle>
                {receivedSales.length === 0 ? (
                  <p className="-mt-1.5 text-[13px]" style={{ color: "var(--sf-text-muted)" }}>
                    Nenhuma venda recebida em {monthName}.
                  </p>
                ) : (
                  <>
                    {/* Unidades e total, sem "N vendas": a contagem era de LINHAS
                        de venda, e um pedido com prêmio vira duas. As unidades
                        são as mesmas "un. pagas" da comissão, lá em cima. */}
                    <p className="-mt-1.5 mb-3 text-xs" style={{ color: "var(--sf-text-muted)" }}>
                      {receivedUnits} un. pagas ·{" "}
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
        </div>
      </main>

      {/* Os dois sheets são abertos por estado, sem Trigger do Radix: sem o
          `onCloseAutoFocus` o foco caía no <body> ao fechar. A classe
          `storefront` se repete porque o Radix porta isto para fora da árvore
          da página — ver src/pages/CLAUDE.md §2. */}

      {/* Conferência de estoque. Sheet e não tela nova: é consulta de conferir e
          fechar, e sair da tela perderia o mês que o vendedor tinha escolhido. */}
      <Sheet open={stockOpen} onOpenChange={setStockOpen}>
        <SheetContent
          side="bottom"
          hideClose
          onCloseAutoFocus={e => {
            e.preventDefault();
            stockButtonRef.current?.focus();
          }}
          className={`storefront ${COLUMN} inset-x-0 flex h-[76vh] flex-col gap-0 rounded-b-none rounded-t-[28px] border-0 p-0`}
          style={{ background: "var(--sf-bg)", colorScheme: "dark" }}
        >
          <SheetTop
            title="Meu estoque"
            subtitle={`${stock.units} un. · ${stock.flavors} ${stock.flavors === 1 ? "sabor" : "sabores"}`}
            onClose={() => setStockOpen(false)}
          />
          <SheetDescription className="sr-only">
            O que o sistema diz que está com você, para conferir com o que tem em mãos.
          </SheetDescription>

          <div className="flex-1 overflow-y-auto overscroll-contain px-5 pb-7 pt-3">
            {loading ? (
              <p className="py-16 text-center text-[13px]" style={{ color: "var(--sf-text-muted)" }}>
                Carregando seu estoque…
              </p>
            ) : stock.groups.length === 0 ? (
              <p className="py-16 text-center text-[13px]" style={{ color: "var(--sf-text-muted)" }}>
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
                          {/* O livre vem feito: "6 com 3 em pedido" deixava a
                              subtração para a cabeça de quem está na rua. */}
                          {line.reserved > 0 && (
                            <p className="mt-0.5 text-xs" style={{ color: "var(--sf-text-muted)" }}>
                              <span className="font-bold" style={{ color: "var(--sf-text)" }}>
                                {(() => {
                                  const free = Math.max(0, line.quantity - line.reserved);
                                  return free === 0 ? "Nenhuma livre" : free === 1 ? "1 livre" : `${free} livres`;
                                })()}
                              </span>{" "}
                              · {line.reserved} em pedido esperando
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
                  {/* Sem os pedidos, o "em pedido esperando" some de todas as
                      linhas e tudo parece livre — a tela precisa dizer. */}
                  {ordersError && " Os pedidos não carregaram agora, então as unidades prometidas podem não aparecer."}
                </p>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {storeUrl && (
        <Sheet open={storeOpen} onOpenChange={setStoreOpen}>
          <SheetContent
            side="bottom"
            hideClose
            onCloseAutoFocus={e => {
              e.preventDefault();
              storeButtonRef.current?.focus();
            }}
            className={`storefront ${COLUMN} inset-x-0 flex max-h-[64vh] flex-col gap-0 rounded-b-none rounded-t-[28px] border-0 p-0`}
            style={{ background: "var(--sf-bg)", colorScheme: "dark" }}
          >
            <SheetTop title="Minha loja" onClose={() => setStoreOpen(false)} />
            <SheetDescription className="sr-only">O link da sua loja, para mandar aos clientes.</SheetDescription>
            <div className="px-5 pb-7 pt-3">
              <p className="text-[13px] leading-relaxed" style={{ color: "var(--sf-text-muted)" }}>
                Mande este link para os seus clientes. Cada pedido que eles fizerem aparece aqui para você confirmar.
                {stock.units === 0 && ` Agora você está sem estoque: sua loja abre vazia até ${OWNER} te passar produto.`}
              </p>
              <StoreLinkPanel url={storeUrl} />
            </div>
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}
