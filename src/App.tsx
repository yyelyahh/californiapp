import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { StoreProvider } from "@/context/StoreContext";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import AppLayout from "@/components/AppLayout";
import { ConfirmProvider } from "@/components/ConfirmProvider";
import Dashboard from "@/pages/Dashboard";
import ProductsPage from "@/pages/ProductsPage";
import StockEntryPage from "@/pages/StockEntryPage";
import SalesPage from "@/pages/SalesPage";
import ExpensesPage from "@/pages/ExpensesPage";
import InvestorsPage from "@/pages/InvestorsPage";

import LossesPage from "@/pages/LossesPage";
import CommissionsPage from "@/pages/CommissionsPage";

import LoginPage from "@/pages/LoginPage";
import LandingPage from "@/pages/LandingPage";
import NotFound from "./pages/NotFound";

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
          {!isSeller && <Route path="/investors" element={<InvestorsPage />} />}
          {!isSeller && <Route path="/revenue" element={<MonthlyRevenuePage />} />}
          {!isSeller && <Route path="/sellers" element={<SellersPage />} />}
          {!isSeller && <Route path="/seller-accounts" element={<Navigate to="/commissions" replace />} />}
          {!isSeller && <Route path="/losses" element={<LossesPage />} />}
          {!isSeller && <Route path="/commissions" element={<CommissionsPage />} />}

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
