
# Página "Relatórios" — Inteligência de Vendas e Estoque

Tudo será implementado **inteiramente no frontend**, em uma nova página `/reports`, usando os dados que já existem no `StoreContext` (vendas, produtos, entradas de estoque, despesas, vendedores). Sem novas tabelas no banco — todos os cálculos são derivados em tempo real e atualizam automaticamente quando uma venda/entrada é registrada (já que o StoreContext recarrega).

## Estrutura da página

Rota nova `/reports` (apenas admin), adicionada ao `AppLayout` com ícone `BarChart3` e label **"Relatórios"**.

A página será dividida em **abas** (`Tabs` shadcn) para não virar um scroll infinito:

1. **Visão Geral** — KPIs + insights automáticos + alertas
2. **Heatmap** — heatmap de vendas
3. **Reposição** — indicadores de estoque e sugestões de compra
4. **Giro** — análise de giro de estoque
5. **Lucratividade** — ranking de produtos por margem/ROI

Filtro global no topo: **período** (7d, 30d, 90d, personalizado), **vendedor** e **marca** (usaremos `brand` como "categoria", já que o sistema não tem categoria separada).

## 1. Visão Geral

- **Cards KPI**: Faturamento, Lucro estimado, Ticket médio, Vendas no período, Produtos parados, Alertas ativos.
- **Gráfico de linha** — tendência de vendas diárias com comparação ao período anterior (% crescimento/queda).
- **Top 5 produtos mais vendidos** (barras horizontais).
- **Melhor vendedor** do período (card destaque).
- **Painel de Insights automáticos** — frases geradas dinamicamente (ver seção 7).
- **Painel de Alertas** — lista colorida com badges (estoque baixo, sem saída, vendas acima do normal, encalhado, margem ruim).

## 2. Heatmap de Vendas

Matriz **dia da semana × hora do dia não temos** → usaremos **dia da semana × semana do período** (ex.: 7×N) com toggle entre **quantidade de vendas** e **faturamento**.

- Cores: vermelho (baixo) → amarelo (médio) → verde (alto), via gradiente HSL com tokens semânticos.
- Tooltip com data exata e valor.
- Resumo lateral: "Melhor dia: Sexta", "Pior dia: Segunda".
- Implementação: grid CSS simples (sem nova lib), célula com `bg` calculado por percentil.

## 3. Indicadores de Reposição

Para cada produto calcula:
- **Velocidade de venda** = total vendido nos últimos 30 dias ÷ 30 (un./dia) e ÷ 7 (un./semana).
- **Dias até acabar** = `stock / vel_diaria`.
- **Sugestão de recompra** = consumo previsto para 30 dias − estoque atual (mínimo 0).
- **Tendência** = compara últimos 7 dias vs 7 dias anteriores → ↑/↓/→.

Badges automáticas:
- `Repor urgente` — dias até acabar ≤ 3
- `Alta demanda` — tendência ↑ > 30%
- `Estoque saudável` — 7–30 dias
- `Baixa saída` — < 1 venda/semana
- `Produto parado` — 0 vendas em 30 dias

Tabela ordenável com: produto, estoque, vel/semana, dias restantes, sugestão de compra, badge.

## 4. Análise de Giro

Para cada produto:
- **Última venda** (data)
- **Dias sem movimentação**
- **Giro mensal** = vendidos no mês ÷ estoque médio
- **Frequência** = nº dias com venda ÷ dias do período
- **Quantidade total vendida** no período

Classificação:
- **Giro rápido** — giro mensal ≥ 1.5
- **Giro médio** — 0.5–1.5
- **Giro lento** — 0.1–0.5
- **Encalhado** — sem venda há > 60 dias

Visual: tabela + gráfico de barras agrupado por classificação (contagem de produtos).

## 5. Lucratividade

Para cada produto:
- **Margem unitária** = `salePrice − purchasePrice`
- **Margem %** = margem ÷ salePrice
- **Lucro total no período** = margem × qtd vendida
- **ROI do estoque** = lucro / (purchasePrice × estoque médio)
- **Lucro por dia em estoque** = lucro / dias médios até venda

Rankings (3 cards lado a lado):
- Top 5 mais lucrativos
- Top 5 piores margens
- Top 5 "ocupam estoque sem retorno" (alto estoque × baixo lucro)

## 6. Alertas

Lista renderizada na aba Visão Geral, gerada por função `gerarAlertas()` que combina os critérios das seções 3, 4 e 5. Cada alerta tem severidade (info/warning/danger) e ícone.

## 7. Insights automáticos (`gerarInsights`)

Função pura que recebe `{products, sales, stockEntries, period}` e devolve array de strings com:
- Produto com maior crescimento % vs período anterior
- Produto com maior queda
- Melhor dia da semana (faturamento)
- Marca com melhor margem média
- Produto que costuma esgotar mais rápido após reposição (média entre data de entrada e dia em que estoque chegou a 0/baixo)
- Categoria com baixo giro

Exibidos em cards com ícone de "lâmpada".

## 8. Estrutura técnica

Novo arquivo `src/lib/analytics.ts` com funções puras e tipadas:

```ts
calcularGiro(product, sales, period)
calcularTempoMedioVenda(product, sales, stockEntries)
calcularVelocidadeVenda(product, sales, days)
preverReposicao(product, sales)
detectarProdutosParados(products, sales, thresholdDays)
classificarGiro(metrics)
calcularLucratividade(product, sales)
gerarHeatmap(sales, period, mode)
gerarInsights(ctx)
gerarAlertas(ctx)
```

Tudo memoizado via `useMemo` na página, recalculado quando `store.sales`/`store.products`/`store.stockEntries` mudam — portanto **atualiza automaticamente após cada venda ou entrada**.

Sem mudanças no banco, sem novas migrations, sem mudanças no `StoreContext`.

## 9. Visual

- Mesma linguagem do app (dark theme, tokens semânticos do `index.css`).
- Componentes shadcn: `Tabs`, `Card`, `Badge`, `Table`, `Select`, `Tooltip`.
- Gráficos com `recharts` (já instalado).
- Heatmap em CSS grid puro.
- Badges com cores semânticas: `bg-destructive`, `bg-yellow-500/20`, `bg-income/20` etc.
- Tooltips explicativos em todos os KPIs (`Tooltip` shadcn).

## Arquivos

**Novos:**
- `src/lib/analytics.ts` — funções de cálculo
- `src/pages/ReportsPage.tsx` — página principal
- `src/components/reports/HeatmapSales.tsx`
- `src/components/reports/ReplenishmentTable.tsx`
- `src/components/reports/StockTurnoverTable.tsx`
- `src/components/reports/ProfitabilityRanking.tsx`
- `src/components/reports/InsightsPanel.tsx`
- `src/components/reports/AlertsPanel.tsx`

**Editados:**
- `src/App.tsx` — registrar rota `/reports` (admin only)
- `src/components/AppLayout.tsx` — item de menu "Relatórios"

## Limitações honestas

- **Heatmap por hora do dia** não é possível: as vendas só guardam data, não hora exata da transação (campo `date` é tratado como dia). O heatmap será **dia-da-semana × semana**, que é o mais útil dado o dado disponível.
- "Categoria" usará o campo `brand` (não há categoria separada).
- "Tempo médio até venda" é aproximado a partir das datas de entrada de estoque vs vendas (FIFO simples), não rastreamento real por unidade.
