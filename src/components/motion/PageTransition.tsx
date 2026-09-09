import { motion, useReducedMotion } from "motion/react";
import { useLocation } from "react-router-dom";
import { transitionBase } from "@/lib/motion";

/**
 * A ÚNICA transição entre páginas: um fade com 6px de deriva pra cima na
 * ENTRADA da tela nova. Nada mais — nem flash, nem saída animada.
 *
 * **Por que não tem `AnimatePresence` aqui.** Tinha, com `mode="wait"` e
 * `exit`, e era a causa do bug de "troquei de página e a tela não apareceu; só
 * depois de clicar no ícone de novo". Dois motivos, os dois reproduzidos em
 * `src/test/page-transition.test.tsx`:
 *
 * 1. O filho que está saindo NÃO segurava a tela antiga. Quem está dentro dele
 *    é o `<Routes>`, que lê a localização do contexto — quando a rota muda, ele
 *    re-renderiza dentro do nó que está saindo e já mostra a tela NOVA. Ou
 *    seja: a tela de destino aparecia, apagava (a tal "saída"), desmontava e
 *    montava OUTRA VEZ para entrar. Toda navegação montava a página duas
 *    vezes — dois `useEffect`, duas cargas de dados, um pisca no meio.
 * 2. Com `mode="wait"` o filho novo fica numa fila até a saída terminar, e essa
 *    fila trava. Basta um re-render do pai cair dentro dos 120ms da saída
 *    (o poll da SalesPage, o StoreContext, qualquer coisa) para o elemento novo
 *    montar e ficar parado no `initial` — presente no DOM, em `opacity: 0`.
 *    É exatamente a tela em branco que o clique seguinte no menu "consertava":
 *    o clique trocava a `key` e forçava uma montagem limpa.
 *
 * Sem `AnimatePresence` não existe fila para travar: a `key` muda, o React
 * desmonta a tela antiga e monta a nova, que entra com o fade. A saída animada
 * some — e não faz falta, porque ela nunca chegou a mostrar a tela que estava
 * saindo (ver ponto 1).
 */
export default function PageTransition({ children, className }: { children: React.ReactNode; className?: string }) {
  const location = useLocation();
  const reduce = useReducedMotion();

  // Mesma marcação com ou sem animação: telas de altura cheia dependem do
  // `className` (flex-1) chegar até aqui para a cadeia de altura não quebrar.
  if (reduce) return <div className={className}>{children}</div>;

  return (
    <motion.div
      key={location.pathname}
      className={className}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={transitionBase}
    >
      {children}
    </motion.div>
  );
}
