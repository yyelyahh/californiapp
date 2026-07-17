CREATE OR REPLACE VIEW public.financial_events AS
SELECT pc.id, 'partner_contribution'::text AS kind, pc.date AS event_date, pc.created_at,
  'Aporte — '::text || COALESCE(p.name, 'sócio'::text) AS description,
  pc.amount, pc.amount AS cash_delta, 0::numeric AS inventory_delta, 0::numeric AS receivable_delta,
  0::numeric AS loan_delta, pc.amount AS partner_capital_delta,
  0::numeric AS accumulated_profit_delta, 0::numeric AS distributed_profit_delta,
  'partner_contributions'::text AS ref_table, pc.id AS ref_id, pc.notes
FROM partner_contributions pc LEFT JOIN partners p ON p.id = pc.partner_id
UNION ALL
SELECT l.id, 'loan_received', l.received_date, l.created_at,
  'Empréstimo — ' || l.lender_name, l.principal, l.principal, 0, 0, l.principal, 0, 0, 0,
  'loans', l.id, l.notes
FROM loans l
UNION ALL
SELECT lp.id, 'loan_payment', lp.date, lp.created_at, 'Pagamento de empréstimo',
  lp.principal_amount + lp.interest_amount, -(lp.principal_amount + lp.interest_amount),
  0, 0, -lp.principal_amount, 0, -lp.interest_amount, 0,
  'loan_payments', lp.id, lp.notes
FROM loan_payments lp
UNION ALL
SELECT se.id, 'stock_purchase', se.date::date, se.created_at, 'Compra de estoque',
  se.total_cost, -se.total_cost, se.total_cost, 0, 0, 0, 0, 0,
  'stock_entries', se.id, se.notes
FROM stock_entries se
UNION ALL
SELECT s.id, 'sale', s.date::date, s.created_at, 'Venda', s.total_price,
  COALESCE(s.paid_amount, 0), 0, s.total_price - COALESCE(s.paid_amount, 0),
  0, 0, s.total_price, 0, 'sales', s.id, s.notes
FROM sales s WHERE s.type = 'venda'
UNION ALL
SELECT s.id, 'sale_cogs', s.date::date, s.created_at, 'CPV',
  pr.purchase_price * s.quantity, 0, -(pr.purchase_price * s.quantity), 0, 0, 0,
  -(pr.purchase_price * s.quantity), 0, 'sales', s.id, NULL
FROM sales s JOIN products pr ON pr.id = s.product_id
WHERE s.type = 'venda' AND pr.purchase_price IS NOT NULL
UNION ALL
-- Retirada de funcionário: transferência estoque -> A Receber pelo CUSTO.
-- Sem reconhecer receita/lucro no ato. A margem só aparecerá quando pago.
SELECT s.id, 'seller_withdrawal', s.date::date, s.created_at, 'Retirada de funcionário',
  pr.purchase_price * s.quantity,
  0,
  -(pr.purchase_price * s.quantity),
  pr.purchase_price * s.quantity,
  0, 0, 0, 0,
  'sales', s.id, s.notes
FROM sales s JOIN products pr ON pr.id = s.product_id
WHERE s.type = 'retirada_funcionario' AND pr.purchase_price IS NOT NULL
UNION ALL
-- seller_manual_debts removido do ledger: são ajustes avulsos de saldo do vendedor,
-- sem contrapartida financeira real. Continuam existindo na tabela e no relatório do vendedor.
SELECT sdp.id, 'seller_debt_payment', sdp.date::date, sdp.created_at, 'Pagamento de dívida de vendedor',
  sdp.amount, sdp.amount, 0, -sdp.amount, 0, 0, 0, 0,
  'seller_debt_payments', sdp.id, sdp.notes
FROM seller_debt_payments sdp
UNION ALL
SELECT e.id, 'expense', e.date::date, e.created_at, COALESCE(e.description, e.category),
  e.amount, -e.amount, 0, 0, 0, 0, -e.amount, 0, 'expenses', e.id, NULL
FROM expenses e
UNION ALL
SELECT plp.id, 'withdrawal', plp.date, plp.created_at, 'Retirada de sócio',
  plp.amount, -plp.amount, 0, 0, 0, 0, 0, plp.amount,
  'pro_labore_payments', plp.id, plp.notes
FROM pro_labore_payments plp
UNION ALL
SELECT cp.id, 'commission_paid', cp.date, cp.created_at, 'Comissão paga',
  cp.amount, -cp.amount, 0, 0, 0, 0, -cp.amount, 0,
  'commission_payments', cp.id, cp.notes
FROM commission_payments cp
UNION ALL
SELECT sl.id, 'stock_loss', sl.date::date, sl.created_at, 'Perda de estoque',
  sl.total_cost, 0, -sl.total_cost, 0, 0, 0, -sl.total_cost, 0,
  'stock_losses', sl.id, sl.reason
FROM stock_losses sl;

GRANT SELECT ON public.financial_events TO authenticated, service_role;