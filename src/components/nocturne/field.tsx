/**
 * Rótulo + controle amarrados. Sem isto o `<Label>` ao lado do `<Input>` é só
 * texto perto do campo: o leitor de tela anuncia "caixa de edição" sem dizer
 * qual, e tocar no rótulo não põe o cursor no campo.
 *
 * O `Field` gera um id e o `Label`, o `Input`, o `Textarea` e o
 * `SelectTrigger` de `src/components/ui` o leem daqui quando não recebem um
 * `htmlFor`/`id` escrito. Por isso um `Field` envolve UM controle só — dois
 * campos no mesmo `Field` sairiam com o mesmo id. O `SegmentedToggle` (grupo
 * de botões, que não é campo) usa o id do rótulo, `<id>-label`, para se
 * nomear com aria-labelledby. Campo sem rótulo visível
 * (filtro, busca, célula de tabela) leva `aria-label` e não usa `Field`.
 *
 * Arquivo à parte (e não no index do nocturne) porque os componentes de
 * `ui/` importam daqui, e o index importa de `ui/`.
 */
import { createContext, useContext, useId, type HTMLAttributes } from "react";

const FieldContext = createContext<string | undefined>(undefined);

export function useFieldId(): string | undefined {
  return useContext(FieldContext);
}

export function Field(props: HTMLAttributes<HTMLDivElement>) {
  const id = useId();
  return (
    <FieldContext.Provider value={id}>
      <div {...props} />
    </FieldContext.Provider>
  );
}
