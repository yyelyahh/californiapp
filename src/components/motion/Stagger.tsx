import { motion, useReducedMotion, type HTMLMotionProps } from "motion/react";
import { listItem, stagger } from "@/lib/motion";

interface StaggerProps extends HTMLMotionProps<"div"> {
  children: React.ReactNode;
  /** intervalo entre filhos, em segundos */
  gap?: number;
}

/** Container que faz os filhos entrarem em cascata. */
export function Stagger({ children, gap = 0.045, ...props }: StaggerProps) {
  const reduce = useReducedMotion();
  if (reduce) return <div {...(props as React.HTMLAttributes<HTMLDivElement>)}>{children}</div>;

  return (
    <motion.div variants={stagger(gap)} initial="hidden" animate="visible" {...props}>
      {children}
    </motion.div>
  );
}

/** Item de uma cascata. Deve estar dentro de <Stagger>. */
export function StaggerItem({ children, ...props }: HTMLMotionProps<"div">) {
  const reduce = useReducedMotion();
  if (reduce) return <div {...(props as React.HTMLAttributes<HTMLDivElement>)}>{children}</div>;

  return (
    <motion.div variants={listItem} {...props}>
      {children}
    </motion.div>
  );
}
