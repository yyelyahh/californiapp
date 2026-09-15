import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";

export interface Branch {
  id: string;
  name: string;
  active: boolean;
  createdAt: string;
}

interface BranchContextType {
  /** Só as filiais que esta pessoa alcança — o corte vem da RLS, não daqui. */
  branches: Branch[];
  /** `null` é "Todas as filiais", e "Todas" é SOMENTE LEITURA. */
  branchId: string | null;
  setBranchId: (id: string | null) => void;
  /** Se o switch aparece. Exige mais de uma filial E papel de admin. */
  canSeeAll: boolean;
  loading: boolean;
  branchName: (id: string | null | undefined) => string;
}

const BranchContext = createContext<BranchContextType | null>(null);

/**
 * Onde fica guardada a escolha. Global e não por vendedor: é a cidade em que a
 * pessoa está trabalhando hoje, e ela não muda de cidade ao trocar de tela.
 */
const STORAGE_KEY = "californiapp:branch";

/** `"all"` é gravado explicitamente para "Todas" — a ausência da chave é outro
 *  estado (nunca escolheu nada), e esse cai na primeira filial. */
const ALL = "all";

/**
 * Qual filial a tela abre, dada a escolha guardada e a lista que a RLS
 * devolveu.
 *
 * Vive fora do provider porque é a única regra desta camada que pode dar
 * errado em silêncio: um id que saiu da lista — acesso revogado, filial
 * desativada — não pode deixar a tela presa num lugar que não existe mais.
 * Presa, ela apareceria como "sumiu tudo", que é a leitura errada de "sem
 * acesso". Testada em `src/test/branch-choice.test.ts`.
 *
 * `undefined` = nunca escolheu nada; `null` = escolheu "Todas".
 */
export function pickBranch(
  stored: string | null | undefined,
  list: { id: string }[],
  canSeeAll: boolean,
): string | null {
  if (stored === null && canSeeAll) return null;
  if (typeof stored === "string" && list.some(b => b.id === stored)) return stored;
  return list[0]?.id ?? null;
}

function readStored(): string | null | undefined {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return undefined;
    return raw === ALL ? null : raw;
  } catch {
    return undefined;
  }
}

/**
 * Qual cidade está na tela.
 *
 * Fica ACIMA do `StoreProvider` porque é ele que precisa remontar quando a
 * escolha muda — ver o `key` em `App.tsx`. Aqui só mora a escolha e a lista
 * do que a pessoa pode escolher.
 *
 * A lista vem do banco SEM FILTRO NO CLIENTE: a policy "Read own branches"
 * devolve só o que `my_branch_ids()` alcança. É isso que faz o switch do sócio
 * nascer certo sem uma linha de código a mais — e é isso que faz o corte ser
 * real, porque a mesma regra vale para `sales`, `expenses` e todo o resto.
 */
export function BranchProvider({ children }: { children: React.ReactNode }) {
  const { role, user } = useAuth();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchIdState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase
        .from("branches" as any)
        .select("*")
        .eq("active", true)
        .order("created_at", { ascending: true });
      if (cancelled) return;

      const list: Branch[] = error || !data
        ? []
        : (data as any[]).map(r => ({
            id: r.id,
            name: r.name,
            active: r.active !== false,
            createdAt: r.created_at,
          }));
      setBranches(list);

      setBranchIdState(pickBranch(readStored(), list, role === "admin" && list.length > 1));
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
    // `user?.id` no lugar de `user`: o objeto muda de identidade a cada
    // refresh de token, e recarregar a lista de filiais a cada uma seria
    // remontar o StoreProvider inteiro junto (ver o `key` em App.tsx).
  }, [role, user?.id]);

  const setBranchId = useCallback((id: string | null) => {
    setBranchIdState(id);
    try {
      localStorage.setItem(STORAGE_KEY, id ?? ALL);
    } catch {
      // Navegador com storage bloqueado: a escolha vale só nesta sessão.
    }
  }, []);

  const canSeeAll = role === "admin" && branches.length > 1;

  const branchName = useCallback(
    (id: string | null | undefined) => {
      if (!id) return "Todas as filiais";
      return branches.find(b => b.id === id)?.name ?? "Filial desconhecida";
    },
    [branches],
  );

  const value = useMemo<BranchContextType>(
    () => ({ branches, branchId, setBranchId, canSeeAll, loading, branchName }),
    [branches, branchId, setBranchId, canSeeAll, loading, branchName],
  );

  return <BranchContext.Provider value={value}>{children}</BranchContext.Provider>;
}

export function useBranch() {
  const ctx = useContext(BranchContext);
  if (!ctx) throw new Error("useBranch must be used within BranchProvider");
  return ctx;
}
