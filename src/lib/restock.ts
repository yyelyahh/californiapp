import type { Product, PurchaseOrder, Sale } from "@/types";

/**
 * Estatísticas por MODELO (marca + modelo) para o card "Repor agora" do Dashboard.
 *
 * Tudo aqui sai de dado que já existe: products.stock / purchasePrice / salePrice,
 * o histórico de sales e as compras em aberto. Nenhuma coluna nova no banco.
 *
 * Lembrete do domínio: products tem uma linha por SABOR. O que o dono repõe é o
 * modelo inteiro, então as contas agregam os sabores de um mesmo brand+model.
 */

/** Sem vender há mais que isso (com estoque parado) = capital travado. */
export const STALE_DAYS = 60;
/** Janela usada para medir o giro (vendas/dia), que hoje só alimenta leitura. */
export const VELOCITY_WINDOW_DAYS = 30;
/**
 * Abaixo desta fração do mínimo a linha sai como crítica, e não como alerta.
 *
 * Tudo que está na lista já está abaixo do mínimo — é assim que entra. O que
 * este corte separa é "faltou um pouco" de "está acabando": com metade do
 * mínimo ou menos, a reposição deixa de ser rotina.
 */
export const CRITICAL_MIN_RATIO = 0.5;

export interface ModelStat {
  /** `brand|model`, único e estável. */
  key: string;
  brand: string;
  model: string;
  stock: number;
  /** Custo unitário médio, ponderado pelo estoque de cada sabor. */
  unitCost: number;
  /** Quanto o estoque atual vale a custo. */
  stockValue: number;
  /**
   * O mínimo do MODELO: o maior entre os mínimos dos sabores dele.
   *
   * Maior, e não soma. O diálogo "Mínimo por modelo" grava o mesmo número em
   * todos os sabores, e quem digita 10 ali quer dez unidades do modelo — não
   * dez de cada sabor. Somar multiplicaria o pedido pelo número de sabores. É a
   * mesma leitura que a tela de Produtos já fazia; se algum sabor foi ajustado
   * à mão para um mínimo mais alto, é esse que manda.
   *
   * Zero = sem mínimo definido. Esse modelo não entra na lista de reposição:
   * sem mínimo não há o que calcular.
   */
  minUnits: number;
  /** Unidades vendidas por dia na janela recente. Leitura, não entra na conta. */
  perDay: number;
  /** Dias DISTINTOS com venda na janela. Leitura, não entra na conta. */
  saleDays: number;
  /** Quantos dias o estoque atual ainda dura. `Infinity` quando não há giro. */
  daysLeft: number;
  /** Margem bruta da tabela de preços, em %. */
  marginPct: number;
  /** Unidades deste modelo em compras pedidas e ainda não recebidas. */
  incoming: number;
  /** Quanto falta para o estoque alcançar o mínimo do modelo. */
  needUnits: number;
  /** O que falta PEDIR: `needUnits` menos o que já está a caminho. */
  restockUnits: number;
  /** Custo estimado do que falta pedir. */
  restockCost: number;
  /** Dias desde a última venda. `Infinity` se nunca vendeu. */
  daysSinceLastSale: number;
  /** Receita do modelo no período do filtro. */
  revenue: number;
  /** Unidades vendidas no período do filtro. */
  qty: number;
}

export type Urgency = "critical" | "warning" | "ok";

/**
 * Quão grave é a falta, medida contra o MÍNIMO do modelo.
 *
 * Era medida em dias de estoque (`daysLeft`), uma razão entre o estoque e o
 * giro — e razão ignora tamanho: o modelo que vendeu uma unidade no mês e zerou
 * dava zero dia e pintava de vermelho na frente do que move duas por dia. Aqui
 * a régua é a política que o dono escreveu: quanto ele quer ter na prateleira.
 *
 * Sem mínimo definido não há gravidade a medir — devolve `ok`, e esse modelo
 * nem chega a entrar na lista.
 */
export function urgencyOf(stock: number, minUnits: number): Urgency {
  if (minUnits <= 0) return "ok";
  if (stock >= minUnits) return "ok";
  return stock <= minUnits * CRITICAL_MIN_RATIO ? "critical" : "warning";
}

const modelKey = (p: { brand: string; model: string }) => `${p.brand}|${p.model}`;

/**
 * Chave para casar a COMPRA com o modelo. Normalizada (sem caixa, sem sobra de
 * espaço) porque marca e modelo do item de compra são texto digitado em outra
 * tela: casando por igualdade exata, "elfbar" não encontraria "Elfbar" e a linha
 * pediria de novo uma compra que já está a caminho. Mesmo cuidado que o
 * `set_model_image` toma no banco.
 */
const joinKey = (brand: string, model: string) =>
  `${brand.trim().toLowerCase()}|${model.trim().toLowerCase()}`;

const daysBetween = (a: Date, b: Date) => (a.getTime() - b.getTime()) / 86_400_000;

