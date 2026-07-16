CREATE OR REPLACE VIEW public.financial_events AS
SELECT pc.id, 'partner_contribution'::text AS kind, pc.date AS event_date, pc.created_at,
  'Aporte — '::text || COALESCE(p.name,'sócio'::text) AS description,
  pc.amount, pc.amount AS cash_delta, 0::numeric AS inventory_delta, 0::numeric AS receivable_delta,
  0::numeric AS loan_delta, pc.amount AS partner_capital_delta,
  0::numeric AS accumulated_profit_delta, 0::numeric AS distributed_profit_delta,
  'partner_contributions'::text AS ref_table, pc.id AS ref_id, pc.notes
FROM partner_contributions pc LEFT JOIN partners p ON p.id = pc.partner_id
UNION ALL
SELECT l.id, 'loan_received'::text, l.received_date, l.created_at,
  'Empréstimo — '::text || l.lender_name, l.principal, l.principal, 0, 0, l.principal, 0, 0, 0,
  'loans'::text, l.id, l.notes
FROM loans l
UNION ALL
SELECT lp.id, 'loan_payment'::text, lp.date, lp.created_at,
  'Pagamento de empréstimo'::text, lp.principal_amount + lp.interest_amount,
  -(lp.principal_amount + lp.interest_amount), 0, 0, -lp.principal_amount, 0,
  -lp.interest_amount, 0, 'loan_payments'::text, lp.id, lp.notes
FROM loan_payments lp
UNION ALL
SELECT se.id, 'stock_purchase'::text, se.date::date, se.created_at,
  'Compra de estoque'::text, se.total_cost, -se.total_cost, se.total_cost, 0, 0, 0, 0, 0,
  'stock_entries'::text, se.id, se.notes
FROM stock_entries se
UNION ALL
SELECT s.id, 'sale'::text, s.date::date, s.created_at,
  'Venda'::text, s.total_price, COALESCE(s.paid_amount,0), 0,
  s.total_price - COALESCE(s.paid_amount,0), 0, 0, s.total_price, 0,
  'sales'::text, s.id, s.notes
FROM sales s WHERE s.type = 'venda'
UNION ALL
SELECT s.id, 'sale_cogs'::text, s.date::date, s.created_at,
  'CPV'::text, pr.purchase_price * s.quantity::numeric, 0,
  -(pr.purchase_price * s.quantity::numeric), 0, 0, 0,
  -(pr.purchase_price * s.quantity::numeric), 0,
  'sales'::text, s.id, NULL::text
FROM sales s JOIN products pr ON pr.id = s.product_id
WHERE s.type = 'venda' AND pr.purchase_price IS NOT NULL
UNION ALL
-- Retirada de funcionário: estoque sai, vira conta a receber (dívida do vendedor), reconhece margem
SELECT s.id, 'seller_withdrawal'::text, s.date::date, s.created_at,
  'Retirada de funcionário'::text, s.total_price, 0,
  -(pr.purchase_price * s.quantity::numeric), s.total_price, 0, 0,
  s.total_price - (pr.purchase_price * s.quantity::numeric), 0,
  'sales'::text, s.id, s.notes
FROM sales s JOIN products pr ON pr.id = s.product_id
WHERE s.type = 'retirada_funcionario'
UNION ALL
-- Dívida manual lançada para vendedor: A Receber sobe, Lucro Acumulado cai (empresa absorve como perda)
SELECT smd.id, 'seller_manual_debt'::text, smd.date::date, smd.created_at,
  'Dívida manual do vendedor'::text, smd.amount, 0, 0, smd.amount, 0, 0,
  -smd.amount, 0, 'seller_manual_debts'::text, smd.id, smd.notes
FROM seller_manual_debts smd
UNION ALL
-- Pagamento de dívida do vendedor: caixa entra, A Receber cai
SELECT sdp.id, 'seller_debt_payment'::text, sdp.date::date, sdp.created_at,
  'Pagamento de dívida de vendedor'::text, sdp.amount, sdp.amount, 0, -sdp.amount, 0, 0, 0, 0,
  'seller_debt_payments'::text, sdp.id, sdp.notes
FROM seller_debt_payments sdp
UNION ALL
SELECT e.id, 'expense'::text, e.date::date, e.created_at,
  COALESCE(e.description, e.category), e.amount, -e.amount, 0, 0, 0, 0, -e.amount, 0,
  'expenses'::text, e.id, NULL::text
FROM expenses e
UNION ALL
SELECT plp.id, 'withdrawal'::text, plp.date, plp.created_at,
  'Retirada de sócio'::text, plp.amount, -plp.amount, 0, 0, 0, 0, 0, plp.amount,
  'pro_labore_payments'::text, plp.id, plp.notes
FROM pro_labore_payments plp
UNION ALL
SELECT cp.id, 'commission_paid'::text, cp.date, cp.created_at,
  'Comissão paga'::text, cp.amount, -cp.amount, 0, 0, 0, 0, -cp.amount, 0,
  'commission_payments'::text, cp.id, cp.notes
FROM commission_payments cp
UNION ALL
SELECT sl.id, 'stock_loss'::text, sl.date::date, sl.created_at,
  'Perda de estoque'::text, sl.total_cost, 0, -sl.total_cost, 0, 0, 0, -sl.total_cost, 0,
  'stock_losses'::text, sl.id, sl.reason
FROM stock_losses sl;