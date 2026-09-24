import { Routes, Route, Navigate } from "react-router-dom";
import { Suspense, lazy, useEffect } from "react";
import { StoreProvider } from "@/context/StoreContext";
import { BranchProvider, useBranch } from "@/context/BranchContext";
import { useAuth } from "@/context/AuthContext";
import AppLayout from "@/components/AppLayout";
import { BootGate } from "@/components/BootProgress";
import { BootScreen, BOOT_STEPS } from "@/components/BootScreen";

/**
 * Tudo o que só existe DEPOIS do login mora neste arquivo, e o `App` o carrega
 * por `lazy`.
 *
 * O corte é de peso, não de segurança — quem protege é a RLS, não o bundle.
 * Mas o `AppLayout` (a sidebar, com os glifos Phosphor) e o `StoreContext` (que
 * carrega a operação inteira na memória) viajavam no mesmo arquivo que a loja
 * pública: o cliente que abre `/loja/ivoti` pelo WhatsApp, no 4G, baixava a
 * administração da empresa antes de ver o primeiro preço. Agora ele baixa a
 * loja, e só.
 *
 * Cada tela do ERP também é um `lazy`: são 14, e ninguém abre duas ao mesmo
 * tempo. O `<Suspense>` abaixo é quem espera por elas, com fallback `null` —
 * um spinner que pisca é pior que um quadro que não chega a ser visto. Para o
 * quadro não chegar a ser visto de verdade, o código de todas elas é
 * pré-carregado logo depois do login (`preloadErpPages`).
 */
/**
 * O import de cada tela do ERP, num lugar só: é daqui que sai o `lazy` E o
 * pré-carregamento (ver `preloadErpPages`). Duas listas separadas acabariam
 * com uma tela nova no `lazy` e fora do pré-carregamento.
 */
const pageLoaders = {
  dashboard: () => import("@/pages/Dashboard"),
  products: () => import("@/pages/ProductsPage"),
  stock: () => import("@/pages/StockEntryPage"),
  sales: () => import("@/pages/SalesPage"),
  expenses: () => import("@/pages/ExpensesPage"),
  finance: () => import("@/pages/FinancePage"),
  losses: () => import("@/pages/LossesPage"),
  commissions: () => import("@/pages/CommissionsPage"),
  insights: () => import("@/pages/InsightsPage"),
  audit: () => import("@/pages/AuditPage"),
};

const Dashboard = lazy(pageLoaders.dashboard);
const ProductsPage = lazy(pageLoaders.products);
const StockEntryPage = lazy(pageLoaders.stock);
const SalesPage = lazy(pageLoaders.sales);
const SellerSalesPage = lazy(() => import("@/pages/SellerSalesPage"));
const ExpensesPage = lazy(pageLoaders.expenses);
const FinancePage = lazy(pageLoaders.finance);
const LossesPage = lazy(pageLoaders.losses);
const CommissionsPage = lazy(pageLoaders.commissions);
const InsightsPage = lazy(pageLoaders.insights);
const AuditPage = lazy(pageLoaders.audit);

/**
 * Baixa o código de TODAS as telas do ERP quando o navegador fica ocioso.
 *
 * Sem isto, a primeira visita a cada tela esperava a rede antes de desenhar
 * qualquer coisa — e como o fallback do Suspense é `null` e a `key` do
 * PageTransition remonta a área da página, a espera aparecia como tela em
 * branco. A Lovable troca o nome dos arquivos a cada publicação, então essa
 * "primeira visita" voltava depois de toda mudança, não só no primeiro acesso.
 * O pacote vem DEPOIS que a tela atual está de pé: abrir o app não fica mais
 * lento, e as trocas seguintes não esperam a rede.
 *
 * Falha calada: se o pré-carregamento cair, a tela carrega do jeito antigo
 * quando for aberta.
 */
function preloadErpPages() {
  const run = () => {
    for (const load of Object.values(pageLoaders)) void load().catch(() => {});
  };
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number })
    .requestIdleCallback;
  if (idle) idle(run, { timeout: 3000 });
  else setTimeout(run, 1500);
}

