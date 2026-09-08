-- ============================================================
-- create_pending_order: preço vem do banco + reserva com prazo
-- ------------------------------------------------------------
-- Duas correções na mesma reescrita, porque são a mesma function e
-- separá-las em duas migrations só faria a segunda copiar o corpo
-- inteiro da primeira de novo.
--
-- (a) PREÇO
-- ------------------------------------------------------------
-- Como estava: create_pending_order gravava em order_items.unit_price
-- exatamente o número que veio no p_items, e confirm_order repassava
-- esse número para create_sale. Como a function é GRANT ... TO anon
-- (o cliente da loja não tem login), qualquer pessoa com o link do
-- vendedor podia montar a chamada na mão com "unit_price": 0.01 e o
-- sistema registraria a venda por um centavo. A única barreira era o
-- vendedor reparar no total antes de confirmar.
--
-- A partir daqui o p_items continua sendo aceito com unit_price — o
-- front ainda manda — mas o valor é IGNORADO: quem define o preço é
-- products.sale_price, lido dentro da transação.
--
-- Efeito colateral aceito conscientemente: se o preço mudar enquanto
-- a loja está aberta na tela do cliente, o comprovante que ele
-- compartilha no WhatsApp mostra o preço antigo e o pedido nasce com
-- o novo. É raro, e o alternativo (recusar o pedido) travava cliente
-- legítimo por causa de uma edição de preço.
--
-- (b) PRAZO DA RESERVA
-- ------------------------------------------------------------
-- A soma do que já está reservado passa a ignorar pedido pendente
-- mais velho que order_reservation_ttl(). É isso que faz o estoque
-- de um pedido abandonado voltar a ser vendável na hora, sem
-- depender da varredura ter rodado. A varredura entra logo no
-- começo, só para tirar esses pedidos da lista do vendedor.
--
-- A assinatura não muda (p_items continua jsonb), então nem
-- DROP FUNCTION nem mudança no front são necessários.
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_pending_order(
  p_seller_id uuid,
  p_customer_name text,
  p_customer_whatsapp text,
  p_freight_notes text,
  p_items jsonb -- [{ "product_id": "...", "quantity": 2 }] — unit_price é ignorado
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

  -- Tira da frente os pendentes vencidos antes de contar reserva. Não é
  -- o que garante o estoque livre (o filtro de idade abaixo garante) —
  -- serve para o pedido sumir da lista do vendedor.
  PERFORM public.expire_stale_orders();

  -- ---- Valida e trava cada item ANTES de reservar qualquer coisa ----
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := (v_item->>'product_id')::uuid;
    v_quantity := (v_item->>'quantity')::integer;
    IF v_quantity IS NULL OR v_quantity <= 0 THEN
      RAISE EXCEPTION 'quantidade_invalida';
    END IF;

    -- FOR UPDATE não convive com agregação na mesma query: trava numa
    -- subconsulta e soma por fora dela.
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
    WHERE o.seller_id = p_seller_id
      AND oi.product_id = v_product_id
      AND o.status = 'pendente'
      AND o.created_at > now() - public.order_reservation_ttl();

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

    -- AQUI está a correção: o preço vem da tabela, não do payload.
    SELECT sale_price INTO v_unit_price
    FROM public.products
    WHERE id = v_product_id;

    IF v_unit_price IS NULL THEN
      RAISE EXCEPTION 'produto_nao_encontrado:%', v_product_id;
    END IF;

    v_total := v_total + (v_quantity * v_unit_price);

    INSERT INTO public.order_items (order_id, product_id, quantity, unit_price)
    VALUES (v_order_id, v_product_id, v_quantity, v_unit_price);
  END LOOP;

  UPDATE public.orders SET total_amount = v_total WHERE id = v_order_id;
  RETURN v_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_pending_order(uuid, text, text, text, jsonb) TO anon, authenticated;
