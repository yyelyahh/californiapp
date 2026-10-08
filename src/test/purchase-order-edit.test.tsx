import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import PurchaseOrdersSection from "@/components/PurchaseOrdersSection";

const mocks = vi.hoisted(() => ({ update: vi.fn(), add: vi.fn(), error: vi.fn() }));
vi.mock("@/context/StoreContext", () => ({ useStore: () => ({
  products: [{ brand: "Elfbar", model: "10K" }],
  purchaseOrders: [
    { id: "pending-id", number: 2, status: "pending", date: "2026-10-08", notes: "Fornecedor", freightCost: 20, paidAmount: 100,
      updatedAt: "2026-10-08T12:00:00Z", items: [{ id: "item", brand: "Elfbar", model: "10K", expectedQuantity: 5, unitPrice: 20, receivedFlavors: [] }] },
    { id: "received-id", number: 1, status: "received", date: "2026-10-01", freightCost: 0, paidAmount: 0, items: [] },
  ],
  addPurchaseOrder: mocks.add, updatePurchaseOrder: mocks.update, deletePurchaseOrder: vi.fn(), receivePurchaseOrder: vi.fn(),
}) }));
vi.mock("@/context/BranchContext", () => ({ useBranch: () => ({ branches: [{ id: "branch", name: "Matriz" }], branchId: "branch" }) }));
vi.mock("@/components/ConfirmProvider", () => ({ useConfirm: () => vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: mocks.error } }));

function openEdit() {
  render(<MemoryRouter><PurchaseOrdersSection /></MemoryRouter>);
  fireEvent.click(screen.getByRole("button", { name: "Editar compra #2" }));
}

beforeEach(() => { vi.clearAllMocks(); mocks.update.mockResolvedValue(true); });
afterEach(cleanup);

describe("edição de compras a caminho", () => {
  it("preenche a compra e salva sem criar outra", async () => {
    openEdit();
    expect(screen.getByLabelText("Data")).toHaveValue("2026-10-08");
    expect(screen.getByLabelText("Observações")).toHaveValue("Fornecedor");
    expect(screen.getByLabelText("Frete (R$)")).toHaveValue(20);
    expect(screen.getByLabelText("Quantidade esperada do produto 1")).toHaveValue(5);
    fireEvent.change(screen.getByLabelText("Quantidade esperada do produto 1"), { target: { value: "8" } });
    fireEvent.change(screen.getByLabelText("Frete (R$)"), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith("pending-id", {
      date: "2026-10-08", notes: "Fornecedor", freightCost: 30,
      items: [{ brand: "Elfbar", model: "10K", expectedQuantity: 8, unitPrice: 20 }],
    }, "2026-10-08T12:00:00Z"));
    expect(mocks.add).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Salvar alterações" })).not.toBeInTheDocument());
  });

  it("mantém os dados para tentar novamente quando salvar falha", async () => {
    mocks.update.mockResolvedValue(false);
    openEdit();
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("button", { name: "Salvar alterações" })).toBeEnabled());
    expect(screen.getByLabelText("Observações")).toHaveValue("Fornecedor");
  });

  it("recusa quantidades fracionárias e valores negativos", () => {
    openEdit();
    fireEvent.change(screen.getByLabelText("Quantidade esperada do produto 1"), { target: { value: "1.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));
    expect(mocks.update).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Quantidade esperada do produto 1"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Valor unitário do produto 1"), { target: { value: "-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledTimes(2);
  });

  it("não oferece edição de compra recebida no histórico", () => {
    render(<MemoryRouter><PurchaseOrdersSection /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Histórico" }));
    expect(screen.queryByRole("button", { name: "Editar compra #1" })).not.toBeInTheDocument();
    expect(screen.getByText("Compra #1")).toBeInTheDocument();
  });

  it("impede novo envio enquanto está salvando", async () => {
    let finish: (value: boolean) => void = () => {};
    mocks.update.mockImplementation(() => new Promise<boolean>(resolve => { finish = resolve; }));
    openEdit();
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));
    expect(screen.getByRole("button", { name: "Salvando…" })).toBeDisabled();
    expect(screen.getByLabelText("Quantidade esperada do produto 1")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Salvando…" }));
    expect(mocks.update).toHaveBeenCalledTimes(1);
    finish(true);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Salvando…" })).not.toBeInTheDocument());
  });
});