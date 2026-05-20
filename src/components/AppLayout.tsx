import { NavLink, useLocation } from "react-router-dom";
import { LayoutDashboard, Package, ArrowDownToLine, ShoppingCart, Receipt, Users, DollarSign, UserCheck, Wallet, ChevronLeft, ChevronRight, LogOut, Menu, X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";

const allNavItems = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard", adminOnly: true },
  { to: "/products", icon: Package, label: "Produtos", adminOnly: true },
  { to: "/stock", icon: ArrowDownToLine, label: "Entrada", adminOnly: true },
  { to: "/sales", icon: ShoppingCart, label: "Vendas", adminOnly: false },
  { to: "/expenses", icon: Receipt, label: "Despesas", adminOnly: true },
  { to: "/investors", icon: Users, label: "Investidores", adminOnly: true },
  { to: "/revenue", icon: DollarSign, label: "Receita", adminOnly: true },
  { to: "/sellers", icon: UserCheck, label: "Vendedores", adminOnly: true },
  { to: "/seller-accounts", icon: Wallet, label: "Contas Func.", adminOnly: true },
  { to: "/reports", icon: BarChart3, label: "Relatórios", adminOnly: true },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const location = useLocation();
  const { signOut, role } = useAuth();

  const navItems = allNavItems.filter(item => role === "admin" || !item.adminOnly);
  const mobileNavItems = navItems.slice(0, 5);

  return (
    <div className="flex h-screen">
      {/* Desktop sidebar */}
      <aside className={cn(
        "hidden md:flex bg-sidebar border-r border-sidebar-border flex-col transition-all duration-300 h-screen sticky top-0 overflow-y-auto",
        collapsed ? "w-16" : "w-56"
      )}>
        <div className="p-4 flex items-center gap-2 border-b border-sidebar-border">
          {!collapsed && (
            <h1 className="text-lg font-bold tracking-tight" style={{ background: 'linear-gradient(135deg, hsl(270 60% 55%), hsl(285 55% 45%))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>California</h1>
          )}
          <button onClick={() => setCollapsed(!collapsed)} className="ml-auto text-sidebar-foreground hover:text-foreground transition-colors p-1">
            {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        </div>
        <nav className="flex-1 py-3 space-y-1 px-2">
          {navItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all",
                location.pathname === item.to
                  ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                  : "text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
              )}
            >
              <item.icon size={18} />
              {!collapsed && <span>{item.label}</span>}
            </NavLink>
          ))}
        </nav>
        {!collapsed && (
          <div className="p-4 border-t border-sidebar-border">
            <p className="text-xs text-muted-foreground mb-3">California Contabilidade</p>
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
      </aside>

      {/* Main content area */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Mobile top header */}
        <header className="md:hidden flex items-center justify-between px-4 py-3 border-b border-border bg-sidebar sticky top-0 z-40">
          <h1 className="text-base font-bold tracking-tight" style={{ background: 'linear-gradient(135deg, hsl(270 60% 55%), hsl(285 55% 45%))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>California</h1>
          <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)} className="text-sidebar-foreground hover:text-foreground p-1">
            {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </header>

        {/* Mobile dropdown menu */}
        {mobileMenuOpen && (
          <div className="md:hidden absolute top-[49px] left-0 right-0 z-50 bg-sidebar border-b border-border shadow-lg animate-fade-in">
            <nav className="py-2 px-3 space-y-1">
              {navItems.map(item => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={() => setMobileMenuOpen(false)}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all",
                    location.pathname === item.to
                      ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                      : "text-sidebar-foreground hover:bg-sidebar-accent/50"
                  )}
                >
                  <item.icon size={18} />
                  <span>{item.label}</span>
                </NavLink>
              ))}
              <button
                onClick={() => { signOut(); setMobileMenuOpen(false); }}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-muted-foreground hover:text-destructive transition-colors w-full"
              >
                <LogOut size={18} />
                <span>Sair</span>
              </button>
            </nav>
          </div>
        )}

        {/* Main content */}
        <main className="flex-1 overflow-auto pb-20 md:p-0">
          <div className="p-4 md:p-6 max-w-7xl mx-auto animate-fade-in">
            {children}
          </div>
        </main>

        {/* Mobile bottom nav */}
        <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-sidebar border-t border-border flex items-center justify-around py-1.5 safe-area-bottom">
          {mobileNavItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              className={cn(
                "flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-lg text-[10px] transition-all min-w-[48px]",
                location.pathname === item.to
                  ? "text-primary"
                  : "text-muted-foreground"
              )}
            >
              <item.icon size={20} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}
