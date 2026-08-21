import { useEffect, useRef, useState } from "react";
import { animate, useReducedMotion } from "motion/react";

interface AnimatedNumberProps {
  value: number;
  /** formata o valor exibido (ex.: moeda, percentual) */
  format?: (v: number) => string;
  duration?: number;
  className?: string;
  /** anima de 0 até o valor já na primeira renderização */
  animateOnMount?: boolean;
}

/** Número que "conta" suavemente até o valor final. */
export default function AnimatedNumber({
  value,
  format = (v) => String(Math.round(v)),
  duration = 0.6,
  className,
  animateOnMount = false,
}: AnimatedNumberProps) {
  const reduce = useReducedMotion();
  const [display, setDisplay] = useState(animateOnMount ? 0 : value);
  const prev = useRef(animateOnMount ? 0 : value);

  useEffect(() => {
    if (reduce) {
      prev.current = value;
      setDisplay(value);
      return;
    }
    const from = prev.current;
    prev.current = value;
    if (from === value) return;

    const controls = animate(from, value, {
      duration,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => setDisplay(v),
    });
    return () => controls.stop();
  }, [value, duration, reduce]);

  return <span className={className}>{format(display)}</span>;
}
