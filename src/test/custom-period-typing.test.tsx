import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

/**
 * Digitar a data do período personalizado à mão derrubava a tela.
 *
 * No meio da digitação o `<input type="date">` fica vazio (o ano ainda não
 * está inteiro); `parseISO("")` devolve data inválida sem lançar, e o `format`
 * do rótulo explodia com "Invalid time value". Aqui a Insights é montada e o
 * campo recebe exatamente esse valor intermediário.
 */

vi.mock("@/context/StoreContext", () => ({
  useStore: () => ({ products: [], activeProducts: [], sales: [] }),
}));

const { default: InsightsPage } = await import("@/pages/InsightsPage");

describe("período personalizado digitado à mão", () => {
  it("campo vazio no meio da digitação não derruba a tela", () => {
    render(<InsightsPage />);
    const start = screen.getByLabelText("Data inicial");
    expect(() => fireEvent.change(start, { target: { value: "" } })).not.toThrow();
    fireEvent.change(screen.getByLabelText("Data final"), { target: { value: "" } });
    // A tela continua de pé, já no modo personalizado.
    expect(screen.getByLabelText("Data inicial")).toBeInTheDocument();
  });

  it("fim antes do início também não quebra", () => {
    render(<InsightsPage />);
    fireEvent.change(screen.getByLabelText("Data inicial"), { target: { value: "2026-09-20" } });
    fireEvent.change(screen.getByLabelText("Data final"), { target: { value: "2026-09-02" } });
    expect(screen.getByLabelText("Data final")).toBeInTheDocument();
  });
});
