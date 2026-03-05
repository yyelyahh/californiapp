import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { StoreProvider } from "@/context/StoreContext";
import AppLayout from "@/components/AppLayout";
import Dashboard from "@/pages/Dashboard";
import ProductsPage from "@/pages/ProductsPage";
import StockEntryPage from "@/pages/StockEntryPage";
import SalesPage from "@/pages/SalesPage";
import ExpensesPage from "@/pages/ExpensesPage";
import InvestorsPage from "@/pages/InvestorsPage";
import MonthlyRevenuePage from "@/pages/MonthlyRevenuePage";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <StoreProvider>
        <BrowserRouter>
          <AppLayout>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/products" element={<ProductsPage />} />
              <Route path="/stock" element={<StockEntryPage />} />
              <Route path="/sales" element={<SalesPage />} />
              <Route path="/expenses" element={<ExpensesPage />} />
              <Route path="/investors" element={<InvestorsPage />} />
              <Route path="/revenue" element={<MonthlyRevenuePage />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </AppLayout>
        </BrowserRouter>
      </StoreProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
