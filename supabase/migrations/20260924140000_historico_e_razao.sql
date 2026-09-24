-- ============================================================
-- Histórico protegido, custo congelado na venda e o razão da retirada
-- ------------------------------------------------------------
-- Três pendências da revisão de lógica de 2026-09-24, todas no mesmo lugar:
-- o que o histórico diz e como o razão (financial_events) lê.
--
-- 1. EXCLUIR PRODUTO APAGAVA O HISTÓRICO. sales, stock_entries, stock_losses
--    e stock_transfers referenciavam products com ON DELETE CASCADE: excluir
--    um sabor apagava junto toda venda, entrada, perda e transferência dele, e
--    o faturamento e o razão do passado mudavam sem rastro. Agora é RESTRICT:
--    produto com histórico não se exclui — se arquiva (archived_models), que é
--    a saída que existe justamente para isso. order_items já era assim.
--    product_branch e product_assignments continuam em CASCADE: são estado de
--    hoje, não história.
--
-- 2. O CUSTO DA VENDA ERA O DE HOJE. A perna sale_cogs lia
--    product_branch.purchase_price na hora da consulta, e esse número é
--    sobrescrito a cada entrada (custo do último lote), a cada transferência e
--    a cada edição. Resultado: todo lote novo reescrevia o CPV e o lucro de
--    TODOS os meses passados. Agora cada venda ganha o custo do momento em que
--    aconteceu, em sale_costs — tabela à parte, e não coluna em sales, porque
--    sales é lida pelo vendedor (RLS) com select("*") e o custo não pode chegar
--    a ele: o GRANT por coluna faria a consulta inteira falhar (ver Gotchas).
--    Vendas anteriores a esta migration ganham o custo DE HOJE da filial delas:
--    é o melhor dado que existe, e a partir daqui ele para de mudar.
--
-- 3. A RETIRADA DO VENDEDOR NO RAZÃO. Ela entrava como "a receber" pelo CUSTO,
--    enquanto a comissão e a cobrança a tratam pelo PREÇO — e o saldo do
--    vendedor já a desconta da comissão. O "A receber" do Financeiro
--    acumulava o custo de toda retirada descontada da comissão (nunca quitada
--    no razão) e ia a negativo pela margem quando o vendedor pagava em
--    dinheiro. O modelo que o saldo do vendedor já usa é: retirada é COMISSÃO
--    PAGA EM MERCADORIA. Então no razão ela sai do estoque e do lucro pelo
--    custo, sem criar recebível; e o pagamento de dívida do vendedor entra no
--    caixa e no lucro (ele devolve a comissão que tinha sido paga em
--    mercadoria). Conferido nos dois caminhos: retirada de 150 que custou 68,
--    descontada da comissão ⇒ lucro −68 e comissão paga 150 menor; paga em
--    dinheiro ⇒ −68 + 150 = +82, a margem da venda ao vendedor.
-- ============================================================


-- ------------------------------------------------------------
-- 1. Histórico não some com o produto
-- ------------------------------------------------------------
-- Pelo catálogo do banco, e não por nome de constraint: o nome depende de
-- quem criou a tabela (Lovable, SQL Editor), e errar o nome num DROP não dá
-- sinal nenhum.
DO $restrict_product_history$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conname, c.conrelid::regclass AS tbl
      FROM pg_constraint c
     WHERE c.contype = 'f'
       AND c.confrelid = 'public.products'::regclass
       AND c.confdeltype = 'c'  -- só as que estão em CASCADE
       AND c.conrelid IN (
         'public.sales'::regclass,
         'public.stock_entries'::regclass,
         'public.stock_losses'::regclass,
         'public.stock_transfers'::regclass
       )
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname);
    EXECUTE format(
      'ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE RESTRICT',
      r.tbl, r.conname
    );
  END LOOP;
END;
$restrict_product_history$;


-- ------------------------------------------------------------
-- 2. O custo da venda, congelado no momento dela
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sale_costs (
  sale_id    uuid PRIMARY KEY REFERENCES public.sales(id) ON DELETE CASCADE,
  unit_cost  numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.sale_costs IS
  'Custo unitário de cada venda no momento em que ela aconteceu. Fora de sales para não chegar ao vendedor.';

ALTER TABLE public.sale_costs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sale_costs FROM anon, public;
-- Só leitura, e só admin: quem escreve é o gatilho abaixo (DEFINER). Nem admin
-- reescreve o custo de uma venda passada — é justamente o que isto impede.
GRANT SELECT ON public.sale_costs TO authenticated;

DROP POLICY IF EXISTS "Admins read sale costs" ON public.sale_costs;
CREATE POLICY "Admins read sale costs" ON public.sale_costs
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    AND EXISTS (
      SELECT 1 FROM public.sales s
       WHERE s.id = sale_costs.sale_id
         AND s.branch_id IN (SELECT public.my_branch_ids())
    )
  );

