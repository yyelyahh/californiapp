import { motion, type HTMLMotionProps } from "motion/react";

type StaggerProps = HTMLMotionProps<"div"> & {
  children?: React.ReactNode;
  /**
   * Intervalo entre filhos, em segundos. Continua aceito para não quebrar as
   * chamadas antigas, e é ignorado — ver o comentário abaixo.
   */
  gap?: number;
};

/**
 * Container de lista.
 *
 * Já foi uma cascata: cada filho subia 8px no seu tempo, um atrás do outro. Não
 * é mais. Ao abrir uma tela, quem sobe é o BLOCO INTEIRO, uma vez só — é o que
 * o `PageTransition` faz com a página. Texto e card subindo cada um por conta
 * faziam a tela parecer montar aos pedaços, e numa lista longa pareciam
 * carregamento lento de um dado que já estava na mão.
 *
 * O componente continua existindo (e continua sendo um `motion.div`) porque ele
 * carrega o `className` das listas e porque os filhos ainda animam a SAÍDA por
 * dentro do `AnimatePresence` — o que sai quando alguém exclui uma linha.
 */
export function Stagger({ children, gap: _gap, ...props }: StaggerProps) {
  return <motion.div {...props}>{children}</motion.div>;
}

/** Item de uma lista. Sem entrada própria; ver `Stagger`. */
export function StaggerItem({ children, ...props }: HTMLMotionProps<"div"> & { children?: React.ReactNode }) {
  return <motion.div {...props}>{children}</motion.div>;
}

/**
 * Mesma coisa do `Stagger` para quem passa filhos soltos. `max` continua na
 * assinatura pelo mesmo motivo do `gap`: era o limite de itens animados.
 */
export function StaggerAuto({
  children,
  gap: _gap,
  max: _max,
  ...props
}: StaggerProps & { max?: number }) {
  return <motion.div {...props}>{children}</motion.div>;
}
