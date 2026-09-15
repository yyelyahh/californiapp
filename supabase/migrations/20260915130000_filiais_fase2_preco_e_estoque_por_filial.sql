-- ============================================================
-- Filiais, fase 2: o corte — preço e estoque passam a ser da cidade
-- ------------------------------------------------------------
-- ESTA MIGRATION SOBE JUNTO COM O FRONT DA FASE 3. Ela REMOVE colunas de
-- `products` que a tela lê hoje (`stock`, `sale_price`, `purchase_price`,
-- `min_stock`). Aprovar o SQL e deixar o front para depois derruba o app.
--
-- O desenho: o CATÁLOGO é compartilhado (uma linha por sabor em `products`,
-- como sempre), e o que varia por cidade — preço, custo, estoque, mínimo —
-- sai para `product_branch`.
--
-- `product_branch` é ESPARSA de propósito: produto sem linha numa filial é
-- produto que aquela cidade NÃO VENDE. Densa (uma linha para todo produto em
-- toda filial) exigiria semear um preço, e preço semeado em zero vende de
-- graça na primeira vez que alguém esquecer de preencher.
--
-- As colunas antigas NÃO ficam como resíduo. `products.image_url` já ensinou
-- o preço disso: ninguém escreve nela há meses, ela continua sendo lida como
-- fallback e toda leitura de foto precisa lembrar que existe. Uma coluna
-- `stock` que ninguém atualiza seria pior — ela mostra um número.
--
-- ORDEM DENTRO DO ARQUIVO, e ela é obrigatória:
--   1. `product_branch` + backfill
--   2. `branch_id` em sales / stock_entries / stock_losses / expenses
--   3. DROP VIEW financial_events + recriar  (a view DEPENDE de
--      products.purchase_price; o DROP COLUMN falha se ela vier depois)
--   4. reescrever as functions          (ainda com as colunas de pé)
--   5. DROP COLUMN em products
--   6. refazer o GRANT SELECT (colunas) ON products  — coluna fora da lista
--      derruba a consulta INTEIRA, não só a coluna (lição da 20260901091725)
--   7. RLS
--   8. auditoria da tabela nova
-- ============================================================


-- ============================================================
-- 0. A fase 1 precisa ter rodado
-- ============================================================
-- Sem ela, a primeira falha seria a FK de `product_branch` reclamando de uma
-- tabela `branches` que não existe — mensagem que não diz o que fazer. Aqui a
-- mensagem diz.
DO $exige_fase_um$
BEGIN
  IF to_regclass('public.branches') IS NULL THEN
    RAISE EXCEPTION 'aplique antes a migration 20260915120000 (filiais, fase 1)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.branches) THEN
    RAISE EXCEPTION 'nenhuma filial cadastrada — confira o seed da 20260915120000';
  END IF;
END $exige_fase_um$;


-- ============================================================
-- 1. product_branch: o que é da cidade
-- ============================================================

CREATE TABLE IF NOT EXISTS public.product_branch (
  product_id     uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  branch_id      uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  sale_price     numeric NOT NULL DEFAULT 0,
  purchase_price numeric NOT NULL DEFAULT 0,
  stock          integer NOT NULL DEFAULT 0,
  min_stock      integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, branch_id)
);

COMMENT ON TABLE public.product_branch IS
  'Preço, custo, estoque e mínimo de cada sabor em cada cidade. Esparsa: sem linha = aquela filial não vende esse sabor.';

CREATE INDEX IF NOT EXISTS product_branch_branch_idx ON public.product_branch (branch_id);

-- Backfill: uma linha por produto na matriz (a filial mais antiga). Tudo o
-- que existe hoje nasceu lá.
INSERT INTO public.product_branch (product_id, branch_id, sale_price, purchase_price, stock, min_stock, created_at)
SELECT p.id,
       (SELECT id FROM public.branches ORDER BY created_at LIMIT 1),
       p.sale_price,
       p.purchase_price,
       p.stock,
       p.min_stock,
       p.created_at
  FROM public.products p
ON CONFLICT (product_id, branch_id) DO NOTHING;

-- O MESMO tratamento de GRANT por coluna que `products` tem: o custo não
-- chega ao cliente autenticado, e quem precisa dele passa pela
-- get_product_costs. RLS sozinha não esconde coluna.
ALTER TABLE public.product_branch ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.product_branch FROM anon, authenticated, public;
GRANT SELECT (product_id, branch_id, sale_price, stock, min_stock, created_at)
  ON public.product_branch TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.product_branch TO authenticated;
GRANT ALL ON public.product_branch TO service_role;


-- ============================================================
-- 2. branch_id onde não há vendedor de quem derivar
-- ============================================================
-- `sales` e `stock_losses` precisam de coluna própria porque `seller_id` é
-- NULO na venda manual do admin, na retirada de funcionário e na perda da
-- casa. E a coluna é carimbada na ESCRITA de propósito: venda feita na
-- cidade A continua na cidade A mesmo que o vendedor um dia mude de lugar.

ALTER TABLE public.sales         ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id);
ALTER TABLE public.stock_entries ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id);
ALTER TABLE public.stock_losses  ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id);
ALTER TABLE public.expenses      ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id);

-- Os gatilhos de usuário saem do caminho durante o backfill, e voltam logo
-- depois. Carimbar uma coluna nova em linha antiga NÃO é um evento de
-- negócio: é o esquema alcançando o que já existia.
--
-- Sem isto, duas coisas quebram:
--
--   * `validate_sale_integrity` roda em CADA venda do histórico e refaz o piso
--     de 70% do preço de tabela DE HOJE. Toda unidade premiada pela fidelidade
--     saiu por METADE do preço — abaixo do piso, e legitimamente — então o
--     UPDATE morre em "Valor unitário abaixo do permitido para este produto",
--     falando de uma venda de meses atrás que ninguém está editando. (No SQL
--     Editor `auth.uid()` é nulo, então `has_role` devolve false e nem a
--     isenção de admin salva.)
--   * o gatilho de auditoria grava uma linha por venda, por entrada, por perda
--     e por despesa do histórico inteiro — o mesmo motivo pelo qual o gatilho
--     de `product_branch` só é pendurado DEPOIS do backfill, no fim deste
--     arquivo.
--
-- `DISABLE TRIGGER USER` não encosta nos gatilhos internos de constraint: a FK
-- de `branch_id` continua sendo verificada.
DO $backfill_branch$
DECLARE
  v_matriz uuid := (SELECT id FROM public.branches ORDER BY created_at LIMIT 1);
  t text;
