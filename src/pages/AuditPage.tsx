import { useCallback, useMemo, useState } from "react";
import { ChevronDown, RotateCw, Search, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useStore } from "@/context/StoreContext";
import { useBranch } from "@/context/BranchContext";
import { useAuditLog } from "@/hooks/useAuditLog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import AnimatedNumber from "@/components/motion/AnimatedNumber";
import { NcButton, SegmentedChips, Rule, EYEBROW, RAIL_FIRST, STICKY_HEAD } from "@/components/nocturne";
import { transitionBase } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { currentMonthRange, formatDateBR, isoDay } from "@/lib/date-utils";
import {
  AREAS,
  actorLabel,
  describe,
  entityInfo,
  fieldLabel,
  formatValue,
  groupMovements,
  isOutsideApp,
  shortId,
  sourceLabel,
  summarize,
  searchableText,
  visibleFields,
  type ActorNames,
  type AuditRow,
  type Movement,
  type RefResolver,
} from "@/lib/audit-format";

/**
 * Auditoria — quem fez cada movimento.
 *
 * A tela existe porque o painel tem mais de um admin: "a venda foi registrada"
 * deixou de ser uma frase completa. O dado vem do `audit_log`, que um gatilho
 * genérico preenche a cada escrita (ver a migration 20260914181553).
 *
 * A decisão que define esta tela é o AGRUPAMENTO POR TRANSAÇÃO. Uma venda
 * registrada escreve em duas tabelas — nasce a linha em `sales` e o
 * `create_sale` debita `products.stock` — e as duas viram registro. Listadas
 * lado a lado, elas contariam dois movimentos onde houve um; o `tx` que o log
 * guarda é o que permite dizer "registrou uma venda" e deixar o débito de
 * estoque onde ele pertence, dentro do detalhe.
 */

type DateRangePreset = "all" | "today" | "7d" | "month" | "lastMonth" | "custom";

/** Os mesmos chips do Dashboard, da Entrada e das Despesas. */
const PERIOD_OPTIONS: { value: DateRangePreset; label: string; short: string }[] = [
  { value: "all", label: "Todo o período", short: "Tudo" },
  { value: "today", label: "Hoje", short: "Hoje" },
  { value: "7d", label: "Últimos 7 dias", short: "7d" },
  { value: "month", label: "Este mês", short: "Mês" },
  { value: "lastMonth", label: "Mês passado", short: "Mês ant." },
];

/**
 * Abre no mês corrente, como Vendas e Entrada, e pelo mesmo motivo: o log
 * cresce mais rápido que qualquer outra tabela daqui (toda escrita do app vira
 * pelo menos uma linha). "Tudo" é um clique; voltar de uma tela travada não é.
 */
const DEFAULT_PRESET: DateRangePreset = "month";

/** Quantas pessoas / áreas cabem nas listas do trilho. */
const MAX_RAIL_ROWS = 6;

const TIME = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });
const WEEKDAY = new Intl.DateTimeFormat("pt-BR", { weekday: "short" });

const ACTION_NOUN: Record<string, string> = {
  insert: "inclusão",
  update: "alteração",
  delete: "exclusão",
};

/** "uma venda" → "Venda", para o cabeçalho de cada registro do detalhe. */
function thingNoun(entity: string): string {
  const noun = entityInfo(entity).thing.replace(/^(uma|um) /, "");
  return noun.charAt(0).toUpperCase() + noun.slice(1);
}

/**
 * Chave de "quem". O id do usuário quando existe; quando não existe (a loja, o
 * SQL Editor), a origem — senão todas as escritas sem dono cairiam na mesma
 * gaveta e o filtro não separaria a loja pública de uma mexida no banco.
 */
function actorKey(row: AuditRow): string {
  return row.actor_id ?? `source:${row.actor_source}`;
}

function dayLabel(day: string): string {
  const today = isoDay(new Date());
  const yesterday = isoDay(new Date(Date.now() - 86_400_000));
  if (day === today) return "Hoje";
  if (day === yesterday) return "Ontem";
  const [y, m, d] = day.split("-").map(Number);
  const weekday = WEEKDAY.format(new Date(y, m - 1, d)).replace(".", "");
  return `${weekday} · ${formatDateBR(day)}`;
}

