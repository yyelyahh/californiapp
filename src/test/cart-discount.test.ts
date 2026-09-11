import { describe, it, expect } from "vitest";
import { previewCartDiscount, modelKey, type DiscountableItem } from "@/lib/cart-discount";

/**
 * Duas regras, e o encontro das duas.
 *
 * FIDELIDADE: a cada 6 unidades acumuladas pelo cliente, uma sai por metade do
 * preço — e nunca por valor igual ou abaixo do custo, caso em que ela sai por
 * custo + 15%. COMBO: 2 ou mais unidades do mesmo modelo (sabores misturados)
 * saem R$ 7 mais baratas cada. Os preços já chegam prontos do banco
 * (`loyalty_price`, `combo_price`); o que se testa aqui é QUANTAS unidades
 * ganham, QUAIS delas e o que acontece quando as duas regras caem na mesma.
 */

const CICLO = 6;

/** `loyalty_price` a 50% por padrão, como um produto de margem folgada. */
const item = (
  id: string,
  price: number,
  quantity: number,
  extra: Partial<DiscountableItem> = {},
): DiscountableItem => ({
  product_id: id,
  sale_price: price,
  loyalty_price: price / 2,
  quantity,
  ...extra,
});

/** Só fidelidade: sem `comboMinUnits`, o combo não existe para esta conta. */
const fid = (historyUnits: number) => ({ loyalty: { historyUnits, cycleUnits: CICLO } });
/** Só combo. */
const COMBO = { comboMinUnits: 2 };

describe("fidelidade — a sexta unidade", () => {
  it("sem cadastro encontrado não prevê desconto nenhum", () => {
    const out = previewCartDiscount([item("a", 100, 6)], {});
    expect(out.total).toBe(600);
    expect(out.discountUnits).toBe(0);
  });

  it("cinco unidades na primeira compra ainda não fecham o ciclo", () => {
    const out = previewCartDiscount([item("a", 100, 5)], fid(0));
    expect(out.discountUnits).toBe(0);
    expect(out.total).toBe(500);
  });

  it("a sexta unidade da primeira compra sai pela metade", () => {
    const out = previewCartDiscount([item("a", 100, 6)], fid(0));
    expect(out.loyaltyUnits).toBe(1);
    expect(out.discountTotal).toBe(50);
    expect(out.total).toBe(550);
  });

  it("o histórico conta junto com o carrinho", () => {
    // 4 já compradas + 2 no carrinho = a sexta acontece agora
    const out = previewCartDiscount([item("a", 100, 2)], fid(4));
    expect(out.discountUnits).toBe(1);
    expect(out.total).toBe(150);
  });

  it("quem já está em 5 leva desconto na próxima unidade", () => {
    const out = previewCartDiscount([item("a", 100, 1)], fid(5));
    expect(out.discountUnits).toBe(1);
    expect(out.total).toBe(50);
  });

  it("o ciclo repete: doze unidades de uma vez premiam duas", () => {
    const out = previewCartDiscount([item("a", 100, 12)], fid(0));
    expect(out.discountUnits).toBe(2);
    expect(out.discountTotal).toBe(100);
  });

  it("quem acabou de fechar um ciclo recomeça do zero", () => {
    // 6 no histórico: a próxima premiada é a 12ª, então 5 no carrinho não dão nada
    expect(previewCartDiscount([item("a", 100, 5)], fid(6)).discountUnits).toBe(0);
    expect(previewCartDiscount([item("a", 100, 6)], fid(6)).discountUnits).toBe(1);
  });

  it("o desconto cai na unidade mais barata do carrinho", () => {
    const out = previewCartDiscount([item("caro", 200, 3), item("barato", 60, 3)], fid(0));
    expect(out.discountUnits).toBe(1);
    // 30 (metade de 60), não 100 (metade de 200)
    expect(out.discountTotal).toBe(30);
  });

  it("preço empatado desempata por product_id, como o banco", () => {
    const out = previewCartDiscount([item("zz", 100, 3), item("aa", 100, 3)], fid(0));
    expect(out.discountUnits).toBe(1);
    expect(out.discountTotal).toBe(50);
  });

  it("dois prêmios cabem no mesmo item quando ele tem quantidade", () => {
    const out = previewCartDiscount([item("barato", 50, 10), item("caro", 300, 2)], fid(0));
    expect(out.discountUnits).toBe(2);
    expect(out.discountTotal).toBe(50); // 25 + 25
  });

  it("prêmio transborda para o próximo item quando o primeiro acaba", () => {
    const out = previewCartDiscount([item("barato", 50, 1), item("caro", 300, 11)], fid(0));
    expect(out.discountUnits).toBe(2);
    expect(out.discountTotal).toBe(25 + 150);
  });

  it("margem curta não gasta o prêmio: ele passa para o próximo item", () => {
    // O piso (custo + 15%) encostou no preço cheio: não há desconto a dar ali.
    const semMargem = item("piso", 50, 1, { loyalty_price: 50 });
    const out = previewCartDiscount([semMargem, item("outro", 80, 5)], fid(0));
    expect(out.discountUnits).toBe(1);
    expect(out.discountTotal).toBe(40); // metade de 80, não zero
  });

  it("carrinho inteiro sem margem devolve pedido sem desconto", () => {
    const out = previewCartDiscount([item("piso", 50, 6, { loyalty_price: 50 })], fid(0));
    expect(out.discountUnits).toBe(0);
    expect(out.total).toBe(out.fullTotal);
  });

  it("carrinho vazio e ciclo ausente não quebram", () => {
    const vazio = previewCartDiscount([], fid(5));
    expect(vazio.total).toBe(0);
    expect(vazio.discountUnits).toBe(0);
    expect(
      previewCartDiscount([item("a", 100, 6)], { loyalty: { historyUnits: 0, cycleUnits: 0 } })
        .discountUnits,
    ).toBe(0);
  });

  it("não reordena o carrinho original", () => {
    const cart = [item("caro", 200, 1), item("barato", 60, 6)];
    previewCartDiscount(cart, fid(0));
    expect(cart.map(i => i.product_id)).toEqual(["caro", "barato"]);
  });
});