BEGIN
  IF v_matriz IS NULL THEN
    RAISE EXCEPTION 'nenhuma filial cadastrada — a fase 1 não foi aplicada';
  END IF;
  FOREACH t IN ARRAY ARRAY['sales', 'stock_entries', 'stock_losses', 'expenses'] LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER USER', t);
    EXECUTE format('UPDATE public.%I SET branch_id = $1 WHERE branch_id IS NULL', t) USING v_matriz;
    EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER USER', t);

    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN branch_id SET NOT NULL', t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %1$s_branch_idx ON public.%1$I (branch_id)', t);
  END LOOP;
END $backfill_branch$;


-- ============================================================
-- 3. O razão: CPV passa a ler o custo da cidade da venda
-- ============================================================
-- DROP + CREATE, não CREATE OR REPLACE: este só aceita ACRESCENTAR coluna no
-- fim, e aqui o corpo de duas pernas muda. O DROP leva os GRANTs e o
-- `security_invoker` junto — os três voltam no fim do bloco.
--
-- A coluna `branch_id` nova NÃO é usada pela fase 3: o Financeiro continua
-- global, porque a sociedade é do negócio inteiro. Ela entra agora porque a
-- view está sendo reescrita de qualquer jeito, e é o que abre "resultado por
-- cidade" mais adiante sem um segundo DROP VIEW.
--
-- Ela é NULA nas pernas de SOCIEDADE (aporte, empréstimo, pagamento de
-- empréstimo, retirada de sócio) e preenchida nas de OPERAÇÃO. Nulo aqui não
-- é dado faltando: é a afirmação de que aquele movimento não é de cidade
-- nenhuma.
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
-- CPV pelo custo DA CIDADE da venda: o mesmo sabor pode ter sido comprado
-- por preços diferentes nas duas praças, e é o custo de lá que a venda de lá
-- consome.
SELECT s.id, 'sale_cogs', s.date::date, s.created_at, 'CPV',
  pb.purchase_price * s.quantity, 0, -(pb.purchase_price * s.quantity), 0, 0, 0,
  -(pb.purchase_price * s.quantity), 0, 'sales', s.id, NULL,
  s.branch_id
FROM sales s
JOIN product_branch pb ON pb.product_id = s.product_id AND pb.branch_id = s.branch_id
WHERE s.type = 'venda' AND pb.purchase_price IS NOT NULL
UNION ALL
-- Retirada de funcionário: transferência estoque -> A Receber pelo CUSTO.
-- Sem reconhecer receita/lucro no ato. A margem só aparecerá quando pago.
SELECT s.id, 'seller_withdrawal', s.date::date, s.created_at, 'Retirada de funcionário',
  pb.purchase_price * s.quantity,
  0,
  -(pb.purchase_price * s.quantity),
  pb.purchase_price * s.quantity,
  0, 0, 0, 0,
  'sales', s.id, s.notes,
  s.branch_id
FROM sales s
JOIN product_branch pb ON pb.product_id = s.product_id AND pb.branch_id = s.branch_id
WHERE s.type = 'retirada_funcionario' AND pb.purchase_price IS NOT NULL
UNION ALL
-- seller_manual_debts removido do ledger: são ajustes avulsos de saldo do vendedor,
-- sem contrapartida financeira real. Continuam existindo na tabela e no relatório do vendedor.
--
-- Aqui e na comissão a filial vem do VENDEDOR — são tabelas de vendedor, e
-- vendedor tem uma cidade. LEFT JOIN para a linha nunca sumir por causa do
-- rótulo: o que filtra de verdade é a RLS da tabela de origem.
SELECT sdp.id, 'seller_debt_payment', sdp.date::date, sdp.created_at, 'Pagamento de dívida de vendedor',
  sdp.amount, sdp.amount, 0, -sdp.amount, 0, 0, 0, 0,
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


-- ============================================================
-- 4. As functions
-- ============================================================

-- ------------------------------------------------------------
-- 4.1 Os dois motores de estoque ganham a filial
-- ------------------------------------------------------------
-- Lista de parâmetros diferente ⇒ DROP obrigatório. Sem ele ficariam duas
-- versões coexistindo e a de 2 argumentos continuaria sendo escolhida pelas
-- chamadas antigas — mexendo numa coluna `products.stock` que nem existe
-- mais, e falhando só em tempo de execução.
DROP FUNCTION IF EXISTS public.decrement_product_stock(uuid, integer);
DROP FUNCTION IF EXISTS public.increment_product_stock(uuid, integer);

