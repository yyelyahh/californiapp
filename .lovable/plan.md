## Ajustes na página Distribuição

Reformular os cálculos e o escopo temporal dos KPIs da página, mantendo o layout atual.

### Novas regras

**Lucro Líquido (all-time, sem filtro de data)**
- Receita = soma de `paidAmount` de todas as vendas (`type = "venda"`), ou seja, apenas o que foi efetivamente recebido.
- (−) COGS: custo de compra × quantidade de todas as vendas recebidas (proporcional ao `paidAmount / totalPrice` quando a venda foi parcialmente paga, para não descontar custo de mercadoria ainda não realizada).
- (−) Despesas: todas do sistema, sem filtro.
- (−) Pagamentos a investidores: soma de todos os `dividends` cadastrados na página Investidores.
- Resultado exibido no card "Lucro Líquido" e no bloco "Distribuição do Lucro".

**Comissões / Vendedores (inalterado)**
- Continuam limitadas ao período selecionado no topo (Mês / Mês anterior / Trimestre / Personalizado).
- Corte de 01/06/2026 permanece: nada antes dessa data conta como comissão.
- O bloco "Vendedores" continua reagindo ao seletor de período.

**Retiradas dos Sócios (all-time)**
- Somar todas as retiradas de todos os sócios, sem filtro de data.
- Card "Retiradas dos Sócios" e ledger da distribuição usam esse total.
- Cards individuais de cada sócio passam a mostrar "Total retirado" (all-time) no lugar de "no período"; o "último saque" continua.

**Saldo Disponível**
- Fórmula: `Lucro Líquido (all-time) − Comissões pendentes (do período) − Retiradas (all-time)`.
- Validação do diálogo "saldo ficará negativo" continua usando esse valor.

### Ajustes de UI/textos
- Substituir os subtítulos "No período" dos cards Lucro e Retiradas por "Total acumulado".
- Ajustar labels do bloco "Distribuição do Lucro" e do rodapé de insights para refletir all-time em Lucro e Retiradas.
- Manter o seletor de período no topo, mas deixar claro que ele afeta apenas Comissões/Vendedores (label do seletor: "Período (comissões)").

### Arquivos
- `src/pages/CommissionsPage.tsx`
  - Adicionar carregamento de `dividends` do store.
  - Ajustar `periodMetrics`: separar `netProfit` (all-time, com COGS proporcional ao recebido) e `totalWithdrawals` (all-time) das métricas de comissão (que continuam usando `inPeriod` + corte legado).
  - Ajustar componente `ProfitDistribution` e rodapé de insights com os novos rótulos.