-- AFTER INSERT em sales: pega TODO caminho de venda (create_sale, pedido do
-- catálogo confirmado, INSERT direto) sem reescrever nenhuma function.
CREATE OR REPLACE FUNCTION public.freeze_sale_cost()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $freeze_sale_cost$
BEGIN
  INSERT INTO public.sale_costs (sale_id, unit_cost)
  SELECT NEW.id, pb.purchase_price
    FROM public.product_branch pb
   WHERE pb.product_id = NEW.product_id
     AND pb.branch_id = NEW.branch_id
     AND pb.purchase_price IS NOT NULL
  ON CONFLICT (sale_id) DO NOTHING;
  RETURN NEW;
END;
$freeze_sale_cost$;

DROP TRIGGER IF EXISTS sales_freeze_cost ON public.sales;
CREATE TRIGGER sales_freeze_cost
  AFTER INSERT ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.freeze_sale_cost();

-- Backfill: o custo DE HOJE da filial da venda. Não é o custo de quando ela
-- aconteceu (esse dado não existe), mas é o número que o razão já usava — e a
-- partir daqui ele para de andar.
INSERT INTO public.sale_costs (sale_id, unit_cost)
SELECT s.id, pb.purchase_price
  FROM public.sales s
  JOIN public.product_branch pb ON pb.product_id = s.product_id AND pb.branch_id = s.branch_id
 WHERE pb.purchase_price IS NOT NULL
ON CONFLICT (sale_id) DO NOTHING;


-- ------------------------------------------------------------
-- 3. O razão: CPV pelo custo congelado, retirada como comissão em mercadoria
-- ------------------------------------------------------------
-- Cópia da view da 20260915130000 com três pernas mudadas (sale_cogs,
-- seller_withdrawal, seller_debt_payment). Mesmas colunas, na mesma ordem.
DROP VIEW IF EXISTS public.financial_events;

CREATE VIEW public.financial_events AS
SELECT pc.id, 'partner_contribution'::text AS kind, pc.date AS event_date, pc.created_at,
  'Aporte — '::text || COALESCE(p.name, 'sócio'::text) AS description,
  pc.amount, pc.amount AS cash_delta, 0::numeric AS inventory_delta, 0::numeric AS receivable_delta,
  0::numeric AS loan_delta, pc.amount AS partner_capital_delta,
  0::numeric AS accumulated_profit_delta, 0::numeric AS distributed_profit_delta,
  'partner_contributions'::text AS ref_table, pc.id AS ref_id, pc.notes,
  NULL::uuid AS branch_id
FROM partner_contributions pc LEFT JOIN partners p ON p.id = pc.partner_id
UNION ALL
SELECT l.id, 'loan_received', l.received_date, l.created_at,
  'Empréstimo — ' || l.lender_name, l.principal, l.principal, 0, 0, l.principal, 0, 0, 0,
  'loans', l.id, l.notes,
  NULL::uuid
FROM loans l
UNION ALL
SELECT lp.id, 'loan_payment', lp.date, lp.created_at, 'Pagamento de empréstimo',
  lp.principal_amount + lp.interest_amount, -(lp.principal_amount + lp.interest_amount),
  0, 0, -lp.principal_amount, 0, -lp.interest_amount, 0,
  'loan_payments', lp.id, lp.notes,
  NULL::uuid
FROM loan_payments lp
UNION ALL
SELECT se.id, 'stock_purchase', se.date::date, se.created_at, 'Compra de estoque',
  se.total_cost, -se.total_cost, se.total_cost, 0, 0, 0, 0, 0,
  'stock_entries', se.id, se.notes,
  se.branch_id
FROM stock_entries se
UNION ALL
SELECT s.id, 'sale', s.date::date, s.created_at, 'Venda', s.total_price,
  COALESCE(s.paid_amount, 0), 0, s.total_price - COALESCE(s.paid_amount, 0),
  0, 0, s.total_price, 0, 'sales', s.id, s.notes,
  s.branch_id
