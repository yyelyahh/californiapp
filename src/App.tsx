import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { StoreProvider } from "@/context/StoreContext";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import AppLayout from "@/components/AppLayout";
import Dashboard from "@/pages/Dashboard";
import ProductsPage from "@/pages/ProductsPage";
import StockEntryPage from "@/pages/StockEntryPage";
import SalesPage from "@/pages/SalesPage";
import ExpensesPage from "@/pages/ExpensesPage";
import InvestorsPage from "@/pages/InvestorsPage";
import MonthlyRevenuePage from "@/pages/MonthlyRevenuePage";
import SellersPage from "@/pages/SellersPage";
import SellerAccountsPage from "@/pages/SellerAccountsPage";

import LoginPage from "@/pages/LoginPage";
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
          {!isSeller && <Route path="/" element={<Dashboard />} />}
          {!isSeller && <Route path="/products" element={<ProductsPage />} />}
          {!isSeller && <Route path="/stock" element={<StockEntryPage />} />}
          <Route path="/sales" element={<SalesPage />} />
          {!isSeller && <Route path="/expenses" element={<ExpensesPage />} />}
          {!isSeller && <Route path="/investors" element={<InvestorsPage />} />}
          {!isSeller && <Route path="/revenue" element={<MonthlyRevenuePage />} />}
          {!isSeller && <Route path="/sellers" element={<SellersPage />} />}
          {!isSeller && <Route path="/seller-accounts" element={<SellerAccountsPage />} />}
          {!isSeller && <Route path="/reports" element={<ReportsPage />} />}
          <Route path="*" element={isSeller ? <Navigate to="/sales" replace /> : <NotFound />} />
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
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
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
        <BrowserRouter>
          <AuthGate />
        </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
