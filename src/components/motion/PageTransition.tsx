import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useLocation } from "react-router-dom";
import { transitionBase, transitionFast } from "@/lib/motion";

export default function PageTransition({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const reduce = useReducedMotion();

  if (reduce) return <>{children}</>;

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={location.pathname}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0, transition: transitionBase }}
        exit={{ opacity: 0, y: -4, transition: transitionFast }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
