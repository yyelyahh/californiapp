import { useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { useStore, type LoadProgress } from "@/context/StoreContext";
import { cn } from "@/lib/utils";
import { BootScreen, BOOT_STEPS } from "@/components/BootScreen";

/**
 * A barra de carregamento do ERP, em duas formas.
 *
 * TELA DE ENTRADA (`BootScreen`): da sessão até a primeira onda de dados. É a
 * espera de quem acabou de entrar, e a tela só aparece quando produtos,
 * vendas, entradas, vendedores, atribuições e perdas já estão na mão — antes
 * disso o Dashboard abria com R$ 0 em tudo e os números iam pipocando, o que
 * se lê como "número errado" e não como "ainda carregando".
 *
 * BARRA FINA NO TOPO (`TopProgress`): a onda financeira, que chega depois SEM
 * travar a tela (foi desenhada assim de propósito), e a troca de filial —
 * que remonta o StoreProvider e recarrega tudo, mas com a sidebar de pé: uma
 * tela cheia ali apagaria a navegação a cada troca.
 *
 * A barra anda por CONSULTA TERMINADA (`loadProgress`, no StoreContext), não
 * por relógio: barra que avança sozinha e para em 90% esperando é a mentira
 * que o usuário aprende a ignorar.
 */

/**
 * Faixa de 2px no topo da janela. Fica SEMPRE montada e some por opacidade:
 * desmontar no fim cortaria o último trecho da barra antes de ele ser visto.
 */
export function TopProgress({ progress, active }: { progress: number; active: boolean }) {
  const pct = Math.round(Math.max(0, Math.min(1, progress)) * 100);
  return (
    <div
      role="progressbar"
      aria-label="Carregando dados"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-hidden={!active}
      className={cn(
        "pointer-events-none fixed inset-x-0 top-0 z-[60] h-[2px] transition-opacity duration-500 motion-reduce:transition-none",
        active ? "opacity-100" : "opacity-0",
      )}
    >
      <div
        className="h-full transition-[width] duration-300 ease-out motion-reduce:transition-none"
        style={{ width: `${active ? pct : 100}%`, background: "var(--nc-accent)" }}
      />
    </div>
  );
}

/**
 * Quem já passou pela tela de entrada NESTA aba. Módulo, e não estado: o
 * StoreProvider remonta a cada troca de filial (é o `key` do BranchScopedStore),
 * e estado dentro dele nasceria zerado — a troca de filial viraria tela cheia.
 * Guarda o id da pessoa para que sair e entrar com outra conta mostre a tela de
 * entrada de novo.
 */
let bootedFor: string | null = null;

/** Posição na barra fina: a primeira onda é a primeira metade, a financeira a segunda. */
function topProgressOf(p: LoadProgress) {
  const frac = p.total > 0 ? p.done / p.total : 1;
  if (p.phase === "core") return 0.5 * frac;
  if (p.phase === "secondary") return 0.5 + 0.5 * frac;
  return 1;
}

/**
 * Vai dentro do StoreProvider, em volta do ERP. Na primeira entrada segura a
 * tela até a primeira onda; depois disso, só a barra fina.
 */
export function BootGate({ children }: { children: React.ReactNode }) {
  const { loadProgress } = useStore();
  const { user } = useAuth();
  const coreDone = loadProgress.phase !== "core";
  const firstBoot = !!user && bootedFor !== user.id;

  useEffect(() => {
    if (coreDone && user) bootedFor = user.id;
  }, [coreDone, user]);

  if (firstBoot && !coreDone) {
    const frac = loadProgress.total > 0 ? loadProgress.done / loadProgress.total : 0;
    return (
      <BootScreen
        progress={BOOT_STEPS.data + (1 - BOOT_STEPS.data) * frac}
        label="Carregando produtos e vendas"
        detail={`${loadProgress.done} de ${loadProgress.total}`}
      />
    );
  }

  return (
    <>
      <TopProgress progress={topProgressOf(loadProgress)} active={loadProgress.phase !== "done"} />
      {children}
    </>
  );
}
