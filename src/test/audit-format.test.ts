import { describe, it, expect } from "vitest";
import { formatCurrency } from "@/lib/currency";
import {
  actorLabel,
  describe as describeMovement,
  entityInfo,
  formatValue,
  groupMovements,
  summarize,
  visibleFields,
  type AuditRow,
} from "@/lib/audit-format";

/**
 * O que se testa aqui é a leitura do log, não o log.
 *
 * A regra que sustenta a tela inteira é uma só: escritas com o mesmo `tx` são
 * UM movimento, e dentro dele uma linha é o assunto e as outras são
 * consequência. Se isso quebrar, uma venda passa a aparecer duas vezes na
 * lista — uma como venda, outra como "alterou um produto" — e a tela deixa de
 * responder "quantos movimentos houve hoje", que é a pergunta dela.
 */

let seq = 0;

const row = (over: Partial<AuditRow> = {}): AuditRow => ({
  id: `r${++seq}`,
  at: "2026-09-14T18:00:00.000Z",
  tx: 1,
  actor_id: "u1",
  actor_email: "gabi@exemplo.com",
  actor_name: null,
  actor_source: "authenticated",
  action: "insert",
  entity: "sales",
  entity_id: "e1",
  changed_fields: null,
  row_data: {},
  old_data: null,
  ...over,
});

describe("agrupamento por transação", () => {
  it("junta a venda e o débito de estoque num movimento só", () => {
    const movements = groupMovements([
      row({ tx: 7, entity: "sales", action: "insert", row_data: { quantity: 3, total_price: 90 } }),
      row({ tx: 7, entity: "products", action: "update", changed_fields: ["stock"], row_data: { stock: 9 } }),
    ]);

    expect(movements).toHaveLength(1);
    expect(movements[0].entries).toHaveLength(2);
    // A venda é o assunto; o estoque é o que ela produziu.
    expect(movements[0].main.entity).toBe("sales");
  });

  it("separa transações diferentes ainda que no mesmo instante", () => {
    const movements = groupMovements([
      row({ tx: 1, entity: "expenses" }),
      row({ tx: 2, entity: "expenses" }),
    ]);
    expect(movements).toHaveLength(2);
  });

  it("na confirmação de pedido o assunto é o pedido, não as vendas que ele gerou", () => {
    const movements = groupMovements([
      row({ tx: 9, entity: "orders", action: "update", changed_fields: ["status"], row_data: { status: "confirmada" } }),
      row({ tx: 9, entity: "sales", action: "insert" }),
      row({ tx: 9, entity: "sales", action: "insert" }),
      row({ tx: 9, entity: "products", action: "update", changed_fields: ["stock"] }),
    ]);

    expect(movements[0].main.entity).toBe("orders");
    expect(movements[0].entries).toHaveLength(4);
  });

  it("edição de produto sozinha continua sendo o próprio assunto", () => {
    const movements = groupMovements([
      row({ tx: 3, entity: "products", action: "update", changed_fields: ["sale_price"] }),
    ]);
    expect(movements[0].main.entity).toBe("products");
  });

  it("preserva a ordem em que as linhas chegaram (mais novo primeiro)", () => {
    const movements = groupMovements([
      row({ tx: 20, at: "2026-09-14T18:00:00.000Z" }),
      row({ tx: 10, at: "2026-09-14T17:00:00.000Z" }),
    ]);
    expect(movements.map(m => m.tx)).toEqual([20, 10]);
  });
});

describe("a frase do movimento", () => {
  it("usa o verbo da ação e o artigo da tabela", () => {
    expect(describeMovement(row({ entity: "sales", action: "insert" })).text).toBe("registrou uma venda");
    expect(describeMovement(row({ entity: "expenses", action: "delete" })).text).toBe("excluiu uma despesa");
    expect(describeMovement(row({ entity: "products", action: "update", changed_fields: ["sale_price"] })).text)
      .toBe("alterou um produto");
  });

  it("diz confirmou / recusou em vez de 'alterou um pedido'", () => {
    const confirm = describeMovement(
      row({ entity: "orders", action: "update", changed_fields: ["status"], row_data: { status: "confirmada" } }),
    );
    const decline = describeMovement(
      row({ entity: "orders", action: "update", changed_fields: ["status"], row_data: { status: "recusada" } }),
    );
    expect(confirm.text).toBe("confirmou um pedido");
    expect(decline.text).toBe("recusou um pedido");
    expect(confirm.automatic).toBeUndefined();
  });

  it("marca a expiração como automática — ninguém decidiu isso", () => {
    const expired = describeMovement(
      row({ entity: "orders", action: "update", changed_fields: ["status"], row_data: { status: "expirada" } }),
    );
    expect(expired.automatic).toBe(true);
  });

  it("chama ajuste de estoque pelo nome quando só o estoque mudou", () => {
    expect(describeMovement(row({ entity: "products", action: "update", changed_fields: ["stock"] })).text)
      .toBe("ajustou o estoque de um produto");
    // Com outra coluna junto já não é só um ajuste de estoque.
    expect(describeMovement(row({ entity: "products", action: "update", changed_fields: ["stock", "sale_price"] })).text)
      .toBe("alterou um produto");
  });

  it("tabela fora do mapa não quebra a frase", () => {
    expect(entityInfo("tabela_nova").area).toBe("Outros");
    expect(describeMovement(row({ entity: "tabela_nova", action: "insert" })).text)
      .toBe("registrou um registro em tabela_nova");
  });
});

