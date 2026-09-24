import { describe, it, expect } from "vitest";
import { fetchAllRows, PAGE_SIZE } from "@/lib/fetch-all-rows";

/**
 * Um "servidor" com `total` linhas que, como o PostgREST, nunca devolve mais
 * que PAGE_SIZE por requisição. `calls` conta as idas ao banco.
 */
function fakeTable(total: number, failAt?: number) {
  const calls: [number, number][] = [];
  const query = () => ({
    range: async (from: number, to: number) => {
      calls.push([from, to]);
      if (failAt !== undefined && from >= failAt) return { data: null, error: new Error("rede") };
      const end = Math.min(to + 1, total, from + PAGE_SIZE);
      return { data: Array.from({ length: Math.max(0, end - from) }, (_, i) => from + i), error: null };
    },
  });
  return { query, calls };
}

describe("fetchAllRows", () => {
  it("junta todas as páginas quando a tabela passa do teto", async () => {
    const t = fakeTable(2 * PAGE_SIZE + 37);
    const { data, error } = await fetchAllRows(t.query);
    expect(error).toBeNull();
    expect(data).toHaveLength(2 * PAGE_SIZE + 37);
    expect(data![PAGE_SIZE]).toBe(PAGE_SIZE);
    expect(t.calls).toEqual([
      [0, PAGE_SIZE - 1],
      [PAGE_SIZE, 2 * PAGE_SIZE - 1],
      [2 * PAGE_SIZE, 3 * PAGE_SIZE - 1],
    ]);
  });

  it("tabela pequena é uma ida só", async () => {
    const t = fakeTable(12);
    const { data } = await fetchAllRows(t.query);
    expect(data).toHaveLength(12);
    expect(t.calls).toHaveLength(1);
  });

  it("múltiplo exato do teto pede uma página a mais e ela volta vazia", async () => {
    const t = fakeTable(PAGE_SIZE);
    const { data } = await fetchAllRows(t.query);
    expect(data).toHaveLength(PAGE_SIZE);
    expect(t.calls).toHaveLength(2);
  });

  it("erro no meio devolve erro e nenhuma linha, nunca meia tabela", async () => {
    const t = fakeTable(3 * PAGE_SIZE, PAGE_SIZE);
    const { data, error } = await fetchAllRows(t.query);
    expect(data).toBeNull();
    expect(error).toBeInstanceOf(Error);
  });
});
