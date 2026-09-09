import { NavLink, useLocation } from "react-router-dom";
import {
  SquaresFour, Tag, Package, TrendDown, Receipt, FileText, HandCoins, ChartLine, Coins, BookOpen,
  CaretLeft, CaretRight, SignOut, List, X,
} from "@phosphor-icons/react";
import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
import PageTransition from "@/components/motion/PageTransition";
import { EYEBROW } from "@/components/nocturne";
import { springSoft, transitionBase, transitionFast } from "@/lib/motion";

/**
 * Os glifos são os mesmos do mockup Nocturne: Phosphor Regular, um a um
 * (squares-four, tag, package, trend-down, receipt, file-text, hand-coins,
 * chart-line, coins, book-open) — antes eram equivalentes aproximados do
 * lucide, com peso de traço e desenho diferentes.
 *
 * Cada item já teve uma `color` própria, usada só pelo flash em tela cheia que
 * existia ao trocar de página. O flash saiu (ver PageTransition) e a cor saiu
 * com ele: no Nocturne o item ativo usa o accent, e só ele.
 *
 * Lista corrida, sem agrupar por categoria: a ordem aqui é a ordem na tela.
 */
const allNavItems = [
  { to: "/dashboard", icon: SquaresFour, label: "Dashboard", adminOnly: true },
  { to: "/products", icon: Tag, label: "Produtos", adminOnly: true },
  { to: "/stock", icon: Package, label: "Entrada", adminOnly: true },
  { to: "/losses", icon: TrendDown, label: "Perdas", adminOnly: true },
  { to: "/sales", icon: Receipt, label: "Vendas", adminOnly: false },
  { to: "/expenses", icon: FileText, label: "Despesas", adminOnly: true },
  { to: "/commissions", icon: HandCoins, label: "Distribuição", adminOnly: true },
  { to: "/insights", icon: ChartLine, label: "Insights", adminOnly: true },
  { to: "/finance", icon: Coins, label: "Financeiro", adminOnly: true },
  { to: "/", icon: BookOpen, label: "Catálogo", adminOnly: true },
];

/**
 * Telas já migradas para o tema Nocturne. Elas ocupam a largura e a altura
 * inteiras: sem o container centralizado (max-w-7xl) e sem o padding padrão do
 * layout — a própria tela cuida do seu espaçamento.
 *
 * Ao migrar uma tela nova para o Nocturne, adicione a rota dela aqui.
 */
const fullBleedRoutes = new Set(["/dashboard", "/products", "/stock", "/losses", "/sales"]);

/** Atalhos da barra inferior no celular. */
const bottomBarRoutes = ["/dashboard", "/products", "/sales", "/commissions"];

/**
 * Realce do item ativo — a MESMA peça do `PeriodChips` do Dashboard: contorno de
 * 1px no accent sobre um preenchimento de 10%. Fica aqui em cima porque as três
 * navegações (sidebar, menu mobile, barra inferior) precisam pintar igual; se
 * divergirem, a barra de baixo passa a parecer de outro app.
 */
const ACTIVE_PILL: React.CSSProperties = {
  boxShadow: "inset 0 0 0 1px var(--nc-accent)",
  background: "color-mix(in srgb, var(--nc-accent) 10%, transparent)",
};

