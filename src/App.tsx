import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { BootScreen, BOOT_STEPS } from "@/components/BootScreen";
import { Suspense, lazy } from "react";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { ConfirmProvider } from "@/components/ConfirmProvider";

/**
 * Nada de tela vem por `import` de topo: cada uma é um `lazy`.
 *
 * Antes o navegador baixava o app INTEIRO antes de desenhar a primeira tela —
 * o recharts do Dashboard, o xlsx do relatório e a operação inteira chegavam
 * junto com o login, num arquivo só de 1,6 MB. Ninguém usa 14 telas de uma
 * vez, e quem abre a loja pelo WhatsApp nunca vai ver a Auditoria.
 *
 * `ProtectedRoutes` é o corte maior: ele leva junto o `AppLayout` e o
 * `StoreContext`, que são o ERP e não têm o que fazer na loja pública nem na
 * tela de login.
 *
 * O `<Suspense>` que embrulha o `<Routes>` abaixo já existia; o que faltava era
 * dar a ele o que esperar. O fallback é `null` de propósito: o pedaço da tela
 * chega em milissegundos e um spinner que pisca é pior que um quadro em branco
 * que não chega a ser visto.
 */
const ProtectedRoutes = lazy(() => import("@/ProtectedRoutes"));
const LoginPage = lazy(() => import("@/pages/LoginPage"));
const SellerStorePage = lazy(() => import("@/pages/SellerStorePage"));
const OAuthConsent = lazy(() => import("@/pages/OAuthConsent"));

const PageFallback = () => null;


const queryClient = new QueryClient();


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
  const { pathname } = useLocation();

  if (loading) {
    // A loja pública também espera a sessão aqui, e quem abre o link do
    // vendedor não tem nada a ver com o ERP: para ela, o texto neutro de
    // sempre. A tela de entrada com a marca é de quem vai ENTRAR no sistema.
    if (pathname.startsWith("/loja/")) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-background">
          <div className="text-muted-foreground">Carregando...</div>
        </div>
      );
    }
    return <BootScreen progress={BOOT_STEPS.session} label="Verificando sua sessão" />;
  }

  return (
    <Suspense fallback={<PageFallback />}>
      {/* `/` não tem tela própria: a raiz cai em `ProtectedRoutes` pelo `/*`
          abaixo, que manda para o login ou para a tela do papel de quem já está
          logado. Havia ali um catálogo público (`LandingPage`), removido por
          não ser usado — a loja de verdade é `/loja/:sellerId`, e essa fica. */}
      <Routes>
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
