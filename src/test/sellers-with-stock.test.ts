import { describe, it, expect } from "vitest";
import { sellersWithAssignedStock, type AssignmentLike } from "@/lib/sellers-with-stock";

const seller = (id: string, name = id) => ({ id, name });

const ana = seller("ana");
const bruno = seller("bruno");
const carla = seller("carla");
const todos = [ana, bruno, carla];

const atribuir = (sellerId: string, quantity: number): AssignmentLike => ({ sellerId, quantity });

describe("sellersWithAssignedStock", () => {
  it("devolve só quem tem unidade atribuída", () => {
    const out = sellersWithAssignedStock(todos, [atribuir("ana", 3), atribuir("carla", 1)]);
    expect(out.map(s => s.id)).toEqual(["ana", "carla"]);
  });

  it("preserva a ordem da lista original", () => {
    const out = sellersWithAssignedStock(todos, [atribuir("carla", 2), atribuir("ana", 2)]);
    expect(out.map(s => s.id)).toEqual(["ana", "carla"]);
  });

  it("basta UM sabor com saldo para o vendedor entrar", () => {
    const out = sellersWithAssignedStock(todos, [atribuir("bruno", 0), atribuir("bruno", 5)]);
    expect(out.map(s => s.id)).toEqual(["bruno"]);
  });

  it("caixa zerada não entra", () => {
    const out = sellersWithAssignedStock(todos, [atribuir("ana", 0)]);
    expect(out).toEqual([]);
  });

  it("quantidade negativa não é estoque vendável", () => {
    // Existe: linha anterior ao gatilho validate_assignment_fits_stock.
    const out = sellersWithAssignedStock(todos, [atribuir("ana", -2)]);
    expect(out).toEqual([]);
  });

  it("sem atribuição nenhuma, ninguém aparece", () => {
    expect(sellersWithAssignedStock(todos, [])).toEqual([]);
  });

  it("o vendedor já escolhido entra mesmo de caixa vazia", () => {
    // É o caso da edição de uma venda antiga: o formulário tem que dizer o que
    // está gravado, não só o que ainda é escolhível.
    const out = sellersWithAssignedStock(todos, [atribuir("ana", 4)], "bruno");
    expect(out.map(s => s.id)).toEqual(["ana", "bruno"]);
  });

  it("o vendedor já escolhido não aparece duas vezes quando tem estoque", () => {
    const out = sellersWithAssignedStock(todos, [atribuir("ana", 4)], "ana");
    expect(out.map(s => s.id)).toEqual(["ana"]);
  });

  it("keepSellerId vazio ou nulo não guarda ninguém", () => {
    expect(sellersWithAssignedStock(todos, [], "")).toEqual([]);
    expect(sellersWithAssignedStock(todos, [], null)).toEqual([]);
    expect(sellersWithAssignedStock(todos, [], undefined)).toEqual([]);
  });

  it("keepSellerId de quem não está na lista não inventa vendedor", () => {
    // Vendedor de outra filial: `sellers` já vem recortado, e a atribuição
    // dele não pode fazê-lo reaparecer aqui.
    const out = sellersWithAssignedStock(todos, [atribuir("ana", 1)], "diego");
    expect(out.map(s => s.id)).toEqual(["ana"]);
  });

  it("atribuição de vendedor fora da lista é ignorada", () => {
    const out = sellersWithAssignedStock(todos, [atribuir("diego", 9)]);
    expect(out).toEqual([]);
  });
});
