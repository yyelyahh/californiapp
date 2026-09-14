import { useReducedMotion } from "motion/react";

/**
 * Fundo da tela de login: linhas em onda andando devagar, com um realce do
 * accent vazando do fundo.
 *
 * O laço é CSS (`@keyframes login-wave` em index.css), não rAF: é animação
 * infinita e não vale gastar main thread com ela. Cada path é desenhado com o
 * DOBRO da largura do viewBox, repetindo o mesmo período — e o deslocamento é
 * de UM período (não uma fração da largura), que é o que faz o laço fechar sem
 * emenda visível.
 */

const VIEW_W = 1200;
const VIEW_H = 600;

/** Uma onda: meia largura de período, repetida até cobrir 2× o viewBox. */
function wavePath(y: number, amplitude: number, period: number) {
  const half = period / 2;
  let d = `M 0 ${y}`;
  for (let x = 0; x < VIEW_W * 2; x += period) {
    d += ` C ${x + half * 0.5} ${y - amplitude}, ${x + half * 0.5} ${y - amplitude}, ${x + half} ${y}`;
    d += ` C ${x + period - half * 0.5} ${y + amplitude}, ${x + period - half * 0.5} ${y + amplitude}, ${x + period} ${y}`;
  }
  return d;
}

type Wave = {
  y: number;
  amplitude: number;
  period: number;
  color: string;
  opacity: number;
  width: number;
  duration: number;
  delay: number;
};

/* Opacidade cresce até o meio da pilha e cai de novo: o brilho de cor fica na
 * faixa onde o card está, e as bordas da tela quase somem no fundo. */
const WAVES: Wave[] = [
  { y: 110, amplitude: 26, period: 520, color: "var(--nc-accent)", opacity: 0.1, width: 1, duration: 34, delay: -4 },
  { y: 210, amplitude: 38, period: 660, color: "var(--nc-profit)", opacity: 0.16, width: 1.2, duration: 27, delay: -11 },
  { y: 300, amplitude: 30, period: 440, color: "var(--nc-accent)", opacity: 0.22, width: 1.5, duration: 21, delay: -2 },
  { y: 380, amplitude: 44, period: 720, color: "var(--nc-profit)", opacity: 0.18, width: 1.2, duration: 30, delay: -17 },
  { y: 470, amplitude: 28, period: 560, color: "var(--nc-accent)", opacity: 0.13, width: 1, duration: 24, delay: -8 },
  { y: 545, amplitude: 20, period: 480, color: "var(--nc-profit)", opacity: 0.09, width: 1, duration: 18, delay: -13 },
];

export default function LoginWaves() {
  const reduce = useReducedMotion();

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* O accent vazando do fundo, atrás das linhas, centrado onde o card fica. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(60% 45% at 50% 42%, color-mix(in srgb, var(--nc-accent) 12%, transparent), transparent 70%)",
        }}
      />
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        focusable="false"
      >
        {WAVES.map((w, i) => (
          <path
            key={i}
            d={wavePath(w.y, w.amplitude, w.period)}
            fill="none"
            stroke={w.color}
            strokeWidth={w.width}
            strokeOpacity={w.opacity}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            className={reduce ? undefined : "login-wave"}
            style={
              reduce
                ? undefined
                : ({
                    animationDuration: `${w.duration}s`,
                    animationDelay: `${w.delay}s`,
                    "--login-wave-shift": `${-w.period}px`,
                  } as React.CSSProperties)
            }
          />
        ))}
      </svg>
    </div>
  );
}
