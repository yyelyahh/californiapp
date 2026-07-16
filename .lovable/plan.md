
## Contexto do problema

Confirmado no banco: as "27 unidades sumidas" são, na verdade, **26 vendas com `type = 'retirada_funcionario'`** (retiradas de estoque que viram dívida do vendedor). A view `financial_events` filtra `WHERE s.type = 'venda'` — então essas retiradas:

- **decrementam** `products.stock` (código de venda executa para qualquer type)
- **não geram** eventos no ledger (nem saída de estoque, nem contas a receber)

Além disso, duas tabelas inteiras estão fora do ledger:
- `seller_manual_debts` (R$ 993,91) — dívidas manuais lançadas para o vendedor
- `seller_debt_payments` (R$ 842,47) — pagamentos dessas dívidas

Resultado: o ledger continua "vendo" 26 unidades no estoque que fisicamente já saíram, inflando o cálculo em ~R$ 1.766.

## O que este plano faz

Estende a view `financial_events` para reconhecer três tipos de evento novos, mantendo a identidade Ativo = Passivo + PL:

### 1. `retirada_funcionario` (a partir de `sales` com esse type)
Modela como venda a prazo para o vendedor — estoque sai, vira conta a receber, gera margem:
- `inventory_delta = − (products.purchase_price × quantity)`
- `receivable_delta = + total_price`
- `accumulated_profit_delta = + (total_price − purchase_price × quantity)`
- `cash_delta = 0`

### 2. `seller_manual_debt` (a partir de `seller_manual_debts`)
Dívida lançada manualmente pelo admin — cria conta a receber sem afetar caixa nem estoque. Como representa um valor devido pelo vendedor por consumo/quebra já contabilizada em outro lugar, tratamos como **reclassificação** que aumenta o A Receber e reduz o Lucro Acumulado (equivale a reconhecer uma perda que virou dívida):
- `receivable_delta = + amount`
- `accumulated_profit_delta = − amount` — a decidir com o usuário (ver questão abaixo)

### 3. `seller_debt_payment` (a partir de `seller_debt_payments`)
Recebimento de dívida do vendedor — caixa entra, conta a receber cai:
- `cash_delta = + amount`
- `receivable_delta = − amount`

## Impacto esperado no card "Estoque (a custo)"

```text
Antes:  R$ 4.466,85
− CPV das 26 retiradas: R$ 1.766,39
Depois: R$ 2.700,46
Produtos (referência):  R$ 2.609,33
Resíduo:                R$    91,13
```

O resíduo de ~R$ 91 é a **outra causa da divergência já diagnosticada**: entradas registradas ao custo histórico da nota vs. saídas (CPV) valoradas ao `purchase_price` atual do produto. Fechá-lo exige mudar a valoração para custo médio ou FIFO — fora do escopo deste passo.

## Arquivos afetados

- **Nova migração** (`supabase/migrations/…_extend_financial_events.sql`)
  - `CREATE OR REPLACE VIEW public.financial_events` adicionando três `UNION ALL`:
    - `retirada_funcionario` (join `sales` × `products`, filtro `type = 'retirada_funcionario'`)
    - `seller_manual_debt` (from `seller_manual_debts`)
    - `seller_debt_payment` (from `seller_debt_payments`)
  - View continua `SECURITY INVOKER` (padrão) e herda as policies das tabelas fonte.
- **`src/context/StoreContext.tsx`**
  - Adicionar canais realtime para `seller_manual_debts` e `seller_debt_payments` que refazem `financial_events` (retiradas já disparam via `sales`).
  - Nenhuma mudança nos seletores (`getInventoryCostValue`, `getReceivables`, `getCash`, etc.) — todos leem da view.
- **`src/pages/FinancePage.tsx`**
  - Nenhuma mudança de código. Cards passam a refletir os novos valores automaticamente.
  - Histórico de movimentações passará a mostrar as três novas linhas de evento.

## Perguntas antes de implementar

1. **Manual debts geram lançamento de perda?** Hoje `seller_manual_debts` (R$ 993,91) representam quê? Cobrança por produto quebrado/consumido pelo vendedor? Se sim, o correto é `accumulated_profit_delta = − amount` (a empresa reconhece o valor como perda absorvida via dívida). Se for cobrança de algo já contabilizado, o profit_delta deve ser 0 — só reclassifica um ativo em outro.
2. **Margem em retirada de funcionário deve virar lucro?** Nas 26 retiradas, `total_price − CPV = −45,03` (vendidas ~ao custo, algumas abaixo). Confirma que retirada é conceitualmente uma venda (reconhece receita e CPV) e não uma transferência interna a custo?