CREATE FUNCTION public.decrement_product_stock(
  p_product_id uuid,
  p_quantity   integer,
  p_branch_id  uuid
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $decrement_product_stock$
DECLARE
  v_new_stock integer;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'quantidade_invalida';
  END IF;
  IF p_branch_id IS NULL THEN
    RAISE EXCEPTION 'filial_obrigatoria';
  END IF;

  -- UPDATE condicional: só aplica se ainda houver estoque suficiente
  -- no momento exato da escrita (não no momento da leitura anterior).
  -- É isso que elimina a janela de corrida.
  UPDATE public.product_branch
  SET stock = stock - p_quantity
  WHERE product_id = p_product_id
    AND branch_id = p_branch_id
    AND stock >= p_quantity
  RETURNING stock INTO v_new_stock;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'estoque_insuficiente';
  END IF;

  RETURN v_new_stock;
END;
$decrement_product_stock$;

REVOKE ALL ON FUNCTION public.decrement_product_stock(uuid, integer, uuid) FROM PUBLIC, anon;

CREATE FUNCTION public.increment_product_stock(
  p_product_id uuid,
  p_quantity   integer,
  p_branch_id  uuid
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $increment_product_stock$
DECLARE
  v_new_stock integer;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'quantidade_invalida';
  END IF;
  IF p_branch_id IS NULL THEN
    RAISE EXCEPTION 'filial_obrigatoria';
  END IF;

  UPDATE public.product_branch
  SET stock = stock + p_quantity
  WHERE product_id = p_product_id AND branch_id = p_branch_id
  RETURNING stock INTO v_new_stock;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'produto_nao_encontrado';
  END IF;

  RETURN v_new_stock;
END;
$increment_product_stock$;

REVOKE ALL ON FUNCTION public.increment_product_stock(uuid, integer, uuid) FROM PUBLIC, anon;


-- ------------------------------------------------------------
-- 4.2 create_sale: a venda nasce com cidade
-- ------------------------------------------------------------
-- 11º parâmetro, então DROP e GRANT de novo.
--
-- Quando a venda tem vendedor, a filial NÃO é escolhida por quem chama: ela
-- é derivada de `sellers.branch_id`. O `p_branch_id`, quando vem junto, é
-- CONFERIDO contra ela — um front que mande a filial errada leva um erro em
-- vez de gravar a venda na cidade de outra pessoa.
DROP FUNCTION IF EXISTS public.create_sale(uuid, integer, numeric, timestamptz, text, integer, numeric, text, uuid, text);

CREATE FUNCTION public.create_sale(
  p_product_id     uuid,
  p_quantity       integer,
  p_unit_price     numeric,
  p_date           timestamptz,
  p_notes          text DEFAULT NULL,
  p_installments   integer DEFAULT 1,
  p_paid_amount    numeric DEFAULT 0,
  p_type           text DEFAULT 'venda',
  p_seller_id      uuid DEFAULT NULL,
  p_payment_method text DEFAULT NULL,
  p_branch_id      uuid DEFAULT NULL
) RETURNS public.sales
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $create_sale$
DECLARE
  v_is_admin boolean := public.has_role(auth.uid(), 'admin');
  v_my_seller_id uuid := public.get_my_seller_id();
  v_branch_id uuid;
  v_total_price numeric;
  v_paid_now boolean;
  v_paid_at timestamptz;
  v_new_sale public.sales;
  v_remaining integer;
  v_assignment record;
  v_available integer;
BEGIN
  IF NOT v_is_admin THEN
    IF p_seller_id IS NULL OR p_seller_id <> v_my_seller_id THEN
      RAISE EXCEPTION 'nao_autorizado';
    END IF;
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'quantidade_invalida';
  END IF;

  -- ---- De que cidade é esta venda ----
  IF p_seller_id IS NOT NULL THEN
    SELECT s.branch_id INTO v_branch_id FROM public.sellers s WHERE s.id = p_seller_id;
    IF v_branch_id IS NULL THEN
      RAISE EXCEPTION 'vendedor_sem_filial';
    END IF;
    IF p_branch_id IS NOT NULL AND p_branch_id <> v_branch_id THEN
      RAISE EXCEPTION 'filial_divergente';
    END IF;
  ELSE
    -- Venda manual e retirada de funcionário não têm vendedor: só existem
    -- com uma filial concreta. "Todas as filiais" é somente leitura, e é
    -- aqui que essa regra deixa de ser combinado de tela.
    v_branch_id := p_branch_id;
    IF v_branch_id IS NULL THEN
      RAISE EXCEPTION 'filial_obrigatoria';
    END IF;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.my_branch_ids() b WHERE b = v_branch_id) THEN
    RAISE EXCEPTION 'nao_autorizado';
  END IF;

  IF p_seller_id IS NOT NULL THEN
    -- trava as linhas de atribuição do vendedor e soma a quantidade disponível
    SELECT COALESCE(SUM(l.quantity), 0) INTO v_available
    FROM (
      SELECT quantity
      FROM public.product_assignments
      WHERE seller_id = p_seller_id AND product_id = p_product_id
      FOR UPDATE
    ) l;

    IF v_available < p_quantity THEN
      RAISE EXCEPTION 'estoque_vendedor_insuficiente';
    END IF;
  END IF;

  v_total_price := p_quantity * p_unit_price;
  v_paid_now := (p_type = 'venda') AND (COALESCE(p_paid_amount, 0) >= v_total_price - 0.01);
  v_paid_at := CASE WHEN v_paid_now THEN now() ELSE NULL END;

  PERFORM public.decrement_product_stock(p_product_id, p_quantity, v_branch_id);

  INSERT INTO public.sales (
    product_id, quantity, unit_price, total_price, date, notes,
    installments, paid_amount, paid_at, type, seller_id, payment_method, branch_id
  ) VALUES (
    p_product_id, p_quantity, p_unit_price, v_total_price, p_date, p_notes,
    p_installments,
    CASE WHEN p_type = 'retirada_funcionario' THEN 0 ELSE COALESCE(p_paid_amount, 0) END,
    v_paid_at, p_type, p_seller_id,
    CASE WHEN p_type = 'venda' THEN p_payment_method ELSE NULL END,
    v_branch_id
  ) RETURNING * INTO v_new_sale;

  IF p_seller_id IS NOT NULL THEN
    v_remaining := p_quantity;
    FOR v_assignment IN
      SELECT id, quantity FROM public.product_assignments
      WHERE seller_id = p_seller_id AND product_id = p_product_id
      ORDER BY created_at ASC
      FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0;
      IF v_assignment.quantity <= v_remaining THEN
        DELETE FROM public.product_assignments WHERE id = v_assignment.id;
        v_remaining := v_remaining - v_assignment.quantity;
      ELSE
        UPDATE public.product_assignments SET quantity = quantity - v_remaining WHERE id = v_assignment.id;
        v_remaining := 0;
      END IF;
    END LOOP;
  END IF;

  RETURN v_new_sale;
END;
$create_sale$;

GRANT EXECUTE ON FUNCTION public.create_sale(uuid, integer, numeric, timestamptz, text, integer, numeric, text, uuid, text, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.create_sale(uuid, integer, numeric, timestamptz, text, integer, numeric, text, uuid, text, uuid) FROM PUBLIC, anon;


-- ------------------------------------------------------------
-- 4.3 delete_sale devolve o estoque na filial DA VENDA
-- ------------------------------------------------------------
-- Mesma assinatura ⇒ CREATE OR REPLACE. A filial sai de `v_sale.branch_id`,
-- não do vendedor: é justamente o caso em que os dois podem divergir depois.
CREATE OR REPLACE FUNCTION public.delete_sale(p_sale_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $delete_sale$
DECLARE
  v_sale public.sales;
  v_is_admin boolean := public.has_role(auth.uid(), 'admin');
  v_my_seller_id uuid := public.get_my_seller_id();
  v_assignment_id uuid;
BEGIN
  SELECT * INTO v_sale FROM public.sales WHERE id = p_sale_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'venda_nao_encontrada';
  END IF;

  IF NOT v_is_admin AND (v_sale.seller_id IS NULL OR v_sale.seller_id <> v_my_seller_id) THEN
    RAISE EXCEPTION 'nao_autorizado';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.my_branch_ids() b WHERE b = v_sale.branch_id) THEN
    RAISE EXCEPTION 'nao_autorizado';
  END IF;

  DELETE FROM public.sales WHERE id = p_sale_id;
  PERFORM public.increment_product_stock(v_sale.product_id, v_sale.quantity, v_sale.branch_id);

  IF v_sale.seller_id IS NOT NULL THEN
    SELECT id INTO v_assignment_id
    FROM public.product_assignments
    WHERE seller_id = v_sale.seller_id AND product_id = v_sale.product_id
    LIMIT 1
    FOR UPDATE;

    IF v_assignment_id IS NOT NULL THEN
      UPDATE public.product_assignments SET quantity = quantity + v_sale.quantity WHERE id = v_assignment_id;
    ELSE
      INSERT INTO public.product_assignments (seller_id, product_id, quantity)
      VALUES (v_sale.seller_id, v_sale.product_id, v_sale.quantity);
    END IF;
  END IF;
END;
$delete_sale$;


-- ------------------------------------------------------------
-- 4.4 O piso de preço da venda é o da cidade
-- ------------------------------------------------------------
-- O gatilho que impede o vendedor de vender a menos de 70% da tabela lia
-- `products.sale_price`. Com preço por filial, a tabela dele é a da cidade
-- da venda — senão a trava da cidade cara valeria na cidade barata.
CREATE OR REPLACE FUNCTION public.validate_sale_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $validate_sale_integrity$
DECLARE
  v_sale_price numeric;
  v_price_touched boolean;
BEGIN
  IF NEW.quantity IS NULL OR NEW.quantity <= 0 THEN
    RAISE EXCEPTION 'Quantidade inválida';
  END IF;
  IF NEW.unit_price IS NULL OR NEW.unit_price < 0 THEN
    RAISE EXCEPTION 'Valor unitário inválido';
  END IF;
  IF NEW.total_price IS NULL
     OR round(NEW.total_price, 2) <> round(NEW.unit_price * NEW.quantity, 2) THEN
    RAISE EXCEPTION 'Total da venda não confere com quantidade x valor unitário';
  END IF;
  IF COALESCE(NEW.paid_amount, 0) < 0
     OR round(COALESCE(NEW.paid_amount, 0), 2) > round(NEW.total_price, 2) THEN
    RAISE EXCEPTION 'Valor pago inválido';
  END IF;

  -- O piso de 70% vale para quem DEFINE um preço, não para quem mexe em
  -- qualquer outra coluna da venda.
  --
  -- Antes ele era refeito em todo UPDATE, contra o preço de tabela DE HOJE: um
  -- vendedor marcando como recebida uma venda antiga levava "Valor unitário
  -- abaixo do permitido" por causa de um desconto legítimo dado meses atrás —
  -- e toda unidade premiada pela fidelidade sai por METADE do preço, ou seja,
  -- sempre abaixo do piso. Preço que ninguém tocou não se revalida: ele já
  -- passou por aqui no dia em que foi gravado.
  --
  -- A comparação de OLD fica dentro do `IF TG_OP = 'UPDATE'` porque no INSERT
  -- o registro OLD nem existe, e o AND do SQL não garante curto-circuito.
  v_price_touched := (TG_OP = 'INSERT');
  IF TG_OP = 'UPDATE' THEN
    v_price_touched := NEW.unit_price IS DISTINCT FROM OLD.unit_price;
  END IF;

  IF v_price_touched AND NEW.type = 'venda' AND NOT public.has_role(auth.uid(), 'admin') THEN
    SELECT pb.sale_price INTO v_sale_price
      FROM public.product_branch pb
     WHERE pb.product_id = NEW.product_id
       AND pb.branch_id = NEW.branch_id;
    IF v_sale_price IS NOT NULL AND NEW.unit_price < v_sale_price * 0.7 THEN
      RAISE EXCEPTION 'Valor unitário abaixo do permitido para este produto';
    END IF;
  END IF;

  RETURN NEW;
END;
$validate_sale_integrity$;


-- ------------------------------------------------------------
-- 4.5 get_product_costs ganha a filial
-- ------------------------------------------------------------
-- Assinatura diferente ⇒ DROP e GRANT de novo.
--
-- Com `p_branch_id` nulo ("Todas") devolve o MAIOR custo entre as filiais
-- que a pessoa alcança — o mesmo critério do preço em get_branch_products.
-- Custo alto e preço alto juntos mantêm a margem exibida conservadora: um
-- número consolidado que erra deve errar para baixo.
DROP FUNCTION IF EXISTS public.get_product_costs();

CREATE FUNCTION public.get_product_costs(p_branch_id uuid DEFAULT NULL)
RETURNS TABLE(product_id uuid, purchase_price numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $get_product_costs$
  SELECT pb.product_id, MAX(pb.purchase_price)
    FROM public.product_branch pb
   WHERE public.has_role(auth.uid(), 'admin')
     AND pb.branch_id IN (SELECT public.my_branch_ids())
     AND (p_branch_id IS NULL OR pb.branch_id = p_branch_id)
   GROUP BY pb.product_id;
$get_product_costs$;

REVOKE EXECUTE ON FUNCTION public.get_product_costs(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_product_costs(uuid) TO authenticated;


-- ------------------------------------------------------------
-- 4.6 get_branch_products: a lista que segura o front
-- ------------------------------------------------------------
-- Esta function é o que permite ao front NÃO mudar de forma. Ela devolve
-- exatamente o que `PRODUCT_COLS` devolvia — e sem `purchase_price`, que é
-- justamente por isso que ela pode ser SECURITY DEFINER sem abrir o custo.
--
-- Com `p_branch_id` NULL ela agrega ("Todas as filiais"): estoque e mínimo
-- SOMADOS, preço o MAIOR, mais `price_varies` dizendo que o número de preço
-- ali não é um preço, é o teto de dois. A tela lê esse booleano e avisa —
-- somar estoque é honesto, somar preço não seria.
--
-- O filtro por `my_branch_ids()` é a rede de segurança do SECURITY DEFINER:
-- "Todas" nunca quer dizer "todas as do banco", quer dizer "todas as
-- minhas". Sem ele, o sócio que forçasse a chamada com NULL veria a rede.
CREATE OR REPLACE FUNCTION public.get_branch_products(p_branch_id uuid DEFAULT NULL)
RETURNS TABLE(
  id           uuid,
  name         text,
  brand        text,
  model        text,
  flavor       text,
  sale_price   numeric,
  stock        integer,
  min_stock    integer,
  image_url    text,
  created_at   timestamptz,
  price_varies boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $get_branch_products$
  SELECT p.id,
         p.name,
         p.brand,
         COALESCE(p.model, '') AS model,
         p.flavor,
         MAX(pb.sale_price)                  AS sale_price,
         SUM(pb.stock)::integer              AS stock,
         SUM(pb.min_stock)::integer          AS min_stock,
         p.image_url,
         p.created_at,
         (COUNT(DISTINCT pb.sale_price) > 1) AS price_varies
    FROM public.product_branch pb
    JOIN public.products p ON p.id = pb.product_id
   WHERE pb.branch_id IN (SELECT public.my_branch_ids())
     AND (p_branch_id IS NULL OR pb.branch_id = p_branch_id)
   GROUP BY p.id, p.name, p.brand, p.model, p.flavor, p.image_url, p.created_at
   ORDER BY p.created_at;
$get_branch_products$;

REVOKE EXECUTE ON FUNCTION public.get_branch_products(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_branch_products(uuid) TO authenticated;


-- ------------------------------------------------------------
-- 4.7 A loja pública: a filial sai do vendedor, por dentro
-- ------------------------------------------------------------
-- As 11 colunas de retorno NÃO mudam, então CREATE OR REPLACE basta e o
-- GRANT para anon sobrevive. É o que faz `/loja/:sellerId` não mudar uma
-- linha de código: o link é do vendedor, o vendedor é de uma cidade, e o
-- preço que a loja mostra é o de lá.
--
-- Efeito da esparsidade: sabor atribuído ao vendedor mas sem linha em
-- `product_branch` na cidade dele não aparece no catálogo. É a leitura
-- certa — sem preço cadastrado ali, não há o que vender.
CREATE OR REPLACE FUNCTION public.get_seller_catalog(p_seller_id uuid)
RETURNS TABLE(
  seller_name   text,
  product_id    uuid,
  name          text,
  brand         text,
  model         text,
  flavor        text,
  sale_price    numeric,
  loyalty_price numeric,
  combo_price   numeric,
  available     integer,
  image_url     text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $get_seller_catalog$
  WITH foto AS (
    SELECT DISTINCT ON (lower(btrim(pmi.brand)), lower(btrim(COALESCE(pmi.model, ''))))
           lower(btrim(pmi.brand))               AS brand_key,
           lower(btrim(COALESCE(pmi.model, ''))) AS model_key,
           NULLIF(btrim(pmi.image_url), '')      AS image_url
      FROM public.product_model_images pmi
     ORDER BY lower(btrim(pmi.brand)),
              lower(btrim(COALESCE(pmi.model, ''))),
              pmi.created_at DESC
  ),
  filial AS (
    SELECT s.name AS seller_name, s.branch_id
      FROM public.sellers s
     WHERE s.id = p_seller_id
  )
  SELECT
    f.seller_name,
    p.id AS product_id,
    p.name,
    p.brand,
    COALESCE(p.model, '') AS model,
    p.flavor,
    pb.sale_price,
    public.loyalty_unit_price(pb.sale_price, pb.purchase_price) AS loyalty_price,
    public.combo_unit_price(pb.sale_price, pb.purchase_price)   AS combo_price,
    GREATEST(0, pa.assigned - COALESCE((
      SELECT SUM(oi.quantity)
      FROM public.order_items oi
      JOIN public.orders o ON o.id = oi.order_id
      WHERE o.seller_id = p_seller_id
        AND oi.product_id = p.id
        AND o.status = 'pendente'
        AND o.created_at > now() - public.order_reservation_ttl()
    ), 0))::integer AS available,
    COALESCE(foto.image_url, NULLIF(btrim(p.image_url), '')) AS image_url
  FROM (
    SELECT product_id, SUM(quantity) AS assigned
    FROM public.product_assignments
    WHERE seller_id = p_seller_id
    GROUP BY product_id
  ) pa
  JOIN public.products p ON p.id = pa.product_id
  CROSS JOIN filial f
  JOIN public.product_branch pb
    ON pb.product_id = p.id AND pb.branch_id = f.branch_id
  LEFT JOIN foto
    ON foto.brand_key = lower(btrim(p.brand))
   AND foto.model_key = lower(btrim(COALESCE(p.model, '')))
  ORDER BY p.brand, p.flavor;
$get_seller_catalog$;


-- ------------------------------------------------------------
-- 4.8 O comprovante do pedido lê o preço cheio da cidade
-- ------------------------------------------------------------
-- O desconto continua sem coluna: ele É a diferença entre o preço cheio e o
-- `unit_price` gravado. O que muda é de onde sai o preço cheio — da filial
-- do vendedor do pedido, não mais de `products`.
CREATE OR REPLACE FUNCTION public.order_receipt(p_order_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $order_receipt$
  SELECT jsonb_build_object(
    'order_id',       o.id,
    'total',          o.total_amount,
    'discount_total', COALESCE(SUM((pb.sale_price - oi.unit_price) * oi.quantity)
                        FILTER (WHERE oi.unit_price < pb.sale_price), 0),
    'discount_units', COALESCE(SUM(oi.quantity)
                        FILTER (WHERE oi.unit_price < pb.sale_price), 0)
  )
  FROM public.orders o
  JOIN public.order_items oi ON oi.order_id = o.id
  JOIN public.sellers sel    ON sel.id = o.seller_id
  JOIN public.product_branch pb
    ON pb.product_id = oi.product_id AND pb.branch_id = sel.branch_id
  WHERE o.id = p_order_id
  GROUP BY o.id, o.total_amount;
$order_receipt$;

REVOKE EXECUTE ON FUNCTION public.order_receipt(uuid) FROM PUBLIC, anon, authenticated;


-- ------------------------------------------------------------
-- 4.9 create_pending_order: preço e custo vêm da cidade do vendedor
-- ------------------------------------------------------------
-- Mesma assinatura e mesmo retorno ⇒ CREATE OR REPLACE, e o GRANT para anon
-- é preservado. O corpo é o da 20260911120000; muda só de onde sai o
-- dinheiro: `products.sale_price/purchase_price` vira
-- `product_branch.sale_price/purchase_price` na filial do vendedor.
--
-- A CHECAGEM DE ESTOQUE não muda e não deveria: o que limita o pedido do
-- catálogo é `product_assignments` — o que está NA MÃO daquele vendedor —,
-- não o estoque da loja. E atribuição já é de uma cidade só, porque o
-- vendedor é. `product_branch` entra aqui como fonte de PREÇO.
CREATE OR REPLACE FUNCTION public.create_pending_order(
  p_seller_id         uuid,
  p_customer_name     text,
  p_customer_whatsapp text,
  p_freight_notes     text,
  p_items             jsonb,  -- [{ "product_id": "...", "quantity": 2 }] — unit_price é ignorado
  p_client_token      uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $create_pending_order$
DECLARE
  -- Tetos. Não são regra de negócio, são o tamanho máximo do estrago de
  -- uma requisição só.
  c_max_itens        constant integer := 30;
  c_max_por_item     constant integer := 50;
  c_max_unidades     constant integer := 100;
  c_max_pendentes    constant integer := 3;

  v_branch_id     uuid;
  v_customer_id   uuid;
  v_order_id      uuid;
  v_item          record;
  v_assigned      integer;
  v_reserved      integer;
  v_pendentes     integer;
  v_total         numeric := 0;
  v_whatsapp      text;
  v_name          text;
  v_freight       text;
  v_unidades      integer := 0;
  v_historico     integer;
  v_premiadas     integer;
  v_restam        integer;
  v_aqui          integer;
  v_preco_base    numeric;
  v_preco_premio  numeric;
BEGIN
  -- ---- 0) Reenvio do mesmo pedido devolve o mesmo pedido ----
  IF p_client_token IS NOT NULL THEN
    SELECT id INTO v_order_id FROM public.orders WHERE client_token = p_client_token;
    IF v_order_id IS NOT NULL THEN
      RETURN public.order_receipt(v_order_id);
    END IF;
  END IF;

  -- ---- 0.5) A cidade sai do vendedor, sempre ----
  -- O link da loja é dele; o preço que o cliente acabou de ver é o de lá.
  SELECT s.branch_id INTO v_branch_id FROM public.sellers s WHERE s.id = p_seller_id;
  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'vendedor_invalido';
  END IF;

  -- ---- 1) Entrada: cortada no tamanho, nunca recusada por tamanho ----
  -- Cortar em vez de recusar é de propósito aqui: nome e observação são
  -- texto livre de quem está comprando, e barrar o pedido por causa de um
  -- endereço comprido perderia a venda. O que precisa RECUSAR é o que
  -- mexe em estoque, logo abaixo.
  v_name := btrim(left(btrim(COALESCE(p_customer_name, '')), 80));
  IF v_name = '' THEN
    RAISE EXCEPTION 'nome_invalido';
  END IF;

  v_whatsapp := regexp_replace(COALESCE(p_customer_whatsapp, ''), '\D', '', 'g');
  -- Mesma régua do isValidPhone do front: DDD + 8 ou 9 dígitos.
  IF length(v_whatsapp) < 10 OR length(v_whatsapp) > 11 THEN
    RAISE EXCEPTION 'whatsapp_invalido';
  END IF;

  v_freight := nullif(btrim(left(btrim(COALESCE(p_freight_notes, '')), 300)), '');

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'carrinho_vazio';
  END IF;
  IF jsonb_array_length(p_items) > c_max_itens THEN
    RAISE EXCEPTION 'pedido_muito_grande';
  END IF;

  -- ---- 2) Teto de pedidos pendentes por telefone ----
  SELECT count(*) INTO v_pendentes
  FROM public.orders o
  JOIN public.customers c ON c.id = o.customer_id
  WHERE o.seller_id = p_seller_id
    AND o.status = 'pendente'
    AND o.created_at > now() - public.order_reservation_ttl()
    AND regexp_replace(c.whatsapp, '\D', '', 'g') = v_whatsapp;

  IF v_pendentes >= c_max_pendentes THEN
    RAISE EXCEPTION 'muitos_pedidos_pendentes';
  END IF;

  PERFORM public.expire_stale_orders();

  -- ---- 3) Valida e trava cada item ANTES de reservar qualquer coisa ----
  FOR v_item IN
    SELECT x.product_id AS pid, SUM(x.quantity)::integer AS qty
    FROM jsonb_to_recordset(p_items) AS x(product_id uuid, quantity integer)
    GROUP BY x.product_id
    ORDER BY x.product_id
  LOOP
    IF v_item.pid IS NULL THEN
      RAISE EXCEPTION 'item_invalido';
    END IF;
    IF v_item.qty IS NULL OR v_item.qty <= 0 OR v_item.qty > c_max_por_item THEN
      RAISE EXCEPTION 'quantidade_invalida';
    END IF;

    v_unidades := v_unidades + v_item.qty;

    -- FOR UPDATE não convive com agregação na mesma query: trava numa
    -- subconsulta e soma por fora dela.
    SELECT COALESCE(SUM(l.quantity), 0) INTO v_assigned
    FROM (
      SELECT quantity
      FROM public.product_assignments
      WHERE seller_id = p_seller_id AND product_id = v_item.pid
      FOR UPDATE
    ) l;

    SELECT COALESCE(SUM(oi.quantity), 0) INTO v_reserved
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    WHERE o.seller_id = p_seller_id
      AND oi.product_id = v_item.pid
      AND o.status = 'pendente'
      AND o.created_at > now() - public.order_reservation_ttl();

    IF (v_assigned - v_reserved) < v_item.qty THEN
      RAISE EXCEPTION 'estoque_insuficiente:%', v_item.pid;
    END IF;
  END LOOP;

  IF v_unidades > c_max_unidades THEN
    RAISE EXCEPTION 'pedido_muito_grande';
  END IF;

  -- ---- 4) Cliente e pedido ----
  -- O cliente é da REDE, não da cidade: a fidelidade acumula junto nas duas.
  INSERT INTO public.customers (name, whatsapp)
  VALUES (v_name, v_whatsapp)
  ON CONFLICT (whatsapp) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO v_customer_id;

  BEGIN
    INSERT INTO public.orders (customer_id, seller_id, freight_notes, status, client_token)
    VALUES (v_customer_id, p_seller_id, v_freight, 'pendente', p_client_token)
    RETURNING id INTO v_order_id;
  EXCEPTION WHEN unique_violation THEN
    IF p_client_token IS NULL THEN
      RAISE;
    END IF;
    SELECT id INTO v_order_id FROM public.orders WHERE client_token = p_client_token;
    RETURN public.order_receipt(v_order_id);
  END;

  -- ---- 5) Quantas unidades saem premiadas ----
  -- `customer_units` NÃO recebe filial: a fidelidade é da rede inteira.
  v_historico := public.customer_units(v_whatsapp);
  v_premiadas := ((v_historico + v_unidades) / public.loyalty_cycle())
               - (v_historico / public.loyalty_cycle());
  v_restam := v_premiadas;

  -- ---- 6) Itens: combo no preço base, fidelidade na unidade mais barata ----
  FOR v_item IN
    WITH pedido AS (
      SELECT x.product_id AS pid, SUM(x.quantity)::integer AS qty
      FROM jsonb_to_recordset(p_items) AS x(product_id uuid, quantity integer)
      GROUP BY x.product_id
    ),
    com_modelo AS (
      SELECT ped.pid,
             ped.qty,
             pb.sale_price,
             pb.purchase_price,
             public.combo_unit_price(pb.sale_price, pb.purchase_price) AS preco_combo,
             SUM(ped.qty) OVER (
               PARTITION BY public.product_model_key(p.id, p.brand, p.model)
             ) AS unidades_do_modelo
      FROM pedido ped
      JOIN public.products p ON p.id = ped.pid
      JOIN public.product_branch pb
        ON pb.product_id = p.id AND pb.branch_id = v_branch_id
    )
    SELECT pid,
           qty,
           sale_price,
           purchase_price,
           CASE
             WHEN unidades_do_modelo >= public.combo_min_units()
              AND preco_combo < sale_price
               THEN preco_combo
             ELSE sale_price
           END AS base_price
    FROM com_modelo
    ORDER BY base_price, pid
  LOOP
    v_preco_base := v_item.base_price;
    v_aqui := 0;

    IF v_restam > 0 THEN
      v_preco_premio := public.loyalty_unit_price(v_item.sale_price, v_item.purchase_price);
      -- "Não acumula: vale o melhor dos dois". O prêmio só entra se for
      -- melhor que o preço base — e prêmio que não desconta NÃO é
      -- consumido: passa para o próximo item em vez de entregar nada.
      IF v_preco_premio < v_preco_base THEN
        v_aqui := LEAST(v_restam, v_item.qty);
      END IF;
    END IF;

    IF v_aqui > 0 THEN
      INSERT INTO public.order_items (order_id, product_id, quantity, unit_price)
      VALUES (v_order_id, v_item.pid, v_aqui, v_preco_premio);
      v_total := v_total + (v_aqui * v_preco_premio);
      v_restam := v_restam - v_aqui;
    END IF;

    IF (v_item.qty - v_aqui) > 0 THEN
      INSERT INTO public.order_items (order_id, product_id, quantity, unit_price)
      VALUES (v_order_id, v_item.pid, v_item.qty - v_aqui, v_preco_base);
      v_total := v_total + ((v_item.qty - v_aqui) * v_preco_base);
    END IF;
  END LOOP;

  UPDATE public.orders SET total_amount = v_total WHERE id = v_order_id;

  RETURN public.order_receipt(v_order_id);
END;
$create_pending_order$;


-- ------------------------------------------------------------
-- 4.10 confirm_order repassa a filial do vendedor
-- ------------------------------------------------------------
-- Mesma assinatura ⇒ CREATE OR REPLACE. `create_sale` derivaria a filial
-- sozinha a partir do vendedor; passar explícito aqui faz as duas contas se
-- conferirem — se um dia divergirem, o erro aparece na hora em vez de a
-- venda cair na cidade errada em silêncio.
CREATE OR REPLACE FUNCTION public.confirm_order(
  p_order_id uuid,
  p_payment_method text DEFAULT 'pendente',
  p_notes text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $confirm_order$
DECLARE
  v_order public.orders;
  v_item record;
  v_sale public.sales;
  v_is_admin boolean := public.has_role(auth.uid(), 'admin');
  v_my_seller_id uuid := public.get_my_seller_id();
  v_branch_id uuid;
  v_paid boolean;
  v_note text;
  v_sale_notes text;
BEGIN
  IF p_payment_method IS NULL OR p_payment_method NOT IN (
    'pix', 'dinheiro',
    'pix_pendente', 'dinheiro_pendente', 'dinheiro_com_vendedor', 'pendente'
  ) THEN
    RAISE EXCEPTION 'forma_pagamento_invalida';
  END IF;

  v_paid := p_payment_method IN ('pix', 'dinheiro');

  v_note := nullif(btrim(left(btrim(coalesce(p_notes, '')), 80)), '');
  v_sale_notes := CASE
    WHEN v_note IS NULL THEN 'Pedido via catálogo #' || p_order_id
    ELSE v_note || ' · Pedido via catálogo #' || p_order_id
  END;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pedido_nao_encontrado';
  END IF;

  IF NOT v_is_admin AND v_order.seller_id <> v_my_seller_id THEN
    RAISE EXCEPTION 'nao_autorizado';
  END IF;

  SELECT s.branch_id INTO v_branch_id FROM public.sellers s WHERE s.id = v_order.seller_id;
  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'vendedor_sem_filial';
  END IF;

  IF v_order.status <> 'pendente' THEN
    RAISE EXCEPTION 'pedido_ja_processado';
  END IF;

  IF v_order.created_at < now() - public.order_reservation_ttl() THEN
    RAISE EXCEPTION 'pedido_expirado';
  END IF;

  FOR v_item IN SELECT * FROM public.order_items WHERE order_id = p_order_id
  LOOP
    SELECT * INTO v_sale FROM public.create_sale(
      p_product_id := v_item.product_id,
      p_quantity := v_item.quantity,
      p_unit_price := v_item.unit_price,
      p_date := now(),
      p_notes := v_sale_notes,
      p_installments := 1,
      p_paid_amount := CASE WHEN v_paid THEN v_item.quantity * v_item.unit_price ELSE 0 END,
      p_type := 'venda',
      p_seller_id := v_order.seller_id,
      p_payment_method := p_payment_method,
      p_branch_id := v_branch_id
    );

    UPDATE public.order_items SET sale_id = v_sale.id WHERE id = v_item.id;
  END LOOP;

  UPDATE public.orders SET status = 'confirmada', confirmed_at = now() WHERE id = p_order_id;
END;
$confirm_order$;


-- ============================================================
-- 5. products perde o que virou da cidade
-- ============================================================
-- Só identidade fica: id, name, brand, model, flavor, image_url, created_at.
ALTER TABLE public.products
  DROP COLUMN IF EXISTS stock,
  DROP COLUMN IF EXISTS sale_price,
  DROP COLUMN IF EXISTS purchase_price,
  DROP COLUMN IF EXISTS min_stock;

COMMENT ON TABLE public.products IS
  'Catálogo COMPARTILHADO pela rede: uma linha por sabor, só identidade. Preço, custo, estoque e mínimo moram em product_branch.';


-- ============================================================
-- 6. O GRANT por coluna encolhe junto
-- ============================================================
-- Coluna que sai da lista derruba a consulta INTEIRA quando pedida, não só
-- a coluna (lição da 20260901091725, quando image_url ficou de fora e a tela
-- de Produtos apareceu vazia com os dados intactos no banco). Refazer a
-- lista aqui é o que evita o espelho disso ao contrário: um GRANT sobrando
-- em coluna que não existe mais faz o próprio GRANT falhar.
REVOKE SELECT ON public.products FROM authenticated;
GRANT SELECT (id, name, brand, model, flavor, image_url, created_at)
  ON public.products TO authenticated;


-- ============================================================
-- 7. RLS: o corte é no BANCO, não na tela
-- ============================================================
-- Duas formas, e só duas:
--   * tabela com `branch_id` PRÓPRIO  → has_role admin AND branch_id IN (my_branch_ids)
--   * tabela de VENDEDOR              → has_role admin AND EXISTS contra sellers
--
-- As policies de vendedor (`seller_id = get_my_seller_id()`) ficam como
-- estão: já isolam por pessoa, e pessoa tem uma filial.
--
-- Isto é o que faz a separação ser real. Com o filtro só na UI, um
-- `supabase.from("sales").select("*")` no console do sócio devolveria a
-- cidade inteira do outro.

-- ---- 7.1 Tabelas com branch_id próprio ----
DO $rls_branch$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('sales',         'Admins manage all sales'),
      ('stock_entries', 'Admins manage stock_entries'),
      ('stock_losses',  'Admins manage stock_losses'),
      ('expenses',      'Admins manage expenses'),
      ('sellers',       'Admins manage sellers')
    ) AS v(tbl, pol)
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.pol, r.tbl);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated '
      'USING (public.has_role(auth.uid(), ''admin'') AND branch_id IN (SELECT public.my_branch_ids())) '
      'WITH CHECK (public.has_role(auth.uid(), ''admin'') AND branch_id IN (SELECT public.my_branch_ids()))',
      r.pol, r.tbl
    );
  END LOOP;
