
-- ============================================================
-- 1) partner_contributions
-- ============================================================
CREATE TABLE public.partner_contributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
  amount numeric NOT NULL CHECK (amount > 0),
  date date NOT NULL DEFAULT CURRENT_DATE,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.partner_contributions TO authenticated;
GRANT ALL ON public.partner_contributions TO service_role;
ALTER TABLE public.partner_contributions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage partner_contributions"
  ON public.partner_contributions
  FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- ============================================================
-- 2) loans
-- ============================================================
CREATE TABLE public.loans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lender_name text NOT NULL,
  principal numeric NOT NULL CHECK (principal >= 0),
  interest_amount numeric NOT NULL DEFAULT 0 CHECK (interest_amount >= 0),
  received_date date NOT NULL DEFAULT CURRENT_DATE,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.loans TO authenticated;
GRANT ALL ON public.loans TO service_role;
ALTER TABLE public.loans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage loans"
  ON public.loans
  FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- ============================================================
-- 3) loan_payments
-- ============================================================
CREATE TABLE public.loan_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id uuid NOT NULL REFERENCES public.loans(id) ON DELETE CASCADE,
  principal_amount numeric NOT NULL DEFAULT 0 CHECK (principal_amount >= 0),
  interest_amount numeric NOT NULL DEFAULT 0 CHECK (interest_amount >= 0),
  date date NOT NULL DEFAULT CURRENT_DATE,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.loan_payments TO authenticated;
GRANT ALL ON public.loan_payments TO service_role;
ALTER TABLE public.loan_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage loan_payments"
  ON public.loan_payments
  FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- ============================================================
-- 4) Migração: investors → loans (preservando ids)
-- ============================================================
INSERT INTO public.loans (id, lender_name, principal, interest_amount, received_date, notes, created_at)
SELECT
  i.id,
  i.name,
  i.invested_amount,
  GREATEST(0, i.total_return - i.invested_amount),
  i.created_at::date,
  'Migrado de investors (retorno ' || i.return_percentage::text || '%)',
  i.created_at
FROM public.investors i;

-- Migração: dividends → loan_payments (split proporcional)
INSERT INTO public.loan_payments (loan_id, principal_amount, interest_amount, date, notes, created_at)
SELECT
  d.investor_id,
  CASE
    WHEN i.total_return > 0
      THEN ROUND((d.amount * (i.invested_amount / i.total_return))::numeric, 2)
    ELSE d.amount
  END,
  CASE
    WHEN i.total_return > 0
      THEN ROUND((d.amount * ((i.total_return - i.invested_amount) / i.total_return))::numeric, 2)
    ELSE 0
  END,
  d.date::date,
  d.notes,
  d.created_at
FROM public.dividends d
JOIN public.investors i ON i.id = d.investor_id;

-- ============================================================
-- 5) VIEW financial_events (ledger unificado, sempre derivada)
-- ============================================================
CREATE OR REPLACE VIEW public.financial_events
WITH (security_invoker = on)
AS
-- Aportes de sócios
SELECT
  pc.id AS id,
  'partner_contribution'::text AS kind,
  pc.date AS event_date,
  pc.created_at AS created_at,
  ('Aporte — ' || COALESCE(p.name, 'sócio')) AS description,
  pc.amount AS amount,
  pc.amount AS cash_delta,
  0::numeric AS inventory_delta,
  0::numeric AS receivable_delta,
  0::numeric AS loan_delta,
  pc.amount AS partner_capital_delta,
  0::numeric AS accumulated_profit_delta,
  0::numeric AS distributed_profit_delta,
  'partner_contributions'::text AS ref_table,
  pc.id AS ref_id,
  pc.notes AS notes
FROM public.partner_contributions pc
LEFT JOIN public.partners p ON p.id = pc.partner_id

UNION ALL
-- Empréstimos recebidos
SELECT
  l.id,
  'loan_received',
  l.received_date,
  l.created_at,
  ('Empréstimo — ' || l.lender_name),
  l.principal,
  l.principal, 0, 0, l.principal, 0, 0, 0,
  'loans', l.id, l.notes
FROM public.loans l

UNION ALL
-- Pagamentos de empréstimo (principal e juros combinados)
SELECT
  lp.id,
  'loan_payment',
  lp.date,
  lp.created_at,
  'Pagamento de empréstimo',
  (lp.principal_amount + lp.interest_amount),
  -(lp.principal_amount + lp.interest_amount),
  0, 0,
  -lp.principal_amount,
  0,
  -lp.interest_amount,
  0,
  'loan_payments', lp.id, lp.notes
FROM public.loan_payments lp

UNION ALL
-- Compras de estoque
SELECT
  se.id,
  'stock_purchase',
  se.date::date,
  se.created_at,
  'Compra de estoque',
  se.total_cost,
  -se.total_cost,
  se.total_cost,
  0, 0, 0, 0, 0,
  'stock_entries', se.id, se.notes
FROM public.stock_entries se

UNION ALL
-- Vendas (regime de caixa parcial: cash = paid_amount, receivable = total-paid; receita reconhecida por competência para consistência do ledger)
SELECT
  s.id,
  'sale',
  s.date::date,
  s.created_at,
  'Venda',
  s.total_price,
  COALESCE(s.paid_amount, 0),
  0,
  s.total_price - COALESCE(s.paid_amount, 0),
  0, 0,
  s.total_price,
  0,
  'sales', s.id, s.notes
FROM public.sales s
WHERE s.type = 'venda'

UNION ALL
-- CPV (Custo dos Produtos Vendidos) — saída de estoque a custo, reduz lucro
SELECT
  s.id,
  'sale_cogs',
  s.date::date,
  s.created_at,
  'CPV',
  (pr.purchase_price * s.quantity),
  0,
  -(pr.purchase_price * s.quantity),
  0, 0, 0,
  -(pr.purchase_price * s.quantity),
  0,
  'sales', s.id, NULL
FROM public.sales s
JOIN public.products pr ON pr.id = s.product_id
WHERE s.type = 'venda' AND pr.purchase_price IS NOT NULL

UNION ALL
-- Despesas
SELECT
  e.id,
  'expense',
  e.date::date,
  e.created_at,
  COALESCE(e.description, e.category),
  e.amount,
  -e.amount,
  0, 0, 0, 0,
  -e.amount,
  0,
  'expenses', e.id, NULL
FROM public.expenses e

UNION ALL
-- Retiradas de sócios (pro_labore_payments)
SELECT
  plp.id,
  'withdrawal',
  plp.date,
  plp.created_at,
  'Retirada de sócio',
  plp.amount,
  -plp.amount,
  0, 0, 0, 0, 0,
  plp.amount,
  'pro_labore_payments', plp.id, plp.notes
FROM public.pro_labore_payments plp

UNION ALL
-- Comissões pagas
SELECT
  cp.id,
  'commission_paid',
  cp.date,
  cp.created_at,
  'Comissão paga',
  cp.amount,
  -cp.amount,
  0, 0, 0, 0,
  -cp.amount,
  0,
  'commission_payments', cp.id, cp.notes
FROM public.commission_payments cp

UNION ALL
-- Perdas de estoque
SELECT
  sl.id,
  'stock_loss',
  sl.date::date,
  sl.created_at,
  'Perda de estoque',
  sl.total_cost,
  0,
  -sl.total_cost,
  0, 0, 0,
  -sl.total_cost,
  0,
  'stock_losses', sl.id, sl.reason
FROM public.stock_losses sl;

GRANT SELECT ON public.financial_events TO authenticated;
GRANT SELECT ON public.financial_events TO service_role;
