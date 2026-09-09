import { useStore } from "@/context/StoreContext";
import { useMemo, useState } from "react";
import { Plus, Search, Trash2, X, CalendarDays } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetFooter, SheetTrigger } from "@/components/ui/sheet";
import { todayDateString, localDateToISO, formatDateBR } from "@/lib/date-utils";
import { useConfirm } from "@/components/ConfirmProvider";
import { AnimatePresence, motion } from "motion/react";
import { Stagger } from "@/components/motion/Stagger";
import AnimatedNumber from "@/components/motion/AnimatedNumber";
import { listItem, transitionBase } from "@/lib/motion";
import { NcButton, NcSheetHeader, SegmentedChips, Rule, EYEBROW } from "@/components/nocturne";
import { sortNames } from "@/lib/catalog-order";
import { cn } from "@/lib/utils";

/**
 * Categorias sugeridas. Não são vocabulário fechado — a coluna é texto livre e
 * despesa antiga pode ter categoria que não está aqui; por isso as caixas de
 * seleção somam estas com o que já existe no banco (ver `allCategories`).
 * "Outros" fica sempre no fim: é o escoadouro, não uma categoria como as outras.
 */
const CATEGORY_PRESETS = ["Frete", "Embalagem", "Marketing", "Aluguel"];
const CATEGORY_FALLBACK = "Outros";

