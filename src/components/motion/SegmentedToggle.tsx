import { useId } from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

export interface SegmentedOption<T extends string> {
  id: T;
  label: string;
  disabled?: boolean;
  title?: string;
}

interface SegmentedToggleProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
  /** classes do container da grade (ex.: "grid-cols-2") */
  gridClassName?: string;
  align?: "center" | "left";
}

/**
 * Alternador com indicador de fundo deslizante.
 * A cor de destaque fica apenas no indicador; o texto ativo fica forte
 * e o inativo com opacidade reduzida.
 */
export default function SegmentedToggle<T extends string>({
  options,
  value,
  onChange,
  className,
  gridClassName = "grid-cols-2",
  align = "center",
}: SegmentedToggleProps<T>) {
  const reduce = useReducedMotion();
  const layoutId = useId();

  return (
    <div className={cn("grid gap-1 rounded-lg border border-border/60 bg-secondary/40 p-1", gridClassName, className)}>
      {options.map((opt) => {
        const active = opt.id === value;
        return (
          <button
            key={opt.id}
            type="button"
            disabled={opt.disabled}
            title={opt.title}
            onClick={() => !opt.disabled && onChange(opt.id)}
            className={cn(
              "relative rounded-md px-3 py-2 text-sm font-medium transition-colors duration-200",
              align === "left" ? "text-left" : "text-center",
              active ? "text-primary-foreground" : "text-muted-foreground/70 hover:text-foreground",
              opt.disabled && "opacity-40 cursor-not-allowed hover:text-muted-foreground/70",
            )}
          >
            {active && (
              <motion.span
                layoutId={reduce ? undefined : layoutId}
                className="absolute inset-0 rounded-md bg-primary"
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              />
            )}
            <span className="relative z-10">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
