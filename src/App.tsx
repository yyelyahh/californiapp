import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { lazy, Suspense } from "react";
import { StoreProvider } from "@/context/StoreContext";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import AppLayout from "@/components/AppLayout";
import { ConfirmProvider } from "@/components/ConfirmProvider";

const Dashboard = lazy(() => import("@/pages/Dashboard"));
const ProductsPage = lazy(() => import("@/pages/ProductsPage"));
const StockEntryPage = lazy(() => import("@/pages/StockEntryPage"));
const SalesPage = lazy(() => import("@/pages/SalesPage"));
const ExpensesPage = lazy(() => import("@/pages/ExpensesPage"));
const FinancePage = lazy(() => import("@/pages/FinancePage"));
const LossesPage = lazy(() => import("@/pages/LossesPage"));
const CommissionsPage = lazy(() => import("@/pages/CommissionsPage"));
const InsightsPage = lazy(() => import("@/pages/InsightsPage"));
const LoginPage = lazy(() => import("@/pages/LoginPage"));
const LandingPage = lazy(() => import("@/pages/LandingPage"));
const NotFound = lazy(() => import("./pages/NotFound"));

const PageFallback = () => (
  <div className="flex min-h-[50vh] items-center justify-center">
    <div className="text-muted-foreground text-sm">Carregando...</div>
  </div>
);

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

  const isSeller = role === "seller";

  return (
    <StoreProvider>
      <AppLayout>
        <Routes>
          {!isSeller && <Route path="/dashboard" element={<Dashboard />} />}
          {!isSeller && <Route path="/products" element={<ProductsPage />} />}
          {!isSeller && <Route path="/stock" element={<StockEntryPage />} />}
          <Route path="/sales" element={<SalesPage />} />
          {!isSeller && <Route path="/expenses" element={<ExpensesPage />} />}
          {!isSeller && <Route path="/investors" element={<Navigate to="/finance" replace />} />}
          {!isSeller && <Route path="/finance" element={<FinancePage />} />}
          {!isSeller && <Route path="/revenue" element={<Navigate to="/commissions" replace />} />}
          {!isSeller && <Route path="/sellers" element={<Navigate to="/commissions" replace />} />}
          {!isSeller && <Route path="/seller-accounts" element={<Navigate to="/commissions" replace />} />}
          {!isSeller && <Route path="/losses" element={<LossesPage />} />}
          {!isSeller && <Route path="/commissions" element={<CommissionsPage />} />}
          {!isSeller && <Route path="/insights" element={<InsightsPage />} />}

          <Route path="*" element={<Navigate to={isSeller ? "/sales" : "/dashboard"} replace />} />
        </Routes>
      </AppLayout>
    </StoreProvider>
  );
}

function AuthGate() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-muted-foreground">Carregando...</div>
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={user ? <Navigate to="/dashboard" replace /> : <LoginPage />} />
      <Route path="/*" element={<ProtectedRoutes />} />
    </Routes>
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
