import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Suspense } from "react";
import { StoreProvider } from "@/context/StoreContext";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import AppLayout from "@/components/AppLayout";
import { ConfirmProvider } from "@/components/ConfirmProvider";

import Dashboard from "@/pages/Dashboard";
import ProductsPage from "@/pages/ProductsPage";
import StockEntryPage from "@/pages/StockEntryPage";
import SalesPage from "@/pages/SalesPage";
import SellerSalesPage from "@/pages/SellerSalesPage";
import ExpensesPage from "@/pages/ExpensesPage";
import FinancePage from "@/pages/FinancePage";
import LossesPage from "@/pages/LossesPage";
import CommissionsPage from "@/pages/CommissionsPage";
import InsightsPage from "@/pages/InsightsPage";
import LoginPage from "@/pages/LoginPage";
import LandingPage from "@/pages/LandingPage";
import SellerStorePage from "@/pages/SellerStorePage";
import OAuthConsent from "@/pages/OAuthConsent";
import NotFound from "./pages/NotFound";

const PageFallback = () => null;


const queryClient = new QueryClient();


function ProtectedRoutes() {
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
  // da tela dele brigaria com o shell do ERP por fora. O `StoreProvider`
  // continua, que é de onde vêm os dados.
  //
  // Chegar aqui com `role` ainda desconhecido não acontece mais: o
  // `AuthContext` só desliga o `loading` depois de resolver o papel.
  if (role === "seller") {
    return (
      <StoreProvider>
        <Suspense fallback={<PageFallback />}>
          <Routes>
            <Route path="/minhas-vendas" element={<SellerSalesPage />} />
            <Route path="*" element={<Navigate to="/minhas-vendas" replace />} />
          </Routes>
        </Suspense>
      </StoreProvider>
    );
  }

  return (
    <StoreProvider>
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

            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </Suspense>
      </AppLayout>
    </StoreProvider>
  );
}

/**
 * Destino de retorno preservado em `?next=`. Só aceita caminho relativo do
 * próprio app — assim o link de autorização não vira um redirecionamento
 * aberto para fora.
 */
function safeNextPath(): string | null {
  const raw = new URLSearchParams(window.location.search).get("next");
  if (!raw) return null;
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  return raw;
}

function AuthGate() {
  const { user, loading, role } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-muted-foreground">Carregando...</div>
      </div>
    );
  }

  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/loja/:sellerId" element={<SellerStorePage />} />
        <Route path="/.lovable/oauth/consent" element={<OAuthConsent />} />
        {/* Já logado em /login vai direto para a tela do próprio papel. Mandar
            todo mundo para /dashboard funcionava (o vendedor ricocheteava de
            lá para a tela dele), mas era um redirect a mais no caminho de quem
            acabou de entrar. */}
        <Route
          path="/login"
          element={
            user ? (
              <Navigate
                to={safeNextPath() ?? (role === "seller" ? "/minhas-vendas" : "/dashboard")}
                replace
              />
            ) : (
              <LoginPage />
            )
          }
        />
        <Route path="/*" element={<ProtectedRoutes />} />
      </Routes>
    </Suspense>
  );
}


const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AuthProvider>
        <ConfirmProvider>
          <BrowserRouter>
            <AuthGate />
          </BrowserRouter>
        </ConfirmProvider>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
