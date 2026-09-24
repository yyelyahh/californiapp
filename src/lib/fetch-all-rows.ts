/**
 * Linhas por página nas leituras de tabela inteira. É o teto do PostgREST
 * (`max_rows` do Supabase): acima dele o servidor corta a resposta calado.
 */
export const PAGE_SIZE = 1000;

/** O pedaço do query builder que a paginação usa. */
type Rangeable = {
  range(from: number, to: number): PromiseLike<{ data: unknown[] | null; error: unknown }>;
};

/**
 * Lê uma consulta INTEIRA, em páginas de {@link PAGE_SIZE}.
 *
 * O PostgREST devolve no máximo 1000 linhas por requisição e não avisa que
 * cortou: a resposta chega com `error` nulo e 1000 linhas, e a tela soma a
 * parte como se fosse o todo. Foi assim que o razão (`financial_events`)
 * passou de 1000 linhas e o Caixa começou a sair errado sem nada acusar. Toda
 * tabela de HISTÓRICO — a que cresce com o uso — passa por aqui.
 *
 * `query` é uma FÁBRICA, e não o builder pronto, porque o builder do
 * supabase-js é de uso único: cada página precisa de um novo. A ordenação tem
 * que ser TOTAL (quem chama termina em `.order("id")`), senão duas linhas com
 * o mesmo `created_at` trocam de lugar entre uma página e outra e uma aparece
 * duas vezes enquanto a outra some.
 *
 * Devolve a mesma forma `{ data, error }` de uma consulta comum, para entrar no
 * `Promise.all` do carregamento sem mudar quem lê o resultado. Erro em
 * qualquer página devolve erro e nenhum dado: meia tabela é exatamente o que
 * esta função existe para impedir.
 *
 * Testada em src/test/fetch-all-rows.test.ts.
 */
// `any` no retorno para quem chama continuar mapeando linha crua do banco,
// como fazia com o `.data` de uma consulta comum.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchAllRows(query: () => Rangeable): Promise<{ data: any[] | null; error: unknown }> {
  const rows: unknown[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await query().range(from, from + PAGE_SIZE - 1);
    if (error) return { data: null, error };
    const page = data ?? [];
    for (const r of page) rows.push(r);
    if (page.length < PAGE_SIZE) return { data: rows, error: null };
  }
}
