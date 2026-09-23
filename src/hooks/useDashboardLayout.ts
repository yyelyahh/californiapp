import { useCallback, useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { DEFAULT_LAYOUT, normalizeLayout, type DashboardLayout } from "@/lib/dashboard-layout";

/**
 * O layout do Dashboard de quem está logado.
 *
 * A verdade é a linha em `dashboard_layouts` (migration 20260923120000), para o
 * layout seguir a pessoa entre aparelhos. O localStorage guarda só uma CÓPIA,
 * lida no primeiro render: sem ela a tela abriria no layout padrão e pularia
 * para o da pessoa quando o banco respondesse — o solavanco que o projeto já
 * recusou em todo canto. Se a cópia e o banco divergirem, o banco ganha.
 *
 * Escrever é otimista e com debounce: a tela muda na hora, e arrastar um bloco
 * por cinco posições vira UM upsert, não cinco.
 */

/** Espera depois da última mexida antes de gravar. */
const SAVE_DELAY_MS = 700;

const cacheKey = (userId: string) => `dashboard-layout:${userId}`;

function readCache(userId: string | undefined): DashboardLayout {
  if (!userId) return DEFAULT_LAYOUT;
  try {
    const raw = localStorage.getItem(cacheKey(userId));
    return raw ? normalizeLayout(JSON.parse(raw)) : DEFAULT_LAYOUT;
  } catch {
    return DEFAULT_LAYOUT;
  }
}

function writeCache(userId: string, layout: DashboardLayout) {
  try {
    localStorage.setItem(cacheKey(userId), JSON.stringify(layout));
  } catch {
    // Navegador sem storage (aba anônima, site bloqueado): o banco segue valendo.
  }
}

/**
 * A tabela ainda não está no types.ts gerado. O cast é no CLIENTE, e a chamada
 * continua sendo método dele — `const from = supabase.from` perderia o `this`
 * (ver "Gotchas de front" no CLAUDE.md).
 */
const db = supabase as unknown as SupabaseClient;

export function useDashboardLayout() {
  const { user } = useAuth();
  const userId = user?.id;

  const [layout, setLayout] = useState<DashboardLayout>(() => readCache(userId));
  const pending = useRef<{ timer: ReturnType<typeof setTimeout>; layout: DashboardLayout } | null>(null);
  /** Um aviso de falha por sessão da tela, não um por mexida. */
  const warned = useRef(false);
  /** Mexida local ainda não gravada: a leitura do banco que chegar depois não pode desfazê-la. */
  const dirty = useRef(false);

  const persist = useCallback(
    async (next: DashboardLayout) => {
      if (!userId) return;
      const { error } = await db
        .from("dashboard_layouts")
        .upsert({ user_id: userId, layout: next, updated_at: new Date().toISOString() });
      if (error && !warned.current) {
        warned.current = true;
        console.error(error);
        toast.error("Não deu para salvar o layout na sua conta — ele vale só neste navegador por enquanto");
      }
    },
    [userId],
  );

  useEffect(() => {
    setLayout(readCache(userId));
    if (!userId) return;
    let alive = true;
    void (async () => {
      const { data, error } = await db
        .from("dashboard_layouts")
        .select("layout")
        .eq("user_id", userId)
        .maybeSingle();
      // Falha na leitura fica calada: a tela continua no cache (ou no padrão),
      // que é exatamente o Dashboard de antes. Não é motivo para toast.
      if (!alive || error || dirty.current) return;
      const next = data ? normalizeLayout(data.layout) : DEFAULT_LAYOUT;
      setLayout(next);
      writeCache(userId, next);
    })();
    return () => { alive = false; };
  }, [userId]);

  // Sair da tela com uma gravação na fila grava na hora, em vez de perder a
  // última mexida.
  useEffect(() => () => {
    if (pending.current) {
      clearTimeout(pending.current.timer);
      void persist(pending.current.layout);
      pending.current = null;
    }
  }, [persist]);

  const update = useCallback(
    (next: DashboardLayout) => {
      setLayout(next);
      if (!userId) return;
      dirty.current = true;
      writeCache(userId, next);
      if (pending.current) clearTimeout(pending.current.timer);
      const timer = setTimeout(() => {
        pending.current = null;
        void persist(next);
      }, SAVE_DELAY_MS);
      pending.current = { timer, layout: next };
    },
    [persist, userId],
  );

  const reset = useCallback(() => update(DEFAULT_LAYOUT), [update]);

  return { layout, update, reset };
}
