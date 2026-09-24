import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { LoadProgress } from "@/context/StoreContext";

/**
 * A tela de entrada segura o ERP só na PRIMEIRA carga da pessoa. Trocar de
 * filial remonta o StoreProvider e volta a fase para "core" — se a tela cheia
 * voltasse junto, a sidebar sumiria a cada troca de cidade.
 */

let progress: LoadProgress = { phase: "core", done: 0, total: 6 };
let userId = "u1";

vi.mock("@/context/StoreContext", () => ({ useStore: () => ({ loadProgress: progress }) }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: userId } }) }));

const { BootGate } = await import("@/components/BootProgress");

const app = () => <BootGate><p>tela do ERP</p></BootGate>;

describe("BootGate", () => {
  it("primeira entrada: tela cheia com a etapa e a contagem, sem o ERP", () => {
    progress = { phase: "core", done: 2, total: 6 };
    render(app());
    expect(screen.getByText(/Carregando produtos e vendas/)).toHaveTextContent("2 de 6");
    expect(screen.queryByText("tela do ERP")).not.toBeInTheDocument();
  });

  it("primeira onda pronta: o ERP aparece, com a barra fina da financeira", () => {
    progress = { phase: "secondary", done: 7, total: 14 };
    const { unmount } = render(app());
    expect(screen.getByText("tela do ERP")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Carregando dados" })).toHaveAttribute("aria-valuenow", "75");
    unmount();
  });

  it("troca de filial (volta a core) NÃO volta a tela cheia", () => {
    progress = { phase: "core", done: 0, total: 6 };
    render(app());
    expect(screen.getByText("tela do ERP")).toBeInTheDocument();
    expect(screen.queryByText(/Carregando produtos e vendas/)).not.toBeInTheDocument();
  });

  it("outra conta na mesma aba passa pela tela de entrada de novo", () => {
    userId = "u2";
    progress = { phase: "core", done: 1, total: 6 };
    render(app());
    expect(screen.getByText(/Carregando produtos e vendas/)).toBeInTheDocument();
  });
});
