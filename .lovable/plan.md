## Objetivo

Criar uma nova página **Insights** no ERP com 4 indicadores de negócio, todos respeitando um filtro de período único no topo (mês atual · mês anterior · personalizado), no mesmo padrão visual das demais páginas.

---

## 1. Banco de dados

Adicionar coluna `min_stock` (integer, default 0) na tabela `products`.

Ajustes no frontend:
- `Product` type ganha `minStock: number`.
- `StoreContext.mapProduct` lê `min_stock`.
- `addProduct` / `updateProduct` gravam `min_stock`.
- `AddProductDialog` e o edit inline em `ProductsPage` ganham um campo "Estoque mínimo" (opcional, default 0).

---

## 2. Nova rota `/insights`

Criar `src/pages/InsightsPage.tsx` e adicionar item "Insights" no menu (sidebar + mobile) em `AppLayout.tsx`, entre "Distribuição" e "Financeiro".

Filtro de período no topo (mesmo componente já usado em CommissionsPage): Mês atual · Mês anterior · Personalizado (2 date inputs).

---

## 3. Cards

Todos clicáveis, abrem um `Sheet` (drawer) com o detalhamento — segue o padrão dos drawers já existentes.

### Card 1 — Estoque Baixo
- KPI: nº de produtos com `stock < minStock` (minStock > 0). Não depende do período.
- Drawer: lista com Marca · Modelo · Sabor · Estoque atual · Estoque mínimo, ordenada por maior déficit primeiro.

### Card 2 — Modelo mais vendido (período)
- Base: vendas `type = "venda"` no período, agrupadas por `${brand} ${model}`.
- KPI: modelo campeão + unidades + % das vendas do período.
- Drawer: gráfico de barras (recharts) com todos os modelos ordenados desc por unidades.

### Card 3 — Modelos mais lucrativos (período)
- Fórmula por venda: `(unitPrice − product.purchasePrice) × quantity`, agrupado por modelo.
- Margem média = lucro total / receita total do modelo.
- Toggle "Maior lucro" ↔ "Maior margem" (botões).
- Drawer: lista compacta com lucro absoluto, margem, unidades.

### Card 4 — Giro de estoque (período)
- Para cada modelo: `Entraram` = soma de `stock_entries.quantity` no período; `Vendidos` = soma vendas no período. `Giro% = Vendidos / max(Entraram, 1)`.
- Se `Entraram = 0` mas houve vendas, marcar como "sem reposição" e usar estoque inicial estimado como base.
- KPI no card: modelo com melhor giro + %.
- Drawer: lista com Entraram · Vendidos · Giro%.

---

## 4. Padrão visual

- Grid `md:grid-cols-2 lg:grid-cols-4` para os 4 cards.
- Cada card: título pequeno em uppercase + valor grande + linha secundária, cursor-pointer, hover sutil.
- Drawers via `Sheet` (side="right"), header com título + descrição, corpo com scroll.
- Cores: mesmos tokens semânticos (`text-income`, `text-warning`, `text-destructive`, `text-primary`) já em uso.

---

## 5. Escopo excluído

- Sem novas migrations além de `min_stock`.
- Sem alterar Distribuição, Financeiro, Vendas.
- Gráfico apenas no drawer do Card 2 (barras horizontais simples), mantendo cards limpos.
