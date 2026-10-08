CREATE OR REPLACE FUNCTION public.edit_pending_purchase_order(p_order_id uuid, p_date date, p_notes text, p_freight_cost numeric, p_items jsonb, p_expected_updated_at timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $edit_purchase$
DECLARE
  v_order public.purchase_orders%ROWTYPE;
  v_item jsonb;
  v_paid numeric := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'sem_permissao';
  END IF;
  SELECT * INTO v_order FROM public.purchase_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'compra_nao_encontrada'; END IF;
  IF v_order.status <> 'pending' THEN RAISE EXCEPTION 'compra_ja_recebida'; END IF;
  IF p_expected_updated_at IS NULL OR v_order.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'compra_alterada';
  END IF;
  IF p_date IS NULL OR p_freight_cost IS NULL OR p_freight_cost < 0 OR p_freight_cost::text IN ('NaN', 'Infinity', '-Infinity') THEN
    RAISE EXCEPTION 'compra_invalida';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN RAISE EXCEPTION 'itens_invalidos'; END IF;
  IF jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'itens_invalidos'; END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    IF coalesce(btrim(v_item->>'brand'), '') = '' OR coalesce(btrim(v_item->>'model'), '') = ''
       OR coalesce(v_item->>'expected_quantity', '') !~ '^[0-9]+$'
       OR (v_item->>'expected_quantity')::numeric <= 0
       OR (v_item->>'expected_quantity')::numeric > 2147483647
       OR coalesce(v_item->>'unit_price', '') !~ '^[0-9]+(\.[0-9]+)?$' THEN
      RAISE EXCEPTION 'itens_invalidos';
    END IF;
    v_paid := v_paid + (v_item->>'unit_price')::numeric * (v_item->>'expected_quantity')::integer;
  END LOOP;
  DELETE FROM public.purchase_order_items WHERE purchase_order_id = p_order_id;
  INSERT INTO public.purchase_order_items (purchase_order_id, brand, model, expected_quantity, unit_price, received_flavors)
    SELECT p_order_id, btrim(value->>'brand'), btrim(value->>'model'), (value->>'expected_quantity')::integer,
           (value->>'unit_price')::numeric, '[]'::jsonb FROM jsonb_array_elements(p_items);
  UPDATE public.purchase_orders SET date = p_date, notes = nullif(btrim(p_notes), ''), freight_cost = p_freight_cost, paid_amount = v_paid
    WHERE id = p_order_id RETURNING * INTO v_order;
  RETURN to_jsonb(v_order) || jsonb_build_object('purchase_order_items',
    (SELECT jsonb_agg(to_jsonb(i) ORDER BY i.created_at, i.id) FROM public.purchase_order_items i WHERE i.purchase_order_id = p_order_id));
END;
$edit_purchase$;
REVOKE ALL ON FUNCTION public.edit_pending_purchase_order(uuid, date, text, numeric, jsonb, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.edit_pending_purchase_order(uuid, date, text, numeric, jsonb, timestamptz) TO authenticated, service_role;