function formatCurrency(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

/** Sem centavos — para os números grandes do trilho, como no Dashboard. */
function formatCurrencyShort(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(v);
}

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

/** Quantas categorias cabem na lista do trilho antes de virar "+ N outras". */
const MAX_TOP_CATEGORIES = 6;

/** Acima disso a linha entra sem cascata — lista longa não precisa animar item a item. */
const MAX_STAGGERED_ROWS = 20;

export default function ExpensesPage() {
  const { expenses, addExpense, deleteExpense } = useStore();
  const confirm = useConfirm();

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ description: "", category: "", amount: "", date: todayDateString() });
  const [submitting, setSubmitting] = useState(false);

  const [search, setSearch] = useState("");
  const [fCategory, setFCategory] = useState<string>("all");
  const [fPreset, setFPreset] = useState<DateRangePreset>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  /**
   * Sugestões + o que já foi digitado alguma vez. Sem isso uma despesa gravada
   * com categoria fora da lista ficava invisível no filtro: aparecia na lista e
   * não dava para isolar.
   */
  const allCategories = useMemo(() => {
    const known = new Set([...CATEGORY_PRESETS, CATEGORY_FALLBACK]);
    const extra = new Set<string>();
    expenses.forEach(e => { if (e.category && !known.has(e.category)) extra.add(e.category); });
    return [...CATEGORY_PRESETS, ...sortNames(Array.from(extra)), CATEGORY_FALLBACK];
  }, [expenses]);

  const reset = () => setForm({ description: "", category: "", amount: "", date: todayDateString() });

  const formAmount = Number(form.amount) || 0;
  const canSubmit = form.description.trim() !== "" && formAmount > 0;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    await addExpense({
      description: form.description.trim(),
      category: form.category || CATEGORY_FALLBACK,
      amount: formAmount,
      date: localDateToISO(form.date),
    });
    setSubmitting(false);
    reset();
    setOpen(false);
  };

  const applyPreset = (p: DateRangePreset) => {
    setFPreset(p);
    const now = new Date();
    const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (p === "all") { setDateFrom(""); setDateTo(""); return; }
    if (p === "today") { const t = fmt(now); setDateFrom(t); setDateTo(t); return; }
    if (p === "7d") { const past = new Date(now); past.setDate(past.getDate() - 6); setDateFrom(fmt(past)); setDateTo(fmt(now)); return; }
    if (p === "month") { setDateFrom(fmt(new Date(now.getFullYear(), now.getMonth(), 1))); setDateTo(fmt(new Date(now.getFullYear(), now.getMonth() + 1, 0))); return; }
    if (p === "lastMonth") { setDateFrom(fmt(new Date(now.getFullYear(), now.getMonth() - 1, 1))); setDateTo(fmt(new Date(now.getFullYear(), now.getMonth(), 0))); return; }
  };

  const clearFilters = () => { setSearch(""); setFCategory("all"); setFPreset("all"); setDateFrom(""); setDateTo(""); };
  const hasActiveFilters = search !== "" || fCategory !== "all" || dateFrom !== "" || dateTo !== "";

  /** Sobretítulo do cabeçalho: o período que está mandando na tela, como na Entrada. */
  const periodLabel = PERIOD_OPTIONS.find(o => o.value === fPreset)?.label ?? "Período personalizado";

  /**
   * Ordena por data, e não pela ordem de cadastro invertida como antes: quem
   * lança hoje uma despesa da semana passada quer vê-la na semana passada.
   */
  const filtered = useMemo(() => {
    let items = [...expenses].sort((a, b) => b.date.localeCompare(a.date));
    if (search.trim()) {
      const q = search.toLowerCase();
      items = items.filter(e => e.description.toLowerCase().includes(q));
    }
    if (fCategory !== "all") items = items.filter(e => e.category === fCategory);
    if (dateFrom) items = items.filter(e => e.date.slice(0, 10) >= dateFrom);
    if (dateTo) items = items.filter(e => e.date.slice(0, 10) <= dateTo);
    return items;
  }, [expenses, search, fCategory, dateFrom, dateTo]);

  const totals = useMemo(() => {
    const sum = filtered.reduce((s, e) => s + e.amount, 0);
    const biggest = filtered.reduce<(typeof filtered)[number] | null>(
      (max, e) => (!max || e.amount > max.amount ? e : max),
      null,
    );
    return {
      count: filtered.length,
      sum,
      biggest,
      average: filtered.length > 0 ? sum / filtered.length : 0,
    };
  }, [filtered]);

  /** Onde o dinheiro sai, do maior para o menor. */
  const byCategory = useMemo(() => {
    const map = new Map<string, { name: string; total: number; count: number }>();
    filtered.forEach(e => {
      const name = (e.category || "").trim() || CATEGORY_FALLBACK;
      const cur = map.get(name);
      if (cur) { cur.total += e.amount; cur.count += 1; }
      else map.set(name, { name, total: e.amount, count: 1 });
    });
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [filtered]);

  /**
   * Ritmo do mês. NÃO passa pelo filtro de propósito — é a pergunta "estou
   * gastando mais do que no mês passado?", que não muda porque a pessoa foi
   * olhar março.
   *
   * A comparação é com o mesmo TRECHO do mês passado (até o mesmo dia), não com
   * o mês fechado: dia 3 contra um mês inteiro sempre diria que a despesa
   * despencou — e diria isso todo começo de mês.
   */
  const rhythm = useMemo(() => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const curPrefix = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
    const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevPrefix = `${prevDate.getFullYear()}-${pad(prevDate.getMonth() + 1)}`;
    const dayCut = pad(now.getDate());

    let current = 0;
    let previous = 0;
    expenses.forEach(e => {
      const d = e.date.slice(0, 10);
      if (d.slice(0, 7) === curPrefix) current += e.amount;
      else if (d.slice(0, 7) === prevPrefix && d.slice(8, 10) <= dayCut) previous += e.amount;
    });

    return {
      current,
      previous,
      day: now.getDate(),
      deltaPct: previous > 0 ? ((current - previous) / previous) * 100 : null,
    };
  }, [expenses]);

  return (
    // `/expenses` está em `fullBleedRoutes` (AppLayout): chega sem padding e sem
    // max-width, e é a tela que cuida do próprio espaçamento. Mesmo esqueleto do
    // Dashboard, do Produtos, da Entrada e das Perdas — coluna principal + trilho.
    <div className="nocturne flex flex-1 flex-col xl:flex-row xl:items-stretch">
      {/* ---------------- Coluna principal ---------------- */}
      <div className="flex-1 min-w-0 p-4 md:p-6 flex flex-col gap-4">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className={EYEBROW} style={{ color: "var(--nc-accent)" }}>{periodLabel}</span>
            <h1 className="mt-1 text-xl sm:text-[22px]">Despesas</h1>
          </div>

          {/* Painel lateral, como as outras portas de registro do painel. Era um
              diálogo no meio da tela — o mesmo remendo que as Perdas tinham. */}
          <Sheet open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
            <SheetTrigger asChild>
              <NcButton variant="solid" size="md"><Plus size={14} />Nova despesa</NcButton>
            </SheetTrigger>
            {/* `nocturne` repetido aqui pelo mesmo motivo do SheetContent da loja:
                o Radix porta o painel para o <body> e os tokens não chegam por
                herança. */}
            <SheetContent className="nocturne w-full sm:max-w-xl overflow-y-auto p-0 flex flex-col">
              <NcSheetHeader
                eyebrow="Custos da operação"
                title="Nova despesa"
                description="Gasto que não é compra de estoque: frete, embalagem, anúncio, aluguel."
              />

              <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
                {/* O que foi pago */}
                <section className="space-y-3">
                  <p className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>O que foi pago</p>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Descrição</Label>
                    <Input
                      value={form.description}
                      onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                      placeholder="Ex: frete da remessa de setembro"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Categoria</Label>
                    <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
                      <SelectTrigger>
                        <SelectValue placeholder={`Sem escolha, entra como “${CATEGORY_FALLBACK}”`} />
                      </SelectTrigger>
                      <SelectContent className="nocturne">
                        {allCategories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </section>

                {/* Quanto e quando */}
                <section className="space-y-3">
                  <p className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>Quanto e quando</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Valor (R$)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={form.amount}
                        onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                        placeholder="0,00"
                        className="nc-num"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Data</Label>
                      <Input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
                    </div>
                  </div>
                </section>
              </div>

              <SheetFooter className="px-5 py-3" style={{ borderTop: "1px solid var(--nc-track)", background: "var(--nc-rail)" }}>
                <div className="flex w-full items-center justify-between gap-3">
                  <p className="text-[11px]" style={{ color: "var(--nc-text-2)" }}>
                    {formAmount > 0
                      ? <>Sai do caixa <span className="nc-num font-medium" style={{ color: "var(--nc-crit)" }}>{formatCurrency(formAmount)}</span></>
                      : "Preencha a descrição e o valor"}
                  </p>
                  <NcButton variant="solid" size="md" onClick={handleSubmit} disabled={!canSubmit || submitting}>
                    {submitting ? "Registrando…" : "Registrar despesa"}
                  </NcButton>
                </div>
              </SheetFooter>
            </SheetContent>
          </Sheet>
        </header>

        {/* ---------------- Busca, categoria e período ----------------
            Duas linhas como na SalesPage: busca e categoria em cima, período
            embaixo. Numa linha só, os dois campos de data espremiam a busca. */}
        <div className="nc-card flex flex-col gap-2 px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[180px] flex-1">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: "var(--nc-text-3)" }} />
              <input
                type="text"
                placeholder="Buscar descrição…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                aria-label="Buscar despesa por descrição"
                className="nc-input h-8 w-full pl-8 pr-2.5 text-[12.5px]"
              />
            </div>
            <Select value={fCategory} onValueChange={setFCategory}>
              <SelectTrigger className="h-8 w-auto min-w-[130px] text-[12.5px]"><SelectValue /></SelectTrigger>
              <SelectContent className="nocturne">
                <SelectItem value="all">Todas categorias</SelectItem>
                {allCategories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
            {/* O "Limpar" fica SEMPRE na linha e só some da vista quando não há
                filtro: montar e desmontar ele mudava a largura de todo mundo a
                cada clique, porque a busca é `flex-1` e engolia (ou devolvia) o
                espaço dele. Mesma regra da Entrada e da SalesPage. */}
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
                value={dateFrom}
                onChange={e => { setDateFrom(e.target.value); setFPreset("custom"); }}
                aria-label="Data inicial"
                className="nc-input nc-num h-8 w-[132px] px-2 text-[12px]"
              />
              <span className="text-xs" style={{ color: "var(--nc-text-3)" }}>–</span>
              <input
                type="date"
                value={dateTo}
                onChange={e => { setDateTo(e.target.value); setFPreset("custom"); }}
                aria-label="Data final"
                className="nc-input nc-num h-8 w-[132px] px-2 text-[12px]"
              />
            </div>
          </div>
        </div>

        {/* ---------------- Lista ----------------
            Lista de linhas, e não tabela, para a saída animada continuar
            existindo: a despesa some da tela na hora em que é excluída, e um
            <tr> não anima altura direito. Mesma decisão das Perdas. */}
        {filtered.length === 0 ? (
          <div className="nc-card py-16 text-center text-[13px]" style={{ color: "var(--nc-text-3)" }}>
            {expenses.length === 0
              ? "Nenhuma despesa registrada."
              : search.trim()
                ? `Nenhuma despesa encontrada para “${search.trim()}”.`
                : "Nenhuma despesa encontrada com os filtros aplicados."}
          </div>
        ) : (
          <Stagger className="nc-card overflow-hidden">
            <AnimatePresence initial={false}>
              {filtered.map((e, i) => (
                <motion.div
                  key={e.id}
                  layout
                  variants={i < MAX_STAGGERED_ROWS ? listItem : undefined}
                  exit={{ opacity: 0, height: 0 }}
                  transition={transitionBase}
                  className="nc-row nc-hover group flex items-center justify-between gap-3 overflow-hidden px-4 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px]">{e.description}</p>
                    <p className="truncate text-[11px]" style={{ color: "var(--nc-text-3)" }}>{formatDateBR(e.date)}</p>
                  </div>
                  <div className="flex flex-none items-center gap-3">
                    {/* Categoria não é estado de dinheiro — vai no selo neutro.
                        Verde, laranja e vermelho continuam querendo dizer
                        recebido / falta receber / não entrou nada em toda tela. */}
                    <span className="nc-pill nc-pill--mute">{e.category || CATEGORY_FALLBACK}</span>
                    <p className="nc-num min-w-[86px] text-right text-[13px]" style={{ color: "var(--nc-crit)" }}>
                      {formatCurrency(e.amount)}
                    </p>
                    {/* No desktop a ação só aparece no hover da linha; no toque
                        não há hover, então fica sempre visível abaixo de sm. */}
                    <div className="transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                      <NcButton
                        variant="danger"
                        size="icon"
                        aria-label={`Excluir despesa ${e.description}`}
                        onClick={async () => {
                          if (await confirm({ title: "Excluir despesa", description: `Excluir “${e.description}”?` })) {
                            deleteExpense(e.id);
                          }
                        }}
                      >
                        <Trash2 size={13} />
                      </NcButton>
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </Stagger>
        )}
      </div>

      {/* ---------------- Coluna direita: o que sai do caixa ----------------
          No celular ela vem ANTES da lista (`order-first`), como nas outras
          telas migradas: a lista rola por telas e um resumo embaixo dela não
          seria lido.

          Sem barra de duas cores aqui, pelo mesmo motivo da Entrada: despesa se
          reparte em N categorias, não em duas metades — uma barra dividida
          inventaria uma divisão que não existe. A repartição real está na lista
          do fim, com a participação de cada categoria. */}
      <aside
        className="order-first flex w-full flex-none flex-col gap-3.5 p-4 md:p-6 xl:order-none xl:w-[312px]"
        style={{ background: "var(--nc-rail)" }}
      >
        <span className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>Custos da operação</span>

        <div>
          <span className="text-[11.5px]" style={{ color: "var(--nc-text-2)" }}>Despesa no período</span>
          <div className="flex flex-wrap items-baseline gap-2">
            {/* O número principal desta tela é dinheiro que sai, então ele nasce
                em --nc-crit — o mesmo tom do prejuízo das Perdas. O accent é a
                receita; despesa em accent leria como entrada. */}
            <span style={{ color: "var(--nc-crit)" }}>
              <AnimatedNumber
                value={totals.sum}
                format={formatCurrencyShort}
                duration={0.7}
                animateOnMount
                className="nc-num text-[30px] font-semibold tracking-[-0.025em]"
              />
            </span>
          </div>
          <p className="nc-num mt-1.5 text-[11px]" style={{ color: "var(--nc-text-2)" }}>
            {totals.count} lançamento{totals.count === 1 ? "" : "s"} · {byCategory.length} categoria{byCategory.length === 1 ? "" : "s"}
          </p>
        </div>

        <Rule />

        <div className="flex flex-col gap-2.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[12.5px]" style={{ color: "var(--nc-text-2)" }}>Maior lançamento</span>
            <span className="nc-num text-sm">
              {totals.biggest ? formatCurrencyShort(totals.biggest.amount) : "—"}
            </span>
          </div>
          <div className="nc-rule-top flex items-baseline justify-between gap-2 pt-2.5">
            <span className="text-[12.5px]">Média por lançamento</span>
            <AnimatedNumber
              value={totals.average}
              format={formatCurrency}
              duration={0.7}
              animateOnMount
              className="nc-num text-xl font-semibold"
            />
          </div>
          <p className="truncate text-[11.5px]" style={{ color: "var(--nc-text-3)" }}>
            {totals.biggest ? totals.biggest.description : "Nenhum lançamento no período"}
          </p>
        </div>

        <Rule />

        {/* Ritmo: o único bloco que ignora o filtro, e que diz isso. Compara com
            o mesmo trecho do mês passado — ver o memo `rhythm`. */}
        <div>
          <div className="mb-1.5 flex items-center gap-1.5">
            <CalendarDays size={12} style={{ color: "var(--nc-text-3)" }} />
            <span className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>Ritmo do mês</span>
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[12.5px]" style={{ color: "var(--nc-text-2)" }}>Este mês, até hoje</span>
              <span className="nc-num text-base font-semibold" style={{ color: rhythm.current > 0 ? "var(--nc-crit)" : undefined }}>
                {formatCurrencyShort(rhythm.current)}
              </span>
            </div>
            <div className="nc-num flex items-baseline justify-between gap-2 text-[11.5px]" style={{ color: "var(--nc-text-3)" }}>
              <span>mês passado até o dia {rhythm.day}</span>
              <span>{formatCurrencyShort(rhythm.previous)}</span>
            </div>
            {rhythm.deltaPct !== null && (
              // Só o aumento ganha cor. Gastar menos não é --nc-ok: aquele verde
              // é dinheiro que ENTROU, e usá-lo aqui faria dois verdes com
              // significados diferentes em telas vizinhas.
              <p
                className="nc-num text-[11.5px]"
                style={{ color: rhythm.deltaPct > 0 ? "var(--nc-crit)" : "var(--nc-text-2)" }}
              >
                {rhythm.deltaPct > 0 ? "+" : ""}
                {rhythm.deltaPct.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}% no mesmo trecho
              </p>
            )}
            <p className="text-[11px]" style={{ color: "var(--nc-text-3)" }}>
              Não segue o filtro: é sempre o mês corrente.
            </p>
          </div>
        </div>

        <Rule />

        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>Onde o dinheiro sai</span>
            <span className="nc-num text-[10.5px]" style={{ color: "var(--nc-text-3)" }}>
              {byCategory.length} no período
            </span>
          </div>
          {byCategory.length === 0 ? (
            <p className="py-4 text-center text-xs" style={{ color: "var(--nc-text-3)" }}>
              Nenhuma despesa no período.
            </p>
          ) : (
            <Stagger className="flex flex-col">
              {byCategory.slice(0, MAX_TOP_CATEGORIES).map(c => (
                <motion.div key={c.name} variants={listItem} className="nc-row flex items-center justify-between gap-2 py-1.5 text-xs">
                  <span className="min-w-0 flex-1 truncate">
                    {c.name}
                    <span style={{ color: "var(--nc-text-3)" }}> · {c.count}</span>
                  </span>
                  <span className="nc-num flex-none">
                    {formatCurrencyShort(c.total)}
                    <span style={{ color: "var(--nc-text-3)" }}>
                      {" · "}{totals.sum > 0 ? Math.round((c.total / totals.sum) * 100) : 0}%
                    </span>
                  </span>
                </motion.div>
              ))}
              {byCategory.length > MAX_TOP_CATEGORIES && (
                <p className="pt-2 text-[11px]" style={{ color: "var(--nc-text-3)" }}>
                  + {byCategory.length - MAX_TOP_CATEGORIES} outras categorias
                </p>
              )}
            </Stagger>
          )}
        </div>
      </aside>
    </div>
  );
}
