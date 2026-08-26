-- ============================================================

-- Corrige create_pending_order: FOR UPDATE não pode ser usado

-- junto com função de agregação (SUM) na mesma consulta — mesmo

-- problema que foi corrigido em create_sale no commit anterior.

-- ============================================================

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

BEGIN

  IF p_customer_name IS NULL OR trim(p_customer_name) = '' THEN

    RAISE EXCEPTION 'nome_invalido';

  END IF;

  IF p_customer_whatsapp IS NULL OR trim(p_customer_whatsapp) = '' THEN

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

    -- CORREÇÃO: trava as linhas numa subconsulta, soma por fora dela.

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

  VALUES (trim(p_customer_name), trim(p_customer_whatsapp))

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