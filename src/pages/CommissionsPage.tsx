import { useMemo, useState } from "react";
import { useStore } from "@/context/StoreContext";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetFooter } from "@/components/ui/sheet";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Wallet, Trash2, Plus, Clock, Crown, ArrowRight, Users, X,
  HandCoins, Receipt, Package, Share2,
} from "lucide-react";
import {
  format, startOfMonth, endOfMonth, endOfYear,
  isWithinInterval, parseISO, isToday, isYesterday, subMonths,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { todayDateString, localDateToISO, formatDateBR } from "@/lib/date-utils";
import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "motion/react";
import { Stagger } from "@/components/motion/Stagger";
import AnimatedNumber from "@/components/motion/AnimatedNumber";
import { listItem, transitionBase } from "@/lib/motion";
import { NcButton, NcSheetHeader, SegmentedChips, Rule, EYEBROW } from "@/components/nocturne";
import { useConfirm } from "@/components/ConfirmProvider";
import SellerReportDrawer from "@/components/SellerReportDrawer";
import { compareCatalog } from "@/lib/catalog-order";
import { getNextTier, unitsUntilNextTier, computeSellerBalance } from "@/lib/commissions";

function formatCurrency(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v || 0);
}

/** Sem centavos — para os números grandes do trilho, como no Dashboard. */
function formatCurrencyShort(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(v || 0);
}

type Period = "month" | "lastMonth" | "custom";

/**
 * Os mesmos chips das outras telas migradas (`SegmentedChips`). "custom" não
 * está aqui de propósito: ele não é um chip, é o que sobra quando a pessoa
 * digita um intervalo à mão — e aí nenhum chip fica aceso.
 */
const PERIOD_OPTIONS: { value: Period; label: string; short: string }[] = [
  { value: "month", label: "Mês atual", short: "Mês" },
  { value: "lastMonth", label: "Mês anterior", short: "Mês ant." },
];

const TIMELINE_OPTIONS = [
  { value: "all", label: "Tudo", short: "Tudo" },
  { value: "withdrawal", label: "Retiradas dos sócios", short: "Retiradas" },
  { value: "commission", label: "Comissões pagas", short: "Comissões" },
];

/** Quantos vendedores cabem na lista do trilho antes de virar "+ N outros". */
const MAX_TOP_SELLERS = 6;

/**
 * Saldo do vendedor em cor, com o MESMO vocabulário dos selos do painel:
 * positivo é o que a casa ainda deve a ele (--nc-alert, "falta pagar");
 * negativo é dívida dele com a casa (--nc-crit, "não entrou nada"); zerado não
 * é notícia e fica neutro.
 */
function balanceTone(v: number) {
  if (v > 0.01) return "var(--nc-alert)";
  if (v < -0.01) return "var(--nc-crit)";
  return "var(--nc-text-2)";
}

function balanceLabel(v: number) {
  if (v > 0.01) return "Falta pagar ao vendedor";
  if (v < -0.01) return "O vendedor deve à casa";
  return "Sem saldo em aberto";
}

/** Modo do painel do vendedor: o resumo, ou um dos três formulários. */
type PanelMode = "resumo" | "comissao" | "divida" | "lancar";

const PANEL_TITLES: Record<Exclude<PanelMode, "resumo">, string> = {
  comissao: "Pagar comissão",
  divida: "Receber dívida",
  lancar: "Lançar dívida",
};