const PageFallback = () => null;

export default function ProtectedRoutes() {
  const { user, loading, role } = useAuth();

  // Só o ERP: o vendedor tem uma tela só e não navega entre as outras.
  useEffect(() => {
    if (user && role === "admin") preloadErpPages();
  }, [user, role]);

  if (loading) {
    return <BootScreen progress={BOOT_STEPS.session} label="Verificando sua sessão" />;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // O vendedor tem uma tela só, e ela usa o tema da loja em vez do Nocturne do
  // ERP. Por isso a bifurcação acontece ANTES do AppLayout: a sidebar e a barra
  // inferior existiriam para navegar entre uma opção, e o shell de tela cheia
  // da tela dele brigaria com o shell do ERP por fora.
  //
  // Chegar aqui com `role` ainda desconhecido não acontece mais: o
  // `AuthContext` só desliga o `loading` depois de resolver o papel.
  //
  // O `BranchProvider` fica ACIMA do `StoreProvider` nos dois caminhos: é ele
  // que diz de qual cidade são os dados que o Store vai carregar. O vendedor
  // não vê switch nenhum — o contexto resolve a filial única dele sozinho.
  return (
    <BranchProvider>
      <BranchScopedStore>
        {role === "seller" ? (
          <Suspense fallback={<PageFallback />}>
            <Routes>
              <Route path="/minhas-vendas" element={<SellerSalesPage />} />
              <Route path="*" element={<Navigate to="/minhas-vendas" replace />} />
            </Routes>
          </Suspense>
        ) : (
          // A barra de carregamento é só do ERP: a tela do vendedor tem o
          // tema da loja, e uma entrada no Nocturne antes dela seria outra
          // marca piscando na frente.
          <BootGate>
          <AppLayout>
            <Suspense fallback={<PageFallback />}>
              <Routes>
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/products" element={<ProductsPage />} />
                <Route path="/stock" element={<StockEntryPage />} />
                <Route path="/sales" element={<SalesPage />} />
                <Route path="/expenses" element={<ExpensesPage />} />
                <Route path="/investors" element={<Navigate to="/finance" replace />} />
                <Route path="/finance" element={<FinancePage />} />
                <Route path="/revenue" element={<Navigate to="/commissions" replace />} />
                <Route path="/sellers" element={<Navigate to="/commissions" replace />} />
                <Route path="/seller-accounts" element={<Navigate to="/commissions" replace />} />
                <Route path="/losses" element={<LossesPage />} />
                <Route path="/commissions" element={<CommissionsPage />} />
                <Route path="/insights" element={<InsightsPage />} />
                <Route path="/audit" element={<AuditPage />} />

                <Route path="*" element={<Navigate to="/dashboard" replace />} />
              </Routes>
            </Suspense>
          </AppLayout>
          </BootGate>
        )}
      </BranchScopedStore>
    </BranchProvider>
  );
}

/**
 * Trocar de filial REMONTA o `StoreProvider` inteiro, pelo `key`.
 *
 * A alternativa era reconciliar 21 estados diferentes (produtos, vendas,
 * atribuições, despesas…) a cada troca, cada um com a sua própria janela entre
 * "já mudou a filial" e "ainda tem dado da anterior na tela". Um `key` resolve
 * a classe inteira de bug de dado velho de uma vez: o provider antigo morre
 * com tudo o que tinha dentro e o novo nasce carregando do zero.
 *
 * Enquanto a lista de filiais não chegou, nada monta — o Store precisa saber
 * de qual cidade carregar ANTES da primeira consulta, e montar sem saber
 * pediria a rede inteira para jogar fora no instante seguinte.
 */
function BranchScopedStore({ children }: { children: React.ReactNode }) {
  const { branchId, loading } = useBranch();

  if (loading) {
    return <BootScreen progress={BOOT_STEPS.branches} label="Carregando filiais" />;
  }

  return <StoreProvider key={branchId ?? "all"}>{children}</StoreProvider>;
}
