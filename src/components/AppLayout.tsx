import { NavLink, useLocation } from "react-router-dom";
import {
  SquaresFour, Tag, Package, TrendDown, Receipt, FileText, HandCoins, ChartLine, Coins, ClockCounterClockwise,
  CaretLeft, CaretRight, SignOut, List, X,
} from "@phosphor-icons/react";
import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
import PageTransition from "@/components/motion/PageTransition";
import BranchSwitcher from "@/components/BranchSwitcher";
import { EYEBROW } from "@/components/nocturne";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { springSoft, transitionBase, transitionFast } from "@/lib/motion";

/**
 * Os glifos são os mesmos do mockup Nocturne: Phosphor Regular, um a um
 * (squares-four, tag, package, trend-down, receipt, file-text, hand-coins,
 * chart-line, coins) — antes eram equivalentes aproximados do lucide, com peso
 * de traço e desenho diferentes. A Auditoria nasceu depois do mockup e usa o
 * clock-counter-clockwise, o glifo de "o que já aconteceu" da mesma família.
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
  { to: "/audit", icon: ClockCounterClockwise, label: "Auditoria", adminOnly: true },
];

/**
 * Telas já migradas para o tema Nocturne. Elas ocupam a largura e a altura
 * inteiras: sem o container centralizado (max-w-7xl) e sem o padding padrão do
 * layout — a própria tela cuida do seu espaçamento.
 *
 * Ao migrar uma tela nova para o Nocturne, adicione a rota dela aqui.
 */
const fullBleedRoutes = new Set(["/dashboard", "/products", "/stock", "/losses", "/sales", "/expenses", "/commissions", "/insights", "/finance", "/audit"]);

/**
 * Atalhos da barra inferior no celular — quatro, e o quinto lugar é o "Mais".
 *
 * Eram estes quatro e mais nada: as outras seis telas só existiam atrás do
 * hambúrguer do topo, o que deixava DUAS navegações para a mesma lista, e a de
 * baixo — a que o polegar alcança — era a incompleta. Agora o "Mais" abre a
 * lista inteira, o hambúrguer sai do cabeçalho e a navegação volta a ser uma
 * só.
 *
 * A folha do "Mais" traz TODAS as telas, inclusive estas quatro: quem abre uma
 * lista chamada "mais" procurando "Produtos" não pode não encontrar.
 */
const bottomBarRoutes = ["/dashboard", "/products", "/sales", "/commissions"];

/**
 * Acima disto a barra não comporta mais um atalho e o excedente vira "Mais".
 * Com quatro ou menos telas alcançáveis (o caso de quem não é admin) a barra
 * mostra todas e o botão nem aparece — "Mais" para abrir uma lista de duas
 * linhas seria um toque a mais para chegar ao mesmo lugar.
 */
const MAX_BOTTOM_ITEMS = 5;

