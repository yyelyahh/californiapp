import type { Sale } from "@/types";

/**
 * Peças da tela do vendedor (/minhas-vendas) que são conta, não desenho —
 * aqui para o teste alcançar sem montar a página.
 */

/* ------------------------------------------------------------------ */
/* Venda em aberto, agrupada por pedido                                 */
/* ------------------------------------------------------------------ */

/**
 * O `confirm_order` grava a nota como "<obs> · Pedido via catálogo #<uuid>" (ou
 * só a parte do pedido, sem observação). É o único elo entre a venda e o pedido
 * que o vendedor enxerga sem outra consulta, e é por ele que as vendas de um
 * mesmo pedido (uma por sabor) viram UMA linha de "A receber": o cliente paga
 * o pedido, não o sabor.
 */
const ORDER_NOTE = /^(?:(.*?) · )?Pedido via catálogo #([0-9a-f-]{36})/i;

export function parseOrderNote(notes: string | undefined | null): { orderId: string | null; note: string | null } {
  const match = ORDER_NOTE.exec((notes ?? "").trim());
  if (!match) return { orderId: null, note: notes?.trim() || null };
  return { orderId: match[2].toLowerCase(), note: match[1]?.trim() || null };
}

export const saleOpenAmount = (s: Sale) => Math.max(0, s.totalPrice - (s.paidAmount || 0));

export type OpenSaleGroup = {
  /** O pedido, ou a própria venda quando ela não veio de pedido. */
  key: string;
  orderId: string | null;
  sales: Sale[];
  open: number;
  units: number;
  /** A venda mais recente do grupo (é a data do pedido). */
  date: string;
  note: string | null;
};

/**
 * O que o cliente ainda não pagou, de TODOS os meses desde `since`: venda em
 * aberto não some na virada do mês, e é justamente ela que falta marcar.
 * Retirada não entra (não tem cliente). Mais antigo primeiro — é o que está há
 * mais tempo esperando o dinheiro.
 */
