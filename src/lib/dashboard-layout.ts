/**
 * O Dashboard montado por quem usa.
 *
 * Cada pedaço da tela é um BLOCO com identidade fixa (`WidgetId`), e o layout é
 * só a lista desses blocos em ordem, cada um com três escolhas: se aparece, onde
 * fica no modo vertical (coluna ou trilho) e que tamanho tem no modo de cards.
 * A ORDEM é uma só, a do array: no modo vertical cada área lê os seus na ordem
 * em que aparecem, no de cards a grade lê todos. Duas ordens (uma por modo)
 * fariam a pessoa arrumar a tela duas vezes e estranhar a outra ao trocar.
 *
 * O layout padrão é o Dashboard como ele era antes de existir personalização —
 * quem nunca abriu o painel não vê diferença nenhuma.
 *
 * Tudo aqui é função pura (testada em src/test/dashboard-layout.test.ts): o que
 * vem do banco é jsonb que qualquer versão antiga do app pode ter gravado, e é
 * o `normalizeLayout` que decide o que ainda vale.
 */

export type WidgetId =
  | "restock"
  | "performance"
  | "topModels"
  | "revenue"
  | "result"
  | "indicators"
  | "grossProfit"
  | "recentSales";

/** Coluna do meio ou trilho da direita — só existe no modo vertical. */
export type WidgetArea = "main" | "rail";

/** Quantas colunas da grade o bloco ocupa no modo de cards. */
export type WidgetSize = "s" | "m" | "l";

/** `vertical` é a tela de sempre (coluna + trilho); `cards` é a grade. */
export type ViewMode = "vertical" | "cards";

export interface WidgetDef {
  id: WidgetId;
  label: string;
  description: string;
  /**
   * Onde o bloco cabe. "Repor agora" é tabela de quatro colunas e não cabe nos
   * 312px do trilho sem virar arrasto lateral, então ele só mora na coluna.
   */
  areas: WidgetArea[];
  /** Tamanhos que fazem sentido na grade — tabela e gráfico não cabem em 1/4. */
  sizes: WidgetSize[];
  defaultArea: WidgetArea;
  defaultSize: WidgetSize;
}

const ALL_SIZES: WidgetSize[] = ["s", "m", "l"];
const BOTH_AREAS: WidgetArea[] = ["main", "rail"];

/** O catálogo de blocos, NA ORDEM do layout padrão. */
export const WIDGETS: WidgetDef[] = [
  {
    id: "restock",
    label: "Repor agora",
    description: "O que pedir para voltar ao mínimo",
    areas: ["main"],
    sizes: ["m", "l"],
    defaultArea: "main",
    defaultSize: "l",
  },
  {
    id: "performance",
    label: "Desempenho financeiro",
    description: "Receita e lucro dos últimos 6 meses",
    areas: BOTH_AREAS,
    sizes: ["m", "l"],
    defaultArea: "main",
    defaultSize: "l",
  },
  {
    id: "topModels",
    label: "Modelos mais vendidos",
    description: "Ranking por receita no período",
    areas: BOTH_AREAS,
    sizes: ALL_SIZES,
    defaultArea: "main",
    defaultSize: "m",
  },
  {
    id: "revenue",
    label: "Receita",
    description: "Faturamento, recebido e a receber",
    areas: BOTH_AREAS,
    sizes: ALL_SIZES,
    defaultArea: "rail",
    defaultSize: "s",
  },
  {
    id: "result",
    label: "Resultado",
    description: "CPV, despesas e lucro líquido",
    areas: BOTH_AREAS,
    sizes: ALL_SIZES,
    defaultArea: "rail",
    defaultSize: "s",
  },
  {
    id: "indicators",
    label: "Ticket e estoque",
    description: "Ticket médio e estoque a custo",
    areas: BOTH_AREAS,
    sizes: ALL_SIZES,
    defaultArea: "rail",
    defaultSize: "s",
  },
  {
    id: "grossProfit",
    label: "Lucro bruto",
    description: "Receita menos o custo do que saiu",
    areas: BOTH_AREAS,
    sizes: ALL_SIZES,
    defaultArea: "rail",
    defaultSize: "s",
  },
  {
    id: "recentSales",
    label: "Últimas vendas",
    description: "As 6 vendas mais recentes",
    areas: BOTH_AREAS,
    sizes: ALL_SIZES,
    defaultArea: "rail",
    defaultSize: "m",
  },
];

const DEFS = new Map(WIDGETS.map(w => [w.id, w]));

export function widgetDef(id: WidgetId): WidgetDef {
  return DEFS.get(id)!;
}

export interface WidgetConfig {
  id: WidgetId;
  visible: boolean;
  area: WidgetArea;
  size: WidgetSize;
}

export interface DashboardLayout {
  mode: ViewMode;
  widgets: WidgetConfig[];
}

