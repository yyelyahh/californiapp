-- ============================================================
-- Confirmar pedido aceita uma observação curta
-- ------------------------------------------------------------
-- A forma de pagamento tem vocabulário fechado (pix, dinheiro,
-- os quatro pendentes) e é o que o ERP usa para contar dinheiro.
-- Mas o acerto real que o vendedor combinou no WhatsApp não cabe
-- nesse vocabulário: "dia 20", "fiado", "pagou metade". Hoje isso
-- vive só na cabeça dele, e quando a cobrança volta duas semanas
-- depois ninguém sabe o que tinha sido combinado.
--
-- A observação NÃO substitui a forma de pagamento nem mexe no
-- valor: ela é texto livre, gravado em sales.notes junto com a
-- referência do pedido. Continua sendo o método escolhido que
-- deriva o valor pago — a regra de dinheiro não passa por aqui.
--
-- Ordem dentro de sales.notes: a observação vem PRIMEIRO. A
-- listagem de vendas da SalesPage corta a coluna em 140px, então
-- o prefixo "Pedido via catálogo #<uuid>" comeria a tela inteira
-- e esconderia justamente o que o vendedor escreveu. A referência
-- do pedido continua ali, no fim, para quem abrir o tooltip.
--
-- Limite de 80 caracteres no banco: "observação curta" é a
-- promessa da tela, e sem o corte aqui um paste acidental entra
-- inteiro em toda linha de venda do pedido.
--
-- A lista de parâmetros muda, então o DROP é obrigatório: sem ele
-- ficariam duas confirm_order coexistindo e a de 2 argumentos
-- continuaria sendo escolhida nas chamadas antigas, gravando a
-- venda sem observação nenhuma e sem erro nenhum.
-- ============================================================

DROP FUNCTION IF EXISTS public.confirm_order(uuid, text);

CREATE OR REPLACE FUNCTION public.confirm_order(
  p_order_id uuid,
  p_payment_method text DEFAULT 'pendente',
  p_notes text DEFAULT NULL
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
  v_note text;
  v_sale_notes text;
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

  -- Espaço em branco não é observação: vira NULL e some da nota.
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
      p_notes := v_sale_notes,
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

GRANT EXECUTE ON FUNCTION public.confirm_order(uuid, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.confirm_order(uuid, text, text) FROM PUBLIC, anon;
