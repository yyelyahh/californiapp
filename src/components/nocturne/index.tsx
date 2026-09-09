/**
 * Peças compartilhadas do Nocturne.
 *
 * Mesma regra do `src/components/storefront/` que o doc da loja pede: se duas
 * telas do painel precisam da mesma peça, ela mora aqui e as duas importam —
 * ninguém copia estilo de tela em tela. O visual em si está em `src/index.css`
 * (`.nc-btn`, `.nc-rule-top`…), porque hover e disabled não existem em `style`
 * inline; o que está aqui é só a casca em React.
 */
import { forwardRef, useId } from "react";
import { motion, useReducedMotion } from "motion/react";
import { transitionBase } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { SheetDescription, SheetTitle } from "@/components/ui/sheet";

type NcButtonVariant = "solid" | "outline" | "quiet" | "ghost" | "danger";
type NcButtonSize = "sm" | "md" | "icon";

export interface NcButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * `solid` = a ação principal da tela (preenchimento accent, tinta escura).
   * `outline` = ação em destaque que não é a principal (contorno accent).
   * `quiet` = secundária, contorno neutro. `ghost` = terciária, sem moldura.
   * `danger` = destrutiva: nasce neutra e só fica crítica no hover.
   */
  variant?: NcButtonVariant;
  size?: NcButtonSize;
}

const VARIANT: Record<NcButtonVariant, string> = {
  solid: "nc-btn--solid",
  outline: "nc-btn--outline",
  quiet: "nc-btn--quiet",
  ghost: "nc-btn--ghost",
  danger: "nc-btn--danger",
};

const SIZE: Record<NcButtonSize, string> = {
  sm: "",
  md: "nc-btn--md",
  icon: "nc-btn--icon",
};

/**
 * Não reaproveita o `Button` do shadcn de propósito, pelo mesmo motivo do
 * `PillButton` da loja: o shadcn aplica `disabled:opacity-50` no botão inteiro,
 * e aqui o desabilitado esmaece só o preenchimento — o rótulo continua legível,
 * então a pessoa ainda lê o que aquele botão faria.
 */
export const NcButton = forwardRef<HTMLButtonElement, NcButtonProps>(
  ({ variant = "quiet", size = "sm", className, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn("nc-btn", VARIANT[variant], SIZE[size], className)}
      {...props}
    />
  ),
);
NcButton.displayName = "NcButton";

/** Divisória que apaga nas pontas — a assinatura do painel. */
export function Rule({ className }: { className?: string }) {
  return <div className={cn("nc-rule-top h-px", className)} />;
}

/** Sobretítulo: 10px, caixa alta, entreletra larga. A cor vem de quem usa. */
export const EYEBROW = "text-[10px] uppercase tracking-[0.1em]";

/**
 * Cabeçalho de painel deslizante: sobretítulo accent, título e descrição, com a
 * régua embaixo. Existe para os painéis pararem de cada um inventar o seu — o
 * "Novo produto" e o "Nova venda" tinham espaçamento e peso diferentes.
 *
 * Vai dentro de um `SheetContent` com `p-0 flex flex-col`; o corpo do painel
 * fica ao lado dele, com o próprio `overflow-y-auto`.
 */
export function NcSheetHeader({
  eyebrow,
  title,
  description,
}: {
  eyebrow?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
}) {
  return (
    <div className="flex-shrink-0 px-5 py-4" style={{ borderBottom: "1px solid var(--nc-track)" }}>
      {eyebrow && (
        <span className={cn(EYEBROW, "block")} style={{ color: "var(--nc-accent)" }}>
          {eyebrow}
        </span>
      )}
      {/* O SheetTitle do radix é quem amarra o aria-labelledby do diálogo — não
          troque por um <h2> solto. */}
      <SheetTitle className="mt-0.5">{title}</SheetTitle>
      {description && <SheetDescription className="mt-1">{description}</SheetDescription>}
    </div>
  );
}

/**
 * Chips de período com o realce accent como peça única: em vez de cada chip
 * desenhar a própria moldura, só o ativo renderiza o `motion.span` com
 * `layoutId`, então o motion anima o realce deslizando do chip antigo pro novo.
 * Mesmo padrão do `SegmentedToggle` / `BrandChips` da loja.
 *
 * Nasceu dentro do Dashboard; virou peça compartilhada quando a tela de Entrada
 * precisou do mesmo filtro. Nenhum chip ativo (`value` fora da lista, como o
 * intervalo personalizado da Entrada) é estado válido: o realce simplesmente
 * não aparece.
 */
export function PeriodChips({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string; short: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  const reduce = useReducedMotion();
  const pillId = useId();

  return (
    <div className="flex items-center gap-1 rounded-lg p-0.5" style={{ background: "var(--nc-track)" }}>
      {options.map(o => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={active}
            title={o.label}
            className="relative rounded-md px-2.5 py-1.5 text-xs transition-colors duration-200"
            style={{ color: active ? "var(--nc-accent)" : "var(--nc-text-2)" }}
          >
            {active && (
              <motion.span
                layoutId={reduce ? undefined : pillId}
                className="absolute inset-0 rounded-md"
                style={{
                  boxShadow: "inset 0 0 0 1px var(--nc-accent)",
                  background: "color-mix(in srgb, var(--nc-accent) 10%, transparent)",
                }}
                transition={transitionBase}
              />
            )}
            <span className="relative z-10">{o.short}</span>
          </button>
        );
      })}
    </div>
  );
}
