CREATE OR REPLACE FUNCTION public.create_sale(p_product_id uuid, p_quantity integer, p_unit_price numeric, p_date timestamp with time zone, p_notes text DEFAULT NULL::text, p_installments integer DEFAULT 1, p_paid_amount numeric DEFAULT 0, p_type text DEFAULT 'venda'::text, p_seller_id uuid DEFAULT NULL::uuid, p_payment_method text DEFAULT NULL::text)
 RETURNS sales
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  IF NOT v_is_admin THEN
    IF p_seller_id IS NULL OR p_seller_id <> v_my_seller_id THEN
      RAISE EXCEPTION 'nao_autorizado';
    END IF;
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'quantidade_invalida';
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

  PERFORM public.decrement_product_stock(p_product_id, p_quantity);

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
$function$;