function parse(dateISO: string): Date | null {
  const d = new Date(dateISO);
  return isNaN(d.getTime()) ? null : d;
}

export interface ComputeModelStatsInput {
  products: Product[];
  /** Histórico completo — usado para giro e para "parado há X dias". */
  sales: Sale[];
  /** Vendas do período selecionado no filtro — usado para receita/quantidade. */
  periodSales: Sale[];
  /**
   * Compras já pedidas. As que ainda não foram recebidas abatem o pedido
   * sugerido: o que já foi decidido não precisa de decisão de novo.
   */
  purchaseOrders?: PurchaseOrder[];
  now?: Date;
  velocityWindowDays?: number;
}

/**
 * Agrega produtos e vendas por modelo. Retorna ordenado por urgência
 * (menos dias de estoque primeiro); modelos sem giro vão para o fim.
 */
export function computeModelStats({
  products,
  sales,
  periodSales,
  purchaseOrders = [],
  now = new Date(),
  velocityWindowDays = VELOCITY_WINDOW_DAYS,
}: ComputeModelStatsInput): ModelStat[] {
  const productModel = new Map<string, string>();
  const groups = new Map<string, {
    brand: string; model: string;
    stock: number; minUnits: number; costWeighted: number; marginWeighted: number;
    costSum: number; marginSum: number; priced: number;
    windowQty: number; saleDayKeys: Set<string>; lastSale: number | null;
    revenue: number; qty: number;
  }>();

  /**
   * Unidades a caminho, por modelo. A compra é CENTRAL (purchase_orders não tem
   * filial — a divisão acontece no recebimento), então em modo de uma filial
   * estas são as unidades da REDE. Ainda assim abatem: o que elas respondem é
   * "já foi comprado?", e essa resposta não muda de cidade para cidade.
   */
  const incomingByModel = new Map<string, number>();
  for (const order of purchaseOrders) {
    if (order.status !== "pending") continue;
    for (const item of order.items) {
      const k = joinKey(item.brand, item.model);
      incomingByModel.set(k, (incomingByModel.get(k) || 0) + item.expectedQuantity);
    }
  }

  for (const p of products) {
    const key = modelKey(p);
    productModel.set(p.id, key);
    const g = groups.get(key) ?? {
      brand: p.brand, model: p.model,
      stock: 0, minUnits: 0, costWeighted: 0, marginWeighted: 0,
      costSum: 0, marginSum: 0, priced: 0,
      windowQty: 0, saleDayKeys: new Set<string>(), lastSale: null,
      revenue: 0, qty: 0,
    };
    const cost = p.purchasePrice || 0;
    const margin = p.salePrice > 0 ? ((p.salePrice - cost) / p.salePrice) * 100 : 0;
    g.stock += p.stock;
    // MAIOR, não soma — ver o comentário de `minUnits` em ModelStat.
    g.minUnits = Math.max(g.minUnits, p.minStock ?? 0);
    g.costWeighted += cost * p.stock;
    g.marginWeighted += margin * p.stock;
    // Fallback para quando o modelo inteiro está zerado: média simples dos sabores.
    g.costSum += cost;
    if (p.salePrice > 0) { g.marginSum += margin; g.priced += 1; }
    groups.set(key, g);
  }

  const windowStart = now.getTime() - velocityWindowDays * 86_400_000;

  for (const s of sales) {
    if (s.type !== "venda") continue;
    const key = productModel.get(s.productId);
    if (!key) continue;
    const g = groups.get(key);
    if (!g) continue;
    const d = parse(s.date);
    if (!d) continue;
    const t = d.getTime();
    if (t > now.getTime()) continue; // venda com data futura não conta como giro
    if (t >= windowStart) {
      g.windowQty += s.quantity;
      g.saleDayKeys.add(d.toISOString().slice(0, 10));
    }
    if (g.lastSale === null || t > g.lastSale) g.lastSale = t;
  }

  for (const s of periodSales) {
    if (s.type !== "venda") continue;
    const key = productModel.get(s.productId);
    if (!key) continue;
    const g = groups.get(key);
    if (!g) continue;
    g.revenue += s.totalPrice;
    g.qty += s.quantity;
  }

  const flavorCount = new Map<string, number>();
  for (const p of products) flavorCount.set(modelKey(p), (flavorCount.get(modelKey(p)) || 0) + 1);

  const stats: ModelStat[] = [];
  for (const [key, g] of groups) {
    const flavors = flavorCount.get(key) || 1;
    const unitCost = g.stock > 0 ? g.costWeighted / g.stock : g.costSum / flavors;
    const marginPct = g.stock > 0
      ? g.marginWeighted / g.stock
      : (g.priced > 0 ? g.marginSum / g.priced : 0);
    const perDay = g.windowQty / velocityWindowDays;
    const daysLeft = perDay > 0 ? g.stock / perDay : Infinity;
    /**
     * O que falta para alcançar o MÍNIMO do modelo.
     *
     * Era uma projeção de giro — `perDay × 30 dias − estoque` —, que respondia
     * "quanto preciso para aguentar um mês no ritmo atual". Agora responde
     * "quanto falta para o estoque voltar ao que o dono decidiu manter na
     * prateleira", que é uma regra e não uma previsão: não depende de a janela
     * de 30 dias ter sido típica, e vale igual para o modelo que vende devagar
     * e precisa estar lá mesmo assim.
     *
     * Sem mínimo definido a conta não existe, e o modelo fica de fora da lista.
     */
    const needUnits = g.minUnits > 0 ? Math.max(0, g.minUnits - g.stock) : 0;
    const incoming = incomingByModel.get(joinKey(g.brand, g.model)) || 0;
    // O que ainda precisa ser PEDIDO — o que já está a caminho sai da conta:
    // o card lista o que precisa de decisão HOJE, e pedido feito não é decisão.
    const restockUnits = Math.max(0, needUnits - incoming);

    stats.push({
      key,
      brand: g.brand,
      model: g.model,
      stock: g.stock,
      minUnits: g.minUnits,
      unitCost,
      stockValue: g.stock * unitCost,
      perDay,
      saleDays: g.saleDayKeys.size,
      daysLeft,
      marginPct,
      incoming,
      needUnits,
      restockUnits,
      restockCost: restockUnits * unitCost,
      daysSinceLastSale: g.lastSale === null ? Infinity : Math.max(0, daysBetween(now, new Date(g.lastSale))),
      revenue: g.revenue,
      qty: g.qty,
    });
  }

  return stats.sort((a, b) => a.daysLeft - b.daysLeft || b.revenue - a.revenue);
}