END $rls_branch$;

-- ---- 7.2 Tabelas de vendedor: a filial vem dele ----
DO $rls_seller$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('product_assignments',  'Admins manage product_assignments'),
      -- Sem underscore mesmo: é o nome como ela nasceu na 20260615124525.
      -- Errar o nome aqui não daria erro nenhum — a policy velha continuaria
      -- de pé ao lado da nova, e policies se SOMAM. O bloco de conferência
      -- no fim de 7 existe exatamente para isso não passar batido.
      ('commission_payments',  'Admins manage commission payments'),
      ('seller_debt_payments', 'Admins manage seller_debt_payments'),
      ('seller_manual_debts',  'Admins manage seller_manual_debts'),
      ('orders',               'Admins manage orders')
    ) AS v(tbl, pol)
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.pol, r.tbl);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated '
      'USING (public.has_role(auth.uid(), ''admin'') AND EXISTS ('
      '  SELECT 1 FROM public.sellers s WHERE s.id = %I.seller_id '
      '   AND s.branch_id IN (SELECT public.my_branch_ids()))) '
      'WITH CHECK (public.has_role(auth.uid(), ''admin'') AND EXISTS ('
      '  SELECT 1 FROM public.sellers s WHERE s.id = %I.seller_id '
      '   AND s.branch_id IN (SELECT public.my_branch_ids())))',
      r.pol, r.tbl, r.tbl, r.tbl
    );
  END LOOP;
