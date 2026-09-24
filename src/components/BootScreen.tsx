/**
 * A tela de entrada do ERP: wordmark, barra e o nome da etapa.
 *
 * Arquivo próprio, sem importar contexto nenhum, porque o App.tsx também a usa
 * (na espera da sessão) e o App.tsx é o pacote que a LOJA PÚBLICA e o login
 * baixam. Morando junto do `BootGate`, ela arrastaria o StoreContext — o ERP
 * inteiro — para o celular de quem abriu a loja pelo WhatsApp.
 *
 * A barra e o `BootGate` estão em src/components/BootProgress.tsx.
 */

/** Onde cada etapa começa na barra da tela de entrada. */
export const BOOT_STEPS = {
  session: 0.06,
  branches: 0.16,
  /** A primeira onda de dados ocupa o resto, de 16% a 100%. */
  data: 0.16,
} as const;

export function BootScreen({ progress, label, detail }: { progress: number; label: string; detail?: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, progress)) * 100);
  return (
    <div
      className="nocturne fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: "var(--nc-bg)" }}
    >
      <div className="flex w-full max-w-[240px] flex-col items-center gap-4">
        <span className="nc-wordmark text-[15px] font-medium tracking-tight">California</span>
        <div
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          className="h-[3px] w-full overflow-hidden rounded-full"
          style={{ background: "var(--nc-track)" }}
        >
          <div
            className="h-full rounded-full transition-[width] duration-300 ease-out motion-reduce:transition-none"
            style={{ width: `${pct}%`, background: "var(--nc-accent)" }}
          />
        </div>
        <p className="text-center text-[12px]" style={{ color: "var(--nc-text-3)" }}>
          {label}
          {detail && <span className="nc-num"> · {detail}</span>}
        </p>
      </div>
    </div>
  );
}
