import { describe, it, expect } from "vitest";
import { buildSalesLink, parseSalesLink } from "@/lib/sales-link";

const search = (link: string) => link.slice(link.indexOf("?"));

describe("endereço de Vendas filtrada", () => {
  it("vai e volta sem perder nada", () => {
    const f = {
      from: "2026-06-01",
      to: "2026-06-30",
      status: "due" as const,
      model: { brand: "Elfbar", model: "BC 10K" },
    };
    expect(parseSalesLink(search(buildSalesLink(f)))).toEqual(f);
  });

  it("marca e modelo com espaço e acento sobrevivem ao endereço", () => {
    const f = { model: { brand: "Ignite Açaí", model: "V 50 / Ice" } };
    expect(parseSalesLink(search(buildSalesLink(f)))).toEqual(f);
  });

  it("todo o período ganha do intervalo", () => {
    const link = buildSalesLink({ all: true, from: "2026-06-01", to: "2026-06-30" });
    expect(link).toBe("/sales?periodo=tudo");
    expect(parseSalesLink(search(link))).toEqual({ all: true });
  });

  it("sem filtro nenhum, o endereço é a tela pura e a leitura é nula", () => {
    expect(buildSalesLink({})).toBe("/sales");
    expect(parseSalesLink("")).toBeNull();
    expect(parseSalesLink("?qualquer=coisa")).toBeNull();
  });

  it("intervalo inválido cai sozinho e não derruba o resto", () => {
    expect(parseSalesLink("?de=2026-02-31&ate=2026-03-10&situacao=a-receber")).toEqual({ status: "due" });
    expect(parseSalesLink("?de=2026-06-30&ate=2026-06-01")).toBeNull();
    expect(parseSalesLink("?de=2026-06-01")).toBeNull();
  });

  it("modelo sem marca não filtra: o nome sozinho não identifica o produto", () => {
    expect(parseSalesLink("?modelo=10K")).toBeNull();
    expect(parseSalesLink("?marca=%20&modelo=10K")).toBeNull();
  });
});