END $rls_seller$;

-- `order_items` não tem seller_id: a filial vem do pedido, que vem do
-- vendedor. Mesmo EXISTS, um salto a mais.
DROP POLICY IF EXISTS "Admins manage order_items" ON public.order_items;
CREATE POLICY "Admins manage order_items" ON public.order_items FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') AND EXISTS (
    SELECT 1 FROM public.orders o
      JOIN public.sellers s ON s.id = o.seller_id
     WHERE o.id = order_items.order_id
       AND s.branch_id IN (SELECT public.my_branch_ids())
  ))
  WITH CHECK (public.has_role(auth.uid(), 'admin') AND EXISTS (
    SELECT 1 FROM public.orders o
      JOIN public.sellers s ON s.id = o.seller_id
     WHERE o.id = order_items.order_id
       AND s.branch_id IN (SELECT public.my_branch_ids())
  ));

-- `customers` fica GLOBAL de propósito: a fidelidade é da rede, e o mesmo
-- WhatsApp comprando nas duas cidades é UMA pessoa. Cortar o cliente por
-- filial quebraria o cartão do checkout.
--
-- `products` também fica global: o catálogo é compartilhado, e é
-- `product_branch` que diz o que cada cidade vende e por quanto.

-- ---- 7.3 product_branch ----
DROP POLICY IF EXISTS "Admins manage product_branch" ON public.product_branch;
CREATE POLICY "Admins manage product_branch" ON public.product_branch FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') AND branch_id IN (SELECT public.my_branch_ids()))
  WITH CHECK (public.has_role(auth.uid(), 'admin') AND branch_id IN (SELECT public.my_branch_ids()));