const SIDEBAR_WIDTH = 208;
const SIDEBAR_COLLAPSED = 56;

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const location = useLocation();
  const { signOut, role, user } = useAuth();
  const reduce = useReducedMotion();

  const navItems = allNavItems.filter(item => role === "admin" || !item.adminOnly);
  const mobileNavItems = navItems.filter(item => bottomBarRoutes.includes(item.to));

  const fullBleed = fullBleedRoutes.has(location.pathname);
  const closeMenu = () => setMobileMenuOpen(false);

  return (
    <div className="flex h-screen">
      {/* ---------------- Sidebar (desktop) ----------------
          Mesmo papel do trilho direito do Dashboard, e por isso a mesma cor:
          --nc-rail. A separação do conteúdo é por TOM, não por borda — é assim
          que o painel separa o trilho, e uma linha aqui denunciaria a emenda.
          A classe `nocturne` traz a fonte (Inter) e o anel de foco no accent;
          o `background` inline sobrepõe o --nc-bg que ela aplicaria. */}
      <motion.aside
        className="nocturne hidden md:flex flex-col h-screen sticky top-0 overflow-y-auto overflow-x-hidden"
        style={{ background: "var(--nc-rail)" }}
        initial={false}
        animate={{ width: collapsed ? SIDEBAR_COLLAPSED : SIDEBAR_WIDTH }}
        transition={reduce ? { duration: 0 } : springSoft}
      >
        <div
          className="flex items-center gap-2 px-3 py-3"
          style={{ borderBottom: "1px solid var(--nc-track)" }}
        >
          {!collapsed && (
            <div className="min-w-0">
              <h1 className="nc-wordmark text-[15px] font-medium leading-tight tracking-tight whitespace-nowrap">
                California
              </h1>
              <p className={cn(EYEBROW, "whitespace-nowrap")} style={{ color: "var(--nc-text-3)" }}>
                Contabilidade
              </p>
            </div>
          )}
          <button
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
            className="nc-btn nc-btn--ghost nc-btn--icon ml-auto"
          >
            {collapsed ? <CaretRight size={16} /> : <CaretLeft size={16} />}
          </button>
        </div>

        <nav className="flex-1 space-y-0.5 px-2 py-3">
          {navItems.map(item => {
            const isActive = location.pathname === item.to;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                title={collapsed ? item.label : undefined}
                data-active={isActive}
                className="nc-nav-item relative flex items-center gap-3 rounded-md px-2.5 py-2 text-[13px]"
              >
                {isActive && (
                  <motion.span
                    layoutId={reduce ? undefined : "sidebar-active-pill"}
                    className="absolute inset-0 rounded-md"
                    style={ACTIVE_PILL}
                    transition={reduce ? { duration: 0 } : transitionBase}
                  />
                )}
                <motion.span
                  className="relative z-10 flex min-w-0 items-center gap-3"
                  whileHover={reduce ? undefined : { x: 2 }}
                  whileTap={reduce ? undefined : { scale: 0.97 }}
                  transition={transitionFast}
                >
                  {/* Ícone herda a cor da linha (currentColor): ativo sai no
                      accent junto com o rótulo. */}
                  <item.icon size={18} />
                  {!collapsed && <span className="whitespace-nowrap">{item.label}</span>}
                </motion.span>
              </NavLink>
            );
          })}
        </nav>

        {/* Rodapé: quem está logado. O trilho do Dashboard fecha com um bloco de
            peso (as últimas vendas); este fecha com a identidade — que até agora
            não aparecia em lugar nenhum do app. */}
        <div className="mx-2 mb-3 px-1">
          {/* Recolhida, a régua que apaga nas pontas some (as bordas de 40px
              somam mais que a largura do trilho): ali entra uma linha reta. */}
          <div
            className={cn("pt-3", !collapsed && "nc-rule-top")}
            style={collapsed ? { borderTop: "1px solid var(--nc-track)" } : undefined}
          >
            <Identity email={user?.email} role={role} collapsed={collapsed} />
            <button
              onClick={signOut}
              aria-label="Sair"
              className={cn(
                "nc-signout mt-2.5 flex w-full items-center gap-2 text-[12.5px]",
                collapsed && "justify-center",
              )}
            >
              <SignOut size={15} />
              {!collapsed && <span>Sair</span>}
            </button>
          </div>
        </div>
      </motion.aside>

      {/* Main content area */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Véu do menu mobile. Fecha um buraco de uso: até agora só o X fechava
            o menu, tocar fora não fazia nada. Fica em z-45 — acima da barra
            inferior (z-40), que também deve escurecer, e abaixo do cabeçalho
            (z-50), que continua clicável para fechar. */}
        <AnimatePresence>
          {mobileMenuOpen && (
            <motion.button
              key="scrim"
              type="button"
              aria-label="Fechar menu"
              onClick={closeMenu}
              className="md:hidden fixed inset-0 z-[45] cursor-default"
              style={{ background: "color-mix(in srgb, var(--nc-bg) 72%, transparent)" }}
              initial={reduce ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={reduce ? { duration: 0 } : transitionBase}
            />
          )}
        </AnimatePresence>

        {/* Cabeçalho e menu vivem no MESMO invólucro grudento, e o menu abre em
            `top-full`. Ancorar no cabeçalho em vez de num deslocamento fixo em
            px importa: o cabeçalho tem duas linhas e a altura muda com a fonte
            do sistema — qualquer número cravado aqui vira uma fresta do
            conteúdo aparecendo entre os dois. */}
        <div className="md:hidden sticky top-0 z-50">
          <header
            className="nocturne flex items-center justify-between px-4 py-2.5"
            style={{ background: "var(--nc-rail)", borderBottom: "1px solid var(--nc-track)" }}
          >
            <div>
              <h1 className="nc-wordmark text-[15px] font-medium leading-tight tracking-tight">California</h1>
              <p className={EYEBROW} style={{ color: "var(--nc-text-3)" }}>Contabilidade</p>
            </div>
            <button
              onClick={() => setMobileMenuOpen(v => !v)}
              aria-label={mobileMenuOpen ? "Fechar menu" : "Abrir menu"}
              aria-expanded={mobileMenuOpen}
              className="nc-btn nc-btn--ghost nc-btn--icon"
            >
              {mobileMenuOpen ? <X size={20} /> : <List size={20} />}
            </button>
          </header>

          {/* O menu é o MESMO trilho da esquerda — mesma lista, mesmo realce,
              mesmo rodapé de identidade: antes o menu aberto não parecia a
              mesma peça que a sidebar. */}
          <AnimatePresence>
            {mobileMenuOpen && (
              <motion.div
                key="menu"
                className="nocturne absolute inset-x-0 top-full max-h-[75dvh] overflow-y-auto"
                style={{
                  background: "var(--nc-rail)",
                  borderBottom: "1px solid var(--nc-track)",
                }}
                initial={reduce ? false : { opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, y: -8 }}
                transition={reduce ? { duration: 0 } : transitionBase}
              >
                <nav className="space-y-0.5 px-3 py-3">
                  {navItems.map(item => {
                    const isActive = location.pathname === item.to;
                    return (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        onClick={closeMenu}
                        data-active={isActive}
                        className="nc-nav-item flex items-center gap-3 rounded-md px-2.5 py-2 text-[13px]"
                        style={isActive ? ACTIVE_PILL : undefined}
                      >
                        <item.icon size={18} />
                        <span>{item.label}</span>
                      </NavLink>
                    );
                  })}
                </nav>
                <div className="mx-3 mb-3">
                  <div className="nc-rule-top flex items-center justify-between gap-3 pt-3">
                    <Identity email={user?.email} role={role} />
                    <button
                      onClick={() => { signOut(); closeMenu(); }}
                      className="nc-signout flex flex-none items-center gap-2 text-[12.5px]"
                    >
                      <SignOut size={15} />
                      <span>Sair</span>
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Main content */}
        <main
          className={cn(
            "flex-1 overflow-y-auto overflow-x-hidden pb-20",
            fullBleed
              // O tema fica no <main>, e não só na página: assim o fundo escuro
              // cobre a área de rolagem inteira mesmo quando o conteúdo é curto
              // ou quando sobra o respiro da barra inferior no mobile.
              ? "nocturne flex flex-col md:pb-0"
              : "md:pb-6",
          )}
        >
          <div
            className={cn(
              "min-w-0",
              fullBleed ? "flex flex-1 flex-col" : "p-3 md:p-6 max-w-7xl mx-auto w-full",
            )}
          >
            <PageTransition className={fullBleed ? "flex flex-1 flex-col" : undefined}>
              {children}
            </PageTransition>
          </div>
        </main>

        {/* Mobile bottom nav */}
        <nav
          className="nocturne md:hidden fixed bottom-0 left-0 right-0 z-40 flex items-center justify-around py-1.5 safe-area-bottom"
          style={{ background: "var(--nc-rail)", borderTop: "1px solid var(--nc-track)" }}
        >
          {mobileNavItems.map(item => {
            const isActive = location.pathname === item.to;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                data-active={isActive}
                className="nc-nav-item relative flex min-w-[48px] flex-col items-center gap-0.5 rounded-lg px-2 py-1.5 text-[10px]"
              >
                {isActive && !reduce && (
                  <motion.span
                    layoutId="mobile-active-dot"
                    className="absolute -top-1 h-0.5 w-6 rounded-full"
                    style={{ background: "var(--nc-accent)" }}
                    transition={springSoft}
                  />
                )}
                <motion.span
                  className="flex flex-col items-center gap-0.5"
                  whileTap={reduce ? undefined : { scale: 0.92 }}
                  transition={transitionFast}
                >
                  <item.icon size={20} />
                  <span>{item.label}</span>
                </motion.span>
              </NavLink>
            );
          })}
        </nav>
      </div>
    </div>
  );
}

