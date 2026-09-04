import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { Icon } from "@phosphor-icons/react";

export type NavBurst = {
  id: number;
  icon: Icon;
  label: string;
  color: string;
};

/** Popup animado do ícone no centro da tela ao trocar de página pelo menu. */
export default function NavIconBurst({
  burst,
  onDone,
}: {
  burst: NavBurst | null;
  onDone: () => void;
}) {
  const reduce = useReducedMotion();
  if (reduce) return null;

  return (
    <AnimatePresence>
      {burst && (
        <motion.div
          key={burst.id}
          className="fixed inset-0 z-[100] flex items-center justify-center pointer-events-none"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.18 } }}
          onAnimationComplete={() => {
            window.setTimeout(onDone, 260);
          }}
        >
          <motion.div
            className="absolute inset-0 bg-background/60 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.15 }}
          />
          <motion.div
            className="relative flex flex-col items-center gap-3"
            initial={{ scale: 0.4, opacity: 0, y: 8 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 1.25, opacity: 0 }}
            transition={{ type: "spring", stiffness: 460, damping: 26, mass: 0.6 }}
          >
            <motion.span
              className="absolute -inset-6 rounded-full"
              style={{ background: burst.color, opacity: 0.18 }}
              initial={{ scale: 0.6, opacity: 0.35 }}
              animate={{ scale: 1.4, opacity: 0 }}
              transition={{ duration: 0.55, ease: "easeOut" }}
            />
            <span
              className="relative flex h-20 w-20 items-center justify-center rounded-2xl border border-border bg-card shadow-xl"
              style={{ boxShadow: `0 0 40px -8px ${burst.color}` }}
            >
              <burst.icon size={38} style={{ color: burst.color }} />
            </span>
            <span className="text-sm font-medium text-foreground">{burst.label}</span>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
