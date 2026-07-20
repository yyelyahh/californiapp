## Objetivo

Simplificar a página **Distribuição** para responder três perguntas objetivas por período:
1. Quanto sobrou de lucro?
2. Quanto devo aos vendedores?
3. Quanto cabe a cada sócio e quanto ainda falta pagar?

Só frontend (`src/pages/CommissionsPage.tsx`). Nada de banco/ledger.

---

## Fórmulas acordadas

**Período:** mês atual · mês anterior · personalizado (removemos "trimestre").

**Lucro bruto do período** — espelha a fórmula do Dashboard:
```
Receita (totalPrice das vendas type=venda no período)
  − CPV (product.purchasePrice × quantity)
  = Lucro bruto
```

**Lucro líquido do período:**
```
Lucro bruto − Despesas do período − Pagamentos a investidores no período
```
(Pagamentos a investidores = tabela `dividends` filtrada por data.)

**A pagar a vendedores** (dois números explícitos):
- `Saldo anterior` = soma do saldo devido de cada vendedor **até o dia anterior ao início do período** (mesma fórmula já usada no `SellerReportDrawer`: comissão acumulada − consumo + pagamentos de dívida − comissões pagas, respeitando cutoff 01/06/2026 e faixas por mês).
- `Gerado no período` = mesmo cálculo restrito ao período.
- `Total a pagar` = anterior + período (só a parte positiva por vendedor, conforme regra atual de `Math.max(0, balance)`).

**Lucro a distribuir aos sócios:**
```
Lucro líquido do período − Total a pagar a vendedores
```
Se negativo, mostra 0 e exibe aviso ("período no vermelho").

**Divisão entre sócios** — usa `partners.percentage` (não hardcoded). Para cada sócio:
- `alvo = distribuivel × (percentage/100)`
- `retirado_no_periodo = soma de proLaborePayments do sócio no período`
- `falta_pagar = max(0, alvo − retirado_no_periodo)`
- `excedente = max(0, retirado_no_periodo − alvo)` (informativo)

---

## UI

**Filtro de período** (topo): três botões — Mês atual · Mês anterior · Personalizado (com dois date inputs quando ativo). Remove "Trimestre".

**3 cards principais** substituem os 4 atuais:
1. **Lucro líquido no período** (verde/vermelho conforme sinal) — mostra também: receita, CPV, despesas, investidores como sub-linhas discretas.
2. **A pagar a vendedores** — mostra `Saldo anterior + Gerado no período = Total`. Ao lado, badge com nº de vendedores com saldo positivo.
3. **Lucro a distribuir aos sócios** — valor grande + linha "= Lucro líquido − A pagar a vendedores".

**Cards por sócio** (substituem o retângulo "Distribuição do Lucro" que sai): um card por sócio com:
- Nome + % configurada
- `Alvo do período`
- `Retirado no período`
- **`Falta pagar` (destacado)** ou **`Excedente`** se já passou do alvo
- Botão "Registrar retirada" (fluxo atual mantido)

**Mantém sem mudança:**
- Cards de vendedores abaixo (comissão/consumo/saldo), com o mesmo fluxo de pagar comissão.
- Seção de atribuição de estoque, transferências, timeline, drawers.
- Fluxo de "Extrato do funcionário".

**Remove:**
- Retângulo "Distribuição do Lucro" (ledger visual antigo).
- Filtro "Trimestre".
- Card "Saldo Disponível" no formato atual (substituído pelo "Lucro a distribuir").
- Métricas "reinvestido em estoque" / "caixa livre" da seção principal (permanecem no Financeiro).

---

## Detalhes técnicos

- Cálculo de `Saldo anterior` por vendedor: extrair para função `computePriorSellerBalance(sellerId, beforeDate)` dentro do próprio `CommissionsPage.tsx` (ou reutilizar de `SellerReportDrawer` se já expõe). Precisa agrupar vendas por mês para aplicar a faixa correta (mesmo padrão do drawer que já valida a lógica).
- `periodMetrics` no arquivo será reescrito: sai `accumulatedProfit/retainedEarnings/available` como base e entra `grossProfit/netProfit/sellerPayable/distribuivel/perPartnerTargets`.
- Filtro "Mês atual" já é o default — apenas remover o case `quarter` do `Period` type e do switch.
- Nada muda no `StoreContext`, no ledger (`financial_events`) nem na página Financeiro.

---

## Escopo do que NÃO muda

- Página Financeiro continua com a visão contábil all-time (Ativo/Passivo/PL).
- Ledger, tabelas e migrations: intocados.
- Regras de comissão (10%/12,5%/15% pós-01/06/2026, 10% legado antes): intocadas.
