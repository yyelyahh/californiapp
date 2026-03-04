import { NavLink, useLocation } from "react-router-dom";
import { LayoutDashboard, Package, ArrowDownToLine, ShoppingCart, Receipt, Users, ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/products", icon: Package, label: "Produtos" },
  { to: "/stock", icon: ArrowDownToLine, label: "Entrada" },
  { to: "/sales", icon: ShoppingCart, label: "Vendas" },
  { to: "/expenses", icon: Receipt, label: "Despesas" },
  { to: "/investors", icon: Users, label: "Investidores" },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();

  return (
    <div className="flex min-h-screen">
      <aside className={cn(
        "bg-sidebar border-r border-sidebar-border flex flex-col transition-all duration-300",
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
            <p className="text-xs text-muted-foreground">California Contabilidade</p>
          </div>
        )}
      </aside>
      <main className="flex-1 overflow-auto">
        <div className="p-6 max-w-7xl mx-auto animate-fade-in">
          {children}
        </div>
      </main>
    </div>
  );
}
