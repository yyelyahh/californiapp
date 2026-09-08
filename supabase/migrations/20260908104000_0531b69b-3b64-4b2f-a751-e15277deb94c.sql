-- ============================================================
-- Confirmar pedido passa a perguntar como o dinheiro entrou
-- ------------------------------------------------------------
-- Como estava: confirm_order chamava create_sale com
-- p_paid_amount = total e p_payment_method = 'combinado'. Duas
-- coisas erradas nisso:
--
--   1. Toda venda de catálogo nascia QUITADA, mesmo o pagamento
--      sendo acertado no WhatsApp depois. Cliente que sumiu sem
--      pagar entrava no caixa como venda recebida, e os filtros
--      de "falta receber" da SalesPage nunca o mostravam.
--
--   2. 'combinado' não existe no vocabulário do ERP — o front só
--      reconhece pix, dinheiro, pix_pendente, dinheiro_pendente,
--      dinheiro_com_vendedor e pendente (ver mapSale no
--      StoreContext). Qualquer outro valor vira `undefined`, então
--      a coluna Forma de Pagamento aparecia como "—" para todo
--      pedido vindo do catálogo.
--
-- Agora quem informa é o vendedor, no clique de confirmar — que é
-- o único momento em que alguém realmente sabe se o dinheiro
-- entrou. O valor pago é DERIVADO do método escolhido, e não um
-- campo à parte: é a mesma regra que o formulário de venda manual
-- já usa (método "pago" ⇒ recebido integral; método "pendente" ⇒
-- nada recebido), então as duas portas de entrada de venda não
-- podem divergir.
--
-- A assinatura muda, então o DROP é obrigatório: sem ele ficariam
-- duas confirm_order coexistindo e a de 1 argumento continuaria
-- gravando 'combinado' silenciosamente.
-- ============================================================

DROP FUNCTION IF EXISTS public.confirm_order(uuid);

CREATE OR REPLACE FUNCTION public.confirm_order(
  p_order_id uuid,
  p_payment_method text DEFAULT 'pendente'
) RETURNS void
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
  v_paid boolean;
BEGIN
  -- Mesma lista que o front oferece. Validar aqui evita que um
  -- valor fora do vocabulário entre em sales e vire "—" na tela.
  IF p_payment_method IS NULL OR p_payment_method NOT IN (
    'pix', 'dinheiro',
    'pix_pendente', 'dinheiro_pendente', 'dinheiro_com_vendedor', 'pendente'
  ) THEN
    RAISE EXCEPTION 'forma_pagamento_invalida';
  END IF;

  -- Só os dois primeiros significam dinheiro na mão. 'dinheiro_com_vendedor'
  -- é dinheiro que o CLIENTE pagou mas ainda está com o vendedor: para a
  -- empresa continua a receber, exatamente como o ERP já trata.
  v_paid := p_payment_method IN ('pix', 'dinheiro');

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

  -- Pedido vencido não vira venda por acidente: se ele já passou do
  -- prazo, a reserva dele não existe mais e o estoque pode ter sido
  -- vendido para outra pessoa. Confirmar aqui debitaria estoque que
  -- o catálogo já prometeu a mais alguém.
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
      p_notes := 'Pedido via catálogo #' || p_order_id,
      p_installments := 1,
      p_paid_amount := CASE WHEN v_paid THEN v_item.quantity * v_item.unit_price ELSE 0 END,
      p_type := 'venda',
      p_seller_id := v_order.seller_id,
      p_payment_method := p_payment_method
    );

    UPDATE public.order_items SET sale_id = v_sale.id WHERE id = v_item.id;
  END LOOP;

  UPDATE public.orders SET status = 'confirmada', confirmed_at = now() WHERE id = p_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirm_order(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.confirm_order(uuid, text) FROM PUBLIC, anon;
