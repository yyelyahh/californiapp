import { motion, useReducedMotion, type HTMLMotionProps } from "motion/react";
import { Children } from "react";
import { listItem, stagger, MAX_STAGGER_ITEMS } from "@/lib/motion";

type StaggerProps = HTMLMotionProps<"div"> & {
  children?: React.ReactNode;
  /** intervalo entre filhos, em segundos */
  gap?: number;
};

/** Container que faz os filhos entrarem em cascata. */
export function Stagger({ children, gap = 0.045, ...props }: StaggerProps) {
  const reduce = useReducedMotion();
  if (reduce) return <motion.div {...props}>{children}</motion.div>;

  return (
    <motion.div variants={stagger(gap)} initial="hidden" animate="visible" {...props}>
      {children}
    </motion.div>
  );
}

/** Item de uma cascata. Deve estar dentro de <Stagger>. */
export function StaggerItem({ children, ...props }: HTMLMotionProps<"div"> & { children?: React.ReactNode }) {
  const reduce = useReducedMotion();
  if (reduce) return <motion.div {...props}>{children}</motion.div>;

  return (
    <motion.div variants={listItem} {...props}>
      {children}
    </motion.div>
  );
}

/**
 * Container em cascata que embrulha automaticamente cada filho direto.
 * Útil quando os filhos são elementos simples (divs/cards) já existentes.
 * Só os primeiros `max` filhos animam, para não pesar em listas longas.
 */
export function StaggerAuto({
  children,
  gap = 0.045,
  max = MAX_STAGGER_ITEMS,
  ...props
}: StaggerProps & { max?: number }) {
  const reduce = useReducedMotion();
  if (reduce) return <motion.div {...props}>{children}</motion.div>;

  return (
    <motion.div variants={stagger(gap)} initial="hidden" animate="visible" {...props}>
      {Children.toArray(children).map((child, i) =>
        i < max ? (
          <motion.div key={i} variants={listItem}>
            {child}
          </motion.div>
        ) : (
          child
        ),
      )}
    </motion.div>
  );
}
