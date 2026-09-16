import { describe, it, expect } from "vitest";
import {
  modelArchiveKey,
  hiddenModelKeys,
  isProductHidden,
  disuseCandidates,
  DISUSE_DAYS,
} from "@/lib/archived-models";
import type { ModelStat } from "@/lib/restock";
import type { ArchivedModel } from "@/types";

const archived = (branchId: string, brand: string, model: string): ArchivedModel => ({
  branchId, brand, model, archivedAt: "2026-09-16T00:00:00Z",
});

const stat = (t: Partial<ModelStat> & { brand: string; model: string }): ModelStat => ({
  key: `${t.brand}|${t.model}`,
  stock: 0, unitCost: 80, stockValue: 0, perDay: 0, saleDays: 0,
  daysLeft: Infinity, marginPct: 40, incoming: 0, needUnits: 0,
  restockUnits: 0, restockCost: 0, daysSinceLastSale: Infinity,
  revenue: 0, qty: 0,
  ...t,
});

describe("modelArchiveKey", () => {
  it("normaliza caixa e espaço, como o banco", () => {
    // A tela esconde pelo que o banco guardou: chaves diferentes seriam dois
    // conjuntos, e arquivar não alcançaria o que a pessoa vê.
    expect(modelArchiveKey(" Elfbar ", "BC10000")).toBe(modelArchiveKey("elfbar", " bc10000"));
  });
});

describe("hiddenModelKeys", () => {
  it("com uma filial escolhida, esconde só o que ELA arquivou", () => {
    const rows = [archived("A", "Elfbar", "BC10000"), archived("B", "Ignite", "V80")];

    expect(hiddenModelKeys(rows, "A", ["A", "B"])).toEqual(new Set(["elfbar|bc10000"]));
    expect(hiddenModelKeys(rows, "B", ["A", "B"])).toEqual(new Set(["ignite|v80"]));
  });

  it("em Todas as filiais, só some o que as duas arquivaram", () => {
    // A lista consolidada é a soma das cidades: esconder o que uma delas ainda
    // vende apagaria estoque vivo da tela.
    const rows = [
      archived("A", "Elfbar", "BC10000"),
      archived("B", "Elfbar", "BC10000"),
      archived("A", "Ignite", "V80"),
    ];

    expect(hiddenModelKeys(rows, null, ["A", "B"])).toEqual(new Set(["elfbar|bc10000"]));
  });

  it("ignora filial que a pessoa não alcança", () => {
    const rows = [archived("A", "Elfbar", "BC10000"), archived("C", "Elfbar", "BC10000")];

    // Quem só administra A não deve ter a lista mexida por decisão de C — nem
    // para esconder, nem para deixar de esconder.
    expect(hiddenModelKeys(rows, null, ["A"])).toEqual(new Set(["elfbar|bc10000"]));
    expect(hiddenModelKeys(rows, null, ["A", "B"])).toEqual(new Set());
  });

  it("sem filial nenhuma alcançável não esconde nada", () => {
    expect(hiddenModelKeys([archived("A", "Elfbar", "BC10000")], null, [])).toEqual(new Set());
  });
});

describe("isProductHidden", () => {
  const hidden = new Set(["elfbar|bc10000"]);

  it("esconde o sabor do modelo arquivado que está zerado", () => {
    expect(isProductHidden({ brand: "Elfbar", model: "BC10000", stock: 0 }, hidden)).toBe(true);
  });

  it("NÃO esconde enquanto houver unidade", () => {
    // Compra que chega depois de arquivar: a unidade existe e precisa ter como
    // sair da tela (venda, perda, transferência).
    expect(isProductHidden({ brand: "Elfbar", model: "BC10000", stock: 3 }, hidden)).toBe(false);
  });

  it("não mexe em modelo que ninguém arquivou", () => {
    expect(isProductHidden({ brand: "Ignite", model: "V80", stock: 0 }, hidden)).toBe(false);
  });
});

describe("disuseCandidates", () => {
  it("sugere o que não tem estoque nem venda há muito tempo, do mais parado primeiro", () => {
    const stats = [
      stat({ brand: "Elfbar", model: "BC10000", daysSinceLastSale: 120 }),
      stat({ brand: "Oxbar", model: "Pod5000" }),                                  // nunca vendeu
      stat({ brand: "Ignite", model: "V80", daysSinceLastSale: 10 }),               // vende
      stat({ brand: "Nikbar", model: "15k", stock: 4, daysSinceLastSale: 300 }),    // tem estoque
    ];

    expect(disuseCandidates(stats, new Set()).map(s => s.model)).toEqual(["Pod5000", "BC10000"]);
  });

  it("não sugere de novo o que já está arquivado", () => {
    const stats = [stat({ brand: "Elfbar", model: "BC10000", daysSinceLastSale: 120 })];

    expect(disuseCandidates(stats, new Set(["elfbar|bc10000"]))).toEqual([]);
  });

  it("o corte é o DISUSE_DAYS, e ele é aberto", () => {
    const stats = [stat({ brand: "Elfbar", model: "BC10000", daysSinceLastSale: DISUSE_DAYS })];

    expect(disuseCandidates(stats, new Set())).toEqual([]);
    expect(disuseCandidates(stats, new Set(), DISUSE_DAYS - 1)).toHaveLength(1);
  });
});
