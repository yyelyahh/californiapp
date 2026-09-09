import { useMemo, useState } from "react";
import { format, startOfMonth, endOfMonth, subMonths, parseISO, isWithinInterval, differenceInCalendarDays, addDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { PackageX, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { useStore } from "@/context/StoreContext";
import { motion } from "motion/react";
import { Stagger } from "@/components/motion/Stagger";
import AnimatedNumber from "@/components/motion/AnimatedNumber";
import { listItem, transitionBase } from "@/lib/motion";
import { SegmentedChips, Rule, EYEBROW } from "@/components/nocturne";
import { currentMonthRange } from "@/lib/date-utils";

type Period = "month" | "lastMonth" | "custom";
type ProfitSort = "abs" | "margin";

const PERIOD_OPTIONS: { value: Period; label: string; short: string }[] = [
  { value: "month", label: "Mês atual", short: "Mês" },
  { value: "lastMonth", label: "Mês anterior", short: "Mês ant." },
];

const PROFIT_SORT_OPTIONS = [
  { value: "abs", label: "Ordenar por lucro em reais", short: "Lucro" },
  { value: "margin", label: "Ordenar por margem", short: "Margem" },
];

/**
 * Cobertura curta = repor agora; média = ficar de olho. Acima da segunda faixa a
 * linha nem entra na lista de reposição.
 */
const COVER_CRITICAL_DAYS = 7;
const COVER_WARNING_DAYS = 14;

/** Acima disso o estoque não está girando: é dinheiro parado, não sortimento. */
const DEAD_STOCK_DAYS = 90;

/** Quantas linhas cabem numa lista de ranking antes de virar "+ N outros". */
const MAX_RANK_ROWS = 10;

/** Quantas marcas cabem na lista do trilho. */
const MAX_RAIL_ROWS = 6;

const fmtCurrency = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v || 0);

/** Sem centavos — para os números grandes do trilho, como no Dashboard. */
const fmtCurrencyShort = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(v || 0);

const fmtPct = (v: number) => `${(v * 100).toFixed(0)}%`;

/** Dias inteiros: "6 dias" é a unidade que a pessoa usa para decidir a compra. */
const fmtDays = (v: number) => `${Math.floor(v)} ${Math.floor(v) === 1 ? "dia" : "dias"}`;

export default function InsightsPage() {
  const { products, sales } = useStore();
  const [period, setPeriod] = useState<Period>("month");
  const [customStart, setCustomStart] = useState(() => currentMonthRange().from);
  const [customEnd, setCustomEnd] = useState(() => currentMonthRange().to);
  const [profitSort, setProfitSort] = useState<ProfitSort>("abs");

  const { start, end, prevStart, prevEnd, label } = useMemo(() => {
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
    const days = differenceInCalendarDays(e, s) + 1;
    const pe = addDays(s, -1);
    const ps = addDays(pe, -(days - 1));
    return { start: s, end: e, prevStart: ps, prevEnd: pe, label: l };
  }, [period, customStart, customEnd]);

  /**
   * Dias JÁ CORRIDOS do período — o divisor do ritmo de venda.
   *
   * No mês corrente o fim do período é o dia 30, mas as vendas só existem até
   * hoje: dividir por 30 no dia 9 dá um terço do ritmo real, e a cobertura sai
   * três vezes maior do que é. O aviso de reposição chegaria tarde justamente
   * no mês que está correndo, que é o único em que ele serve para alguma coisa.
   */
  const rateDays = useMemo(() => {
    const today = new Date();
    const effectiveEnd = end > today ? today : end;
    return Math.max(1, differenceInCalendarDays(effectiveEnd, start) + 1);
  }, [start, end]);

  const inRange = (iso: string, s: Date, e: Date) => {
    try { return isWithinInterval(parseISO(iso), { start: s, end: e }); } catch { return false; }
  };

  const productMap = useMemo(() => new Map(products.map(p => [p.id, p])), [products]);
  const modelKey = (brand: string, model: string) => `${brand} ${model}`.trim();

  const periodSales = useMemo(
    () => sales.filter(s => s.type === "venda" && inRange(s.date, start, end)),
    [sales, start, end],
  );
  const prevPeriodSales = useMemo(
    () => sales.filter(s => s.type === "venda" && inRange(s.date, prevStart, prevEnd)),
    [sales, prevStart, prevEnd],
  );

  /**
   * Desempenho por modelo. O lucro é `receita − custo`, a MESMA conta do
   * Dashboard — era `(unitPrice − purchasePrice) × qtd`, que diverge da receita
   * assim que uma venda sair com desconto no total.
   */
  const buildModelStats = (list: typeof sales) => {
    const map = new Map<string, {
      key: string; brand: string; model: string;
      units: number; revenue: number; cost: number; profit: number;
    }>();
    for (const s of list) {
      const p = productMap.get(s.productId);
      if (!p) continue;
      const key = modelKey(p.brand, p.model);
      const entry = map.get(key) ?? { key, brand: p.brand, model: p.model, units: 0, revenue: 0, cost: 0, profit: 0 };
      entry.units += s.quantity;
      entry.revenue += s.totalPrice;
      entry.cost += p.purchasePrice * s.quantity;
      entry.profit = entry.revenue - entry.cost;
      map.set(key, entry);
    }
    return Array.from(map.values());
  };

  const modelStats = useMemo(() => buildModelStats(periodSales), [periodSales, productMap]);
  const prevModelStats = useMemo(() => buildModelStats(prevPeriodSales), [prevPeriodSales, productMap]);

  const totals = useMemo(() => {
    const units = modelStats.reduce((s, m) => s + m.units, 0);
    const revenue = modelStats.reduce((s, m) => s + m.revenue, 0);
    const cost = modelStats.reduce((s, m) => s + m.cost, 0);
    const profit = revenue - cost;
    return { units, revenue, cost, profit, margin: revenue > 0 ? profit / revenue : 0 };
  }, [modelStats]);

  const prevTotals = useMemo(() => {
    const units = prevModelStats.reduce((s, m) => s + m.units, 0);
    const revenue = prevModelStats.reduce((s, m) => s + m.revenue, 0);
    const cost = prevModelStats.reduce((s, m) => s + m.cost, 0);
    return { units, revenue, profit: revenue - cost };
  }, [prevModelStats]);

  const unitsChange = prevTotals.units > 0 ? (totals.units - prevTotals.units) / prevTotals.units : null;
  const profitChange = prevTotals.profit !== 0 ? (totals.profit - prevTotals.profit) / Math.abs(prevTotals.profit) : null;

  /**
   * Estoque de hoje por modelo, com o mínimo configurado e o dinheiro que ele
   * representa a custo.
   *
   * O mínimo é a SOMA dos mínimos dos sabores, não o maior deles: somar o
   * estoque de oito sabores e comparar com o mínimo de um só dava um modelo
   * "saudável" com seis sabores zerados. `zeroed` continua contando os sabores
   * em falta, porque é o que o cliente pede pelo nome.
   */
  const stockByModel = useMemo(() => {
    const map = new Map<string, {
      key: string; brand: string; model: string;
      stock: number; minStock: number; flavors: number; zeroed: number; cost: number;
    }>();
    for (const p of products) {
      const key = modelKey(p.brand, p.model);
      const entry = map.get(key) ?? { key, brand: p.brand, model: p.model, stock: 0, minStock: 0, flavors: 0, zeroed: 0, cost: 0 };
      entry.stock += p.stock;
      entry.minStock += p.minStock || 0;
      entry.flavors += 1;
      if (p.stock <= 0) entry.zeroed += 1;
      entry.cost += p.stock * (p.purchasePrice || 0);
      map.set(key, entry);
    }
    return map;
  }, [products]);

  /**
   * Cobertura: quantos dias o estoque de hoje dura no ritmo de venda deste
   * período. Substituiu o "giro" (vendidos ÷ estoque médio), que tinha o
   * estoque no divisor e por isso elegia como melhor justamente o modelo que
   * estava zerando — e que dependia de reconstruir o estoque inicial para trás,
   * conta que qualquer acerto manual de estoque furava em silêncio.
   *
   * Aqui só entram dois fatos: o estoque de agora e o que foi vendido no
   * período. Sem reconstrução, sem estoque médio.
   */
  const coverage = useMemo(() => {
    const soldByModel = new Map(modelStats.map(m => [m.key, m.units]));
    return Array.from(stockByModel.values()).map(s => {
      const sold = soldByModel.get(s.key) ?? 0;
      const perDay = sold / rateDays;
      const days = perDay > 0 ? s.stock / perDay : null;
      return { ...s, sold, perDay, days };
    });
  }, [stockByModel, modelStats, rateDays]);

  /**
   * O que repor, por urgência. Duas razões diferentes na mesma lista, porque a
   * ação é a mesma: o mínimo é a política que a pessoa configurou, a cobertura
   * é a demanda medida. Modelo sem estoque que vendeu no período vem primeiro —
   * ali a venda já está sendo perdida.
   */
  const toRestock = useMemo(() => {
    return coverage
      .map(c => {
        const belowMin = c.minStock > 0 && c.stock < c.minStock;
        const shortCover = c.days !== null && c.days <= COVER_WARNING_DAYS;
        const outOfStock = c.stock <= 0 && c.sold > 0;
        return { ...c, belowMin, shortCover, outOfStock };
      })
      .filter(c => c.outOfStock || c.belowMin || c.shortCover)
      .sort((a, b) => {
        if (a.outOfStock !== b.outOfStock) return a.outOfStock ? -1 : 1;
        const da = a.days ?? Infinity;
        const db = b.days ?? Infinity;
        if (da !== db) return da - db;
        return (b.minStock - b.stock) - (a.minStock - a.stock);
      });
  }, [coverage]);

  /** Dinheiro parado: tem estoque e não gira — nada vendido, ou cobertura longa demais. */
  const idle = useMemo(() => {
    return coverage
      .filter(c => c.stock > 0 && (c.sold === 0 || (c.days !== null && c.days > DEAD_STOCK_DAYS)))
      .sort((a, b) => b.cost - a.cost);
  }, [coverage]);

  const idleTotal = useMemo(() => idle.reduce((s, i) => s + i.cost, 0), [idle]);

  const topSold = useMemo(() => [...modelStats].sort((a, b) => b.units - a.units), [modelStats]);

  const topProfit = useMemo(() => {
    const withMargin = modelStats.map(m => ({ ...m, margin: m.revenue > 0 ? m.profit / m.revenue : 0 }));
    return withMargin.sort((a, b) => (profitSort === "abs" ? b.profit - a.profit : b.margin - a.margin));
  }, [modelStats, profitSort]);

  /** Participação por MARCA — o corte que a coluna principal não faz (ela é toda por modelo). */
  const byBrand = useMemo(() => {
    const map = new Map<string, { brand: string; units: number; revenue: number }>();
    modelStats.forEach(m => {
      const brand = (m.brand || "").trim() || "Sem marca";
      const cur = map.get(brand);
      if (cur) { cur.units += m.units; cur.revenue += m.revenue; }
      else map.set(brand, { brand, units: m.units, revenue: m.revenue });
    });
    return Array.from(map.values()).sort((a, b) => b.units - a.units);
  }, [modelStats]);

  const maxSoldUnits = Math.max(1, ...topSold.map(m => m.units));
  const periodLabel = PERIOD_OPTIONS.find(o => o.value === period)?.label ?? "Período personalizado";

  return (
    // `/insights` está em `fullBleedRoutes` (AppLayout): chega sem padding e sem
    // max-width, e é a tela que cuida do próprio espaçamento.
    <div className="nocturne flex flex-1 flex-col xl:flex-row xl:items-stretch">
      {/* ---------------- Coluna principal ---------------- */}
      <div className="flex-1 min-w-0 p-4 md:p-6 flex flex-col gap-4">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className={EYEBROW} style={{ color: "var(--nc-accent)" }}>{label}</span>
            <h1 className="mt-1 text-xl sm:text-[22px]">Insights</h1>
          </div>
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
            {periodLabel} · ritmo medido em {rateDays} {rateDays === 1 ? "dia" : "dias"}
          </span>
        </div>

        {/* ---------------- Repor ---------------- */}
        <section className="flex flex-col gap-2">
          <SectionHead
            title="Vai faltar primeiro"
            sub="Estoque de hoje no ritmo de venda do período, ou abaixo do mínimo configurado"
            count={toRestock.length}
          />
          {toRestock.length === 0 ? (
            <div className="nc-card py-12 text-center text-[13px]" style={{ color: "var(--nc-text-3)" }}>
              Nenhum modelo pedindo reposição.
            </div>
          ) : (
            <Stagger className="nc-card overflow-hidden">
              {toRestock.map(c => (
                <motion.div key={c.key} variants={listItem} className="nc-row flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px]">
                      {c.model || c.brand}
                      <span style={{ color: "var(--nc-text-3)" }}> · {c.brand}</span>
                    </p>
                    <p className="nc-num truncate text-[11px]" style={{ color: "var(--nc-text-3)" }}>
                      {c.stock} un. em estoque
                      {c.minStock > 0 && ` · mínimo ${c.minStock}`}
                      {c.zeroed > 0 && ` · ${c.zeroed} de ${c.flavors} sabores zerados`}
                    </p>
                  </div>
                  <div className="flex flex-none items-center gap-2">
                    {c.belowMin && <span className="nc-pill nc-pill--open">abaixo do mínimo</span>}
                    {/* O prazo é o alvo da leitura: crítico até uma semana,
                        atenção até duas. --nc-crit é literalmente "estoque
                        prestes a acabar". */}
                    {c.outOfStock ? (
                      <span className="nc-pill nc-pill--open">sem estoque</span>
                    ) : c.days !== null ? (
                      <span
                        className="nc-num text-[13px]"
                        style={{ color: c.days <= COVER_CRITICAL_DAYS ? "var(--nc-crit)" : "var(--nc-alert)" }}
                      >
                        {fmtDays(c.days)}
                      </span>
                    ) : (
                      <span className="nc-pill nc-pill--mute">sem venda</span>
                    )}
                  </div>
                </motion.div>
              ))}
            </Stagger>
          )}
        </section>

        {/* ---------------- Parado ---------------- */}
        <section className="flex flex-col gap-2">
          <SectionHead
            title="Parado"
            sub={`Tem estoque e não gira — sem venda no período, ou cobertura acima de ${DEAD_STOCK_DAYS} dias`}
            count={idle.length}
            right={idleTotal > 0 ? `${fmtCurrency(idleTotal)} a custo` : undefined}
          />
          {idle.length === 0 ? (
            <div className="nc-card py-12 text-center text-[13px]" style={{ color: "var(--nc-text-3)" }}>
              Nenhum modelo parado no período.
            </div>
          ) : (
            <Stagger className="nc-card overflow-hidden">
              {idle.map(c => (
                <motion.div key={c.key} variants={listItem} className="nc-row flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px]">
                      {c.model || c.brand}
                      <span style={{ color: "var(--nc-text-3)" }}> · {c.brand}</span>
                    </p>
                    <p className="nc-num truncate text-[11px]" style={{ color: "var(--nc-text-3)" }}>
                      {c.stock} un. ·{" "}
                      {c.sold === 0
                        ? "nenhuma venda no período"
                        : `${c.sold} un. vendidas · cobertura acima de ${DEAD_STOCK_DAYS} dias`}
                    </p>
                  </div>
                  <span className="nc-num flex-none text-[13px]" style={{ color: "var(--nc-alert)" }}>
                    {fmtCurrency(c.cost)}
                  </span>
                </motion.div>
              ))}
            </Stagger>
          )}
        </section>

        {/* ---------------- Quem vende ---------------- */}
        <section className="flex flex-col gap-2">
          <SectionHead
            title="Quem vende"
            sub={totals.units > 0 ? `${totals.units} unidades no período` : undefined}
            count={topSold.length}
          />
          {topSold.length === 0 ? (
            <div className="nc-card py-12 text-center text-[13px]" style={{ color: "var(--nc-text-3)" }}>
              Sem vendas no período.
            </div>
          ) : (
            <Stagger className="nc-card overflow-hidden">
              {topSold.slice(0, MAX_RANK_ROWS).map(m => (
                <motion.div key={m.key} variants={listItem} className="nc-row px-4 py-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <p className="min-w-0 flex-1 truncate text-[13px]">
                      {m.model || m.brand}
                      <span style={{ color: "var(--nc-text-3)" }}> · {m.brand}</span>
                    </p>
                    <span className="nc-num flex-none text-[13px]">
                      {m.units} un.
                      <span style={{ color: "var(--nc-text-3)" }}>
                        {" · "}{fmtPct(totals.units > 0 ? m.units / totals.units : 0)}
                      </span>
                    </span>
                  </div>
                  {/* Escala de comparação (o maior preenche a linha), não divisão
                      de um total — por isso uma cor só sobre o trilho vazio. */}
                  <div className="mt-1.5 h-[4px] overflow-hidden rounded-sm" style={{ background: "var(--nc-track)" }}>
                    <motion.div
                      className="h-full rounded-sm"
                      style={{ background: "var(--nc-accent)" }}
                      initial={{ width: 0 }}
                      animate={{ width: `${(m.units / maxSoldUnits) * 100}%` }}
                      transition={transitionBase}
                    />
                  </div>
                </motion.div>
              ))}
              {topSold.length > MAX_RANK_ROWS && (
                <p className="px-4 py-2 text-[11px]" style={{ color: "var(--nc-text-3)" }}>
                  + {topSold.length - MAX_RANK_ROWS} outros modelos
                </p>
              )}
            </Stagger>
          )}
        </section>

        {/* ---------------- Quem dá lucro ---------------- */}
        <section className="flex flex-col gap-2">
          <SectionHead
            title="Quem dá lucro"
            sub="Receita menos custo do que saiu, por modelo"
            count={topProfit.length}
            action={
              <SegmentedChips
                options={PROFIT_SORT_OPTIONS}
                value={profitSort}
                onChange={v => setProfitSort(v as ProfitSort)}
              />
            }
          />
          {topProfit.length === 0 ? (
            <div className="nc-card py-12 text-center text-[13px]" style={{ color: "var(--nc-text-3)" }}>
              Sem vendas no período.
            </div>
          ) : (
            <Stagger className="nc-card overflow-hidden">
              {topProfit.slice(0, MAX_RANK_ROWS).map(m => (
                <motion.div key={m.key} variants={listItem} className="nc-row flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px]">
                      {m.model || m.brand}
                      <span style={{ color: "var(--nc-text-3)" }}> · {m.brand}</span>
                    </p>
                    <p className="nc-num truncate text-[11px]" style={{ color: "var(--nc-text-3)" }}>
                      {m.units} un. · receita {fmtCurrency(m.revenue)}
                    </p>
                  </div>
                  <div className="flex-none text-right">
                    <p className="nc-num text-[13px]" style={{ color: m.profit < 0 ? "var(--nc-crit)" : undefined }}>
                      {fmtCurrency(m.profit)}
                    </p>
                    <p className="nc-num text-[11px]" style={{ color: "var(--nc-text-3)" }}>
                      margem {fmtPct(m.margin)}
                    </p>
                  </div>
                </motion.div>
              ))}
              {topProfit.length > MAX_RANK_ROWS && (
                <p className="px-4 py-2 text-[11px]" style={{ color: "var(--nc-text-3)" }}>
                  + {topProfit.length - MAX_RANK_ROWS} outros modelos
                </p>
              )}
            </Stagger>
          )}
        </section>
      </div>

      {/* ---------------- Coluna direita: o que o período rendeu ---------------- */}
      <aside
        className="order-first flex w-full flex-none flex-col gap-3.5 p-4 md:p-6 xl:order-none xl:w-[312px]"
        style={{ background: "var(--nc-rail)" }}
      >
        <span className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>Insights do período</span>

        <div>
          <span className="text-[11.5px]" style={{ color: "var(--nc-text-2)" }}>Lucro do período</span>
          <div className="flex flex-wrap items-baseline gap-2">
            <span style={{ color: totals.profit < 0 ? "var(--nc-crit)" : undefined }}>
              <AnimatedNumber
                value={totals.profit}
                format={fmtCurrencyShort}
                duration={0.7}
                animateOnMount
                className="nc-num text-[30px] font-semibold tracking-[-0.025em]"
              />
            </span>
          </div>
          <p className="nc-num mt-1.5 text-[11px]" style={{ color: "var(--nc-text-2)" }}>
            receita {fmtCurrencyShort(totals.revenue)} · margem {fmtPct(totals.margin)}
          </p>
        </div>

        <Rule />

        {/* Divisão real da receita: o que pagou o produto e o que sobrou. */}
        <div>
          <span className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>Onde a receita foi parar</span>
          {totals.revenue <= 0 ? (
            <p className="py-2 text-xs" style={{ color: "var(--nc-text-3)" }}>Sem vendas no período.</p>
          ) : (
            <>
              <div className="mt-1.5 flex h-[5px] gap-0.5">
                <div style={{ flex: Math.max(totals.cost, 0.001), background: "var(--nc-alert)", borderRadius: 2 }} />
                <div style={{ flex: Math.max(totals.profit, 0.001), background: "var(--nc-accent)", borderRadius: 2 }} />
              </div>
              <div className="nc-num mt-1.5 flex justify-between gap-2 text-[11px]" style={{ color: "var(--nc-text-2)" }}>
                <span style={{ color: "var(--nc-alert)" }}>custo {fmtCurrencyShort(totals.cost)}</span>
                <span>lucro {fmtCurrencyShort(totals.profit)}</span>
              </div>
            </>
          )}
        </div>

        <Rule />

        <div className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>Contra o período anterior</span>
            <span className="nc-num text-[10.5px]" style={{ color: "var(--nc-text-3)" }}>
              {format(prevStart, "dd/MM")} – {format(prevEnd, "dd/MM")}
            </span>
          </div>
          <Trend label="Unidades" now={`${totals.units} un.`} before={`${prevTotals.units} un.`} change={unitsChange} />
          <div className="nc-rule-top pt-2.5">
            <Trend label="Lucro" now={fmtCurrencyShort(totals.profit)} before={fmtCurrencyShort(prevTotals.profit)} change={profitChange} />
          </div>
        </div>

        <Rule />

        <div>
          <div className="mb-1.5 flex items-center gap-1.5">
            <PackageX size={12} style={{ color: "var(--nc-text-3)" }} />
            <span className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>Por marca</span>
          </div>
          {byBrand.length === 0 ? (
            <p className="py-4 text-center text-xs" style={{ color: "var(--nc-text-3)" }}>
              Sem vendas no período.
            </p>
          ) : (
            <Stagger className="flex flex-col">
              {byBrand.slice(0, MAX_RAIL_ROWS).map(b => (
                <motion.div key={b.brand} variants={listItem} className="nc-row flex items-center justify-between gap-2 py-1.5 text-xs">
                  <span className="min-w-0 flex-1 truncate">{b.brand}</span>
                  <span className="nc-num flex-none">
                    {b.units} un.
                    <span style={{ color: "var(--nc-text-3)" }}>
                      {" · "}{fmtPct(totals.units > 0 ? b.units / totals.units : 0)}
                    </span>
                  </span>
                </motion.div>
              ))}
              {byBrand.length > MAX_RAIL_ROWS && (
                <p className="pt-2 text-[11px]" style={{ color: "var(--nc-text-3)" }}>
                  + {byBrand.length - MAX_RAIL_ROWS} outras marcas
                </p>
              )}
            </Stagger>
          )}
        </div>
      </aside>
    </div>
  );
}

/**
 * Cabeçalho de seção: sobretítulo terciário, contagem, uma linha de contexto e,
 * se houver, um controle à direita. Mesma peça da tela de Distribuição.
 */
function SectionHead({
  title, sub, count, right, action,
}: {
  title: string; sub?: string; count?: number; right?: string; action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-2">
      <div className="min-w-0">
        <span className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>
          {title}
          {count !== undefined && <span className="nc-num ml-1.5">{count}</span>}
        </span>
        {sub && <p className="mt-0.5 text-[11.5px]" style={{ color: "var(--nc-text-2)" }}>{sub}</p>}
      </div>
      {action}
      {right && <span className="nc-num text-[11.5px]" style={{ color: "var(--nc-alert)" }}>{right}</span>}
    </div>
  );
}

/** Linha de comparação com o período anterior: valor de hoje, o de antes e a variação. */
function Trend({ label, now, before, change }: { label: string; now: string; before: string; change: number | null }) {
  const dir = change === null ? "flat" : change > 0.001 ? "up" : change < -0.001 ? "down" : "flat";
  const Icon = dir === "up" ? TrendingUp : dir === "down" ? TrendingDown : Minus;
  // Só a queda ganha cor: subir é o esperado, e pintar de verde todo mês bom
  // faria o --nc-ok (dinheiro que ENTROU) significar duas coisas.
  const tone = dir === "down" ? "var(--nc-crit)" : "var(--nc-text-2)";
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-[12.5px]" style={{ color: "var(--nc-text-2)" }}>{label}</span>
      <div className="flex items-baseline gap-2">
        <span className="nc-num text-sm">{now}</span>
        <span className="nc-num flex items-center gap-0.5 text-[11px]" style={{ color: tone }}>
          <Icon size={11} />
          {change === null ? "s/ base" : `${change >= 0 ? "+" : ""}${(change * 100).toFixed(0)}%`}
          <span style={{ color: "var(--nc-text-3)" }}> de {before}</span>
        </span>
      </div>
    </div>
  );
}
