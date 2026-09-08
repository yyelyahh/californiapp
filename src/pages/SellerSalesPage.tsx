import { useId, useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { startOfMonth, endOfMonth, startOfQuarter, endOfQuarter, subMonths, parseISO } from "date-fns";
import { Clock, Check, Ban, ChevronDown, LogOut, Inbox } from "lucide-react";

import { useStore } from "@/context/StoreContext";
import { useAuth } from "@/context/AuthContext";
import { usePendingOrders, ORDER_PAYMENT_CHOICES, type Order, type PaymentMethodValue } from "@/hooks/usePendingOrders";
import { computeSellerBalance, computeSellerConsumption, PROJECT_START } from "@/lib/commissions";
import { formatDateBR } from "@/lib/date-utils";
import { EASE_OUT, fadeUp, stagger } from "@/lib/motion";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

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

const fmt = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v || 0);

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
 */
function PeriodChips({ active, onChange }: { active: SellerPeriod; onChange: (id: SellerPeriod) => void }) {
  const reduce = useReducedMotion();
  const pillId = useId();

  return (
    <div className="mt-3.5 flex gap-2 overflow-x-auto overscroll-x-contain pb-0.5">
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
 */
function PaymentPicker({
  children,
  disabled,
  onPick,
}: {
  children: ReactNode;
  disabled?: boolean;
  onPick: (method: PaymentMethodValue) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);

  const pick = async (method: PaymentMethodValue) => {
    setOpen(false);
    await onPick(method);
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
    <Popover open={open} onOpenChange={o => !disabled && setOpen(o)}>
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
  onConfirm: (orderId: string, method: PaymentMethodValue) => void;
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
        <PaymentPicker disabled={processing} onPick={method => onConfirm(order.id, method)}>
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
  const { products, sales, sellers, getProductName, commissionPayments, sellerDebtPayments, sellerManualDebts } =
    useStore();
  const { sellerId, signOut } = useAuth();
  const { pendingOrders, processingOrder, confirmOrder, declineOrder } = usePendingOrders();
  const reduceMotion = useReducedMotion();

  const [period, setPeriod] = useState<SellerPeriod>("month");
  const [consumoOpen, setConsumoOpen] = useState(false);

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

  // Consumo próprio (retiradas + dívidas − pagamentos). Acumulado, não segue o
  // filtro de período: é o que o vendedor ainda deve, não o consumo de um mês.
  const consumo = useMemo(() => {
    if (!sellerId) return null;
    return computeSellerConsumption(sellerId, { sales, sellerManualDebts, sellerDebtPayments });
  }, [sellerId, sales, sellerManualDebts, sellerDebtPayments]);

  const mySales = useMemo(() => {
    const startTs = range.start.getTime();
    const endTs = range.end.getTime();
    return [...sales]
      .filter(s => {
        if (s.sellerId !== sellerId || (s.type || "venda") === "retirada_funcionario") return false;
        const ts = new Date(s.date).getTime();
        return !isNaN(ts) && ts >= startTs && ts <= endTs;
      })
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [sales, sellerId, range]);

  const sumPaid = mySales.reduce((acc, s) => acc + s.paidAmount, 0);
  const sumOpen = mySales.reduce((acc, s) => acc + Math.max(0, s.totalPrice - s.paidAmount), 0);
  const periodLabel = PERIODS.find(p => p.id === period)?.label ?? "";

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

          <PeriodChips active={period} onChange={setPeriod} />
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
                value={fmt(consumo?.openTotal ?? 0)}
                tone={(consumo?.openTotal ?? 0) > 0.01 ? "warn" : "plain"}
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
                    {consumo.retiradas.length === 0 && consumo.manualDebts.length === 0 ? (
                      <p className="py-4 text-center text-[13px]" style={{ color: "var(--sf-text-dim)" }}>
                        Nenhum consumo registrado.
                      </p>
                    ) : (
                      <div className="flex flex-col">
                        {consumo.retiradas.map(s => (
                          <div key={s.id} className="flex items-center justify-between gap-3 py-2">
                            <div className="min-w-0">
                              <p className="truncate text-[13px] font-semibold">{productLabel(s.productId)}</p>
                              <p className="mt-0.5 text-[11px]" style={{ color: "var(--sf-text-muted)" }}>
                                {formatDateBR(s.date)} · {s.quantity} un.
                              </p>
                            </div>
                            <span className="flex-none text-[13px] font-extrabold" style={{ color: "var(--sf-warn)" }}>
                              {fmt(s.totalPrice)}
                            </span>
                          </div>
                        ))}
                        {consumo.manualDebts.map(d => (
                          <div key={d.id} className="flex items-center justify-between gap-3 py-2">
                            <div className="min-w-0">
                              <p className="truncate text-[13px] font-semibold">
                                Dívida{d.notes ? ` · ${d.notes}` : ""}
                              </p>
                              <p className="mt-0.5 text-[11px]" style={{ color: "var(--sf-text-muted)" }}>
                                {formatDateBR(d.date)}
                              </p>
                            </div>
                            <span className="flex-none text-[13px] font-extrabold" style={{ color: "var(--sf-warn)" }}>
                              {fmt(d.amount)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="mt-2 space-y-1 pt-3" style={{ borderTop: "1px solid var(--sf-hairline)" }}>
                      <div className="flex items-center justify-between text-[12px]" style={{ color: "var(--sf-text-muted)" }}>
                        <span>Retiradas</span>
                        <span>{fmt(consumo.retiradasTotal)}</span>
                      </div>
                      {consumo.manualDebtsTotal > 0 && (
                        <div className="flex items-center justify-between text-[12px]" style={{ color: "var(--sf-text-muted)" }}>
                          <span>Dívidas</span>
                          <span>{fmt(consumo.manualDebtsTotal)}</span>
                        </div>
                      )}
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
          </motion.section>

          <motion.section variants={fadeUp} className="mt-6">
            <SectionTitle>Vendas · {periodLabel}</SectionTitle>
            {mySales.length === 0 ? (
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
                  {mySales.map((s, i) => {
                    const received = s.paidAmount >= s.totalPrice - 0.01;
                    return (
                      <div
                        key={s.id}
                        className="flex items-center justify-between gap-3 px-3.5 py-3"
                        style={i > 0 ? { borderTop: "1px solid var(--sf-hairline)" } : undefined}
                      >
                        <div className="min-w-0">
                          <p className="truncate text-[13.5px] font-bold">{productLabel(s.productId)}</p>
                          <p className="mt-0.5 text-[11px]" style={{ color: "var(--sf-text-muted)" }}>
                            {formatDateBR(s.date)} · {s.quantity} un.
                          </p>
                        </div>
                        <span
                          className="flex-none text-[13.5px] font-extrabold"
                          style={{ color: received ? "var(--sf-accent)" : "var(--sf-warn)" }}
                        >
                          {fmt(s.totalPrice)}
                        </span>
                      </div>
                    );
                  })}
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
              </>
            )}
          </motion.section>
        </motion.div>
      </main>
    </div>
  );
}