describe("combo de modelo", () => {
  const v155 = (id: string, qty: number, extra: Partial<DiscountableItem> = {}) =>
    item(id, 45, qty, { brand: "Ignite", model: "V155", combo_price: 38, ...extra });

  it("uma unidade sozinha não liga o combo", () => {
    const out = previewCartDiscount([v155("menta", 1)], COMBO);
    expect(out.comboUnits).toBe(0);
    expect(out.total).toBe(45);
  });

  it("duas unidades do mesmo modelo, mesmo em sabores diferentes, ligam o combo", () => {
    const out = previewCartDiscount([v155("menta", 1), v155("uva", 1)], COMBO);
    expect(out.comboUnits).toBe(2);
    expect(out.comboTotal).toBe(14);
    expect(out.total).toBe(76);
  });

  it("duas unidades do MESMO sabor também ligam", () => {
    const out = previewCartDiscount([v155("menta", 2)], COMBO);
    expect(out.comboUnits).toBe(2);
    expect(out.total).toBe(76);
  });

  it("modelos diferentes contam separado", () => {
    const iceking = item("ice", 60, 1, { brand: "Ignite", model: "ICEKING", combo_price: 53 });
    const out = previewCartDiscount([v155("menta", 1), iceking], COMBO);
    // Um de cada: nenhum dos dois modelos chega a 2 unidades.
    expect(out.comboUnits).toBe(0);
    expect(out.total).toBe(105);
  });

  it("a chave do modelo ignora caixa e espaço, como o banco", () => {
    const a = v155("menta", 1, { brand: " ignite ", model: "v155" });
    const b = v155("uva", 1, { brand: "Ignite", model: " V155" });
    expect(modelKey(a)).toBe(modelKey(b));
    expect(previewCartDiscount([a, b], COMBO).comboUnits).toBe(2);
  });

  it("produto sem marca e sem modelo não faz combo com outro igualmente sem modelo", () => {
    const a = item("a", 45, 1, { combo_price: 38 });
    const b = item("b", 45, 1, { combo_price: 38 });
    expect(previewCartDiscount([a, b], COMBO).comboUnits).toBe(0);
    // Mas duas unidades DELE mesmo continuam sendo combo.
    expect(previewCartDiscount([item("a", 45, 2, { combo_price: 38 })], COMBO).comboUnits).toBe(2);
  });

  it("margem curta: preço de combo encostado no cheio não vira desconto", () => {
    const out = previewCartDiscount([v155("menta", 2, { combo_price: 45 })], COMBO);
    expect(out.comboUnits).toBe(0);
    expect(out.total).toBe(90);
  });

  it("catálogo velho em cache, sem combo_price, não inventa desconto", () => {
    const out = previewCartDiscount([v155("menta", 2, { combo_price: undefined })], COMBO);
    expect(out.comboUnits).toBe(0);
    expect(out.total).toBe(90);
  });

  it("sem regra de combo carregada, nada acontece", () => {
    expect(previewCartDiscount([v155("menta", 4)], {}).comboUnits).toBe(0);
  });
});

