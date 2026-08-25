-- ============================================================
-- Estoque atômico + criação de venda em transação única
-- ------------------------------------------------------------
-- Problema que isso resolve: o addSale() do StoreContext.tsx faz
-- SELECT stock -> valida no JS -> INSERT sales -> UPDATE stock
-- em 4 chamadas separadas ao Supabase. Entre o SELECT e o UPDATE,
-- outra venda concorrente pode ler o mesmo stock "antigo" e vender
-- a mesma unidade duas vezes (TOCTOU / race condition).
--
-- A partir daqui, tudo isso acontece dentro de uma única function
-- Postgres (portanto uma única transação atômica): o banco garante
-- que duas vendas concorrentes do último item nunca vão passar as
-- duas. Isso também é a base que o carrinho/reserva do e-commerce
-- vai reusar depois.
-- ============================================================

-- ----------------------------------------------------------
-- 1) Helpers atômicos de estoque (reutilizáveis por qualquer
--    fluxo: venda, perda, restauração, e depois carrinho/checkout)
-- ----------------------------------------------------------

CREATE OR REPLACE FUNCTION public.decrement_product_stock(
  p_product_id uuid,
  p_quantity integer
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_stock integer;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'quantidade_invalida';
  END IF;

  -- UPDATE condicional: só aplica se ainda houver estoque suficiente
  -- no momento exato da escrita (não no momento da leitura anterior).
  -- É isso que elimina a janela de corrida.
  UPDATE public.products
  SET stock = stock - p_quantity
  WHERE id = p_product_id
    AND stock >= p_quantity
  RETURNING stock INTO v_new_stock;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'estoque_insuficiente';
  END IF;

  RETURN v_new_stock;
END;
$$;

REVOKE ALL ON FUNCTION public.decrement_product_stock(uuid, integer) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.increment_product_stock(
  p_product_id uuid,
  p_quantity integer
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_stock integer;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'quantidade_invalida';
  END IF;

  UPDATE public.products
  SET stock = stock + p_quantity
  WHERE id = p_product_id
  RETURNING stock INTO v_new_stock;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'produto_nao_encontrado';
  END IF;

  RETURN v_new_stock;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_product_stock(uuid, integer) FROM PUBLIC, anon;

-- ----------------------------------------------------------
-- 2) create_sale: substitui os passos 3+4 do addSale (insert em
--    sales + baixa de estoque) por UMA chamada atômica.
--    A autorização replica exatamente as policies de RLS que já
--    existem em `sales` (admin faz tudo; seller só vende o que é
--    seu e só o que tem atribuído).
-- ----------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_sale(
  p_product_id uuid,
  p_quantity integer,
  p_unit_price numeric,
  p_date timestamptz,
  p_notes text DEFAULT NULL,
  p_installments integer DEFAULT 1,
  p_paid_amount numeric DEFAULT 0,
  p_type text DEFAULT 'venda',
  p_seller_id uuid DEFAULT NULL,
  p_payment_method text DEFAULT NULL
) RETURNS public.sales
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin boolean := public.has_role(auth.uid(), 'admin');
  v_my_seller_id uuid := public.get_my_seller_id();
  v_total_price numeric;
  v_paid_now boolean;
  v_paid_at timestamptz;
  v_new_sale public.sales;
  v_remaining integer;
  v_assignment record;
  v_available integer;
BEGIN

  -- ---- Autorização (mesma regra das policies "Sellers insert own sales") ----
  IF NOT v_is_admin THEN
    IF p_seller_id IS NULL OR p_seller_id <> v_my_seller_id THEN
      RAISE EXCEPTION 'nao_autorizado';
    END IF;
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'quantidade_invalida';
  END IF;

  -- ---- Se a venda é de um seller, trava e valida a atribuição dele ANTES de tudo ----
  IF p_seller_id IS NOT NULL THEN
    SELECT COALESCE(SUM(quantity), 0) INTO v_available
    FROM public.product_assignments
    WHERE seller_id = p_seller_id AND product_id = p_product_id
    FOR UPDATE;

    IF v_available < p_quantity THEN
      RAISE EXCEPTION 'estoque_vendedor_insuficiente';
    END IF;
  END IF;

  v_total_price := p_quantity * p_unit_price;
  v_paid_now := (p_type = 'venda') AND (COALESCE(p_paid_amount, 0) >= v_total_price - 0.01);
  v_paid_at := CASE WHEN v_paid_now THEN now() ELSE NULL END;

  -- ---- Debita o estoque global de forma atômica (aqui é onde o race condition era possível) ----
  PERFORM public.decrement_product_stock(p_product_id, p_quantity);

  -- ---- Insere a venda (o trigger validate_sale_integrity continua rodando normalmente) ----
  INSERT INTO public.sales (
    product_id, quantity, unit_price, total_price, date, notes,
    installments, paid_amount, paid_at, type, seller_id, payment_method
  ) VALUES (
    p_product_id, p_quantity, p_unit_price, v_total_price, p_date, p_notes,
    p_installments,
    CASE WHEN p_type = 'retirada_funcionario' THEN 0 ELSE COALESCE(p_paid_amount, 0) END,
    v_paid_at, p_type, p_seller_id,
    CASE WHEN p_type = 'venda' THEN p_payment_method ELSE NULL END
  ) RETURNING * INTO v_new_sale;

  -- ---- Baixa a atribuição do vendedor (FIFO), mesma lógica que hoje está no client ----
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
$$;

GRANT EXECUTE ON FUNCTION public.create_sale(
  uuid, integer, numeric, timestamptz, text, integer, numeric, text, uuid, text
) TO authenticated;

REVOKE ALL ON FUNCTION public.create_sale(
  uuid, integer, numeric, timestamptz, text, integer, numeric, text, uuid, text
) FROM PUBLIC, anon;

-- ----------------------------------------------------------
-- 3) delete_sale: espelha o deleteSale do client (restaura estoque
--    + reatribui vendedor), também atômico.
-- ----------------------------------------------------------

CREATE OR REPLACE FUNCTION public.delete_sale(p_sale_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  DELETE FROM public.sales WHERE id = p_sale_id;
  PERFORM public.increment_product_stock(v_sale.product_id, v_sale.quantity);

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
$$;

GRANT EXECUTE ON FUNCTION public.delete_sale(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.delete_sale(uuid) FROM PUBLIC, anon;