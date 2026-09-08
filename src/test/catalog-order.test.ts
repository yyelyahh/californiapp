import { describe, it, expect } from "vitest";
import { compareText, compareCatalog, sortCatalog, sortNames, sortByName } from "@/lib/catalog-order";

const p = (brand: string, model: string, flavor: string) => ({ brand, model, flavor });

describe("ordem do catálogo", () => {
  it("ordena por marca, depois modelo, depois sabor", () => {
    const out = sortCatalog([
      p("Ignite", "V150", "Uva"),
      p("Elfbar", "BC10000", "Menta"),
      p("Ignite", "V80", "Melancia"),
      p("Ignite", "V150", "Menta"),
    ]);

    expect(out.map(x => `${x.brand}/${x.model}/${x.flavor}`)).toEqual([
      "Elfbar/BC10000/Menta",
      "Ignite/V80/Melancia",
      "Ignite/V150/Menta",
      "Ignite/V150/Uva",
    ]);
  });

  it("modelo com número não é ordenado como texto", () => {
    // sem `numeric`, "V150" viria antes de "V90"
    expect(sortNames(["V90", "V150", "V15"])).toEqual(["V15", "V90", "V150"]);
  });

  it("maiúscula e acento não jogam a marca para o fim da lista", () => {
    // `.sort()` cru devolveria ["Zomo", "elfbar", "ígnite"] (ordem de código)
    expect(sortNames(["Zomo", "elfbar", "ígnite"])).toEqual(["elfbar", "ígnite", "Zomo"]);
  });

  it("campo faltando não quebra nem some da lista", () => {
    const out = sortCatalog([
      { brand: "Ignite", model: null, flavor: "Uva" },
      { brand: undefined, model: "X", flavor: "Menta" },
      p("Elfbar", "A", "Menta"),
    ]);

    expect(out).toHaveLength(3);
    expect(out[0].brand).toBeUndefined(); // vazio ordena primeiro
    expect(out[1].brand).toBe("Elfbar");
  });

  it("não ordena a lista original no lugar", () => {
    const original = [p("Zomo", "B", "Uva"), p("Elfbar", "A", "Menta")];
    const copy = [...original];
    sortCatalog(original);
    expect(original).toEqual(copy);
  });

  it("empate completo devolve 0", () => {
    expect(compareCatalog(p("Ignite", "V150", "Uva"), p("ignite", "v150", "uva"))).toBe(0);
  });

  it("sortByName ordena vendedor e parceiro pelo nome", () => {
    const out = sortByName([{ name: "Bruna" }, { name: "ana" }, { name: "Ávila" }]);
    expect(out.map(x => x.name)).toEqual(["ana", "Ávila", "Bruna"]);
  });

  it("compareText trata nulo como vazio", () => {
    expect(compareText(null, "")).toBe(0);
    expect(compareText(undefined, "a")).toBeLessThan(0);
  });
});
