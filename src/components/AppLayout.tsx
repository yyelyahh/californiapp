import { NavLink, useLocation } from "react-router-dom";
import { LayoutDashboard, Tag, PackagePlus, TrendingDown, Receipt, FileText, HandCoins, LineChart, Coins, BookOpen, ChevronLeft, ChevronRight, LogOut, Menu, X } from "lucide-react";
import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
import PageTransition from "@/components/motion/PageTransition";
import NavIconBurst, { type NavBurst } from "@/components/motion/NavIconBurst";
import { springSoft, transitionBase, transitionFast } from "@/lib/motion";

const allNavItems = [
  { to: "/dashboard", icon: LayoutDashboard, label: "Dashboard", adminOnly: true, color: "#5DCAA5" },
  { to: "/products", icon: Tag, label: "Produtos", adminOnly: true, color: "#5DCAA5" },
  { to: "/stock", icon: PackagePlus, label: "Entrada", adminOnly: true, color: "#85B7EB" },
  { to: "/losses", icon: TrendingDown, label: "Perdas", adminOnly: true, color: "#F09595" },
  { to: "/sales", icon: Receipt, label: "Vendas", adminOnly: false, color: "#5DCAA5" },
  { to: "/expenses", icon: FileText, label: "Despesas", adminOnly: true, color: "#EF9F27" },
  { to: "/commissions", icon: HandCoins, label: "Distribuição", adminOnly: true, color: "#85B7EB" },
  { to: "/insights", icon: LineChart, label: "Insights", adminOnly: true, color: "#7F77DD" },
  { to: "/finance", icon: Coins, label: "Financeiro", adminOnly: true, color: "#EF9F27" },
  { to: "/", icon: BookOpen, label: "Catálogo", adminOnly: true, color: "#D4537E" },
];

type NavItem = (typeof allNavItems)[number];

/**
 * Telas já migradas para o tema Nocturne. Elas ocupam a largura e a altura
 * inteiras: sem o container centralizado (max-w-7xl) e sem o padding padrão do
 * layout — a própria tela cuida do seu espaçamento.
 *
 * Ao migrar uma tela nova para o Nocturne, adicione a rota dela aqui.
 */
