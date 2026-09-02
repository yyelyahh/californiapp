-- ============================================================
-- Normaliza telefone/WhatsApp em toda a busca e no armazenamento,
-- pra "(11) 99999-8888", "11999998888" e "11 99999-8888" serem
-- tratados como o MESMO número — senão a fidelidade quebra por
-- causa de formatação diferente entre a compra atual e a anterior.
-- ============================================================

-- 1) Padroniza os números já salvos (mantém só dígitos)
UPDATE public.customers
SET whatsapp = regexp_replace(whatsapp, '\D', '', 'g')
WHERE whatsapp != regexp_replace(whatsapp, '\D', '', 'g');

-- 2) get_customer_loyalty passa a normalizar os dois lados da comparação
CREATE OR REPLACE FUNCTION public.get_customer_loyalty(p_whatsapp text)
RETURNS TABLE(
  customer_id uuid,
  customer_name text,
  whatsapp text,
  total_purchases integer,
  purchases_for_next_reward integer,
  next_reward_name text,
  loyalty_tier text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id AS customer_id,
    c.name AS customer_name,
    c.whatsapp,
    COALESCE(COUNT(o.id), 0)::integer AS total_purchases,
    CASE
      WHEN COALESCE(COUNT(o.id), 0) < 5 THEN (5 - COALESCE(COUNT(o.id), 0))::integer
      ELSE 0
    END AS purchases_for_next_reward,
    CASE
      WHEN COALESCE(COUNT(o.id), 0) >= 5 THEN 'Compra de bônus (5º pedido)'
      ELSE 'Desconto na 5ª compra'
    END AS next_reward_name,
    CASE
      WHEN COALESCE(COUNT(o.id), 0) >= 5 THEN 'VIP'
      WHEN COALESCE(COUNT(o.id), 0) >= 3 THEN 'Frequente'
      ELSE 'Novo'
    END AS loyalty_tier
  FROM public.customers c
  LEFT JOIN public.orders o ON o.customer_id = c.id AND o.status = 'confirmada'
  WHERE regexp_replace(c.whatsapp, '\D', '', 'g') = regexp_replace(p_whatsapp, '\D', '', 'g')
    AND regexp_replace(p_whatsapp, '\D', '', 'g') != ''
  GROUP BY c.id, c.name, c.whatsapp;
$$;

GRANT EXECUTE ON FUNCTION public.get_customer_loyalty(text) TO anon, authenticated;

-- 3) create_pending_order passa a salvar o WhatsApp já normalizado
--    (só dígitos), pra toda entrada nova já nascer no formato certo.
CREATE OR REPLACE FUNCTION public.create_pending_order(
  p_seller_id uuid,
  p_customer_name text,
  p_customer_whatsapp text,
  p_freight_notes text,
  p_items jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer_id uuid;
  v_order_id uuid;
  v_item jsonb;
  v_product_id uuid;
  v_quantity integer;
  v_unit_price numeric;
  v_assigned integer;
  v_reserved integer;
  v_total numeric := 0;
  v_whatsapp_digits text;
BEGIN
  IF p_customer_name IS NULL OR trim(p_customer_name) = '' THEN
    RAISE EXCEPTION 'nome_invalido';
  END IF;

  v_whatsapp_digits := regexp_replace(COALESCE(p_customer_whatsapp, ''), '\D', '', 'g');
  IF v_whatsapp_digits = '' THEN
    RAISE EXCEPTION 'whatsapp_invalido';
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'carrinho_vazio';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := (v_item->>'product_id')::uuid;
    v_quantity := (v_item->>'quantity')::integer;
    IF v_quantity IS NULL OR v_quantity <= 0 THEN
      RAISE EXCEPTION 'quantidade_invalida';
    END IF;

    SELECT COALESCE(SUM(l.quantity), 0) INTO v_assigned
    FROM (
      SELECT quantity
      FROM public.product_assignments
      WHERE seller_id = p_seller_id AND product_id = v_product_id
      FOR UPDATE
    ) l;

    SELECT COALESCE(SUM(oi.quantity), 0) INTO v_reserved
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    WHERE o.seller_id = p_seller_id AND oi.product_id = v_product_id AND o.status = 'pendente';

    IF (v_assigned - v_reserved) < v_quantity THEN
      RAISE EXCEPTION 'estoque_insuficiente:%', v_product_id;
    END IF;
  END LOOP;

  INSERT INTO public.customers (name, whatsapp)
  VALUES (trim(p_customer_name), v_whatsapp_digits)
  ON CONFLICT (whatsapp) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO v_customer_id;

  INSERT INTO public.orders (customer_id, seller_id, freight_notes, status)
  VALUES (v_customer_id, p_seller_id, p_freight_notes, 'pendente')
  RETURNING id INTO v_order_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := (v_item->>'product_id')::uuid;
    v_quantity := (v_item->>'quantity')::integer;
    v_unit_price := (v_item->>'unit_price')::numeric;
    v_total := v_total + (v_quantity * v_unit_price);
    INSERT INTO public.order_items (order_id, product_id, quantity, unit_price)
    VALUES (v_order_id, v_product_id, v_quantity, v_unit_price);
  END LOOP;

  UPDATE public.orders SET total_amount = v_total WHERE id = v_order_id;
  RETURN v_order_id;
END;
$$;