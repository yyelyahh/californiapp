import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Search, Package, Sparkles, LogIn, LayoutDashboard, Boxes, Tags, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface CatalogItem {
  id: string;
  name: string;
  brand: string;
  model: string;
  flavor: string;
  stock: number;
}

export default function LandingPage() {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [brandFilter, setBrandFilter] = useState<string>("all");
  const { user, role } = useAuth();
  const navigate = useNavigate();

  const load = async () => {
    const { data, error } = await supabase.rpc("get_public_catalog" as any);
    if (!error && data) setItems(data as CatalogItem[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const channel = supabase
      .channel("public-catalog")
      .on("postgres_changes", { event: "*", schema: "public", table: "products" }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const brandStats = useMemo(() => {
    const map = new Map<string, { products: number; stock: number }>();
    items.forEach((i) => {
      const k = i.brand || "Outros";
      const cur = map.get(k) ?? { products: 0, stock: 0 };
      cur.products += 1;
      cur.stock += i.stock;
      map.set(k, cur);
    });
    return Array.from(map.entries())
      .map(([brand, s]) => ({ brand, ...s }))
      .sort((a, b) => b.stock - a.stock);
  }, [items]);

  const totalUnits = useMemo(() => items.reduce((a, i) => a + i.stock, 0), [items]);

  const featuredBrands = ["Elfbar", "Ignite", "Nikbar"];
  const otherBrands = brandStats
    .map((b) => b.brand)
    .filter((b) => !featuredBrands.some((f) => f.toLowerCase() === b.toLowerCase()));

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((i) => {
      const matchBrand =
        brandFilter === "all"
          ? true
          : brandFilter === "outras"
          ? !featuredBrands.some((f) => f.toLowerCase() === i.brand.toLowerCase())
          : i.brand.toLowerCase() === brandFilter.toLowerCase();
      if (!matchBrand) return false;
      if (!q) return true;
      return (
        i.flavor.toLowerCase().includes(q) ||
        i.brand.toLowerCase().includes(q) ||
        i.model.toLowerCase().includes(q)
      );
    });
  }, [items, query, brandFilter]);

  const goApp = () => navigate(user ? (role === "seller" ? "/sales" : "/dashboard") : "/login");

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-40 backdrop-blur-xl bg-background/70 border-b border-border">
        <div className="max-w-7xl mx-auto px-4 md:px-6 h-16 flex items-center justify-between">
          <Link to="/" className="text-xl font-bold tracking-tight text-rgb-cascade">
            California
          </Link>
          <nav className="hidden md:flex items-center gap-6 text-sm text-muted-foreground">
            <a href="#marcas" className="hover:text-foreground transition-colors">Marcas</a>
            <a href="#catalogo" className="hover:text-foreground transition-colors">Catálogo</a>
          </nav>
          <Button onClick={goApp} size="sm" className="gap-2">
            {user ? <><LayoutDashboard size={15} /> Painel</> : <><LogIn size={15} /> Entrar</>}
          </Button>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-border">
        <div
          className="absolute inset-0 opacity-40 pointer-events-none"
          style={{
            background:
              "radial-gradient(60% 50% at 50% 0%, hsl(var(--primary) / 0.25), transparent 70%)",
          }}
        />
        <div className="relative max-w-7xl mx-auto px-4 md:px-6 py-16 md:py-24 text-center">
          <Badge variant="secondary" className="mb-5 gap-1.5 py-1 px-3 text-[11px] uppercase tracking-widest">
            <Sparkles size={12} /> Catálogo ao vivo
          </Badge>
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-4">
            Pods disponíveis em estoque
          </h1>
          <p className="text-muted-foreground text-base md:text-lg max-w-xl mx-auto mb-8">
            Catálogo atualizado automaticamente conforme o estoque da California.
          </p>

          <div className="flex items-center justify-center gap-3 mb-10">
            <Button
              asChild
              variant="outline"
              className="gap-2 h-11 px-6"
            >
              <a href="#catalogo">
                <ChevronDown size={16} />
                Ver Catálogo
              </a>
            </Button>
            <Button
              asChild
              className="gap-2 h-11 px-6 bg-green-600 hover:bg-green-700 text-white border-0"
            >
              <a href="https://wa.me/5551997141255" target="_blank" rel="noopener noreferrer">
                <MessageCircle size={16} />
                Falar no WhatsApp
              </a>
            </Button>
          </div>

          <div className="grid grid-cols-3 gap-3 md:gap-6 max-w-2xl mx-auto">
            {[
              { label: "Produtos disponíveis", value: items.length, icon: Package },
              { label: "Marcas cadastradas", value: brandStats.length, icon: Tags },
              { label: "Unidades em estoque", value: totalUnits, icon: Boxes },
            ].map((s) => (
              <Card key={s.label} className="border-border/60">
                <CardContent className="p-4 md:p-5 text-center">
                  <s.icon size={16} className="mx-auto text-primary mb-2" />
                  <div className="text-2xl md:text-3xl font-bold tracking-tight">{s.value}</div>
                  <div className="text-[10px] md:text-xs uppercase tracking-wider text-muted-foreground mt-1">
                    {s.label}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Brands */}
      <section id="marcas" className="max-w-7xl mx-auto px-4 md:px-6 py-12 md:py-16">
        <div className="flex items-end justify-between mb-6">
          <div>
            <h2 className="text-2xl md:text-3xl font-bold tracking-tight">Marcas</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Clique para filtrar o catálogo por marca.
            </p>
          </div>
        </div>
        {brandStats.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma marca com estoque disponível.</p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4">
            {brandStats.map((b) => {
              const active = brandFilter.toLowerCase() === b.brand.toLowerCase();
              return (
                <button
                  key={b.brand}
                  onClick={() => {
                    setBrandFilter(active ? "all" : b.brand);
                    document.getElementById("catalogo")?.scrollIntoView({ behavior: "smooth" });
                  }}
                  className={cn(
                    "group text-left rounded-2xl border p-5 transition-all hover:-translate-y-0.5",
                    active
                      ? "border-primary bg-primary/5 shadow-[0_0_0_1px_hsl(var(--primary))]"
                      : "border-border bg-card hover:border-primary/40"
                  )}
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-base font-semibold">{b.brand}</span>
                    <Tags size={14} className="text-muted-foreground group-hover:text-primary transition-colors" />
                  </div>
                  <div className="flex items-end justify-between">
                    <div>
                      <div className="text-2xl font-bold">{b.stock}</div>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">unidades</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-medium">{b.products}</div>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">sabores</div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* Catalog */}
      <section id="catalogo" className="max-w-7xl mx-auto px-4 md:px-6 pb-20">
        <div className="flex flex-col gap-4 mb-6">
          <div>
            <h2 className="text-2xl md:text-3xl font-bold tracking-tight">Catálogo</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Apenas sabores com estoque disponível.
            </p>
          </div>
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar por marca, modelo ou sabor..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9 h-11"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {[
              { id: "all", label: "Todas as marcas" },
              ...featuredBrands.map((b) => ({ id: b, label: b })),
              ...(otherBrands.length ? [{ id: "outras", label: "Outras" }] : []),
            ].map((f) => {
              const active = brandFilter.toLowerCase() === f.id.toLowerCase();
              return (
                <button
                  key={f.id}
                  onClick={() => setBrandFilter(f.id)}
                  className={cn(
                    "px-3.5 py-1.5 rounded-full text-xs font-medium border transition-all",
                    active
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card text-muted-foreground hover:text-foreground hover:border-primary/40"
                  )}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
        </div>

        {loading ? (
          <div className="text-center py-20 text-muted-foreground text-sm">Carregando catálogo...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground text-sm">
            Nenhum produto encontrado.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 md:gap-4">
            {filtered.map((p) => (
              <Card
                key={p.id}
                className="group border-border/60 hover:border-primary/40 transition-all hover:-translate-y-0.5"
              >
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-3 mb-4">
                    <Badge variant="secondary" className="text-[10px] uppercase tracking-wider">
                      {p.brand}
                    </Badge>
                    <div className="text-right">
                      <div className="text-lg font-bold leading-none">{p.stock}</div>
                      <div className="text-[9px] uppercase tracking-wider text-muted-foreground mt-1">
                        em estoque
                      </div>
                    </div>
                  </div>
                  <h3 className="text-base font-semibold leading-tight mb-1">{p.flavor}</h3>
                  {p.model && (
                    <p className="text-xs text-muted-foreground">{p.model}</p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <footer className="border-t border-border">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-8 flex flex-col md:flex-row items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground uppercase tracking-widest">
            California · Catálogo conectado ao ERP
          </p>
          <button
            onClick={goApp}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Área restrita →
          </button>
        </div>
      </footer>

      {/* Floating WhatsApp */}
      <a
        href="https://wa.me/5551997141255"
        target="_blank"
        rel="noopener noreferrer"
        className="fixed bottom-6 right-6 z-50 group"
        aria-label="Falar no WhatsApp"
      >
        <span className="absolute right-full mr-3 top-1/2 -translate-y-1/2 whitespace-nowrap rounded-lg bg-card border border-border px-3 py-1.5 text-xs font-medium text-foreground opacity-0 transition-all duration-200 group-hover:opacity-100 shadow-sm pointer-events-none">
          Falar no WhatsApp
        </span>
        <div className="flex items-center justify-center w-14 h-14 rounded-full bg-green-600 text-white shadow-lg transition-transform duration-200 hover:scale-110 hover:shadow-green-600/30">
          <svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
          </svg>
        </div>
      </a>
    </div>
  );
}
