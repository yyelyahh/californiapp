# Comissão pela data de pagamento da venda

## Problema

Hoje a comissão só é gerada quando a venda está quitada, mas ela é atribuída ao período usando a **data da venda**. Se uma venda de julho é recebida em agosto, ela some do relatório de julho (não estava paga) e nunca aparece em agosto (a data da venda é julho). O valor fica invisível.

## Solução

Registrar a **data de quitação** de cada venda e usar essa data — não a data da venda — para decidir em qual período a comissão entra.

### 1. Banco de dados
- Nova coluna `paid_at` (data/hora, opcional) na tabela de vendas.
- Preenchimento retroativo: vendas já quitadas recebem `paid_at` = data da venda (assim nada muda no histórico já fechado).

### 2. Registro / edição de venda
- Venda registrada como recebida → `paid_at` = data da venda.
- Venda em aberto → `paid_at` vazio.
- Ao marcar uma venda em aberto como recebida, um seletor de data (padrão: hoje) define quando o dinheiro entrou; ao voltar para "em aberto", `paid_at` é limpo.

### 3. Distribuição e Extrato do vendedor
- Comissão do período = vendas cujo `paid_at` cai dentro do período selecionado (independente de quando a venda foi feita).
- A faixa de comissão (unidades) passa a ser contada sobre essas mesmas vendas liquidadas no período.
- No extrato, cada venda recebida mostra "venda em dd/mm · recebida em dd/mm" quando as datas diferem.
- Continua valendo o corte de 01/06/2026 e a regra de não somar saldo anterior.

### 4. Lista de vendas
- Vendas em aberto continuam listadas pela data da venda; ao quitar, o app pede a data do recebimento.

## Detalhes técnicos

- Migração: `ALTER TABLE public.sales ADD COLUMN paid_at timestamptz` + update retroativo `paid_at = date` onde `paid_amount >= total_price`.
- `StoreContext`: mapear `paidAt`, incluir no insert/update, limpar quando `paidAmount` volta a zero.
- `CommissionsPage` e `SellerReportDrawer`: trocar o filtro de comissão de `inPeriod(s.date)` para `inPeriod(s.paidAt)` nas vendas pagas; consumo, dívidas e pagamentos seguem pela própria data.
- `SalesPage` / `BatchSaleForm`: campo de data de recebimento ao marcar como pago.
