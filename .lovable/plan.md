
## Objetivo

Rodar uma auditoria completa do estoque para detectar divergências entre o que **deveria existir** (com base nas entradas e vendas) e o que **realmente existe** (estoque no sistema + unidades alocadas a vendedores).

## Como o estoque funciona hoje (entendimento confirmado pelo código)

- `stock_entries` → cada compra/entrada soma na quantidade total do produto.
- `sales` → toda venda (incluindo `retirada_funcionario`) abate de `products.stock`.
- `product_assignments` → quando um produto é "passado" para um vendedor, **NÃO** é descontado de `products.stock`. Ou seja, `products.stock` continua representando **o total físico** (loja + vendedores). A alocação só marca qual fatia está com cada vendedor.
- Quando o vendedor vende, a venda abate tanto da `assignment.quantity` quanto de `products.stock`.

Portanto, as duas equações que devem fechar são:

```text
(1) Estoque esperado  =  SUM(entradas)  −  SUM(vendas)
    deve ser igual a  products.stock

(2) SUM(product_assignments.quantity por produto)  ≤  products.stock
    (a parcela com vendedores não pode ultrapassar o estoque total)
```

## O que vou entregar

Um relatório em CSV salvo em `/mnt/documents/auditoria_estoque.csv` com uma linha por produto e, além disso, um resumo no chat com:

1. **Produtos com divergência de estoque total** (equação 1 quebrada) — provavelmente sinal de venda lançada sem entrada, entrada apagada, ou ajuste manual do `stock`.
2. **Produtos onde a soma com vendedores excede o estoque** (equação 2 quebrada) — sinal de atribuição duplicada ou venda não registrada.
3. **Produtos com estoque negativo** ou inconsistências de sinal.
4. **Visão por vendedor**: quanto cada vendedor tem alocado e checagem se algum item alocado já não existe mais em estoque.

### Colunas do CSV

| Coluna | Significado |
|---|---|
| produto | Marca Modelo * Sabor |
| entradas | SUM(stock_entries.quantity) |
| vendas | SUM(sales.quantity) |
| esperado | entradas − vendas |
| estoque_atual | products.stock |
| diferenca_estoque | estoque_atual − esperado (0 = ok) |
| com_vendedores | SUM(product_assignments.quantity) |
| na_loja | estoque_atual − com_vendedores |
| alerta | texto descrevendo o tipo de divergência |

## Passos da execução

1. Consultar `stock_entries`, `sales`, `products`, `product_assignments`, `sellers` via `supabase--read_query`.
2. Cruzar os dados em um script Python (no exec) e gerar o CSV.
3. Imprimir o resumo das divergências no chat, agrupado por gravidade.
4. Sugerir ações corretivas para cada divergência encontrada (ex.: lançar entrada que faltou, ajustar atribuição, corrigir venda).

## O que NÃO faz parte deste passo

- Não vou alterar nenhum dado no banco automaticamente. Após você revisar o relatório, decidimos juntos quais correções aplicar (e aí sim eu rodo as migrações/atualizações).