describe("combo e fidelidade no mesmo pedido", () => {
  const v155 = (id: string, qty: number, extra: Partial<DiscountableItem> = {}) =>
    item(id, 45, qty, {
      brand: "Ignite",
      model: "V155",
      combo_price: 38,
      loyalty_price: 23,
      ...extra,
    });

  it("a unidade premiada não acumula: sai pelo melhor dos dois, e o resto fica no combo", () => {
    // 6 unidades: 1 premiada a 23 (metade, melhor que o combo) e 5 a 38.
    const out = previewCartDiscount([v155("menta", 6)], { ...COMBO, ...fid(0) });
    expect(out.loyaltyUnits).toBe(1);
    expect(out.comboUnits).toBe(5);
    expect(out.total).toBe(23 + 5 * 38);
    // O desconto da premiada é contado a partir do preço CHEIO, não do combo.
    expect(out.loyaltyTotal).toBe(45 - 23);
    expect(out.comboTotal).toBe(5 * 7);
    expect(out.discountTotal).toBe(out.fullTotal - out.total);
  });

  it("prêmio que não bate o preço do combo não é gasto e passa adiante", () => {
    // Neste produto o piso deixou o prêmio em 40, pior que o combo (38).
    const caro = v155("caro", 2, { loyalty_price: 40 });
    const barato = item("barato", 20, 4, { brand: "Elf", model: "Pod", loyalty_price: 10 });
    const out = previewCartDiscount([caro, barato], { ...COMBO, ...fid(0) });
    // A premiada foi para o barato (10), não para o caro.
    expect(out.loyaltyUnits).toBe(1);
    expect(out.loyaltyTotal).toBe(20 - 10);
    expect(out.comboUnits).toBe(2); // só o modelo com 2 unidades
  });

  it("a fila do prêmio segue o preço JÁ com combo", () => {
    // Sem combo o "caro" (30) estaria atrás do "barato" (28). Com o combo do
    // seu modelo ele cai para 23 e passa a ser a unidade mais barata do pedido.
    const caro = item("caro", 30, 2, {
      brand: "Ignite",
      model: "V155",
      combo_price: 23,
      loyalty_price: 15,
    });
    const barato = item("barato", 28, 1, {
      brand: "Elf",
      model: "Pod",
      combo_price: 21,
      loyalty_price: 14,
    });
    // 3 no histórico + 3 no carrinho = a sexta unidade acontece aqui.
    const out = previewCartDiscount([caro, barato], { ...COMBO, ...fid(3) });
    expect(out.loyaltyUnits).toBe(1);
    expect(out.loyaltyTotal).toBe(30 - 15); // premiou o "caro"
  });

  it("os dois descontos somados batem com o total", () => {
    const out = previewCartDiscount(
      [v155("menta", 3), item("outro", 90, 4, { brand: "Elf", model: "Pod", combo_price: 83 })],
      { ...COMBO, ...fid(5) },
    );
    expect(out.comboTotal + out.loyaltyTotal).toBe(out.discountTotal);
    expect(out.total).toBe(out.fullTotal - out.discountTotal);
    expect(out.discountUnits).toBe(out.comboUnits + out.loyaltyUnits);
  });
});