function defaultConfig(def: WidgetDef): WidgetConfig {
  return { id: def.id, visible: true, area: def.defaultArea, size: def.defaultSize };
}

export const DEFAULT_LAYOUT: DashboardLayout = {
  mode: "vertical",
  widgets: WIDGETS.map(defaultConfig),
};

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * O que veio do banco (ou do cache do navegador) virando um layout válido.
 *
 * Nada aqui lança: layout estragado cai no padrão, bloco que não existe mais é
 * descartado, campo inválido volta ao padrão DAQUELE bloco (e não do layout
 * inteiro — um tamanho errado não deveria desfazer a ordem que a pessoa montou).
 *
 * Bloco NOVO, que o app ganhou depois que a pessoa salvou o layout dela, entra
 * no fim e VISÍVEL: escondido ele nunca seria descoberto, porque ninguém abre o
 * painel procurando o que não sabe que existe.
 */
export function normalizeLayout(raw: unknown): DashboardLayout {
  if (!isObject(raw)) return DEFAULT_LAYOUT;

  const mode: ViewMode = raw.mode === "cards" ? "cards" : "vertical";
  const seen = new Set<WidgetId>();
  const widgets: WidgetConfig[] = [];

  if (Array.isArray(raw.widgets)) {
    for (const item of raw.widgets) {
      if (!isObject(item)) continue;
      const def = DEFS.get(item.id as WidgetId);
      if (!def || seen.has(def.id)) continue;
      seen.add(def.id);
      widgets.push({
        id: def.id,
        visible: typeof item.visible === "boolean" ? item.visible : true,
        area: def.areas.includes(item.area as WidgetArea) ? (item.area as WidgetArea) : def.defaultArea,
        size: def.sizes.includes(item.size as WidgetSize) ? (item.size as WidgetSize) : def.defaultSize,
      });
    }
  }

  for (const def of WIDGETS) {
    if (!seen.has(def.id)) widgets.push(defaultConfig(def));
  }

  return { mode, widgets };
}

/** Troca um campo de um bloco, recusando área ou tamanho que ele não aceita. */
export function updateWidget(
  layout: DashboardLayout,
  id: WidgetId,
  patch: Partial<Omit<WidgetConfig, "id">>,
): DashboardLayout {
  const def = widgetDef(id);
  if (patch.area && !def.areas.includes(patch.area)) return layout;
  if (patch.size && !def.sizes.includes(patch.size)) return layout;
  return {
    ...layout,
    widgets: layout.widgets.map(w => (w.id === id ? { ...w, ...patch } : w)),
  };
}

/**
 * Nova ordem para um GRUPO de blocos (uma área, no modo vertical; todos, no de
 * cards), sem mexer em quem está fora dele.
 *
 * Os blocos do grupo trocam de lugar entre si, dentro das MESMAS posições do
 * array que já ocupavam. Reordenar o trilho não empurra nada da coluna, e ao
 * voltar para o modo de cards a grade continua na ordem que fazia sentido.
 */
export function reorderGroup(layout: DashboardLayout, orderedIds: WidgetId[]): DashboardLayout {
  const group = new Set(orderedIds);
  const queue = [...orderedIds];
  const byId = new Map(layout.widgets.map(w => [w.id, w]));
  // Id que não existe no layout é ignorado, e id do layout que faltou na lista
  // fica onde está — reordenar nunca pode fazer bloco sumir ou duplicar.
  if (orderedIds.length !== layout.widgets.filter(w => group.has(w.id)).length) return layout;
  return {
    ...layout,
    widgets: layout.widgets.map(w => (group.has(w.id) ? byId.get(queue.shift()!)! : w)),
  };
}

/**
 * Um passo para cima ou para baixo dentro do grupo — o caminho do teclado para o
 * mesmo arrasto. `peers` diz quem é do mesmo grupo.
 */
export function moveWithin(
  layout: DashboardLayout,
  id: WidgetId,
  direction: -1 | 1,
  peers: WidgetId[],
): DashboardLayout {
  const i = peers.indexOf(id);
  const j = i + direction;
  if (i < 0 || j < 0 || j >= peers.length) return layout;
  const next = [...peers];
  [next[i], next[j]] = [next[j], next[i]];
  return reorderGroup(layout, next);
}

/** Os blocos de um grupo, na ordem do layout — visíveis ou não. */
export function groupOf(layout: DashboardLayout, area: WidgetArea | null): WidgetConfig[] {
  return area ? layout.widgets.filter(w => w.area === area) : layout.widgets;
}

/** O que a tela desenha: só os visíveis, já separados como o modo pede. */
export function visibleWidgets(layout: DashboardLayout) {
  const shown = layout.widgets.filter(w => w.visible);
  return {
    all: shown,
    main: shown.filter(w => w.area === "main"),
    rail: shown.filter(w => w.area === "rail"),
  };
}
