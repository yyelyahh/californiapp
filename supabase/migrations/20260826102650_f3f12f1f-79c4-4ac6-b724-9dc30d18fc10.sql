-- ============================================================
-- Pedidos pendentes (fluxo WhatsApp) + reserva de estoque
-- ------------------------------------------------------------
-- Fluxo: cliente monta o pedido no catálogo do vendedor -> sistema
-- cria um "pedido pendente" (reserva virtual, sem mexer no estoque
-- físico ainda) -> pedido é compartilhado no WhatsApp do vendedor ->
-- vendedor confirma (debita estoque de verdade, via create_sale) ou
-- recusa (libera a reserva, que era só virtual).
-- ============================================================

-- ----------------------------------------------------------
-- 1) Novas tabelas
-- ----------------------------------------------------------
ALTER TABLE public.sellers ADD COLUMN IF NOT EXISTS whatsapp text;

CREATE TABLE IF NOT EXISTS public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  whatsapp text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id),
  seller_id uuid NOT NULL REFERENCES public.sellers(id),
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'confirmada', 'recusada')),
  freight_notes text,
  total_amount numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id),
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price numeric NOT NULL,
  sale_id uuid REFERENCES public.sales(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orders_seller_status ON public.orders(seller_id, status);
CREATE INDEX IF NOT EXISTS idx_order_items_product ON public.order_items(product_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON public.order_items(order_id);

-- ----------------------------------------------------------
-- 2) RLS — mesma régua do resto do projeto (admin vê tudo,
--    vendedor só o que é dele). Ninguém insere direto: só as
--    functions abaixo, que validam e reservam com segurança.
-- ----------------------------------------------------------
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage customers" ON public.customers FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins manage orders" ON public.orders FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Sellers read own orders" ON public.orders FOR SELECT TO authenticated
  USING (seller_id = public.get_my_seller_id());

CREATE POLICY "Admins manage order_items" ON public.order_items FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Sellers read own order_items" ON public.order_items FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = order_items.order_id AND o.seller_id = public.get_my_seller_id()
  ));