export function groupOpenSales(sales: Sale[], sellerId: string | null | undefined, since: Date): OpenSaleGroup[] {
  if (!sellerId) return [];
  const sinceTs = since.getTime();
  const groups = new Map<string, OpenSaleGroup>();
  for (const s of sales) {
    if (s.sellerId !== sellerId || (s.type || "venda") !== "venda") continue;
    if (saleOpenAmount(s) <= 0.01) continue;
    const ts = new Date(s.date).getTime();
    if (isNaN(ts) || ts < sinceTs) continue;
    const { orderId, note } = parseOrderNote(s.notes);
    const key = orderId ?? `sale:${s.id}`;
    const g = groups.get(key) ?? { key, orderId, sales: [], open: 0, units: 0, date: s.date, note };
    g.sales.push(s);
    g.open += saleOpenAmount(s);
    g.units += s.quantity;
    if (new Date(s.date).getTime() > new Date(g.date).getTime()) g.date = s.date;
    g.note = g.note ?? note;
    groups.set(key, g);
  }
  return Array.from(groups.values()).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

/* ------------------------------------------------------------------ */
/* Linhas do pedido: de onde vem o desconto                             */
/* ------------------------------------------------------------------ */

export type OrderLineTag = "premio" | "combo" | "desconto" | null;

type LineLike = {
  id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  products: { brand: string; model?: string | null } | null;
};

/**
 * Por que uma linha do pedido saiu mais barata. O pedido não grava a regra,
 * então isto é LEITURA do que o `create_pending_order` faz, sem inventar:
 *
 * - O prêmio da fidelidade é linha própria do mesmo produto (order_items
 *   aceita duas linhas iguais de propósito): a mais barata das repetidas é o
 *   prêmio. Linha única pela metade do preço (arredondada para cima) também é.
 * - Com 2+ unidades do mesmo modelo no pedido, o que ficou abaixo do preço é o
 *   combo.
 * - Abaixo do preço sem nenhum dos dois motivos visíveis: "desconto", sem nome
 *   — melhor que chutar a regra errada na frente do cliente.
 *
 * `basePrice` é o preço de venda da filial; sem ele (0/indefinido) só a regra
 * da linha repetida vale.
 */
export function tagOrderLines(
  items: LineLike[],
  basePrice: (productId: string) => number | undefined,
  comboMinUnits = 2,
): Map<string, OrderLineTag> {
  const tags = new Map<string, OrderLineTag>();
  const modelOf = (i: LineLike) => `${i.products?.brand ?? ""}|${i.products?.model ?? ""}`.toLowerCase();
  const unitsByModel = new Map<string, number>();
  for (const i of items) unitsByModel.set(modelOf(i), (unitsByModel.get(modelOf(i)) ?? 0) + i.quantity);

  for (const i of items) {
    const twins = items.filter(o => o.product_id === i.product_id);
    const cheapestTwin = twins.length > 1 && twins.every(o => o === i || o.unit_price > i.unit_price + 0.009);
    if (cheapestTwin) {
      tags.set(i.id, "premio");
      continue;
    }
    const base = basePrice(i.product_id) ?? 0;
    if (!(base > 0) || i.unit_price >= base - 0.009) {
      tags.set(i.id, null);
      continue;
    }
    if (Math.abs(i.unit_price - Math.ceil(base / 2)) < 0.009 && i.quantity === 1) tags.set(i.id, "premio");
    else if ((unitsByModel.get(modelOf(i)) ?? 0) >= comboMinUnits) tags.set(i.id, "combo");
    else tags.set(i.id, "desconto");
  }
  return tags;
}

/* ------------------------------------------------------------------ */
/* WhatsApp do cliente                                                  */
/* ------------------------------------------------------------------ */

/**
 * `wa.me` quer só dígitos, com o DDI. O telefone chega como o cliente digitou
 * no checkout — com ou sem 55, com máscara. 10–11 dígitos é número brasileiro
 * sem DDI; o resto passa como está. Sem dígito suficiente, sem link.
 *
 * `text` abre a conversa com a mensagem já escrita (o vendedor ainda edita
 * antes de mandar): avisar da recusa, do pedido vencido, cobrar.
 */
export function whatsappLink(phone: string | null | undefined, text?: string): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length < 10) return null;
  const full = digits.length <= 11 ? `55${digits}` : digits;
  return `https://wa.me/${full}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}

/** "Maria Eduarda Fagundes" → "Maria". Para a mensagem, não para a tela. */
export const firstName = (name: string | null | undefined) => (name ?? "").trim().split(/\s+/)[0] || "";

/* ------------------------------------------------------------------ */
/* Linhas de um grupo, sem repetir o produto                            */
/* ------------------------------------------------------------------ */

/**
 * O prêmio da fidelidade é uma venda à parte do MESMO produto (linha própria
 * no pedido), e listar as duas lado a lado lia como erro de digitação:
 * "2× Pink Lemonade, Pink Lemonade". Aqui elas somam; a ordem é a da primeira
 * aparição.
 */
export function mergeSaleLines(sales: { productId: string; quantity: number }[]) {
  const byProduct = new Map<string, { productId: string; quantity: number }>();
  for (const s of sales) {
    const line = byProduct.get(s.productId);
    if (line) line.quantity += s.quantity;
    else byProduct.set(s.productId, { productId: s.productId, quantity: s.quantity });
  }
  return Array.from(byProduct.values());
}

/* ------------------------------------------------------------------ */
/* Quanto vale chegar na próxima faixa                                  */
/* ------------------------------------------------------------------ */

/**
 * A faixa é do MÊS inteiro (`computeClosedCommission` aplica a taxa sobre toda
 * a receita paga do mês), então subir de faixa não vale só a comissão da
 * próxima venda: reprecifica tudo o que já foi pago. É isso que a tela precisa
 * dizer — "falta 1 unidade" sem o valor não explica por que correr atrás dela.
 *
 * `paidRevenue` é a receita das vendas QUITADAS do mês, o mesmo recorte da
 * comissão. Não inclui a comissão da própria unidade que falta (o preço dela
 * não se sabe antes da venda).
 */
export function tierUpgradeGain(paidRevenue: number, current: { rate: number }, next: { rate: number } | null) {
  if (!next || !(paidRevenue > 0)) return 0;
  return Math.round(paidRevenue * (next.rate - current.rate) * 100) / 100;
}

/* ------------------------------------------------------------------ */
/* A escada de faixas, escrita                                          */
/* ------------------------------------------------------------------ */

/**
 * "10% até 10 un. · 12,5% de 11 a 15 · 15% a partir de 16", montada das
 * próprias faixas — o número na tela não pode ser um segundo número escrito à
 * mão, que um dia diverge do que a comissão calcula.
 */
export function tierLadder(tiers: { label: string; min: number; max: number | null }[]) {
  return tiers
    .map(t =>
      t.max === null
        ? `${t.label} a partir de ${t.min}`
        : t.min === 0
          ? `${t.label} até ${t.max} un.`
          : `${t.label} de ${t.min} a ${t.max}`,
    )
    .join(" · ");
}