-- O vendedor precisa ler: é daqui que sai o preço na tela dele, e é esta
-- policy que faz o realtime entregar a linha quando o estoque muda.
DROP POLICY IF EXISTS "Authenticated read product_branch" ON public.product_branch;
CREATE POLICY "Authenticated read product_branch" ON public.product_branch FOR SELECT TO authenticated
  USING (branch_id IN (SELECT public.my_branch_ids()));


-- ---- 7.4 Conferência: sobrou alguma porta sem filtro de filial? ----
-- Policies NÃO se sobrepõem, elas se SOMAM: uma policy antiga de FOR ALL com
-- `USING (has_role(...))` deixada para trás continuaria liberando a rede
-- inteira, e as novas não impediriam nada — sem erro, sem aviso, sem nada na
-- tela. O único jeito de isso não passar batido é a própria migration
-- recusar-se a terminar.
--
-- O critério é simples e não depende de eu ter acertado nome nenhum: em
-- tabela cortada por filial, toda policy de FOR ALL tem que mencionar
-- `my_branch_ids`. As de vendedor são FOR SELECT/INSERT/UPDATE/DELETE e não
-- entram aqui — elas isolam por pessoa, e pessoa tem uma cidade.
DO $confere_rls$
DECLARE
  r      record;
  v_sobrou text := '';