export default function CommissionsPage() {
  const store = useStore();
  const confirm = useConfirm();
  const {
    sellers, partners, sales, expenses, products, productAssignments, dividends,
    commissionPayments, proLaborePayments, sellerDebtPayments, sellerManualDebts,
    addCommissionPayment, addProLaborePayment,
    deleteCommissionPayment, deleteProLaborePayment,
    addSellerDebtPayment, addSellerManualDebt,
    addProductAssignment, transferProductAssignment,
    getSellerName, deleteSeller,
  } = store;

  // Retiradas dos sócios = proLaborePayments (apenas relabel semântico)
  const withdrawals = proLaborePayments;
  const addWithdrawal = addProLaborePayment;
  const deleteWithdrawal = deleteProLaborePayment;

  const [period, setPeriod] = useState<Period>("month");
  const [customStart, setCustomStart] = useState<string>(todayDateString());
  const [customEnd, setCustomEnd] = useState<string>(todayDateString());

  // Cutoff legado: tudo antes de 01/06/2026 é tratado como legado (10% de comissão, só abate consumo)
  const LEGACY_CUTOFF = useMemo(() => new Date(2026, 5, 1), []);
  const isLegacy = (iso: string) => {
    try { return parseISO(iso) < LEGACY_CUTOFF; } catch { return false; }
  };
  const PROJECT_START = LEGACY_CUTOFF;

  const { start, end, label } = useMemo(() => {
    const now = new Date();
    let s: Date, e: Date, l: string;
    if (period === "month") {
      s = startOfMonth(now); e = endOfMonth(now);
      l = format(now, "MMMM/yyyy", { locale: ptBR });
    } else if (period === "lastMonth") {
      const prev = subMonths(now, 1);
      s = startOfMonth(prev); e = endOfMonth(prev);
      l = format(prev, "MMMM/yyyy", { locale: ptBR });
    } else {
      try { s = parseISO(customStart); } catch { s = startOfMonth(now); }
      try { e = parseISO(customEnd); } catch { e = endOfMonth(now); }
      if (e < s) e = s;
      l = `${format(s, "dd/MM/yyyy")} – ${format(e, "dd/MM/yyyy")}`;
    }
    return { start: s, end: e, label: l };
  }, [period, customStart, customEnd]);

  const inPeriod = (iso: string) => {
    try { return isWithinInterval(parseISO(iso), { start, end }); } catch { return false; }
  };
  const inYear = (iso: string) => {
    try { return isWithinInterval(parseISO(iso), { start: PROJECT_START, end: endOfYear(new Date()) }); } catch { return false; }
  };
  // Meses FECHADOS tocados pelo período (dia 1 do mês inicial até o último dia do mês final)
  const closedStart = useMemo(() => new Date(start.getFullYear(), start.getMonth(), 1), [start]);
  const closedEnd = useMemo(() => new Date(end.getFullYear(), end.getMonth() + 1, 0, 23, 59, 59, 999), [end]);
  const inClosedPeriod = (iso: string) => {
    try {
      const d = parseISO(iso);
      return d >= closedStart && d <= closedEnd;
    } catch { return false; }
  };

  const periodMetrics = useMemo(() => {
    // Índice de produtos para lookups O(1) dentro dos loops.
    const productById = new Map(products.map(p => [p.id, p]));
    // === LUCRO DO PERÍODO — espelha a fórmula do Dashboard ===
    // Lucro bruto = receita (totalPrice) − CPV (product.purchasePrice × qty), vendas type=venda no período
    const vendasNoPeriodo = sales.filter(s => s.type === "venda" && inPeriod(s.date));
    const revenue = vendasNoPeriodo.reduce((a, s) => a + s.totalPrice, 0);
    const cogs = vendasNoPeriodo.reduce((a, s) => {
      const p = productById.get(s.productId);
      return a + (p?.purchasePrice ?? 0) * s.quantity;
    }, 0);

    const grossProfit = revenue - cogs;

    const periodExpenses = expenses.filter(e => inPeriod(e.date)).reduce((a, e) => a + e.amount, 0);
    const periodInvestorPayments = dividends.filter(d => inPeriod(d.date)).reduce((a, d) => a + d.amount, 0);
    const netProfit = grossProfit - periodExpenses - periodInvestorPayments;

    // === Balanço por vendedor — meses FECHADOS tocados pelo período ===
    const HIDDEN_SELLERS = ["gab", "leo", "luis"];
    const commissionSellers = sellers.filter(s => !HIDDEN_SELLERS.includes((s.name || "").trim().toLowerCase()));

    const sellerBalanceCtx = {
      sales, commissionPayments, sellerDebtPayments, sellerManualDebts,
      start, end, closedStart, PROJECT_START, isLegacy, inClosedPeriod,
    };
    const perSeller = commissionSellers
      .map(seller => computeSellerBalance(seller, sellerBalanceCtx))
      .sort((a, b) => b.vendasTotal - a.vendasTotal);

    const priorPayableSum = perSeller.reduce((a, x) => a + x.priorBalance, 0);
    const periodPayableSum = perSeller.reduce((a, x) => a + x.periodBalance, 0);
    const totalSellerBalance = perSeller.reduce((a, x) => a + Math.max(0, x.balance), 0);

    // === Distribuível aos sócios ===
    const distribuivel = Math.max(0, netProfit - totalSellerBalance);
    const totalPartnerPct = partners.reduce((a, p) => a + (p.percentage || 0), 0);

    // === Retiradas dos sócios ===
    const perPartner = partners.map(partner => {
      const list = withdrawals.filter(w => w.partnerId === partner.id);
      const periodAmt = list.filter(w => inPeriod(w.date)).reduce((a, w) => a + w.amount, 0);
      const yearAmt = list.filter(w => inYear(w.date)).reduce((a, w) => a + w.amount, 0);
      const allTimeAmt = list.reduce((a, w) => a + w.amount, 0);
      const last = list.slice().sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
      const pct = partner.percentage || 0;
      const alvo = totalPartnerPct > 0 ? distribuivel * (pct / totalPartnerPct) : 0;
      const faltaPagar = Math.max(0, alvo - periodAmt);
      const excedente = Math.max(0, periodAmt - alvo);
      return { partner, periodAmt, yearAmt, allTimeAmt, last, count: list.length, alvo, faltaPagar, excedente };
    });
    const totalWithdrawalsPeriod = perPartner.reduce((a, x) => a + x.periodAmt, 0);

    return {
      revenue, cogs, grossProfit, periodExpenses, periodInvestorPayments, netProfit,
      perSeller, totalSellerBalance, priorPayableSum, periodPayableSum,
      perPartner, totalWithdrawalsPeriod, distribuivel,
    };
  }, [sales, expenses, sellers, partners, commissionPayments, withdrawals, sellerDebtPayments, sellerManualDebts, dividends, products, period, start, end, closedStart, closedEnd, PROJECT_START]);

  /** O que ainda cabe retirar sem furar o distribuível do período. */
  const stillDistributable = Math.max(0, periodMetrics.distribuivel - periodMetrics.totalWithdrawalsPeriod);

  const [timelineFilter, setTimelineFilter] = useState<"all" | "commission" | "withdrawal">("all");

  const timeline = useMemo(() => {
    const items = [
      ...commissionPayments.map(p => ({ kind: "commission" as const, id: p.id, when: p.date, amount: p.amount, who: getSellerName(p.sellerId), notes: p.notes })),
      ...withdrawals.map(p => ({ kind: "withdrawal" as const, id: p.id, when: p.date, amount: p.amount, who: partners.find(x => x.id === p.partnerId)?.name ?? "Sócio", notes: p.notes })),
    ]
      .filter(it => timelineFilter === "all" || it.kind === timelineFilter)
      .sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime())
      .slice(0, 30);

    const groups: { day: string; items: typeof items }[] = [];
    items.forEach(it => {
      if (!it.when) return;
      const d = parseISO(it.when);
      if (isNaN(d.getTime())) return;
      const day = isToday(d) ? "Hoje" : isYesterday(d) ? "Ontem" : format(d, "dd 'de' MMM", { locale: ptBR });
      const last = groups[groups.length - 1];
      if (last && last.day === day) last.items.push(it);
      else groups.push({ day, items: [it] });
    });
    return groups;
  }, [commissionPayments, withdrawals, partners, getSellerName, timelineFilter]);

  /* ---------------- Painel do vendedor ----------------
     Um painel só para tudo o que se faz com um vendedor. Antes eram quatro:
     "Consultar" fechava para abrir "Pagar", que fechava para abrir "Pagar
     dívida", que fechava para abrir o extrato — e o cabeçalho do vendedor era
     redigitado em cada um. Aqui o resumo fica de pé e o formulário abre por
     baixo dele, então dá para conferir o saldo enquanto se digita o valor. */
  const [panelSellerId, setPanelSellerId] = useState<string | null>(null);
  const [panelMode, setPanelMode] = useState<PanelMode>("resumo");
  const [panelForm, setPanelForm] = useState({ amount: "", date: todayDateString(), notes: "" });
  const [panelSubmitting, setPanelSubmitting] = useState(false);
  const [extractFor, setExtractFor] = useState<string | null>(null);

  const panelRow = panelSellerId ? periodMetrics.perSeller.find(r => r.seller.id === panelSellerId) : null;

  const openSeller = (sellerId: string) => {
    setPanelSellerId(sellerId);
    setPanelMode("resumo");
  };

  /** Abre um dos formulários com o valor que a tela já sabe sugerir. */
  const startMode = (mode: Exclude<PanelMode, "resumo">, suggested: number) => {
    setPanelMode(mode);
    setPanelForm({ amount: suggested > 0.01 ? suggested.toFixed(2) : "", date: todayDateString(), notes: "" });
  };

  const panelAmount = Number(panelForm.amount) || 0;

  const submitPanel = async () => {
    if (!panelRow || panelMode === "resumo" || panelAmount <= 0) return;
    setPanelSubmitting(true);
    const common = {
      sellerId: panelRow.seller.id,
      amount: panelAmount,
      date: localDateToISO(panelForm.date),
      notes: panelForm.notes || undefined,
    };
    if (panelMode === "comissao") await addCommissionPayment(common);
    else if (panelMode === "divida") await addSellerDebtPayment(common);
    else await addSellerManualDebt(common);
    setPanelSubmitting(false);
    // Volta ao resumo em vez de fechar: o saldo recalculado é a confirmação de
    // que o lançamento entrou.
    setPanelMode("resumo");
    setPanelForm({ amount: "", date: todayDateString(), notes: "" });
  };

  const shareSellerWhatsApp = (r: NonNullable<typeof panelRow>) => {
    const lines = [
      `*${r.seller.name}* — ${label}`,
      ``,
      `Unidades: ${r.units}`,
      `Vendas: ${formatCurrency(r.vendasTotal)}`,
      `Faixa: ${r.tier.label}`,
      `Comissão: ${formatCurrency(r.accrued)}`,
      `Consumo: -${formatCurrency(r.retiradasTotal)}`,
      `Dívidas: -${formatCurrency(r.manualDebtsTotal)}`,
      `Pago: -${formatCurrency(r.commPaid)}`,
      ...(r.debtPaymentsTotal > 0 ? [`Pgto. dívida: +${formatCurrency(r.debtPaymentsTotal)}`] : []),
      ``,
      `*Saldo: ${formatCurrency(r.balance)}*`,
    ];
    window.open(`https://wa.me/?text=${encodeURIComponent(lines.join("\n"))}`, "_blank");
  };

  /* ---------------- Retirada do sócio ---------------- */
  const [wdPartnerId, setWdPartnerId] = useState<string | null>(null);
  const [wdForm, setWdForm] = useState({ amount: "", date: todayDateString(), notes: "" });
  const [wdSubmitting, setWdSubmitting] = useState(false);
  const partnerRow = wdPartnerId ? periodMetrics.perPartner.find(r => r.partner.id === wdPartnerId) : null;

  const openWd = (partnerId: string, suggested: number) => {
    setWdPartnerId(partnerId);
    setWdForm({ amount: suggested > 0.01 ? suggested.toFixed(2) : "", date: todayDateString(), notes: "" });
  };

  const submitWd = async () => {
    if (!wdPartnerId) return;
    const amt = Number(wdForm.amount) || 0;
    if (amt <= 0) return;
    if (amt > stillDistributable + 0.005) {
      const ok = await confirm({
        title: "Retirada acima do que sobrou",
        description: `Ainda cabia retirar: ${formatCurrency(stillDistributable)}\nValor: ${formatCurrency(amt)}\n\nO saldo do período fica negativo. Deseja continuar?`,
        confirmText: "Registrar mesmo assim",
        destructive: false,
      });
      if (!ok) return;
    }
    setWdSubmitting(true);
    await addWithdrawal({
      partnerId: wdPartnerId,
      amount: amt,
      date: localDateToISO(wdForm.date),
      notes: wdForm.notes || undefined,
    });
    setWdSubmitting(false);
    setWdPartnerId(null);
  };

  /* ---------------- Movimentar estoque ----------------
     "Atribuir" e "Transferir" eram dois painéis para o mesmo movimento: uma
     quantidade sai de um lugar e entra na mão de um vendedor. A única
     diferença é de onde ela sai — e isso cabe num campo, do mesmo jeito que a
     tela de Perdas já pergunta a origem. Com um painel só, transferir também
     passou a aceitar vários produtos de uma vez, o que só o atribuir fazia. */
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveFrom, setMoveFrom] = useState("casa");
  const [moveTo, setMoveTo] = useState("");
  const [moveSelected, setMoveSelected] = useState<Record<string, string>>({});
  const [moveSubmitting, setMoveSubmitting] = useState(false);

  /** O que a origem escolhida tem para dar, já na ordem do catálogo. */
  const moveItems = useMemo(() => {
    const productById = new Map(products.map(p => [p.id, p]));
    if (moveFrom === "casa") {
      return products
        .map(p => {
          const assigned = productAssignments.filter(a => a.productId === p.id).reduce((s, a) => s + a.quantity, 0);
          return {
            key: `p:${p.id}`,
            productId: p.id,
            assignmentId: undefined as string | undefined,
            brand: p.brand, model: p.model, flavor: p.flavor,
            available: Math.max(0, p.stock - assigned),
          };
        })
        .filter(p => p.available > 0)
        .sort(compareCatalog);
    }
    return productAssignments
      .filter(a => a.sellerId === moveFrom && a.quantity > 0)
      .map(a => {
        const p = productById.get(a.productId);
        return {
          key: `a:${a.id}`,
          productId: a.productId,
          assignmentId: a.id,
          brand: p?.brand ?? "", model: p?.model ?? "", flavor: p?.flavor ?? "",
          available: a.quantity,
        };
      })
      .sort(compareCatalog);
  }, [products, productAssignments, moveFrom]);

  const moveCount = Object.keys(moveSelected).length;
  const moveUnits = Object.values(moveSelected).reduce((s, v) => s + (Number(v) || 0), 0);
  const canMove = !!moveTo && moveTo !== moveFrom && moveCount > 0;

  const resetMove = () => {
    setMoveFrom("casa"); setMoveTo(""); setMoveSelected({});
  };

  const toggleMoveItem = (key: string, checked: boolean) => {
    setMoveSelected(prev => {
      const next = { ...prev };
      if (checked) next[key] = "1"; else delete next[key];
      return next;
    });
  };

  const submitMove = async () => {
    if (!canMove || moveSubmitting) return;
    setMoveSubmitting(true);
    try {
      for (const [key, qtyStr] of Object.entries(moveSelected)) {
        const item = moveItems.find(i => i.key === key);
        if (!item) continue;
        const quantity = Math.min(Number(qtyStr) || 0, item.available);
        if (quantity <= 0) continue;
        if (item.assignmentId) await transferProductAssignment(item.assignmentId, moveTo, quantity);
        else await addProductAssignment({ sellerId: moveTo, productId: item.productId, quantity });
      }
      resetMove();
      setMoveOpen(false);
    } finally {
      setMoveSubmitting(false);
    }
  };

  const periodLabel = PERIOD_OPTIONS.find(o => o.value === period)?.label ?? "Período personalizado";

  return (
    // `/commissions` está em `fullBleedRoutes` (AppLayout): chega sem padding e
    // sem max-width, e é a tela que cuida do próprio espaçamento.
    <div className="nocturne flex flex-1 flex-col xl:flex-row xl:items-stretch">
      {/* ---------------- Coluna principal ---------------- */}
      <div className="flex-1 min-w-0 p-4 md:p-6 flex flex-col gap-4">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className={EYEBROW} style={{ color: "var(--nc-accent)" }}>{label}</span>
            <h1 className="mt-1 text-xl sm:text-[22px]">Distribuição</h1>
          </div>
          <NcButton variant="solid" size="md" onClick={() => { resetMove(); setMoveOpen(true); }}>
            <Package size={14} />Movimentar estoque
          </NcButton>
        </header>

        {/* ---------------- Período ---------------- */}
        <div className="nc-card flex flex-wrap items-center gap-2 px-3 py-2.5">
          <SegmentedChips options={PERIOD_OPTIONS} value={period} onChange={v => setPeriod(v as Period)} />
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={customStart}
              onChange={e => { setCustomStart(e.target.value); setPeriod("custom"); }}
              aria-label="Data inicial"
              className="nc-input nc-num h-8 w-[132px] px-2 text-[12px]"
            />
            <span className="text-xs" style={{ color: "var(--nc-text-3)" }}>–</span>
            <input
              type="date"
              value={customEnd}
              onChange={e => { setCustomEnd(e.target.value); setPeriod("custom"); }}
              aria-label="Data final"
              className="nc-input nc-num h-8 w-[132px] px-2 text-[12px]"
            />
          </div>
          <span className="ml-auto text-[11px]" style={{ color: "var(--nc-text-3)" }}>
            {periodLabel} · comissão fecha por mês
          </span>
        </div>

        {/* ---------------- Vendedores ---------------- */}
        <section className="flex flex-col gap-2">
          <SectionHead
            title="Vendedores"
            sub={`${periodMetrics.perSeller.length} no período · falta pagar ${formatCurrency(periodMetrics.totalSellerBalance)}`}
          />
          {periodMetrics.perSeller.length === 0 ? (
            <div className="nc-card py-16 text-center text-[13px]" style={{ color: "var(--nc-text-3)" }}>
              Nenhum vendedor cadastrado.
            </div>
          ) : (
            <Stagger className="nc-card overflow-hidden">
              {periodMetrics.perSeller.map(r => {
                const next = getNextTier(r.tier);
                return (
                  <motion.button
                    key={r.seller.id}
                    variants={listItem}
                    type="button"
                    onClick={() => openSeller(r.seller.id)}
                    className="nc-row nc-hover block w-full px-4 py-3 text-left"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-[13px]">{r.seller.name}</span>
                        {/* A faixa é o que o vendedor persegue e estava escondida
                            dentro do painel. Selo neutro: faixa não é estado de
                            dinheiro, é em qual degrau ele está. */}
                        <span className="nc-pill nc-pill--mute flex-none">{r.tier.label}</span>
                      </div>
                      <div className="flex flex-none items-center gap-2">
                        <span className="nc-num text-[13px]" style={{ color: balanceTone(r.balance) }}>
                          {formatCurrency(r.balance)}
                        </span>
                        <ArrowRight size={13} style={{ color: "var(--nc-text-3)" }} />
                      </div>
                    </div>
                    {/* Progresso de faixa: unidades de venda RECEBIDA sobre o
                        que a próxima faixa exige. É o número que o vendedor
                        acompanha — e é sempre venda recebida, porque a comissão
                        só é apurada sobre venda quitada. Na faixa do topo não há
                        meta seguinte, e a linha diz isso em vez de inventar
                        uma. */}
                    <div className="mt-1.5 flex items-center justify-between gap-3">
                      <span className="text-[11px]" style={{ color: "var(--nc-text-3)" }}>
                        {next ? (
                          <>
                            <span className="nc-num" style={{ color: "var(--nc-text-2)" }}>{r.units}/{next.min}</span>
                            {" un. para "}
                            <span style={{ color: "var(--nc-accent)" }}>{next.label}</span>
                          </>
                        ) : (
                          <>
                            <span className="nc-num" style={{ color: "var(--nc-text-2)" }}>{r.units}</span>
                            {" un. · já está na faixa do topo"}
                          </>
                        )}
                      </span>
                      <span className="nc-num flex-none text-[11px]" style={{ color: "var(--nc-text-3)" }}>
                        {formatCurrencyShort(r.vendasTotal)}
                      </span>
                    </div>
                  </motion.button>
                );
              })}
            </Stagger>
          )}
        </section>

        {/* ---------------- Sócios ---------------- */}
        <section className="flex flex-col gap-2">
          <SectionHead
            title="Sócios"
            sub={`retirado ${formatCurrency(periodMetrics.totalWithdrawalsPeriod)} de ${formatCurrency(periodMetrics.distribuivel)} no período`}
          />
          {periodMetrics.perPartner.length === 0 ? (
            <div className="nc-card py-16 text-center text-[13px]" style={{ color: "var(--nc-text-3)" }}>
              Nenhum sócio cadastrado.
            </div>
          ) : (
            <Stagger className="nc-card overflow-hidden">
              {periodMetrics.perPartner.map(r => (
                <motion.div key={r.partner.id} variants={listItem} className="nc-row px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[13px]">{r.partner.name}</p>
                      <p className="truncate text-[11px]" style={{ color: "var(--nc-text-3)" }}>
                        {r.partner.percentage}% da sociedade
                        {r.last ? ` · última retirada ${formatDateBR(r.last.date)}` : " · nenhuma retirada"}
                      </p>
                    </div>
                    <div className="flex flex-none items-center gap-3">
                      <div className="text-right">
                        <p className="nc-num text-[13px]">{formatCurrency(r.periodAmt)}</p>
                        <p className="nc-num text-[11px]" style={{ color: "var(--nc-text-3)" }}>
                          de {formatCurrencyShort(r.alvo)}
                        </p>
                      </div>
                      <NcButton variant="quiet" onClick={() => openWd(r.partner.id, r.faltaPagar)}>
                        <Plus size={13} />Retirada
                      </NcButton>
                    </div>
                  </div>
                  {/* Divisão real de um total: o alvo do sócio se reparte em o
                      que já saiu e o que ainda falta. Mesma gramática da barra
                      do trilho. */}
                  {r.alvo > 0.01 || r.periodAmt > 0.01 ? (
                    <>
                      <div className="mt-2 flex h-[5px] gap-0.5">
                        <div style={{ flex: Math.max(Math.min(r.periodAmt, r.alvo), 0.001), background: "var(--nc-accent)", borderRadius: 2 }} />
                        {r.faltaPagar > 0.01 && (
                          <div style={{ flex: r.faltaPagar, background: "var(--nc-alert)", borderRadius: 2 }} />
                        )}
                        {r.excedente > 0.01 && (
                          <div style={{ flex: r.excedente, background: "var(--nc-crit)", borderRadius: 2 }} />
                        )}
                      </div>
                      <div className="nc-num mt-1.5 flex justify-between gap-2 text-[11px]" style={{ color: "var(--nc-text-2)" }}>
                        <span>retirado {formatCurrencyShort(Math.min(r.periodAmt, r.alvo))}</span>
                        {r.excedente > 0.01 ? (
                          <span style={{ color: "var(--nc-crit)" }}>excedente {formatCurrencyShort(r.excedente)}</span>
                        ) : (
                          <span style={{ color: "var(--nc-alert)" }}>falta {formatCurrencyShort(r.faltaPagar)}</span>
                        )}
                      </div>
                    </>
                  ) : (
                    <p className="mt-2 text-[11px]" style={{ color: "var(--nc-text-3)" }}>
                      Sem lucro a distribuir no período.
                    </p>
                  )}
                </motion.div>
              ))}
            </Stagger>
          )}
        </section>

        {/* ---------------- Histórico ---------------- */}
        <section className="flex flex-col gap-2">
          <SectionHead
            title="Histórico"
            sub="Comissões pagas e retiradas dos sócios, as 30 mais recentes"
            action={
              <SegmentedChips
                options={TIMELINE_OPTIONS}
                value={timelineFilter}
                onChange={v => setTimelineFilter(v as typeof timelineFilter)}
              />
            }
          />
          {timeline.length === 0 ? (
            <div className="nc-card py-16 text-center text-[13px]" style={{ color: "var(--nc-text-3)" }}>
              Nenhum lançamento neste filtro.
            </div>
          ) : (
            <Stagger className="nc-card overflow-hidden">
              <AnimatePresence initial={false}>
                {timeline.map(group => (
                  <motion.div key={group.day} variants={listItem} layout className="nc-row px-4 py-2.5">
                    <p className={cn(EYEBROW, "mb-1")} style={{ color: "var(--nc-text-3)" }}>{group.day}</p>
                    {group.items.map(it => {
                      const isCommission = it.kind === "commission";
                      return (
                        <div key={`${it.kind}-${it.id}`} className="group flex items-center gap-3 py-1">
                          <span
                            className="flex h-6 w-6 flex-none items-center justify-center rounded-full"
                            style={{
                              color: isCommission ? "var(--nc-alert)" : "var(--nc-accent)",
                              background: `color-mix(in srgb, ${isCommission ? "var(--nc-alert)" : "var(--nc-accent)"} 14%, transparent)`,
                            }}
                          >
                            {isCommission ? <Wallet size={12} /> : <Users size={12} />}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[13px]">
                              <span style={{ color: "var(--nc-text-2)" }}>{isCommission ? "Comissão paga" : "Retirada"}</span>
                              {" · "}{it.who}
                            </p>
                            {it.notes && (
                              <p className="truncate text-[11px]" style={{ color: "var(--nc-text-3)" }}>{it.notes}</p>
                            )}
                          </div>
                          <span className="nc-num flex-none text-[13px]" style={{ color: isCommission ? "var(--nc-alert)" : "var(--nc-accent)" }}>
                            −{formatCurrency(it.amount)}
                          </span>
                          <span className="nc-num hidden flex-none text-[11px] sm:inline" style={{ color: "var(--nc-text-3)" }}>
                            {formatDateBR(it.when)}
                          </span>
                          <div className="flex-none transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                            <NcButton
                              variant="danger"
                              size="icon"
                              aria-label={`Excluir ${isCommission ? "pagamento de comissão" : "retirada"} de ${it.who}`}
                              onClick={async () => {
                                const ok = await confirm({
                                  title: "Excluir registro",
                                  description: isCommission ? "Excluir este pagamento de comissão?" : "Excluir esta retirada?",
                                });
                                if (!ok) return;
                                if (isCommission) deleteCommissionPayment(it.id);
                                else deleteWithdrawal(it.id);
                              }}
                            >
                              <Trash2 size={12} />
                            </NcButton>
                          </div>
                        </div>
                      );
                    })}
                  </motion.div>
                ))}
              </AnimatePresence>
            </Stagger>
          )}
        </section>
      </div>

      {/* ---------------- Coluna direita: o que há para repartir ----------------
          No celular ela vem ANTES das listas (`order-first`), como nas outras
          telas migradas. */}
      <aside
        className="order-first flex w-full flex-none flex-col gap-3.5 p-4 md:p-6 xl:order-none xl:w-[312px]"
        style={{ background: "var(--nc-rail)" }}
      >
        <span className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>Distribuição do período</span>

        <div>
          <span className="text-[11.5px]" style={{ color: "var(--nc-text-2)" }}>Para distribuir aos sócios</span>
          <div className="flex flex-wrap items-baseline gap-2">
            <AnimatedNumber
              value={periodMetrics.distribuivel}
              format={formatCurrencyShort}
              duration={0.7}
              animateOnMount
              className="nc-num text-[30px] font-semibold tracking-[-0.025em]"
            />
          </div>
          <p className="nc-num mt-1.5 text-[11px]" style={{ color: "var(--nc-text-2)" }}>
            de um lucro líquido de{" "}
            <span style={{ color: periodMetrics.netProfit < 0 ? "var(--nc-crit)" : undefined }}>
              {formatCurrencyShort(periodMetrics.netProfit)}
            </span>
          </p>
        </div>

        <Rule />

        {/* A divisão que dá nome à tela: o lucro do período se reparte entre
            quem vendeu e quem é dono. É a única barra desta tela que divide um
            total de verdade — por isso ela existe aqui, e não em cada card. */}
        <div>
          <span className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>Como o lucro se reparte</span>
          {periodMetrics.netProfit <= 0 ? (
            <p className="py-2 text-xs" style={{ color: "var(--nc-text-3)" }}>
              Sem lucro no período para repartir.
            </p>
          ) : (
            <>
              <div className="mt-1.5 flex h-[5px] gap-0.5">
                <div style={{ flex: Math.max(periodMetrics.totalSellerBalance, 0.001), background: "var(--nc-alert)", borderRadius: 2 }} />
                <div style={{ flex: Math.max(periodMetrics.distribuivel, 0.001), background: "var(--nc-accent)", borderRadius: 2 }} />
              </div>
              <div className="nc-num mt-1.5 flex justify-between gap-2 text-[11px]" style={{ color: "var(--nc-text-2)" }}>
                <span style={{ color: "var(--nc-alert)" }}>vendedores {formatCurrencyShort(periodMetrics.totalSellerBalance)}</span>
                <span>sócios {formatCurrencyShort(periodMetrics.distribuivel)}</span>
              </div>
            </>
          )}
        </div>

        <Rule />

        <div className="flex flex-col gap-2.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[12.5px]" style={{ color: "var(--nc-text-2)" }}>Já retirado no período</span>
            <span className="nc-num text-sm">{formatCurrencyShort(periodMetrics.totalWithdrawalsPeriod)}</span>
          </div>
          <div className="nc-rule-top flex items-baseline justify-between gap-2 pt-2.5">
            <span className="text-[12.5px]">Ainda cabe retirar</span>
            {/* "Falta pagar" é sempre o alerta, aqui como no Dashboard e em
                Vendas — só que quem falta receber é o sócio. */}
            <span style={{ color: stillDistributable > 0.01 ? "var(--nc-alert)" : undefined }}>
              <AnimatedNumber
                value={stillDistributable}
                format={formatCurrencyShort}
                duration={0.7}
                animateOnMount
                className="nc-num text-xl font-semibold"
              />
            </span>
          </div>
          <div className="nc-num flex items-baseline justify-between gap-2 text-[11.5px]" style={{ color: "var(--nc-text-3)" }}>
            <span>despesas e investidores no período</span>
            <span>{formatCurrencyShort(periodMetrics.periodExpenses + periodMetrics.periodInvestorPayments)}</span>
          </div>
        </div>

        <Rule />

        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>Quem mais vendeu</span>
            <span className="nc-num text-[10.5px]" style={{ color: "var(--nc-text-3)" }}>
              {periodMetrics.perSeller.length} no período
            </span>
          </div>
          {periodMetrics.perSeller.length === 0 ? (
            <p className="py-4 text-center text-xs" style={{ color: "var(--nc-text-3)" }}>
              Nenhum vendedor cadastrado.
            </p>
          ) : (
            <Stagger className="flex flex-col">
              {periodMetrics.perSeller.slice(0, MAX_TOP_SELLERS).map(r => (
                <motion.div key={r.seller.id} variants={listItem} className="nc-row flex items-center justify-between gap-2 py-1.5 text-xs">
                  <span className="min-w-0 flex-1 truncate">
                    {r.seller.name}
                    <span style={{ color: "var(--nc-text-3)" }}> · {r.tier.label}</span>
                  </span>
                  <span className="nc-num flex-none">
                    {formatCurrencyShort(r.vendasTotal)}
                    <span style={{ color: "var(--nc-text-3)" }}> · {r.units} un.</span>
                  </span>
                </motion.div>
              ))}
              {periodMetrics.perSeller.length > MAX_TOP_SELLERS && (
                <p className="pt-2 text-[11px]" style={{ color: "var(--nc-text-3)" }}>
                  + {periodMetrics.perSeller.length - MAX_TOP_SELLERS} outros vendedores
                </p>
              )}
            </Stagger>
          )}
        </div>
      </aside>

      {/* ================= Painel do vendedor ================= */}
      <Sheet open={!!panelSellerId} onOpenChange={v => { if (!v) { setPanelSellerId(null); setPanelMode("resumo"); } }}>
        <SheetContent className="nocturne w-full sm:max-w-xl overflow-y-auto p-0 flex flex-col">
          {panelRow && (
            <>
              <NcSheetHeader
                eyebrow={`Distribuição · ${label}`}
                title={
                  <span className="flex items-center gap-2">
                    {panelRow.seller.name}
                    <span className="nc-pill nc-pill--mute">{panelRow.tier.label}</span>
                  </span>
                }
                description={balanceLabel(panelRow.balance)}
              />

              <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
                {/* Saldo */}
                <div>
                  <span className="text-[11.5px]" style={{ color: "var(--nc-text-2)" }}>Saldo do vendedor</span>
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span style={{ color: balanceTone(panelRow.balance) }}>
                      <AnimatedNumber
                        value={panelRow.balance}
                        format={formatCurrency}
                        duration={0.7}
                        animateOnMount
                        className="nc-num text-[30px] font-semibold tracking-[-0.025em]"
                      />
                    </span>
                  </div>
                </div>

                <Rule />

                {/* A conta inteira, na ordem em que ela acontece. */}
                <section className="space-y-1.5">
                  <p className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>Como se chega nesse saldo</p>
                  <LedgerLine label="Unidades vendidas" value={String(panelRow.units)} />
                  <LedgerLine label="Vendas no período" value={formatCurrency(panelRow.vendasTotal)} />
                  <LedgerLine
                    label="Saldo trazido dos meses anteriores"
                    value={formatCurrency(panelRow.priorBalance)}
                    tone={panelRow.priorBalance < -0.01 ? "var(--nc-crit)" : undefined}
                  />
                  <LedgerLine label="Comissão gerada" value={`+${formatCurrency(panelRow.accrued)}`} tone="var(--nc-ok)" />
                  {panelRow.retiradasTotal > 0.01 && (
                    <LedgerLine label="Consumo próprio" value={`−${formatCurrency(panelRow.retiradasTotal)}`} tone="var(--nc-alert)" />
                  )}
                  {panelRow.manualDebtsTotal > 0.01 && (
                    <LedgerLine label="Dívidas lançadas" value={`−${formatCurrency(panelRow.manualDebtsTotal)}`} tone="var(--nc-alert)" />
                  )}
                  {panelRow.debtPaymentsTotal > 0.01 && (
                    <LedgerLine label="Dívida já paga por ele" value={`+${formatCurrency(panelRow.debtPaymentsTotal)}`} tone="var(--nc-ok)" />
                  )}
                  <LedgerLine label="Comissão já paga a ele" value={`−${formatCurrency(panelRow.commPaid)}`} tone={panelRow.commPaid > 0.01 ? "var(--nc-alert)" : undefined} />
                  <div className="nc-rule-top flex items-center justify-between gap-2 pt-2 text-[13px]">
                    <span>Saldo</span>
                    <span className="nc-num font-medium" style={{ color: balanceTone(panelRow.balance) }}>
                      {formatCurrency(panelRow.balance)}
                    </span>
                  </div>
                </section>

                {/* Próxima faixa */}
                {getNextTier(panelRow.tier) && (
                  <p className="text-[11.5px]" style={{ color: "var(--nc-text-2)" }}>
                    Próxima faixa{" "}
                    <span style={{ color: "var(--nc-accent)" }}>{getNextTier(panelRow.tier)!.label}</span>
                    {" · faltam "}
                    <span className="nc-num">{unitsUntilNextTier(panelRow.units)}</span> un.
                  </p>
                )}

                {/* Vendas dele ainda em aberto: o que pode mudar a faixa. */}
                {panelRow.pendingToReceive > 0.01 && (
                  <div className="rounded-lg p-3 text-xs" style={{ background: "var(--nc-bg)", boxShadow: "inset 0 0 0 1px var(--nc-track)" }}>
                    <div className="flex justify-between">
                      <span style={{ color: "var(--nc-text-2)" }}>Vendas dele ainda a receber</span>
                      <span className="nc-num" style={{ color: "var(--nc-alert)" }}>{formatCurrency(panelRow.pendingToReceive)}</span>
                    </div>
                    <div className="nc-rule-top mt-1.5 flex justify-between pt-1.5">
                      <span style={{ color: "var(--nc-text-2)" }}>Saldo se tudo for recebido</span>
                      <span className="nc-num">{formatCurrency(panelRow.projectedBalance)}</span>
                    </div>
                  </div>
                )}

                <Rule />

                {/* ---- Formulário, quando um dos modos está ativo ----
                    Sem `AnimatePresence`: a troca é só entre dois blocos e o
                    `key` já refaz a entrada. Com `mode="wait"` aqui a fila
                    travaria justamente no caminho mais comum — registrar um
                    pagamento re-renderiza o painel inteiro (o saldo mudou) bem
                    dentro da janela de saída, e o bloco novo ficaria parado no
                    `initial`, invisível. É o mesmo defeito que o PageTransition
                    já teve. */}
                {panelMode === "resumo" ? (
                  <motion.section
                    key="acoes"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={transitionBase}
                    className="space-y-3"
                  >
                      <p className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>Registrar</p>
                      <div className="flex flex-wrap gap-2">
                        <NcButton variant="outline" size="md" onClick={() => startMode("comissao", Math.max(0, panelRow.balance))}>
                          <Wallet size={14} />Pagar comissão
                        </NcButton>
                        <NcButton variant="quiet" size="md" onClick={() => startMode("divida", panelRow.saldoConsumo)}>
                          <Receipt size={14} />Receber dívida
                        </NcButton>
                        <NcButton variant="quiet" size="md" onClick={() => startMode("lancar", 0)}>
                          <HandCoins size={14} />Lançar dívida
                        </NcButton>
                      </div>

                      <p className={cn(EYEBROW, "pt-2")} style={{ color: "var(--nc-text-3)" }}>Ver</p>
                      <div className="flex flex-wrap gap-2">
                        <NcButton variant="ghost" size="md" onClick={() => setExtractFor(panelRow.seller.id)}>
                          Extrato completo<ArrowRight size={13} />
                        </NcButton>
                        <NcButton variant="ghost" size="md" onClick={() => shareSellerWhatsApp(panelRow)}>
                          <Share2 size={14} />Enviar no WhatsApp
                        </NcButton>
                      </div>
                  </motion.section>
                ) : (
                  <motion.section
                    key={panelMode}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={transitionBase}
                    className="space-y-3"
                  >
                      <div className="flex items-center justify-between gap-2">
                        <p className={EYEBROW} style={{ color: "var(--nc-accent)" }}>{PANEL_TITLES[panelMode]}</p>
                        <NcButton variant="ghost" onClick={() => setPanelMode("resumo")}>
                          <X size={13} />Cancelar
                        </NcButton>
                      </div>
                      <p className="text-[11.5px]" style={{ color: "var(--nc-text-2)" }}>
                        {panelMode === "comissao" && "Sai do caixa para a mão do vendedor e abate o saldo."}
                        {panelMode === "divida" && "Dinheiro que o vendedor devolveu do que consumiu."}
                        {panelMode === "lancar" && "Adiantamento, empréstimo ou acerto que ele passa a dever."}
                      </p>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <Label className="text-xs">Valor (R$)</Label>
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            value={panelForm.amount}
                            onChange={e => setPanelForm(f => ({ ...f, amount: e.target.value }))}
                            placeholder="0,00"
                            className="nc-num"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs">Data</Label>
                          <Input type="date" value={panelForm.date} onChange={e => setPanelForm(f => ({ ...f, date: e.target.value }))} />
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Observação</Label>
                        <Input
                          value={panelForm.notes}
                          onChange={e => setPanelForm(f => ({ ...f, notes: e.target.value }))}
                          placeholder={panelMode === "lancar" ? "Ex: adiantamento, empréstimo" : "Opcional"}
                        />
                      </div>
                  </motion.section>
                )}

                {panelMode === "resumo" && (
                  <>
                    <Rule />
                    <NcButton
                      variant="danger"
                      size="md"
                      className="w-full"
                      onClick={async () => {
                        if (await confirm({ title: "Remover vendedor", description: `Remover ${panelRow.seller.name}?`, destructive: true })) {
                          deleteSeller(panelRow.seller.id);
                          setPanelSellerId(null);
                        }
                      }}
                    >
                      <Trash2 size={13} />Remover vendedor
                    </NcButton>
                  </>
                )}
              </div>

              {panelMode !== "resumo" && (
                <SheetFooter className="px-5 py-3" style={{ borderTop: "1px solid var(--nc-track)", background: "var(--nc-rail)" }}>
                  <div className="flex w-full items-center justify-between gap-3">
                    <p className="text-[11px]" style={{ color: "var(--nc-text-2)" }}>
                      {panelAmount > 0 ? (
                        <>
                          Saldo passa a{" "}
                          <span className="nc-num font-medium">
                            {formatCurrency(
                              panelMode === "comissao" ? panelRow.balance - panelAmount
                                : panelMode === "divida" ? panelRow.balance + panelAmount
                                  : panelRow.balance - panelAmount,
                            )}
                          </span>
                        </>
                      ) : "Informe o valor"}
                    </p>
                    <NcButton variant="solid" size="md" onClick={submitPanel} disabled={panelAmount <= 0 || panelSubmitting}>
                      {panelSubmitting ? "Registrando…" : "Registrar"}
                    </NcButton>
                  </div>
                </SheetFooter>
              )}
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* ================= Retirada do sócio ================= */}
      <Sheet open={!!wdPartnerId} onOpenChange={v => { if (!v) setWdPartnerId(null); }}>
        <SheetContent className="nocturne w-full sm:max-w-md overflow-y-auto p-0 flex flex-col">
          {partnerRow && (
            <>
              <NcSheetHeader
                eyebrow={`Sócios · ${label}`}
                title={`Retirada de ${partnerRow.partner.name}`}
                description={`${partnerRow.partner.percentage}% da sociedade · alvo do período ${formatCurrency(partnerRow.alvo)}`}
              />
              <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
                <section className="space-y-1.5">
                  <p className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>Onde ele está</p>
                  <LedgerLine label="Retirado no período" value={formatCurrency(partnerRow.periodAmt)} />
                  <LedgerLine label="Retirado no ano" value={formatCurrency(partnerRow.yearAmt)} />
                  <LedgerLine
                    label="Falta para o alvo"
                    value={formatCurrency(partnerRow.faltaPagar)}
                    tone={partnerRow.faltaPagar > 0.01 ? "var(--nc-alert)" : undefined}
                  />
                </section>
                <Rule />
                <section className="space-y-3">
                  <p className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>Registrar retirada</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Valor (R$)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={wdForm.amount}
                        onChange={e => setWdForm(f => ({ ...f, amount: e.target.value }))}
                        placeholder="0,00"
                        className="nc-num"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Data</Label>
                      <Input type="date" value={wdForm.date} onChange={e => setWdForm(f => ({ ...f, date: e.target.value }))} />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Observação</Label>
                    <Input value={wdForm.notes} onChange={e => setWdForm(f => ({ ...f, notes: e.target.value }))} placeholder="Opcional" />
                  </div>
                </section>
              </div>
              <SheetFooter className="px-5 py-3" style={{ borderTop: "1px solid var(--nc-track)", background: "var(--nc-rail)" }}>
                <div className="flex w-full items-center justify-between gap-3">
                  <p className="text-[11px]" style={{ color: "var(--nc-text-2)" }}>
                    Ainda cabe retirar{" "}
                    <span className="nc-num font-medium" style={{ color: "var(--nc-alert)" }}>
                      {formatCurrency(stillDistributable)}
                    </span>
                  </p>
                  <NcButton variant="solid" size="md" onClick={submitWd} disabled={!Number(wdForm.amount) || wdSubmitting}>
                    {wdSubmitting ? "Registrando…" : "Registrar retirada"}
                  </NcButton>
                </div>
              </SheetFooter>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* ================= Movimentar estoque ================= */}
      <Sheet open={moveOpen} onOpenChange={v => { setMoveOpen(v); if (!v) resetMove(); }}>
        <SheetContent className="nocturne w-full sm:max-w-xl overflow-y-auto p-0 flex flex-col">
          <NcSheetHeader
            eyebrow="Consignação"
            title="Movimentar estoque"
            description="Da casa para um vendedor, ou de um vendedor para outro. A quantidade sai de quem tem e entra na mão de quem vai vender."
          />

          <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
            <section className="space-y-3">
              <p className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>De onde sai e para quem vai</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Origem</Label>
                  <Select value={moveFrom} onValueChange={v => { setMoveFrom(v); setMoveSelected({}); if (v === moveTo) setMoveTo(""); }}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent className="nocturne">
                      <SelectItem value="casa">Estoque da casa</SelectItem>
                      {sellers.map(s => {
                        const held = productAssignments
                          .filter(a => a.sellerId === s.id)
                          .reduce((sum, a) => sum + a.quantity, 0);
                        return (
                          <SelectItem key={s.id} value={s.id} disabled={held <= 0}>
                            {s.name} ({held} un.)
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Destino</Label>
                  <Select value={moveTo} onValueChange={setMoveTo}>
                    <SelectTrigger><SelectValue placeholder="Selecione o vendedor" /></SelectTrigger>
                    <SelectContent className="nocturne">
                      {sellers.filter(s => s.id !== moveFrom).map(s => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </section>

            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <p className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>O que mover</p>
                <span className="nc-num text-[10.5px]" style={{ color: "var(--nc-text-3)" }}>
                  {moveCount} selecionado{moveCount === 1 ? "" : "s"}
                </span>
              </div>
              <div className="max-h-80 overflow-y-auto rounded-lg" style={{ boxShadow: "inset 0 0 0 1px var(--nc-track)" }}>
                {moveItems.length === 0 ? (
                  <p className="p-4 text-center text-xs" style={{ color: "var(--nc-text-3)" }}>
                    {moveFrom === "casa"
                      ? "Todo o estoque da casa já está atribuído."
                      : "Este vendedor não tem estoque para passar adiante."}
                  </p>
                ) : moveItems.map(item => {
                  const checked = Object.prototype.hasOwnProperty.call(moveSelected, item.key);
                  return (
                    <div key={item.key} className="nc-row px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Checkbox id={`move-${item.key}`} checked={checked} onCheckedChange={c => toggleMoveItem(item.key, !!c)} />
                        <label htmlFor={`move-${item.key}`} className="flex flex-1 cursor-pointer items-center justify-between gap-2 text-xs">
                          <span className="truncate">
                            {item.flavor}
                            <span style={{ color: "var(--nc-text-3)" }}> · {item.brand} {item.model}</span>
                          </span>
                          <span className="nc-num flex-none text-[10.5px]" style={{ color: "var(--nc-text-3)" }}>
                            {item.available} disp.
                          </span>
                        </label>
                      </div>
                      {checked && (
                        <Input
                          type="number"
                          min="1"
                          max={item.available}
                          value={moveSelected[item.key]}
                          onChange={e => setMoveSelected(prev => ({
                            ...prev,
                            [item.key]: String(Math.max(1, Math.min(Number(e.target.value) || 1, item.available))),
                          }))}
                          aria-label={`Quantidade de ${item.flavor}`}
                          className="nc-num ml-6 mt-1.5 h-7 w-24 text-xs"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          </div>

          <SheetFooter className="px-5 py-3" style={{ borderTop: "1px solid var(--nc-track)", background: "var(--nc-rail)" }}>
            <div className="flex w-full items-center justify-between gap-3">
              <p className="text-[11px]" style={{ color: "var(--nc-text-2)" }}>
                {moveCount > 0
                  ? <>Movendo <span className="nc-num font-medium">{moveUnits}</span> un. em {moveCount} produto{moveCount === 1 ? "" : "s"}</>
                  : "Escolha a origem, o destino e os produtos"}
              </p>
              <NcButton variant="solid" size="md" onClick={submitMove} disabled={!canMove || moveSubmitting}>
                {moveSubmitting ? "Movendo…" : "Mover"}
              </NcButton>
            </div>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Extrato completo do vendedor */}
      <SellerReportDrawer
        sellerId={extractFor}
        open={!!extractFor}
        onClose={() => setExtractFor(null)}
        initialPeriod={period}
        initialCustomStart={customStart}
        initialCustomEnd={customEnd}
      />
    </div>
  );
}

/**
 * Cabeçalho de seção da coluna principal: sobretítulo terciário, uma linha de
 * contexto e, se houver, um controle à direita. As três seções desta tela usam
 * o mesmo, senão cada uma inventaria o próprio peso.
 */
function SectionHead({ title, sub, action }: { title: string; sub?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-2">
      <div className="min-w-0">
        <span className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>{title}</span>
        {sub && <p className="mt-0.5 text-[11.5px]" style={{ color: "var(--nc-text-2)" }}>{sub}</p>}
      </div>
      {action}
    </div>
  );
}

/** Linha de conta: rótulo à esquerda, número tabular à direita. */
function LedgerLine({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-center justify-between gap-2 text-[12.5px]">
      <span style={{ color: "var(--nc-text-2)" }}>{label}</span>
      <span className="nc-num" style={{ color: tone }}>{value}</span>
    </div>
  );
}
