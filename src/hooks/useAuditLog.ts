import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { ActorNames, AuditAction, AuditRow } from "@/lib/audit-format";

/**
 * O rastro do painel, lido em páginas.
 *
 * Não entra no `StoreContext` de propósito. Aquele contexto carrega tabela
 * inteira na memória e é exatamente o que já trava a lista de Vendas (ver o
 * roadmap no CLAUDE.md). O log de auditoria cresce mais rápido que qualquer
 * outra tabela daqui — toda escrita do app vira pelo menos uma linha — então
 * ele nasce paginado, e só a tela que o mostra carrega alguma coisa.
 */

/** Quantas linhas por requisição. Uma tela cheia de movimentos cabe folgada. */
const PAGE_SIZE = 200;

/** Começo e fim do dia local, como instante — `at` é timestamptz. */
function startOfDayISO(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0).toISOString();
}

function endOfDayISO(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999).toISOString();
}

type Options = {
  /** YYYY-MM-DD; vazio = sem limite daquele lado. */
  from: string;
  to: string;
};

export function useAuditLog({ from, to }: Options) {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [names, setNames] = useState<ActorNames>({});

  /**
   * Cada carga ganha um número. Trocar o período duas vezes depressa dispara
   * duas requisições, e a primeira pode voltar por último — sem isto a tela
   * mostraria o resultado do período que a pessoa já abandonou.
   */
  const runId = useRef(0);

  const fetchPage = useCallback(
    async (offset: number) => {
      const run = ++runId.current;
      if (offset === 0) setLoading(true);
      else setLoadingMore(true);

      let query = supabase
        .from("audit_log")
        // `*` e não uma lista de colunas: o `old_data` só existe depois da
        // segunda migration, e com lista explícita a tela inteira falharia com
        // "column does not exist" num banco que só aplicou a primeira.
        .select("*")
        // O desempate por `id` não é enfeite: todas as linhas de um mesmo
        // movimento têm o MESMO `at` (o now() da transação), e sem um segundo
        // critério a ordem entre elas é indefinida — o que faz uma linha
        // aparecer em duas páginas, ou em nenhuma.
        .order("at", { ascending: false })
        .order("id", { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);

      if (from) query = query.gte("at", startOfDayISO(from));
      if (to) query = query.lte("at", endOfDayISO(to));

      const { data, error: err } = await query;
      if (run !== runId.current) return;

      if (err) {
        setError(err.message);
        setLoading(false);
        setLoadingMore(false);
        return;
      }

      const page = (data ?? []).map(r => ({
        ...r,
        action: r.action as AuditAction,
        row_data: (r.row_data ?? {}) as Record<string, unknown>,
        old_data: (r.old_data ?? null) as Record<string, unknown> | null,
      })) as AuditRow[];

      setError(null);
      setRows(prev => (offset === 0 ? page : [...prev, ...page]));
      setHasMore(page.length === PAGE_SIZE);
      setLoading(false);
      setLoadingMore(false);
    },
    [from, to],
  );

  useEffect(() => {
    void fetchPage(0);
  }, [fetchPage]);

  /**
   * Os nomes de exibição, uma vez só — a tabela tem uma linha por pessoa que
   * usa o painel. Resolver o nome aqui, na LEITURA, é o que faz trocar o nome
   * de alguém acertar também o histórico já gravado: o log guarda o e-mail
   * (identidade, que não se reescreve) e a tela escolhe como chamar.
   *
   * Falha silenciosa de propósito: sem os nomes a tela cai no e-mail, que é o
   * que ela mostrava antes. Perder o rótulo não é motivo para esconder o log.
   */
  useEffect(() => {
    let alive = true;
    void (async () => {
      const { data } = await supabase.from("user_display_names").select("user_id, name");
      if (!alive || !data) return;
      setNames(Object.fromEntries(data.map(r => [r.user_id, r.name])));
    })();
    return () => { alive = false; };
  }, []);

  const loadMore = useCallback(() => {
    if (loadingMore || !hasMore) return;
    void fetchPage(rows.length);
  }, [fetchPage, hasMore, loadingMore, rows.length]);

  const reload = useCallback(() => {
    void fetchPage(0);
  }, [fetchPage]);

  return { rows, names, loading, loadingMore, error, hasMore, loadMore, reload };
}
