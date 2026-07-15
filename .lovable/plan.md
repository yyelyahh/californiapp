## Duas métricas de lucro lado a lado

Mostrar duas visões complementares na página Distribuição, deixando claro quanto foi reinvestido em estoque.

### Métricas

**Lucro Operacional** (o que a operação gera antes de decidir onde alocar)
- = Receita recebida − Despesas − Pagamentos a investidores
- Não desconta custo de mercadoria nem compras de estoque.
- Representa o "dinheiro que a operação gerou" antes de reinvestir.

**Caixa Livre** (o que efetivamente sobrou depois de reinvestir em estoque)
- = Lucro Operacional − Todas as compras de estoque (`stock_entries.totalCost`)
- Reflete o caixa real disponível — se você reinvestiu tudo em estoque, esse valor cai.

**Reinvestimento em estoque** (informativo)
- = Soma de todas as compras de estoque cadastradas.
- Exibido como linha auxiliar para explicar a diferença entre as duas métricas.

Todas as três continuam **all-time**, sem filtro de data. Comissões e vendedores continuam limitados ao período selecionado.

### Mudanças de UI

- Grid superior de KPIs passa de 4 para 5 cards (em telas menores, 2 colunas):
  1. Lucro Operacional
  2. Caixa Livre (destaque, cor conforme sinal)
  3. Reinvestido em Estoque
  4. A pagar a vendedores
  5. Retiradas dos Sócios
- Bloco "Distribuição do Lucro" passa a mostrar o ledger a partir do Lucro Operacional:
  - Lucro Operacional
  - (−) Reinvestido em estoque → Caixa Livre
  - (−) Comissões pendentes
  - (−) Retiradas dos sócios
  - = Saldo Disponível
- "Saldo Disponível" (usado na validação de retirada negativa) passa a ser calculado a partir do **Caixa Livre**: `caixaLivre − comissões pendentes − retiradas`.
- Rodapé de Insights ganha uma linha explicando quanto foi reinvestido.

### Arquivos

- `src/pages/CommissionsPage.tsx`
  - Adicionar `stockEntries` do store.
  - Em `periodMetrics`: calcular `operatingProfit`, `stockReinvestment`, `freeCash`; remover COGS proporcional; recalcular `available` a partir de `freeCash`.
  - Ajustar cards, `ProfitDistribution` e insights.
