import { Buildings } from "@phosphor-icons/react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useBranch } from "@/context/BranchContext";
import { EYEBROW } from "@/components/nocturne";
import { cn } from "@/lib/utils";

/** Valor do "Todas as filiais" no `Select`, que não aceita string vazia. */
const ALL = "__all__";

/**
 * Em qual cidade se está trabalhando.
 *
 * Mora no cabeçalho da sidebar — o único lugar que aparece em TODA tela do
 * ERP. Trocar aqui remonta o `StoreProvider` inteiro (ver `App.tsx`), então
 * tudo o que se vê e se lança a partir do clique é da cidade escolhida.
 *
 * É um `Select` e não o `SegmentedChips` de duas opções que o desenho previa:
 * com "Todas as filiais" na lista já são TRÊS opções no mínimo, e nome de
 * cidade não tem forma curta de três letras que a pessoa reconheça — chip com
 * rótulo cortado num trilho de 208px viraria adivinhação.
 *
 * Não aparece para quem alcança uma filial só (vendedor, sócio): um switch de
 * uma opção é um botão que não faz nada.
 */
export default function BranchSwitcher({
  collapsed,
  compact,
}: {
  /** Sidebar recolhida: sobra a inicial, como o rodapé de identidade já faz. */
  collapsed?: boolean;
  /** Cabeçalho do celular: pílula entre o wordmark e o hambúrguer. */
  compact?: boolean;
}) {
  const { branches, branchId, setBranchId, canSeeAll, branchName } = useBranch();

  // Uma filial só não é escolha. E sem poder ver "Todas", duas filiais viram
  // uma lista de duas — o switch continua valendo, o "Todas" é que some.
  if (branches.length < 2) return null;

  const value = branchId ?? ALL;
  const label = branchName(branchId);
  const initial = (branchId ? label : "T").trim()[0]?.toUpperCase() ?? "?";

  const onChange = (v: string) => setBranchId(v === ALL ? null : v);

  const options = (
    // `nocturne` repetido: o `SelectContent` é portado para fora da árvore da
    // página pelo Radix, e os tokens do tema não chegam por herança.
    <SelectContent className="nocturne">
      {canSeeAll && (
        <SelectItem value={ALL}>
          Todas as filiais
          <span className="ml-1.5 text-[11px]" style={{ color: "var(--nc-text-3)" }}>
            somente leitura
          </span>
        </SelectItem>
      )}
      {branches.map(b => (
        <SelectItem key={b.id} value={b.id}>
          {b.name}
        </SelectItem>
      ))}
    </SelectContent>
  );

  if (collapsed) {
    return (
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger
          aria-label="Trocar de filial"
          title={label}
          className="mx-auto h-7 w-7 justify-center rounded-md border-0 p-0 text-[12px] font-medium [&>svg]:hidden"
          style={{
            color: "var(--nc-accent)",
            background: "color-mix(in srgb, var(--nc-accent) 12%, transparent)",
            boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--nc-accent) 40%, transparent)",
          }}
        >
          {initial}
        </SelectTrigger>
        {options}
      </Select>
    );
  }

  if (compact) {
    return (
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger
          aria-label="Trocar de filial"
          className="h-8 w-auto max-w-[9.5rem] gap-1.5 rounded-full border-0 px-2.5 text-[12px]"
          style={{
            color: "var(--nc-text)",
            background: "var(--nc-track)",
          }}
        >
          <Buildings size={14} style={{ color: "var(--nc-accent)" }} />
          <SelectValue>
            <span className="truncate">{label}</span>
          </SelectValue>
        </SelectTrigger>
        {options}
      </Select>
    );
  }

  return (
    <div className="px-3 pb-3 pt-2.5">
      <p className={cn(EYEBROW, "mb-1.5")} style={{ color: "var(--nc-text-3)" }}>
        Filial
      </p>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger
          aria-label="Trocar de filial"
          className="nc-input h-8 w-full gap-1.5 px-2 text-[12.5px]"
        >
          <Buildings size={14} className="flex-none" style={{ color: "var(--nc-accent)" }} />
          <SelectValue>
            <span className="truncate">{label}</span>
          </SelectValue>
        </SelectTrigger>
        {options}
      </Select>
    </div>
  );
}