export interface RestockSummary {
  /**
   * O que precisa de decisão HOJE: demanda recorrente, ainda sem compra que a
   * cubra. Do maior pedido para o menor.
   */
  urgent: ModelStat[];
  /** Total de modelos cadastrados (o "de N" do rótulo). */
  totalModels: number;
  /** Unidades a pedir somando os urgentes. */
  horizonUnits: number;
  /** Custo estimado dessas unidades. */
  horizonCost: number;
  /** Precisaria de pedido, mas a compra em aberto já cobre. */
  orderedCount: number;
  /** Unidades a caminho desses modelos. */
  orderedUnits: number;
  /** Modelos com estoque parado há mais de `staleDays`. */
  staleCount: number;
  /** Quanto esse estoque parado vale a custo. */
  staleValue: number;
}

/**
 * Reparte quem está abaixo do mínimo em dois destinos: a lista e o balde do que
 * já foi comprado.
 *
 * A ordem da lista é pelo TAMANHO DO PEDIDO. `daysLeft` é uma razão, e razão
 * ignora tamanho: o modelo que vendeu uma unidade no mês e zerou dá zero dia e
 * ficava em primeiro lugar, na frente do que move duas por dia.
 *
 * NÃO HÁ MAIS FILTRO DE DEMANDA RECORRENTE. Ele existia porque a conta antiga
 * era uma PROJEÇÃO: doze unidades numa venda só e doze em dez dias davam o
 * mesmo `perDay`, e projetar a primeira por 30 dias era comprar para um cliente
 * que não ia voltar. O mínimo não projeta nada — é a decisão do dono sobre o
 * que quer ter na prateleira, e ela vale igual para o modelo que sai devagar.
 * Descartar a linha por causa do padrão de venda seria o card discordando da
 * política que o próprio dono escreveu.
 *
 * Modelo SEM mínimo não aparece em lugar nenhum daqui: `needUnits` nasce zero
 * para ele, então ele não é "needy". Consequência assumida — um modelo que
 * vende bem e nunca teve mínimo configurado fica invisível para este card.
 */
export function summarizeRestock(
  stats: ModelStat[],
  { staleDays = STALE_DAYS } = {},
): RestockSummary {
  // `needUnits > 0` já diz "tem mínimo e está abaixo dele" — é como ele é
  // calculado.
  const needy = stats.filter(s => s.needUnits > 0);
  const ordered = needy.filter(s => s.restockUnits === 0);
  const urgent = needy
    .filter(s => s.restockUnits > 0)
    .sort((a, b) => b.restockUnits - a.restockUnits || b.revenue - a.revenue);
  const stale = stats.filter(s => s.stock > 0 && s.daysSinceLastSale > staleDays);

  return {
    urgent,
    totalModels: stats.length,
    horizonUnits: urgent.reduce((sum, s) => sum + s.restockUnits, 0),
    horizonCost: urgent.reduce((sum, s) => sum + s.restockCost, 0),
    orderedCount: ordered.length,
    orderedUnits: ordered.reduce((sum, s) => sum + s.incoming, 0),
    staleCount: stale.length,
    staleValue: stale.reduce((sum, s) => sum + s.stockValue, 0),
  };
}