const ROLE_LABEL: Record<string, string> = {
  admin: "Administrador",
  seller: "Vendedor",
};

/**
 * Quem está logado. A inicial vem num quadrado com o realce do item ativo (o
 * mesmo contorno accent sobre preenchimento translúcido), então, recolhida, ela
 * sozinha ainda diz que ali embaixo mora a conta.
 */
function Identity({ email, role, collapsed }: { email?: string | null; role?: string | null; collapsed?: boolean }) {
  const initial = (email?.trim()[0] ?? "?").toUpperCase();
  const roleLabel = role ? ROLE_LABEL[role] ?? role : "Sessão";

  const badge = (
    <span
      className="flex h-7 w-7 flex-none items-center justify-center rounded-md text-[12px] font-medium"
      style={{
        color: "var(--nc-accent)",
        background: "color-mix(in srgb, var(--nc-accent) 12%, transparent)",
        boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--nc-accent) 40%, transparent)",
      }}
      aria-hidden
    >
      {initial}
    </span>
  );

  if (collapsed) {
    return <div className="flex justify-center" title={email ?? roleLabel}>{badge}</div>;
  }

  return (
    <div className="flex min-w-0 items-center gap-2.5" title={email ?? undefined}>
      {badge}
      <div className="min-w-0">
        <p className={EYEBROW} style={{ color: "var(--nc-accent)" }}>{roleLabel}</p>
        <p className="truncate text-[11.5px]" style={{ color: "var(--nc-text-2)" }}>
          {email ?? "—"}
        </p>
      </div>
    </div>
  );
}
