# Fluidez com Motion (Framer Motion) no app

Adicionar animações consistentes e leves em todo o sistema, sem alterar nenhuma lógica de negócio, cálculo ou dados.

## Princípios

- Uma única "linguagem" de movimento: rápido (150–350ms), curvas suaves, deslocamentos curtos (8–12px).
- Respeitar `prefers-reduced-motion`: quem tiver animações reduzidas no sistema vê tudo estático.
- Zero impacto em performance: nada de animar listas gigantes item a item sem limite.

## O que ganha animação

1. **Transição entre páginas**
  Ao trocar de rota, o conteúdo faz um fade + leve subida. Substitui o `animate-fade-in` atual do layout.
2. **Sidebar / navegação**
  - Indicador do item ativo desliza suavemente entre os itens (efeito de "pílula" que acompanha a seleção).
  - Menu mobile abre/fecha com slide + fade em vez de aparecer seco.
  - Recolher/expandir a sidebar fica com largura animada.
3. **Cards e KPIs (Dashboard, Distribuição, Insights, Financeiro)**
  - Entrada em cascata (cada card entra com um pequeno atraso em sequência).
  - Hover com leve elevação nos cards clicáveis.
  - Números dos KPIs com contagem animada até o valor final.
4. **Listas e tabelas (Vendas, Produtos, Entrada, Perdas, Despesas)**
  - Linhas/cards entram em cascata (limitada aos primeiros itens visíveis).
  - Ao excluir/adicionar um item, ele sai/entra com animação em vez de sumir instantaneamente.
5. **Drawers, sheets e diálogos**
  Manter os componentes atuais, apenas suavizando as curvas de abertura/fechamento para o mesmo padrão.
6. **Login e catálogo**
  - Login: card entra com fade + escala sutil.
  - Catálogo: cards de modelo com hover elevado e o painel lateral de sabores com entrada em cascata.
7. **Feedback de ações**
  Botões com micro-reação ao clique (leve compressão) e estados de carregamento mais suaves.

## Detalhes técnicos

- Instalar `motion` (pacote atual do Framer Motion, import `motion/react`).
- Criar `src/lib/motion.ts` com as variantes compartilhadas (`fadeUp`, `stagger`, `scaleIn`, transições padrão) para não espalhar valores mágicos.
- Criar `src/components/motion/PageTransition.tsx` (usa `AnimatePresence` com a chave da rota) e aplicá-lo em `AppLayout`.
- Criar `src/components/motion/MotionCard.tsx` e `AnimatedNumber.tsx` reutilizáveis.
- Sidebar: usar `layoutId` no indicador de item ativo em `AppLayout.tsx`.
- Cascata em listas: `staggerChildren` no container, com limite (ex.: só os ~20 primeiros itens animam) para não pesar em listas longas.
- `useReducedMotion` para desligar tudo quando o usuário preferir.
- Nenhuma mudança em `StoreContext`, `commissions.ts`, queries ou banco.

## Ordem de execução

1. Instalar dependência + criar utilitários de motion.
2. Transição de rota + sidebar (impacto imediato em todo o app).
3. Dashboard, Distribuição, Insights, Financeiro (cards + números).
4. Vendas, Produtos, Entrada, Perdas, Despesas (listas).
5. Login e Catálogo.
6. Verificação de build e revisão visual no preview.