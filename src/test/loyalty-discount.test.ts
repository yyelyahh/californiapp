import { describe, it, expect } from "vitest";
import { previewLoyaltyDiscount, type DiscountableItem } from "@/lib/loyalty-discount";

/**
 * Regra: a cada 6 unidades acumuladas pelo cliente, uma sai por metade do
 * preço — e nunca por valor igual ou abaixo do custo, caso em que ela sai por
 * custo + 15%. Nos dois caminhos o preço sai em reais inteiros, arredondado
 * para cima. O preço premiado já chega pronto do banco (`loyalty_price`); o que
 * se testa aqui é QUANTAS unidades ganham e QUAL delas.
 */

const CICLO = 6;

/** `loyalty_price` a 50% por padrão, como um produto de margem folgada. */
const item = (id: string, price: number, quantity: number, loyalty = price / 2): DiscountableItem => ({
  product_id: id,
  sale_price: price,
  loyalty_price: loyalty,
  quantity,
});

const pos = (historyUnits: number) => ({ historyUnits, cycleUnits: CICLO });

describe("desconto da sexta unidade", () => {
  it("sem cadastro encontrado não prevê desconto nenhum", () => {
    const out = previewLoyaltyDiscount([item("a", 100, 6)], null);
    expect(out).toEqual({ total: 600, fullTotal: 600, discountTotal: 0, discountUnits: 0 });
  });

  it("cinco unidades na primeira compra ainda não fecham o ciclo", () => {
    const out = previewLoyaltyDiscount([item("a", 100, 5)], pos(0));
    expect(out.discountUnits).toBe(0);
    expect(out.total).toBe(500);
  });

  it("a sexta unidade da primeira compra sai pela metade", () => {
    const out = previewLoyaltyDiscount([item("a", 100, 6)], pos(0));
    expect(out.discountUnits).toBe(1);
    expect(out.discountTotal).toBe(50);
    expect(out.total).toBe(550);
  });

  it("o histórico conta junto com o carrinho", () => {
    // 4 já compradas + 2 no carrinho = a sexta acontece agora
    const out = previewLoyaltyDiscount([item("a", 100, 2)], pos(4));
    expect(out.discountUnits).toBe(1);
    expect(out.total).toBe(150);
  });

  it("quem já está em 5 leva desconto na próxima unidade", () => {
    const out = previewLoyaltyDiscount([item("a", 100, 1)], pos(5));
    expect(out.discountUnits).toBe(1);
    expect(out.total).toBe(50);
  });

  it("o ciclo repete: doze unidades de uma vez premiam duas", () => {
    const out = previewLoyaltyDiscount([item("a", 100, 12)], pos(0));
    expect(out.discountUnits).toBe(2);
    expect(out.discountTotal).toBe(100);
  });

  it("quem acabou de fechar um ciclo recomeça do zero", () => {
    // 6 no histórico: a próxima premiada é a 12ª, então 5 no carrinho não dão nada
    expect(previewLoyaltyDiscount([item("a", 100, 5)], pos(6)).discountUnits).toBe(0);
    expect(previewLoyaltyDiscount([item("a", 100, 6)], pos(6)).discountUnits).toBe(1);
  });

  it("o desconto cai na unidade mais barata do carrinho", () => {
    const out = previewLoyaltyDiscount([item("caro", 200, 3), item("barato", 60, 3)], pos(0));
    expect(out.discountUnits).toBe(1);
    // 30 (metade de 60), não 100 (metade de 200)
    expect(out.discountTotal).toBe(30);
  });

  it("preço empatado desempata por product_id, como o banco", () => {
    const out = previewLoyaltyDiscount([item("zz", 100, 3), item("aa", 100, 3)], pos(0));
    expect(out.discountUnits).toBe(1);
    expect(out.discountTotal).toBe(50);
  });

  it("dois prêmios cabem no mesmo item quando ele tem quantidade", () => {
    const out = previewLoyaltyDiscount([item("barato", 50, 10), item("caro", 300, 2)], pos(0));
    expect(out.discountUnits).toBe(2);
    expect(out.discountTotal).toBe(50); // 25 + 25
  });

  it("prêmio transborda para o próximo item quando o primeiro acaba", () => {
    const out = previewLoyaltyDiscount([item("barato", 50, 1), item("caro", 300, 11)], pos(0));
    expect(out.discountUnits).toBe(2);
    expect(out.discountTotal).toBe(25 + 150);
  });

  it("margem curta não gasta o prêmio: ele passa para o próximo item", () => {
    // O piso (custo + 15%) encostou no preço cheio: não há desconto a dar ali.
    const semMargem = item("piso", 50, 1, 50);
    const out = previewLoyaltyDiscount([semMargem, item("outro", 80, 5)], pos(0));
    expect(out.discountUnits).toBe(1);
    expect(out.discountTotal).toBe(40); // metade de 80, não zero
  });

  it("carrinho inteiro sem margem devolve pedido sem desconto", () => {
    const out = previewLoyaltyDiscount([item("piso", 50, 6, 50)], pos(0));
    expect(out.discountUnits).toBe(0);
    expect(out.total).toBe(out.fullTotal);
  });

  it("carrinho vazio e ciclo ausente não quebram", () => {
    expect(previewLoyaltyDiscount([], pos(5))).toEqual({
      total: 0,
      fullTotal: 0,
      discountTotal: 0,
      discountUnits: 0,
    });
    expect(previewLoyaltyDiscount([item("a", 100, 6)], { historyUnits: 0, cycleUnits: 0 }).discountUnits).toBe(0);
  });

  it("não reordena o carrinho original", () => {
    const cart = [item("caro", 200, 1), item("barato", 60, 6)];
    previewLoyaltyDiscount(cart, pos(0));
    expect(cart.map(i => i.product_id)).toEqual(["caro", "barato"]);
  });
});
