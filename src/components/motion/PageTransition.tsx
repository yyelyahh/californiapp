import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useLocation } from "react-router-dom";
import { EASE_OUT, transitionBase } from "@/lib/motion";

/**
 * A ÚNICA transição entre páginas. Antes ela dividia o palco com o
 * `NavIconBurst`, um scrim em tela cheia com o ícone da seção em glow colorido
 * escalando por cima — um pulso de brilho na tela inteira a cada clique no
 * menu, cansativo de olhar e do tipo que não se deve pedir de quem tem
 * sensibilidade a flash. Foi removido; sobrou só o que está aqui.
 *
 * O que sobrou é de propósito o mínimo que ainda lê como transição: um fade
 * com 6px de deriva pra cima na entrada. Duas regras que mantêm isso calmo:
 *
 * - **Nada de movimento na saída.** A tela que vai embora só apaga. Deslizar as
 *   duas em direções opostas é o que dá a sensação de solavanco.
 * - **Saída bem mais curta que a entrada** (0.12s contra 0.28s). Com
 *   `mode="wait"` a saída inteira acontece antes de a próxima tela existir, e
 *   sair devagar vira uma piscada de tela vazia.
 */
const exitTransition = { duration: 0.12, ease: EASE_OUT };

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
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0, transition: transitionBase }}
        exit={{ opacity: 0, transition: exitTransition }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
