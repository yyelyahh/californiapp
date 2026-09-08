import { createContext, useContext, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User, Session } from "@supabase/supabase-js";

type AppRole = "admin" | "seller";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  role: AppRole | null;
  sellerId: string | null;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  loading: true,
  role: null,
  sellerId: null,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [sellerId, setSellerId] = useState<string | null>(null);

  /** A sessão já foi consultada uma vez (mesmo que o resultado seja "ninguém"). */
  const [sessionChecked, setSessionChecked] = useState(false);
  /** Id do usuário cujo papel já foi resolvido. */
  const [resolvedFor, setResolvedFor] = useState<string | null>(null);

  /**
   * Usuário da sessão corrente. Em ref, e não em state, por dois motivos: o
   * `fetchUserData` precisa saber, no momento em que a resposta CHEGA, se ela
   * ainda é da pessoa logada (resposta atrasada de um login anterior não pode
   * sobrescrever o atual), e o `onAuthStateChange` precisa comparar sem
   * depender de um valor congelado no closure.
   */
  const activeUserId = useRef<string | null>(null);

  const fetchUserData = async (userId: string) => {
    try {
      const [roleRes, sellerRes] = await Promise.all([
        supabase.from("user_roles").select("role").eq("user_id", userId).maybeSingle(),
        supabase.from("sellers").select("id").eq("user_id", userId).maybeSingle(),
      ]);
      if (activeUserId.current !== userId) return;
      setRole((roleRes.data?.role as AppRole) ?? null);
      setSellerId(sellerRes.data?.id ?? null);
    } finally {
      // Marca como resolvido mesmo se a consulta falhar: sem isto uma queda de
      // rede deixaria o app preso na tela de carregando para sempre.
      if (activeUserId.current === userId) setResolvedFor(userId);
    }
  };

  /**
   * Caminho único para os dois gatilhos de sessão. Antes eram dois blocos
   * separados, e era essa divergência que causava o flash: o `getSession`
   * esperava o papel chegar antes de liberar a tela, mas o `onAuthStateChange`
   * (o que dispara no login) soltava o usuário na hora e deixava o papel para
   * depois. Nessa janela `role` era `null`, `role === "seller"` dava false, e o
   * vendedor via o app inteiro do admin por um instante antes de ser jogado
   * para a tela dele.
   */
  const syncUser = (nextSession: Session | null) => {
    const nextUser = nextSession?.user ?? null;
    setSession(nextSession);
    setUser(nextUser);

    if (!nextUser) {
      activeUserId.current = null;
      setRole(null);
      setSellerId(null);
      setResolvedFor(null);
    } else if (activeUserId.current !== nextUser.id) {
      activeUserId.current = nextUser.id;
      // `setTimeout` para não chamar o supabase de dentro do callback do
      // próprio auth — chamada síncrona ali pode travar o cliente.
      setTimeout(() => fetchUserData(nextUser.id), 0);
    }
    // Só compara o id: `onAuthStateChange` também dispara em renovação de
    // token, com a mesma pessoa. Refazer a consulta ali seria desperdício, e
    // zerar o `resolvedFor` piscaria a tela de carregando no meio da sessão.

    setSessionChecked(true);
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => syncUser(nextSession),
    );

    supabase.auth.getSession().then(({ data: { session: nextSession } }) => syncUser(nextSession));

    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * "Ainda não sei quem é essa pessoa" — e não só "ainda não sei se tem
   * sessão". Quem consome isto (ProtectedRoutes) decide rota por papel, então
   * liberar a tela com a sessão pronta e o papel pendente é o mesmo que
   * decidir errado. Derivado em vez de ser mais um `setState` para não existir
   * caminho que esqueça de desligar.
   */
  const loading = !sessionChecked || (!!user && resolvedFor !== user.id);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, role, sellerId, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