export default function AuditPage() {
  const { products, sellers, partners, investors, loans } = useStore();
  const { branches } = useBranch();

  const [preset, setPreset] = useState<DateRangePreset>(DEFAULT_PRESET);
  const [dateFrom, setDateFrom] = useState(currentMonthRange().from);
  const [dateTo, setDateTo] = useState(currentMonthRange().to);
  const [search, setSearch] = useState("");
  const [fArea, setFArea] = useState("all");
  const [fActor, setFActor] = useState("all");
  const [open, setOpen] = useState<Set<number>>(new Set());

  const { rows, names, loading, loadingMore, error, hasMore, loadMore, reload } = useAuditLog({
    from: dateFrom,
    to: dateTo,
  });

  /**
   * uuid → nome. O log guarda o id porque é o que estava na linha; a tela tem
   * produtos, vendedores e sócios na memória e resolve na hora. Id que não
   * resolve (produto já excluído) cai no `shortId` em vez de sumir: um uuid
   * curto ainda dá para casar com o registro de exclusão logo abaixo.
   */
  const resolve = useCallback<RefResolver>(
    (field, id) => {
      switch (field) {
        case "product_id": {
          const p = products.find(x => x.id === id);
          return p ? [p.brand, p.model, p.flavor].filter(Boolean).join(" · ") : null;
        }
        case "branch_id":
        case "from_branch_id":
        case "to_branch_id":
          return branches.find(x => x.id === id)?.name ?? null;
        case "seller_id":
        case "from_seller_id":
          return sellers.find(x => x.id === id)?.name ?? null;
        case "partner_id":
          return partners.find(x => x.id === id)?.name ?? null;
        case "investor_id":
          return investors.find(x => x.id === id)?.name ?? null;
        case "loan_id":
          return loans.find(x => x.id === id)?.lenderName ?? null;
        default:
          return null;
      }
    },
    [products, sellers, partners, investors, loans, branches],
  );

  const movements = useMemo(() => groupMovements(rows), [rows]);

  /** Quem aparece no período — a lista do filtro sai do que existe, não de um enum. */
  const actorOptions = useMemo(() => {
    const seen = new Map<string, string>();
    movements.forEach(m => {
      const key = actorKey(m.main);
      if (!seen.has(key)) seen.set(key, actorLabel(m.main, names));
    });
    return Array.from(seen, ([value, label]) => ({ value, label })).sort((a, b) =>
      a.label.localeCompare(b.label, "pt-BR"),
    );
  }, [movements, names]);

  /**
   * Filtrar por quem não está mais na lista (trocou-se o período e aquela
   * pessoa não mexeu em nada ali) mostraria um campo em branco ao lado de uma
   * lista vazia, sem dizer que uma coisa é a causa da outra. O filtro volta
   * sozinho para "qualquer pessoa", e o campo mostra isso.
   */
  const activeActor = actorOptions.some(o => o.value === fActor) ? fActor : "all";

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return movements.filter(m => {
      if (fArea !== "all" && entityInfo(m.main.entity).area !== fArea) return false;
      if (activeActor !== "all" && actorKey(m.main) !== activeActor) return false;
      if (q && !searchableText(m, resolve, names).includes(q)) return false;
      return true;
    });
  }, [movements, search, fArea, activeActor, resolve, names]);

  /** Os movimentos quebrados por dia LOCAL — `at` chega em UTC. */
  const days = useMemo(() => {
    const map = new Map<string, Movement[]>();
    filtered.forEach(m => {
      const day = isoDay(new Date(m.at));
      const list = map.get(day);
      if (list) list.push(m);
      else map.set(day, [m]);
    });
    return Array.from(map, ([day, items]) => ({ day, items }));
  }, [filtered]);

  /**
   * O trilho lê do `filtered`, não do total carregado: ele acompanha a tela,
   * como o trilho da SalesPage acompanha a aba. Resumo que fala de outro
   * recorte, ao lado de uma lista filtrada, é resumo de outra coisa.
   */
  const stats = useMemo(() => {
    const byActor = new Map<string, { key: string; label: string; count: number }>();
    const byArea = new Map<string, number>();
    let outside = 0;

    filtered.forEach(m => {
      const key = actorKey(m.main);
      const cur = byActor.get(key);
      if (cur) cur.count += 1;
      else byActor.set(key, { key, label: actorLabel(m.main, names), count: 1 });

      const area = entityInfo(m.main.entity).area;
      byArea.set(area, (byArea.get(area) ?? 0) + 1);

      if (isOutsideApp(m.main.actor_source)) outside += 1;
    });

    return {
      count: filtered.length,
      writes: filtered.reduce((s, m) => s + m.entries.length, 0),
      people: byActor.size,
      outside,
      actors: Array.from(byActor.values()).sort((a, b) => b.count - a.count),
      areas: Array.from(byArea, ([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    };
  }, [filtered, names]);

  const applyPreset = (p: DateRangePreset) => {
    setPreset(p);
    const now = new Date();
    if (p === "all") { setDateFrom(""); setDateTo(""); return; }
    if (p === "today") { const t = isoDay(now); setDateFrom(t); setDateTo(t); return; }
    if (p === "7d") {
      const past = new Date(now);
      past.setDate(past.getDate() - 6);
      setDateFrom(isoDay(past));
      setDateTo(isoDay(now));
      return;
    }
    if (p === "month") { const r = currentMonthRange(); setDateFrom(r.from); setDateTo(r.to); return; }
    if (p === "lastMonth") {
      setDateFrom(isoDay(new Date(now.getFullYear(), now.getMonth() - 1, 1)));
      setDateTo(isoDay(new Date(now.getFullYear(), now.getMonth(), 0)));
    }
  };

  /**
   * "Limpar" devolve a tela ao estado em que ela ABRIU — o mês corrente —, e
   * não a "Tudo". Mesma regra de Vendas e Entrada, pelo mesmo motivo de
   * desempenho; por isso o período só conta como filtro ativo quando difere do
   * padrão.
   */
  const clearFilters = () => {
    setSearch("");
    setFArea("all");
    setFActor("all");
    applyPreset(DEFAULT_PRESET);
  };
  const hasActiveFilters = search !== "" || fArea !== "all" || activeActor !== "all" || preset !== DEFAULT_PRESET;

  const periodLabel = PERIOD_OPTIONS.find(o => o.value === preset)?.label ?? "Período personalizado";

  const toggle = (tx: number) =>
    setOpen(prev => {
      const next = new Set(prev);
      if (next.has(tx)) next.delete(tx);
      else next.add(tx);
      return next;
    });

  return (
    // `/audit` está em `fullBleedRoutes` (AppLayout). Mesmo esqueleto das outras
    // telas migradas: coluna principal + trilho de 312px.
    <div className="nocturne flex flex-1 flex-col xl:flex-row xl:items-stretch">
      {/* ---------------- Coluna principal ---------------- */}
      <div className="flex min-w-0 flex-1 flex-col gap-4 p-4 md:p-6">
        <header className={cn(STICKY_HEAD, "flex flex-wrap items-end justify-between gap-4")}>
          <div>
            <span className={EYEBROW} style={{ color: "var(--nc-accent)" }}>{periodLabel}</span>
            <h1 className="mt-1 text-xl sm:text-[22px]">Auditoria</h1>
          </div>
          {/* Não há "novo" nesta tela — ninguém escreve no log, nem o admin. A
              ação da direita é a única que faz sentido aqui: buscar o que
              aconteceu desde que a tela abriu. */}
          <NcButton variant="outline" size="md" onClick={reload} disabled={loading}>
            <RotateCw size={14} className={loading ? "animate-spin" : undefined} />
            {loading ? "Buscando…" : "Atualizar"}
          </NcButton>
        </header>

        {/* ---------------- Filtros ---------------- */}
        <div className="nc-card flex flex-col gap-2 px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[180px] flex-1">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: "var(--nc-text-3)" }} />
              <input
                type="text"
                placeholder="Buscar pessoa, produto, valor…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                aria-label="Buscar movimento"
                className="nc-input h-8 w-full pl-8 pr-2.5 text-[12.5px]"
              />
            </div>
            <Select value={fArea} onValueChange={setFArea}>
              <SelectTrigger className="h-8 w-auto min-w-[130px] text-[12.5px]"><SelectValue /></SelectTrigger>
              <SelectContent className="nocturne">
                <SelectItem value="all">Todas as áreas</SelectItem>
                {AREAS.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={activeActor} onValueChange={setFActor}>
              <SelectTrigger className="h-8 w-auto min-w-[130px] text-[12.5px]"><SelectValue /></SelectTrigger>
              <SelectContent className="nocturne">
                <SelectItem value="all">Qualquer pessoa</SelectItem>
                {actorOptions.map(a => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}
              </SelectContent>
            </Select>
            {/* Sempre montado, escondido com `invisible`: montar e desmontar
                mudava a largura da busca (`flex-1`) a cada clique. */}
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
            <SegmentedChips options={PERIOD_OPTIONS} value={preset} onChange={v => applyPreset(v as DateRangePreset)} />
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                value={dateFrom}
                onChange={e => { setDateFrom(e.target.value); setPreset("custom"); }}
                aria-label="Data inicial"
                className="nc-input nc-num h-8 w-[132px] px-2 text-[12px]"
              />
              <span className="text-xs" style={{ color: "var(--nc-text-3)" }}>–</span>
              <input
                type="date"
                value={dateTo}
                onChange={e => { setDateTo(e.target.value); setPreset("custom"); }}
                aria-label="Data final"
                className="nc-input nc-num h-8 w-[132px] px-2 text-[12px]"
              />
            </div>
          </div>
        </div>

        {/* ---------------- Lista ----------------
            Os três estados, como em toda lista do painel: carregando, erro e
            vazio. O erro ocupa o lugar da lista e traz o botão de tentar de
            novo — sem log não há nada embaixo para ele atrapalhar. */}
        {error ? (
          <div className="nc-card flex flex-col items-center gap-3 py-16 text-center">
            <p className="text-[13px]" style={{ color: "var(--nc-crit)" }}>Não foi possível ler a auditoria.</p>
            <p className="max-w-md text-[11.5px]" style={{ color: "var(--nc-text-3)" }}>{error}</p>
            <NcButton variant="quiet" onClick={reload}>Tentar de novo</NcButton>
          </div>
        ) : loading ? (
          <div className="nc-card py-16 text-center text-[13px]" style={{ color: "var(--nc-text-3)" }}>
            Carregando o rastro…
          </div>
        ) : days.length === 0 ? (
          <div className="nc-card py-16 text-center text-[13px]" style={{ color: "var(--nc-text-3)" }}>
            {rows.length === 0
              ? "Nenhum movimento neste período."
              : "Nenhum movimento encontrado com os filtros aplicados."}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {days.map(({ day, items }) => (
              <section key={day} className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between gap-2 px-1">
                  <span className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>{dayLabel(day)}</span>
                  <span className="nc-num text-[10.5px]" style={{ color: "var(--nc-text-3)" }}>
                    {items.length} movimento{items.length === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="nc-card overflow-hidden">
                  {items.map(m => (
                    <MovementRow
                      key={`${m.tx}-${m.main.id}`}
                      movement={m}
                      open={open.has(m.tx)}
                      onToggle={() => toggle(m.tx)}
                      resolve={resolve}
                      names={names}
                    />
                  ))}
                </div>
              </section>
            ))}

            {/* Os filtros de pessoa e área rodam sobre o que já veio do banco —
                só o período é consultado lá. Enquanto houver página por
                carregar, a tela diz isso em vez de deixar concluir que não
                existe. */}
            {hasMore && (
              <div className="flex flex-col items-center gap-2 py-2">
                <NcButton variant="quiet" size="md" onClick={loadMore} disabled={loadingMore}>
                  {loadingMore ? "Carregando…" : "Carregar mais"}
                </NcButton>
                {hasActiveFilters && (
                  <p className="text-[11px]" style={{ color: "var(--nc-text-3)" }}>
                    O filtro procura só no que já foi carregado.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ---------------- Trilho ----------------
          Sem barra de duas cores, pelo mesmo motivo da Entrada e das Despesas:
          não existe divisão REAL do total em duas metades aqui. Movimento não
          se reparte em recebido/a receber; ele se reparte entre pessoas e
          entre áreas, e é isso que as duas listas do fim mostram. */}
      <aside className={RAIL_FIRST} style={{ background: "var(--nc-rail)" }}>
        <span className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>Rastro do painel</span>

        <div>
          <span className="text-[11.5px]" style={{ color: "var(--nc-text-2)" }}>Movimentos no período</span>
          <div className="flex flex-wrap items-baseline gap-2">
            {/* Contagem não é dinheiro, então não nasce em accent: naquele tom
                ela leria como receita. O accent aqui fica para o que é dinheiro
                em toda tela do painel. */}
            <AnimatedNumber
              value={stats.count}
              duration={0.7}
              animateOnMount
              className="nc-num text-[30px] font-semibold tracking-[-0.025em]"
            />
          </div>
          <p className="nc-num mt-1.5 text-[11px]" style={{ color: "var(--nc-text-2)" }}>
            {stats.writes} escrita{stats.writes === 1 ? "" : "s"} · {stats.people} pessoa{stats.people === 1 ? "" : "s"}
          </p>
        </div>

        <Rule />

        <div>
          <span className={cn(EYEBROW, "mb-1.5 block")} style={{ color: "var(--nc-text-3)" }}>Quem mexeu</span>
          {stats.actors.length === 0 ? (
            <p className="py-4 text-center text-xs" style={{ color: "var(--nc-text-3)" }}>Ninguém no período.</p>
          ) : (
            <div className="flex flex-col">
              {stats.actors.slice(0, MAX_RAIL_ROWS).map(a => (
                <div key={a.key} className="nc-row flex items-center justify-between gap-2 py-1.5 text-xs">
                  <span className="min-w-0 flex-1 truncate">{a.label}</span>
                  <span className="nc-num flex-none">
                    {a.count}
                    <span style={{ color: "var(--nc-text-3)" }}>
                      {" · "}{stats.count > 0 ? Math.round((a.count / stats.count) * 100) : 0}%
                    </span>
                  </span>
                </div>
              ))}
              {stats.actors.length > MAX_RAIL_ROWS && (
                <p className="pt-2 text-[11px]" style={{ color: "var(--nc-text-3)" }}>
                  + {stats.actors.length - MAX_RAIL_ROWS} outras pessoas
                </p>
              )}
            </div>
          )}
        </div>

        <Rule />

        <div>
          <span className={cn(EYEBROW, "mb-1.5 block")} style={{ color: "var(--nc-text-3)" }}>Onde mexeram</span>
          {stats.areas.length === 0 ? (
            <p className="py-4 text-center text-xs" style={{ color: "var(--nc-text-3)" }}>Nenhuma área no período.</p>
          ) : (
            <div className="flex flex-col">
              {stats.areas.slice(0, MAX_RAIL_ROWS).map(a => (
                <div key={a.name} className="nc-row flex items-center justify-between gap-2 py-1.5 text-xs">
                  <span className="min-w-0 flex-1 truncate">{a.name}</span>
                  <span className="nc-num flex-none">{a.count}</span>
                </div>
              ))}
              {stats.areas.length > MAX_RAIL_ROWS && (
                <p className="pt-2 text-[11px]" style={{ color: "var(--nc-text-3)" }}>
                  + {stats.areas.length - MAX_RAIL_ROWS} outras áreas
                </p>
              )}
            </div>
          )}
        </div>

        <Rule />

        {/* O sinal que só a auditoria dá: escrita que não veio do app. Em
            --nc-alert, não em --nc-crit: não é um erro, é algo que merece ser
            reconhecido — quase sempre é o próprio dono mexendo no SQL Editor. */}
        <div>
          <span className={cn(EYEBROW, "mb-1.5 block")} style={{ color: "var(--nc-text-3)" }}>Fora do painel</span>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[12.5px]" style={{ color: "var(--nc-text-2)" }}>Escritas direto no banco</span>
            <span
              className="nc-num text-base font-semibold"
              style={{ color: stats.outside > 0 ? "var(--nc-alert)" : undefined }}
            >
              {stats.outside}
            </span>
          </div>
          <p className="mt-1 text-[11px]" style={{ color: "var(--nc-text-3)" }}>
            {stats.outside > 0
              ? "Feitas pelo SQL Editor ou por um serviço, sem passar pelo app."
              : "Tudo no período passou pelo app."}
          </p>
        </div>
      </aside>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Linha                                                               */
/* ------------------------------------------------------------------ */

function MovementRow({
  movement,
  open,
  onToggle,
  resolve,
  names,
}: {
  movement: Movement;
  open: boolean;
  onToggle: () => void;
  resolve: RefResolver;
  names: ActorNames;
}) {
  const { main, entries } = movement;
  const phrase = describe(main);
  const summary = summarize(movement, resolve);
  const area = entityInfo(main.entity).area;
  const outside = isOutsideApp(main.actor_source);

  return (
    <div className="nc-row overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="nc-hover flex w-full items-center gap-3 px-4 py-2.5 text-left"
      >
        <span className="nc-num w-[38px] flex-none text-[11px]" style={{ color: "var(--nc-text-3)" }}>
          {TIME.format(new Date(movement.at))}
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px]">
            <span>{actorLabel(main, names)}</span>{" "}
            <span style={{ color: "var(--nc-text-2)" }}>{phrase.text}</span>
          </span>
          {(summary || phrase.automatic) && (
            <span className="block truncate text-[11px]" style={{ color: "var(--nc-text-3)" }}>
              {summary}
              {phrase.automatic && (
                <>
                  {summary ? " · " : ""}
                  {/* Quem aparece como autor só abriu a tela que disparou a
                      varredura do prazo. Sem esta linha, a auditoria acusaria
                      alguém de uma decisão que ninguém tomou. */}
                  varredura automática do prazo, não é decisão de ninguém
                </>
              )}
            </span>
          )}
        </span>

        <span className="flex flex-none items-center gap-2">
          {outside && <span className="nc-pill nc-pill--partial">fora do painel</span>}
          <span className="nc-pill nc-pill--mute">{area}</span>
          {entries.length > 1 && (
            <span className="nc-num text-[10.5px]" style={{ color: "var(--nc-text-3)" }}>
              {entries.length}
            </span>
          )}
          <ChevronDown
            size={14}
            className="transition-transform duration-200"
            style={{ color: "var(--nc-text-3)", transform: open ? "rotate(180deg)" : undefined }}
          />
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={transitionBase}
            className="overflow-hidden"
          >
            <div
              className="px-4 pb-3 pt-1"
              style={{ background: "color-mix(in srgb, var(--nc-text) 3%, transparent)" }}
            >
              {entries.map((entry, i) => (
                <EntryDetail key={entry.id} entry={entry} first={i === 0} resolve={resolve} />
              ))}

              <p className="mt-3 text-[11px]" style={{ color: "var(--nc-text-3)" }}>
                {main.actor_email ?? "sem usuário identificado"} · {sourceLabel(main.actor_source)} ·{" "}
                {formatDateBR(movement.at)} às {TIME.format(new Date(movement.at))}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Detalhe de um registro                                              */
/* ------------------------------------------------------------------ */

function EntryDetail({
  entry,
  first,
  resolve,
}: {
  entry: AuditRow;
  first: boolean;
  resolve: RefResolver;
}) {
  /**
   * Em alteração, só as colunas que mudaram — com o valor de antes ao lado,
   * quando o banco guardou (`old_data`, migration 20260914190000). Em inclusão
   * e exclusão, o registro inteiro: o que passou a existir, ou o que deixou de.
   */
  const changed = entry.action === "update" ? (entry.changed_fields ?? []) : [];
  const fields = entry.action === "update" ? changed : visibleFields(entry.row_data);

  return (
    <div className={cn("pt-2.5", !first && "nc-rule-top mt-2.5")}>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className={EYEBROW} style={{ color: "var(--nc-text-2)" }}>
          {thingNoun(entry.entity)} · {ACTION_NOUN[entry.action] ?? entry.action}
        </span>
        {entry.entity_id && (
          <span className="nc-num text-[10.5px]" style={{ color: "var(--nc-text-3)" }}>
            {shortId(entry.entity_id)}
          </span>
        )}
      </div>

      {fields.length === 0 ? (
        <p className="text-[11.5px]" style={{ color: "var(--nc-text-3)" }}>Sem campos para mostrar.</p>
      ) : (
        <dl className="flex flex-col gap-1">
          {fields.map(f => {
            const now = formatValue(f, entry.row_data[f], resolve);
            const hadBefore = entry.action === "update" && entry.old_data && f in entry.old_data;
            const before = hadBefore ? formatValue(f, entry.old_data?.[f], resolve) : null;
            return (
              <div key={f} className="flex items-baseline justify-between gap-3 text-[11.5px]">
                <dt className="flex-none" style={{ color: "var(--nc-text-3)" }}>{fieldLabel(f)}</dt>
                <dd className="nc-num min-w-0 flex-1 truncate text-right">
                  {before !== null && (
                    <>
                      <span style={{ color: "var(--nc-text-3)" }}>{before}</span>
                      <span style={{ color: "var(--nc-text-3)" }}> → </span>
                    </>
                  )}
                  <span>{now}</span>
                </dd>
              </div>
            );
          })}
        </dl>
      )}
    </div>
  );
}
