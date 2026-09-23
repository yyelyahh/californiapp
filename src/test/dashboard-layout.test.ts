import { describe, it, expect } from "vitest";
import {
  DEFAULT_LAYOUT,
  WIDGETS,
  groupOf,
  moveWithin,
  normalizeLayout,
  reorderGroup,
  updateWidget,
  visibleWidgets,
  type WidgetId,
} from "@/lib/dashboard-layout";

const ids = (list: { id: WidgetId }[]) => list.map(w => w.id);

describe("layout padrão", () => {
  it("é o Dashboard de antes: três blocos na coluna, o resto no trilho", () => {
    const { main, rail } = visibleWidgets(DEFAULT_LAYOUT);
    expect(DEFAULT_LAYOUT.mode).toBe("vertical");
    expect(ids(main)).toEqual(["restock", "performance", "topModels"]);
    expect(ids(rail)).toEqual(["revenue", "result", "indicators", "grossProfit", "recentSales"]);
  });
});

describe("normalizeLayout", () => {
  it("cai no padrão com qualquer coisa que não seja objeto", () => {
    expect(normalizeLayout(null)).toEqual(DEFAULT_LAYOUT);
    expect(normalizeLayout("x")).toEqual(DEFAULT_LAYOUT);
    expect(normalizeLayout([1, 2])).toEqual(DEFAULT_LAYOUT);
  });

  it("mantém a ordem salva e descarta bloco que não existe mais", () => {
    const got = normalizeLayout({
      mode: "cards",
      widgets: [
        { id: "recentSales", visible: false, area: "main", size: "l" },
        { id: "apagado", visible: true },
        { id: "revenue", visible: true, area: "rail", size: "s" },
      ],
    });
    expect(got.mode).toBe("cards");
    expect(got.widgets[0]).toEqual({ id: "recentSales", visible: false, area: "main", size: "l" });
    expect(got.widgets[1].id).toBe("revenue");
    expect(got.widgets).toHaveLength(WIDGETS.length);
  });

  it("bloco novo entra no fim e visível", () => {
    const got = normalizeLayout({ mode: "vertical", widgets: [{ id: "revenue", visible: false, area: "rail", size: "s" }] });
    const tail = got.widgets.slice(1);
    expect(tail.every(w => w.visible)).toBe(true);
    expect(ids(tail)).toEqual(ids(WIDGETS).filter(id => id !== "revenue"));
  });

  it("campo inválido volta ao padrão só daquele bloco", () => {
    const got = normalizeLayout({
      widgets: [
        // "Repor agora" não cabe no trilho nem em 1/4 da grade.
        { id: "restock", visible: "sim", area: "rail", size: "s" },
      ],
    });
    expect(got.mode).toBe("vertical");
    expect(got.widgets[0]).toEqual({ id: "restock", visible: true, area: "main", size: "l" });
  });

  it("id repetido conta uma vez só", () => {
    const got = normalizeLayout({ widgets: [{ id: "revenue" }, { id: "revenue", visible: false }] });
    expect(got.widgets.filter(w => w.id === "revenue")).toHaveLength(1);
    expect(got.widgets[0].visible).toBe(true);
  });
});

describe("updateWidget", () => {
  it("recusa área ou tamanho que o bloco não aceita", () => {
    expect(updateWidget(DEFAULT_LAYOUT, "restock", { area: "rail" })).toBe(DEFAULT_LAYOUT);
    expect(updateWidget(DEFAULT_LAYOUT, "performance", { size: "s" })).toBe(DEFAULT_LAYOUT);
  });

  it("move um bloco do trilho para a coluna sem mudar a ordem global", () => {
    const got = updateWidget(DEFAULT_LAYOUT, "recentSales", { area: "main" });
    expect(ids(got.widgets)).toEqual(ids(DEFAULT_LAYOUT.widgets));
    expect(ids(visibleWidgets(got).main)).toEqual(["restock", "performance", "topModels", "recentSales"]);
  });
});

describe("reorderGroup", () => {
  it("reordena o trilho sem encostar na coluna", () => {
    const rail = ids(groupOf(DEFAULT_LAYOUT, "rail")).reverse();
    const got = reorderGroup(DEFAULT_LAYOUT, rail);
    expect(ids(groupOf(got, "main"))).toEqual(["restock", "performance", "topModels"]);
    expect(ids(groupOf(got, "rail"))).toEqual(rail);
  });

  it("lista incompleta, repetida ou com id estranho não mexe em nada", () => {
    expect(reorderGroup(DEFAULT_LAYOUT, ["revenue", "revenue"])).toBe(DEFAULT_LAYOUT);
    expect(reorderGroup(DEFAULT_LAYOUT, ["revenue", "xxx" as WidgetId])).toBe(DEFAULT_LAYOUT);
  });
});

describe("moveWithin", () => {
  it("troca com o vizinho do mesmo grupo e para nas pontas", () => {
    const peers = ids(groupOf(DEFAULT_LAYOUT, "main"));
    const down = moveWithin(DEFAULT_LAYOUT, "restock", 1, peers);
    expect(ids(groupOf(down, "main"))).toEqual(["performance", "restock", "topModels"]);
    expect(moveWithin(DEFAULT_LAYOUT, "restock", -1, peers)).toBe(DEFAULT_LAYOUT);
  });
});