FROM sales s WHERE s.type = 'venda'
UNION ALL
-- CPV pelo custo CONGELADO na venda (sale_costs). O custo de hoje da filial
-- só entra para venda que por algum motivo não tem o seu — e é a mesma leitura
-- que existia antes.
SELECT s.id, 'sale_cogs', s.date::date, s.created_at, 'CPV',
  COALESCE(sc.unit_cost, pb.purchase_price) * s.quantity, 0,
  -(COALESCE(sc.unit_cost, pb.purchase_price) * s.quantity), 0, 0, 0,
  -(COALESCE(sc.unit_cost, pb.purchase_price) * s.quantity), 0, 'sales', s.id, NULL,
  s.branch_id
FROM sales s
LEFT JOIN sale_costs sc ON sc.sale_id = s.id
LEFT JOIN product_branch pb ON pb.product_id = s.product_id AND pb.branch_id = s.branch_id
WHERE s.type = 'venda' AND COALESCE(sc.unit_cost, pb.purchase_price) IS NOT NULL
UNION ALL
-- Retirada de funcionário: COMISSÃO PAGA EM MERCADORIA. Sai do estoque e do
-- lucro pelo custo, sem recebível — o valor dela (pelo preço) já é descontado
-- da comissão no saldo do vendedor, e é por isso que a comissão paga em
-- dinheiro vem menor.
SELECT s.id, 'seller_withdrawal', s.date::date, s.created_at, 'Retirada de funcionário',
  COALESCE(sc.unit_cost, pb.purchase_price) * s.quantity,
  0,
  -(COALESCE(sc.unit_cost, pb.purchase_price) * s.quantity),
  0,
  0, 0,
  -(COALESCE(sc.unit_cost, pb.purchase_price) * s.quantity),
  0,
  'sales', s.id, s.notes,
  s.branch_id
FROM sales s
LEFT JOIN sale_costs sc ON sc.sale_id = s.id
LEFT JOIN product_branch pb ON pb.product_id = s.product_id AND pb.branch_id = s.branch_id
WHERE s.type = 'retirada_funcionario' AND COALESCE(sc.unit_cost, pb.purchase_price) IS NOT NULL
UNION ALL
-- seller_manual_debts continua fora: ajuste avulso de saldo, sem dinheiro.
--
-- Pagamento de dívida do vendedor: dinheiro que entra E lucro — ele está
-- devolvendo a comissão que tinha recebido em mercadoria (a retirada), ou
-- pagando uma dívida avulsa que nunca foi despesa. Não mexe em recebível:
-- a retirada não cria mais um.
SELECT sdp.id, 'seller_debt_payment', sdp.date::date, sdp.created_at, 'Pagamento de dívida de vendedor',
  sdp.amount, sdp.amount, 0, 0, 0, 0, sdp.amount, 0,
  'seller_debt_payments', sdp.id, sdp.notes,
  sel.branch_id
FROM seller_debt_payments sdp LEFT JOIN sellers sel ON sel.id = sdp.seller_id
UNION ALL
SELECT e.id, 'expense', e.date::date, e.created_at, COALESCE(e.description, e.category),
  e.amount, -e.amount, 0, 0, 0, 0, -e.amount, 0, 'expenses', e.id, NULL,
  e.branch_id
FROM expenses e
UNION ALL
SELECT plp.id, 'withdrawal', plp.date, plp.created_at, 'Retirada de sócio',
  plp.amount, -plp.amount, 0, 0, 0, 0, 0, plp.amount,
  'pro_labore_payments', plp.id, plp.notes,
  NULL::uuid
FROM pro_labore_payments plp
UNION ALL
SELECT cp.id, 'commission_paid', cp.date, cp.created_at, 'Comissão paga',
  cp.amount, -cp.amount, 0, 0, 0, 0, -cp.amount, 0,
  'commission_payments', cp.id, cp.notes,
  sel.branch_id
FROM commission_payments cp LEFT JOIN sellers sel ON sel.id = cp.seller_id
UNION ALL
SELECT sl.id, 'stock_loss', sl.date::date, sl.created_at, 'Perda de estoque',
  sl.total_cost, 0, -sl.total_cost, 0, 0, 0, -sl.total_cost, 0,
  'stock_losses', sl.id, sl.reason,
  sl.branch_id
FROM stock_losses sl;

-- Os três que o DROP levou junto.
ALTER VIEW public.financial_events SET (security_invoker = on);
REVOKE ALL ON public.financial_events FROM anon;
GRANT SELECT ON public.financial_events TO authenticated, service_role;
