import { describe, it, expect } from "vitest";
import { pickBranch } from "@/context/BranchContext";

/**
 * A escolha da filial ao abrir o app.
 *
 * É o único ponto da camada de filial que falha em SILÊNCIO se estiver errado:
 * com um id inválido em pé, todas as consultas do `StoreContext` filtram por
 * uma cidade que a pessoa não alcança, e a tela aparece vazia — o que se lê
 * como "sumiu tudo", não como "sem acesso". Por isso a regra saiu de dentro do
 * efeito e virou função pura.
 */

const A = { id: "b-a" };
const B = { id: "b-b" };
const LIST = [A, B];

describe("pickBranch", () => {
  it("sem escolha guardada, abre na primeira filial", () => {
    // Primeira = a mais antiga (a consulta ordena por created_at), que é a
    // matriz. Nunca "Todas": quem abre o app quer poder lançar.
    expect(pickBranch(undefined, LIST, true)).toBe("b-a");
  });

  it("respeita a filial guardada quando ela ainda está na lista", () => {
    expect(pickBranch("b-b", LIST, true)).toBe("b-b");
  });

  it("cai na primeira filial quando o id guardado saiu da lista", () => {
    // Acesso revogado ou filial desativada. Ficar no id antigo deixaria toda
    // consulta filtrando por uma cidade inalcançável.
    expect(pickBranch("b-sumida", LIST, true)).toBe("b-a");
  });

  it("guarda 'Todas' só para quem pode ver todas", () => {
    expect(pickBranch(null, LIST, true)).toBeNull();
  });

  it("derruba 'Todas' para quem não pode mais ver todas", () => {
    // O sócio que abre o navegador onde o dono trabalhou: a chave guardada diz
    // "Todas", e ele não tem esse direito. Cai na cidade dele.
    expect(pickBranch(null, [B], false)).toBe("b-b");
  });

  it("devolve null quando não há filial nenhuma", () => {
    // Pessoa sem linha em user_branches: a falha é alta e barulhenta de
    // propósito — sem filial, nada de escrita, e a tela diz isso.
    expect(pickBranch("b-a", [], false)).toBeNull();
  });
});