/**
 * Realce do item ativo — a MESMA peça do `SegmentedChips` do Dashboard: contorno de
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

  // Com poucas telas alcançáveis a barra mostra todas; passando disso ela fica
  // com os quatro atalhos e o quinto lugar vira o "Mais".
  const needsMore = navItems.length > MAX_BOTTOM_ITEMS;
  const mobileNavItems = needsMore
    ? navItems.filter(item => bottomBarRoutes.includes(item.to))
    : navItems;

  // O "Mais" fica aceso quando a tela atual NÃO está entre os atalhos: sem
  // isso, estar na Auditoria não acende nada na barra e ela passa a dizer que
  // não se está em lugar nenhum.
  const moreActive = needsMore && !mobileNavItems.some(item => item.to === location.pathname);

  const fullBleed = fullBleedRoutes.has(location.pathname);
  const closeMenu = () => setMobileMenuOpen(false);

  return (
    // `h-screen` é 100vh, e no celular 100vh NÃO é o que se vê: o Safari e o
    // Chrome medem a altura com a barra de endereço recolhida, então a raiz
    // nasce mais alta que a janela e o documento inteiro ganha uma sobra para
    // arrastar — é o "a página se mexe sozinha" que não tem conteúdo nenhum
    // embaixo. `dvh` é a altura VISÍVEL, que encolhe e cresce junto com a barra.
    // O `supports` mantém o 100vh de pé em navegador que não conhece a unidade,
    // onde o comportamento errado ainda é melhor que altura nenhuma.
    <div className="flex h-screen supports-[height:100dvh]:h-[100dvh]">
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

        {/* Logo abaixo do wordmark, antes da navegação: a filial é o escopo de
            TUDO o que vem depois dela na tela, e ler o escopo antes da lista é
            a ordem em que a pessoa pensa. Recolhida, sobra a inicial — mesma
            saída do bloco de identidade no rodapé. */}
        <div style={{ borderBottom: "1px solid var(--nc-track)" }}>
          {collapsed ? (
            <div className="py-2.5">
              <BranchSwitcher collapsed />
            </div>
          ) : (
            <BranchSwitcher />
          )}
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
        {/* Cabeçalho do celular. Perdeu o hambúrguer e o menu suspenso: a
            navegação inteira mora na barra de baixo, ao alcance do polegar.
            Sobrou o que identifica onde se está — a marca e a FILIAL, que é o
            escopo de todo número da tela e precisa ficar na faixa fixa.

            Uma linha só, e não duas: o "Contabilidade" embaixo do wordmark é
            decoração que nunca muda, e no celular ele custava ~14px de altura
            em TODA tela, permanentes, numa janela onde a lista é o que importa.
            Ele continua na sidebar do desktop, onde o trilho tem espaço de
            sobra. */}
        <header
          className="nocturne sticky top-0 z-50 flex items-center gap-2 px-4 py-2 md:hidden"
          style={{ background: "var(--nc-rail)", borderBottom: "1px solid var(--nc-track)" }}
        >
          <h1 className="nc-wordmark flex-none text-[15px] font-medium leading-tight tracking-tight">California</h1>
          <div className="ml-auto min-w-0">
            <BranchSwitcher compact />
          </div>
        </header>

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

        {/* Barra inferior: a ÚNICA navegação do celular desde que o hambúrguer
            saiu do cabeçalho. Cada alvo tem 56px de altura — é onde o polegar
            bate, e era a peça com 10px de rótulo em cima de um toque de 48px. */}
        <nav
          className="nocturne fixed bottom-0 left-0 right-0 z-40 flex items-stretch justify-around safe-area-bottom md:hidden"
          style={{ background: "var(--nc-rail)", borderTop: "1px solid var(--nc-track)" }}
        >
          {mobileNavItems.map(item => {
            const isActive = location.pathname === item.to;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                data-active={isActive}
                className="nc-nav-item relative flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1 rounded-lg px-1 text-[11px]"
              >
                {isActive && !reduce && (
                  <motion.span
                    layoutId="mobile-active-dot"
                    className="absolute top-0 h-0.5 w-6 rounded-full"
                    style={{ background: "var(--nc-accent)" }}
                    transition={springSoft}
                  />
                )}
                <motion.span
                  className="flex flex-col items-center gap-1"
                  whileTap={reduce ? undefined : { scale: 0.92 }}
                  transition={transitionFast}
                >
                  <item.icon size={21} />
                  <span className="leading-none">{item.label}</span>
                </motion.span>
              </NavLink>
            );
          })}

          {needsMore && (
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Mais telas"
              aria-expanded={mobileMenuOpen}
              data-active={moreActive || mobileMenuOpen}
              className="nc-nav-item relative flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1 rounded-lg px-1 text-[11px]"
            >
              {/* O traço do ativo é o MESMO `layoutId` dos atalhos: assim ele
                  desliza até aqui quando a tela atual está fora da barra, em
                  vez de apagar de um lado e acender do outro. */}
              {moreActive && !reduce && (
                <motion.span
                  layoutId="mobile-active-dot"
                  className="absolute top-0 h-0.5 w-6 rounded-full"
                  style={{ background: "var(--nc-accent)" }}
                  transition={springSoft}
                />
              )}
              <motion.span
                className="flex flex-col items-center gap-1"
                whileTap={reduce ? undefined : { scale: 0.92 }}
                transition={transitionFast}
              >
                <List size={21} />
                <span className="leading-none">Mais</span>
              </motion.span>
            </button>
          )}
        </nav>

        {/* A lista inteira, subindo de baixo — do mesmo lado em que o dedo
            tocou. O menu antigo descia do TOPO, a 600px do polegar que abriu
            ele.

            Traz TODAS as telas, inclusive as quatro que já estão na barra: quem
            abre uma lista chamada "Mais" procurando "Produtos" não pode deixar
            de encontrar. Ordem corrida, a mesma da sidebar — agrupar por
            categoria aqui inventaria uma taxonomia que o resto do app não tem.

            `side="bottom"` com altura automática, e não um painel de tela
            cheia: com dez linhas de 48px mais o rodapé ele para na metade da
            tela, e o que sobra por cima continua mostrando a página — é o que
            deixa claro que dá para fechar tocando fora. */}
        <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
          <SheetContent
            side="bottom"
            className="nocturne max-h-[85dvh] gap-0 overflow-y-auto rounded-t-2xl border-0 p-0 md:hidden"
            style={{ background: "var(--nc-rail)", boxShadow: "0 -1px 0 var(--nc-track)" }}
          >
            <SheetHeader className="px-4 pb-1 pt-4 text-left">
              <SheetTitle className={cn(EYEBROW, "font-normal")} style={{ color: "var(--nc-text-3)" }}>
                Ir para
              </SheetTitle>
              <SheetDescription className="sr-only">
                Todas as telas do painel.
              </SheetDescription>
            </SheetHeader>

            <nav className="space-y-0.5 px-2 py-2">
              {navItems.map(item => {
                const isActive = location.pathname === item.to;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={closeMenu}
                    data-active={isActive}
                    className="nc-nav-item flex min-h-[48px] items-center gap-3 rounded-md px-3 text-[14px]"
                    style={isActive ? ACTIVE_PILL : undefined}
                  >
                    <item.icon size={20} />
                    <span>{item.label}</span>
                  </NavLink>
                );
              })}
            </nav>

            <div className="mx-4 mb-4">
              <div className="nc-rule-top flex items-center justify-between gap-3 pt-3">
                <Identity email={user?.email} role={role} />
                <button
                  onClick={() => { signOut(); closeMenu(); }}
                  className="nc-signout flex min-h-[44px] flex-none items-center gap-2 px-2 text-[13px]"
                >
                  <SignOut size={16} />
                  <span>Sair</span>
                </button>
              </div>
            </div>
          </SheetContent>
        </Sheet>
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