-- ----------------------------------------------------------
-- 3) create_pending_order — chamada pelo cliente (anônimo, sem
--    login) ao finalizar o carrinho no catálogo do vendedor.
--    Reserva (virtualmente) e valida tudo numa transação atômica.
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_pending_order(
  p_seller_id uuid,
  p_customer_name text,
  p_customer_whatsapp text,
  p_freight_notes text,
  p_items jsonb -- [{ "product_id": "...", "quantity": 2, "unit_price": 49.9 }, ...]
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

  -- ---- Valida e trava (FOR UPDATE) cada item ANTES de reservar qualquer coisa ----
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := (v_item->>'product_id')::uuid;
    v_quantity := (v_item->>'quantity')::integer;

    IF v_quantity IS NULL OR v_quantity <= 0 THEN
      RAISE EXCEPTION 'quantidade_invalida';
    END IF;

    SELECT COALESCE(SUM(quantity), 0) INTO v_assigned
    FROM public.product_assignments
    WHERE seller_id = p_seller_id AND product_id = v_product_id
    FOR UPDATE;

    SELECT COALESCE(SUM(oi.quantity), 0) INTO v_reserved
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    WHERE o.seller_id = p_seller_id AND oi.product_id = v_product_id AND o.status = 'pendente';

    IF (v_assigned - v_reserved) < v_quantity THEN
      RAISE EXCEPTION 'estoque_insuficiente:%', v_product_id;
    END IF;
  END LOOP;

  -- ---- Cliente: reaproveita se o whatsapp já existir, senão cria ----
  INSERT INTO public.customers (name, whatsapp)
  VALUES (trim(p_customer_name), trim(p_customer_whatsapp))
  ON CONFLICT (whatsapp) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO v_customer_id;

  -- ---- Cria o pedido ----
  INSERT INTO public.orders (customer_id, seller_id, freight_notes, status)
  VALUES (v_customer_id, p_seller_id, p_freight_notes, 'pendente')
  RETURNING id INTO v_order_id;

  -- ---- Cria os itens (a reserva "acontece" só por existirem aqui com status pendente) ----
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

GRANT EXECUTE ON FUNCTION public.create_pending_order(uuid, text, text, text, jsonb) TO anon, authenticated;

-- ----------------------------------------------------------
-- 4) confirm_order — vendedor (ou admin) confirma. Debita o
--    estoque de verdade via create_sale (já existente) e vincula
--    a venda gerada a cada item do pedido.
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirm_order(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders;
  v_item record;
  v_sale public.sales;
  v_is_admin boolean := public.has_role(auth.uid(), 'admin');
  v_my_seller_id uuid := public.get_my_seller_id();
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pedido_nao_encontrado';
  END IF;

  IF NOT v_is_admin AND v_order.seller_id <> v_my_seller_id THEN
    RAISE EXCEPTION 'nao_autorizado';
  END IF;

  IF v_order.status <> 'pendente' THEN
    RAISE EXCEPTION 'pedido_ja_processado';
  END IF;

  FOR v_item IN SELECT * FROM public.order_items WHERE order_id = p_order_id
  LOOP
    -- create_sale já debita estoque (produto + atribuição do vendedor)
    -- de forma atômica, dentro desta mesma transação.
    SELECT * INTO v_sale FROM public.create_sale(
      p_product_id := v_item.product_id,
      p_quantity := v_item.quantity,
      p_unit_price := v_item.unit_price,
      p_date := now(),
      p_notes := 'Pedido via catálogo #' || p_order_id,
      p_installments := 1,
      p_paid_amount := v_item.quantity * v_item.unit_price, -- combinado/pago fora do sistema
      p_type := 'venda',
      p_seller_id := v_order.seller_id,
      p_payment_method := 'combinado'
    );

    UPDATE public.order_items SET sale_id = v_sale.id WHERE id = v_item.id;
  END LOOP;

  UPDATE public.orders SET status = 'confirmada', confirmed_at = now() WHERE id = p_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirm_order(uuid) TO authenticated;

-- ----------------------------------------------------------
-- 5) decline_order — libera a reserva (que nunca chegou a debitar
--    estoque de verdade, então "liberar" é só mudar o status).
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.decline_order(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders;
  v_is_admin boolean := public.has_role(auth.uid(), 'admin');
  v_my_seller_id uuid := public.get_my_seller_id();
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pedido_nao_encontrado';
  END IF;

  IF NOT v_is_admin AND v_order.seller_id <> v_my_seller_id THEN
    RAISE EXCEPTION 'nao_autorizado';
  END IF;

  IF v_order.status <> 'pendente' THEN
    RAISE EXCEPTION 'pedido_ja_processado';
  END IF;

  UPDATE public.orders SET status = 'recusada' WHERE id = p_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.decline_order(uuid) TO authenticated;

-- ----------------------------------------------------------
-- 6) get_seller_catalog atualizado: "available" agora desconta
--    as reservas de pedidos pendentes, não só o que já foi vendido.
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_seller_catalog(p_seller_id uuid)
RETURNS TABLE(
  seller_name text,
  product_id uuid,
  name text,
  brand text,
  model text,
  flavor text,
  sale_price numeric,
  available integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    s.name AS seller_name,
    p.id AS product_id,
    p.name,
    p.brand,
    COALESCE(p.model, '') AS model,
    p.flavor,
    p.sale_price,
    GREATEST(0, pa.quantity - COALESCE((
      SELECT SUM(oi.quantity)
      FROM public.order_items oi
      JOIN public.orders o ON o.id = oi.order_id
      WHERE o.seller_id = p_seller_id
        AND oi.product_id = p.id
        AND o.status = 'pendente'
    ), 0))::integer AS available
  FROM public.product_assignments pa
  JOIN public.products p ON p.id = pa.product_id
  JOIN public.sellers s ON s.id = pa.seller_id
  WHERE pa.seller_id = p_seller_id
  ORDER BY p.brand, p.flavor;
$$;

GRANT EXECUTE ON FUNCTION public.get_seller_catalog(uuid) TO anon, authenticated;