const fullBleedRoutes = new Set(["/dashboard"]);

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [burst, setBurst] = useState<NavBurst | null>(null);
  const location = useLocation();
  const { signOut, role } = useAuth();
  const reduce = useReducedMotion();

  const navItems = allNavItems.filter(item => role === "admin" || !item.adminOnly);
  const fullBleed = fullBleedRoutes.has(location.pathname);
  const bottomBarRoutes = ["/dashboard", "/products", "/sales", "/commissions"];
  const mobileNavItems = navItems.filter(item => bottomBarRoutes.includes(item.to));

  const triggerBurst = (item: NavItem) => {
    if (reduce || location.pathname === item.to) return;
    setBurst({ id: Date.now(), icon: item.icon, label: item.label, color: item.color });
  };


  return (
    <div className="flex h-screen">
      {/* Desktop sidebar */}
      <motion.aside
        className="hidden md:flex bg-sidebar border-r border-sidebar-border flex-col h-screen sticky top-0 overflow-y-auto overflow-x-hidden"
        initial={false}
        animate={{ width: collapsed ? 56 : 192 }}
        transition={reduce ? { duration: 0 } : springSoft}
      >
        <div className="p-4 flex items-center gap-2 border-b border-sidebar-border">
          {!collapsed && (
            <h1 className="text-lg font-bold tracking-tight text-rgb-cascade whitespace-nowrap">California</h1>
          )}
          <button onClick={() => setCollapsed(!collapsed)} className="ml-auto text-sidebar-foreground hover:text-foreground transition-colors p-1">
            {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        </div>
        <nav className="flex-1 py-3 space-y-1 px-2">
          {navItems.map(item => {
            const isActive = location.pathname === item.to;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={() => triggerBurst(item)}
                className={cn(
                  "relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors",
                  isActive
                    ? "text-sidebar-accent-foreground font-medium"
                    : "text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
                )}
              >
                {isActive && (
                  <motion.span
                    layoutId={reduce ? undefined : "sidebar-active-pill"}
                    className="absolute inset-0 rounded-lg bg-sidebar-accent"
                    transition={reduce ? { duration: 0 } : springSoft}
                  />
                )}
                <motion.span
                  className="relative z-10 flex items-center gap-3 min-w-0"
                  whileHover={reduce ? undefined : { x: 2 }}
                  whileTap={reduce ? undefined : { scale: 0.97 }}
                  transition={transitionFast}
                >
                  <item.icon
                    size={18}
                    className={cn(isActive ? "" : "text-foreground")}
                    style={isActive ? { color: item.color } : undefined}
                  />
                  {!collapsed && <span className="whitespace-nowrap">{item.label}</span>}
                </motion.span>
              </NavLink>
            );
          })}
        </nav>
        {!collapsed && (
          <div className="p-4 border-t border-sidebar-border">
            <p className="text-xs text-muted-foreground mb-3 whitespace-nowrap">California Contabilidade</p>
            <button
              onClick={signOut}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-destructive transition-colors w-full"
            >
              <LogOut size={16} />
              <span>Sair</span>
            </button>
          </div>
        )}
        {collapsed && (
          <div className="p-2 border-t border-sidebar-border flex justify-center">
            <button onClick={signOut} className="text-muted-foreground hover:text-destructive transition-colors p-2">
              <LogOut size={16} />
            </button>
          </div>
        )}
      </motion.aside>

      {/* Main content area */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Mobile top header */}
        <header className="md:hidden flex items-center justify-between px-4 py-3 border-b border-border bg-sidebar sticky top-0 z-40">
          <h1 className="text-base font-bold tracking-tight text-rgb-cascade">California</h1>
          <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)} className="text-sidebar-foreground hover:text-foreground p-1">
            {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </header>

        {/* Mobile dropdown menu */}
        <AnimatePresence>
          {mobileMenuOpen && (
            <motion.div
              className="md:hidden absolute top-[49px] left-0 right-0 z-50 bg-sidebar border-b border-border shadow-lg overflow-hidden"
              initial={reduce ? false : { opacity: 0, height: 0, y: -8 }}
              animate={{ opacity: 1, height: "auto", y: 0 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, height: 0, y: -8 }}
              transition={reduce ? { duration: 0 } : transitionBase}
            >
              <nav className="py-2 px-3 space-y-1">
                {navItems.map(item => {
                  const isActive = location.pathname === item.to;
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      onClick={() => { triggerBurst(item); setMobileMenuOpen(false); }}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all",
                        isActive
                          ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                          : "text-sidebar-foreground hover:bg-sidebar-accent/50"
                      )}
                    >
                      <item.icon
                        size={18}
                        className={cn(isActive ? "" : "text-foreground")}
                        style={isActive ? { color: item.color } : undefined}
                      />
                      <span>{item.label}</span>
                    </NavLink>
                  );
                })}
                <button
                  onClick={() => { signOut(); setMobileMenuOpen(false); }}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-muted-foreground hover:text-destructive transition-colors w-full"
                >
                  <LogOut size={18} />
                  <span>Sair</span>
                </button>
              </nav>
            </motion.div>
          )}
        </AnimatePresence>

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
        <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-sidebar border-t border-border flex items-center justify-around py-1.5 safe-area-bottom">
          {mobileNavItems.map(item => {
            const isActive = location.pathname === item.to;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={() => triggerBurst(item)}
                className={cn(
                  "relative flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-lg text-[10px] transition-all min-w-[48px]",
                  isActive ? "text-primary" : "text-muted-foreground"
                )}
              >
                {isActive && !reduce && (
                  <motion.span
                    layoutId="mobile-active-dot"
                    className="absolute -top-1 h-0.5 w-6 rounded-full bg-primary"
                    transition={springSoft}
                  />
                )}
                <motion.span
                  className="flex flex-col items-center gap-0.5"
                  whileTap={reduce ? undefined : { scale: 0.92 }}
                  transition={transitionFast}
                >
                  <item.icon
                    size={20}
                    className={cn(isActive ? "" : "text-foreground")}
                    style={isActive ? { color: item.color } : undefined}
                  />
                  <span>{item.label}</span>
                </motion.span>
              </NavLink>
            );
          })}
        </nav>
      </div>

      <NavIconBurst burst={burst} onDone={() => setBurst(null)} />
    </div>
  );
}
