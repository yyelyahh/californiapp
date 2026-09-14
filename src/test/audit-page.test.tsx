import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { AuditRow } from "@/lib/audit-format";

/**
 * Teste de fumaça da tela, com o banco e o contexto fora do caminho.
 *
 * Ele existe por uma razão só: garantir que o agrupamento por transação chega
 * à TELA. A lógica já está coberta em `audit-format.test.ts`, mas nada ali
 * impede alguém de, um dia, iterar as linhas cruas no JSX em vez dos
 * movimentos — e aí a venda volta a aparecer duas vezes, uma como venda e
 * outra como "alterou um produto", sem que nenhum teste de unidade reclame.
 */

const AT = new Date().toISOString();

const rows: AuditRow[] = [
  {
    id: "a1",
    at: AT,
    tx: 42,
    actor_id: "u1",
    actor_email: "gabi@exemplo.com",
    actor_name: null,
    actor_source: "authenticated",
    action: "insert",
    entity: "sales",
    entity_id: "s1",
    changed_fields: null,
    row_data: { quantity: 2, total_price: 60, product_id: "p1" },
    old_data: null,
  },
  {
    id: "a2",
    at: AT,
    tx: 42,
    actor_id: "u1",
    actor_email: "gabi@exemplo.com",
    actor_name: null,
    actor_source: "authenticated",
    action: "update",
    entity: "products",
    entity_id: "p1",
    changed_fields: ["stock"],
    row_data: { stock: 8 },
    old_data: { stock: 10 },
  },
];

vi.mock("@/hooks/useAuditLog", () => ({
  useAuditLog: () => ({
    rows,
    // Nome de exibição cadastrado para o u1: a tela deve chamá-lo assim, e não
    // pela parte antes do @ que o e-mail daria.
    names: { u1: "Gabi" },
    loading: false,
    loadingMore: false,
    error: null,
    hasMore: false,
    loadMore: () => {},
    reload: () => {},
  }),
}));

vi.mock("@/context/StoreContext", () => ({
  useStore: () => ({
    products: [{ id: "p1", brand: "Elfbar", model: "Ice King", flavor: "Uva" }],
    sellers: [],
    partners: [],
    investors: [],
    loans: [],
  }),
}));

const { default: AuditPage } = await import("@/pages/AuditPage");

describe("tela de auditoria", () => {
  it("mostra a venda e o débito de estoque como UM movimento", () => {
    render(<AuditPage />);

    // Uma linha só, com quem fez, o que fez e o produto resolvido para nome.
    const line = screen.getByText("registrou uma venda").closest("button");
    expect(line).toHaveTextContent("Gabi registrou uma venda");
    expect(line).toHaveTextContent("Elfbar · Ice King · Uva");

    // O débito de estoque NÃO vira um segundo movimento na lista, e a
    // contagem do dia conta movimentos, não escritas.
    expect(screen.queryByText("alterou um produto")).not.toBeInTheDocument();
    expect(screen.getByText("1 movimento")).toBeInTheDocument();
    // O trilho, esse, conta as duas escritas — é outro número, de propósito.
    expect(screen.getByText(/2 escritas/)).toBeInTheDocument();
  });

  it("guarda o estoque dentro do detalhe, com o valor de antes", () => {
    render(<AuditPage />);

    expect(screen.queryByText("estoque")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { expanded: false }));

    // "de 10 para 8" — é para isso que a coluna old_data existe.
    const field = screen.getByText("estoque").closest("div");
    expect(field).toHaveTextContent(/10\s*→\s*8/);
  });
});