BEGIN
  FOR r IN
    SELECT p.tablename, p.policyname
      FROM pg_policies p
     WHERE p.schemaname = 'public'
       AND p.tablename IN (
         'sales', 'stock_entries', 'stock_losses', 'expenses', 'sellers',
         'product_assignments', 'commission_payments', 'seller_debt_payments',
         'seller_manual_debts', 'orders', 'order_items', 'product_branch'
       )
       AND p.cmd = 'ALL'
       AND COALESCE(p.qual, '') NOT LIKE '%my_branch_ids%'
     ORDER BY p.tablename, p.policyname
  LOOP
    v_sobrou := v_sobrou || format(E'\n  - %s: "%s"', r.tablename, r.policyname);
  END LOOP;

  IF v_sobrou <> '' THEN
    RAISE EXCEPTION
      'RLS incompleta — policy FOR ALL sem filtro de filial:%', v_sobrou;
  END IF;
END $confere_rls$;


-- ============================================================
-- 8. A tabela nova entra na auditoria
-- ============================================================
-- Depois do backfill de propósito: pendurado antes, o carimbo inicial viraria
-- uma linha de log por produto, e o primeiro dia da auditoria por filial
-- começaria com um ruído que ninguém pediu.
DROP TRIGGER IF EXISTS audit_product_branch ON public.product_branch;
CREATE TRIGGER audit_product_branch
  AFTER INSERT OR UPDATE OR DELETE ON public.product_branch
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
