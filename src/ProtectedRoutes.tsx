import { Routes, Route, Navigate } from "react-router-dom";
import { Suspense, lazy } from "react";
import { StoreProvider } from "@/context/StoreContext";
import { BranchProvider, useBranch } from "@/context/BranchContext";
import { useAuth } from "@/context/AuthContext";
import AppLayout from "@/components/AppLayout";

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
 * o pedaço chega em milissegundos e já fica no cache do navegador nas trocas
 * seguintes, e um spinner que pisca é pior que um quadro que não chega a ser
 * visto.
 */
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const ProductsPage = lazy(() => import("@/pages/ProductsPage"));
const StockEntryPage = lazy(() => import("@/pages/StockEntryPage"));
const SalesPage = lazy(() => import("@/pages/SalesPage"));
const SellerSalesPage = lazy(() => import("@/pages/SellerSalesPage"));
const ExpensesPage = lazy(() => import("@/pages/ExpensesPage"));
const FinancePage = lazy(() => import("@/pages/FinancePage"));
const LossesPage = lazy(() => import("@/pages/LossesPage"));
const CommissionsPage = lazy(() => import("@/pages/CommissionsPage"));
const InsightsPage = lazy(() => import("@/pages/InsightsPage"));
const AuditPage = lazy(() => import("@/pages/AuditPage"));

const PageFallback = () => null;

export default function ProtectedRoutes() {
  const { user, loading, role } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-muted-foreground">Carregando...</div>
      </div>
    );
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
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-muted-foreground">Carregando...</div>
      </div>
    );
  }

  return <StoreProvider key={branchId ?? "all"}>{children}</StoreProvider>;
}
