import type { Transition, Variants } from "motion/react";

/**
 * Linguagem de movimento única do app.
 * Rápido, curvas suaves, deslocamentos curtos.
 */
export const EASE_OUT: Transition["ease"] = [0.22, 1, 0.36, 1];

export const transitionFast: Transition = { duration: 0.18, ease: EASE_OUT };
export const transitionBase: Transition = { duration: 0.28, ease: EASE_OUT };
export const transitionSlow: Transition = { duration: 0.35, ease: EASE_OUT };

export const springSoft: Transition = { type: "spring", stiffness: 380, damping: 32, mass: 0.7 };

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: transitionBase },
  exit: { opacity: 0, y: -6, transition: transitionFast },
};

export const fade: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: transitionBase },
  exit: { opacity: 0, transition: transitionFast },
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.97, y: 8 },
  visible: { opacity: 1, scale: 1, y: 0, transition: transitionBase },
  exit: { opacity: 0, scale: 0.98, transition: transitionFast },
};

/** Container em cascata: os filhos usam `fadeUp`/`listItem`. */
export const stagger = (staggerChildren = 0.045, delayChildren = 0.02): Variants => ({
  hidden: {},
  visible: { transition: { staggerChildren, delayChildren } },
});

export const staggerContainer: Variants = stagger();

export const listItem: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: transitionBase },
  exit: { opacity: 0, y: -4, height: 0, marginTop: 0, transition: transitionFast },
};

/** Limite de itens animados em cascata para não pesar em listas longas. */
export const MAX_STAGGER_ITEMS = 20;

export const hoverLift = {
  whileHover: { y: -2, transition: transitionFast },
  whileTap: { scale: 0.99 },
};
