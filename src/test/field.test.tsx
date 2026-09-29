import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Field } from "@/components/nocturne/field";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import SegmentedToggle from "@/components/motion/SegmentedToggle";

/**
 * O `<Label>` ao lado do `<Input>` era só texto perto do campo: o leitor de
 * tela anunciava "caixa de edição" sem nome. Dentro de um `Field` os dois se
 * amarram sozinhos; fora dele nada muda.
 */
describe("Field", () => {
  it("amarra o rótulo ao campo", () => {
    render(
      <>
        <Field><Label>Valor (R$)</Label><Input /></Field>
        <Field><Label>Observação</Label><Textarea /></Field>
      </>,
    );
    expect(screen.getByLabelText("Valor (R$)").tagName).toBe("INPUT");
    expect(screen.getByLabelText("Observação").tagName).toBe("TEXTAREA");
  });

  it("dois Fields não dividem o id", () => {
    render(
      <>
        <Field><Label>Data</Label><Input type="date" /></Field>
        <Field><Label>Frete</Label><Input /></Field>
      </>,
    );
    expect(screen.getByLabelText("Data").id).not.toBe(screen.getByLabelText("Frete").id);
  });

  it("id escrito à mão vence o do Field", () => {
    render(<Field><Label htmlFor="x">Nome</Label><Input id="x" /></Field>);
    expect(screen.getByLabelText("Nome").id).toBe("x");
  });

  it("nomeia o grupo de botões pelo rótulo e marca o escolhido", () => {
    render(
      <Field>
        <Label>Forma de pagamento</Label>
        <SegmentedToggle
          value="pix"
          onChange={() => {}}
          options={[{ id: "pix", label: "Pix" }, { id: "dinheiro", label: "Dinheiro" }]}
        />
      </Field>,
    );
    expect(screen.getByRole("group", { name: "Forma de pagamento" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Pix" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Dinheiro" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("fora do Field o campo não ganha id", () => {
    render(<Input aria-label="Busca" />);
    expect(screen.getByLabelText("Busca").hasAttribute("id")).toBe(false);
  });
});