describe("quem fez", () => {
  it("prefere o nome do vendedor, depois a parte antes do @", () => {
    expect(actorLabel(row({ actor_name: "Rafa" }))).toBe("Rafa");
    expect(actorLabel(row({ actor_name: null, actor_email: "gabi@exemplo.com" }))).toBe("gabi");
  });

  it("o nome de exibição cadastrado vence tudo — inclusive no que já está gravado", () => {
    const names = { u1: "Gabi" };
    // A MESMA linha antiga, gravada quando não havia nome nenhum, passa a ser
    // lida com o nome novo: o rótulo se resolve na leitura, não fica copiado
    // dentro do log.
    expect(actorLabel(row({ actor_id: "u1", actor_name: null }), names)).toBe("Gabi");
    // E vence até o nome de vendedor que o gatilho copiou.
    expect(actorLabel(row({ actor_id: "u1", actor_name: "Rafa" }), names)).toBe("Gabi");
    // Quem não tem cadastro continua no e-mail.
    expect(actorLabel(row({ actor_id: "u2", actor_name: null }), names)).toBe("gabi");
  });

  it("sem usuário, diz de onde veio", () => {
    expect(actorLabel(row({ actor_id: null, actor_email: null, actor_source: "anon" }))).toBe("A loja");
    expect(actorLabel(row({ actor_id: null, actor_email: null, actor_source: "sql" })))
      .toBe("Alguém fora do painel");
  });
});

describe("valores", () => {
  it("escreve dinheiro como o resto do painel", () => {
    expect(formatValue("total_price", 90)).toBe(formatValue("amount", 90));
    expect(formatValue("sale_price", 25.5)).toContain("25,50");
  });

  it("resolve id para nome quando a tela sabe, e encurta quando não sabe", () => {
    const resolver = (field: string, id: string) => (id === "p1" ? "Elfbar · Ice King · Uva" : null);
    expect(formatValue("product_id", "p1", resolver)).toBe("Elfbar · Ice King · Uva");
    expect(formatValue("product_id", "8f3c1a2e-0000-0000-0000-000000000000", resolver)).toBe("#8f3c1a2e");
  });

  it("nulo vira travessão, não zero", () => {
    expect(formatValue("amount", null)).toBe("—");
    expect(formatValue("notes", "")).toBe("—");
  });

  it("esconde id e carimbos do banco, mostra o resto em ordem de leitura", () => {
    const fields = visibleFields({
      id: "x",
      created_at: "2026-01-01",
      total_price: 90,
      quantity: 3,
      date: "2026-09-14",
    });
    expect(fields).not.toContain("id");
    expect(fields).not.toContain("created_at");
    // A data abre o registro; o total vem depois da quantidade.
    expect(fields).toEqual(["date", "quantity", "total_price"]);
  });
});

describe("resumo da linha", () => {
  it("em alteração, lista os campos mexidos", () => {
    const [m] = groupMovements([
      row({ entity: "products", action: "update", changed_fields: ["sale_price", "stock"], row_data: {} }),
    ]);
    expect(summarize(m)).toBe("preço de venda, estoque");
  });

  it("em inclusão, descreve o que nasceu", () => {
    const [m] = groupMovements([
      row({
        entity: "sales",
        action: "insert",
        row_data: { quantity: 3, total_price: 90, product_id: "p1" },
      }),
    ]);
    // O real sai do `formatCurrency` do painel, que separa "R$" do número com
    // espaço FINO (o nbsp do Intl). Escrever o esperado à mão aqui passaria a
    // testar o teclado de quem escreveu o teste.
    expect(summarize(m, () => "Elfbar · Uva")).toBe(`3 un. · ${formatCurrency(90)} · Elfbar · Uva`);
  });
});
