import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useLocation } from "react-router-dom";
import { transitionBase, transitionFast } from "@/lib/motion";

export default function PageTransition({ children, className }: { children: React.ReactNode; className?: string }) {
  const location = useLocation();
  const reduce = useReducedMotion();

  // Mesma marcação com ou sem animação: telas de altura cheia dependem do
  // `className` (flex-1) chegar até aqui para a cadeia de altura não quebrar.
  if (reduce) return <div className={className}>{children}</div>;

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={location.pathname}
        className={className}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0, transition: transitionBase }}
        exit={{ opacity: 0, y: -4, transition: transitionFast }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
