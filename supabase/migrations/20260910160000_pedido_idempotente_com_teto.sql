-- ============================================================
-- O pedido do catálogo: sem duplicata, com teto, e já com desconto
-- ------------------------------------------------------------
-- create_pending_order é a única porta de escrita aberta a anon no
-- projeto inteiro. Ela sai daqui com quatro coisas que não tinha:
--
-- 1) IDEMPOTÊNCIA. Não havia nada impedindo o MESMO pedido de ser criado
--    duas vezes. O caso real não é o toque duplo — é o timeout: o celular
--    perde o sinal no meio, a loja mostra "tente de novo", a pessoa tenta,
--    e o primeiro pedido tinha sido gravado. Dois cards iguais na tela do
--    vendedor, cada um segurando estoque por 24h, e ninguém sabe qual é o
--    certo. Agora o cliente manda um token junto; o mesmo token devolve o
--    mesmo pedido, sem criar nada.
--
-- 2) ITEM REPETIDO NÃO FURA MAIS O ESTOQUE. A validação conferia cada
--    elemento do array isoladamente: com 5 unidades livres, o payload
--    [{p,5},{p,5}] passava duas vezes e reservava 10. O front nunca faz
--    isso — mas o front não é a guarda de uma function GRANT ... TO anon.
--    Os itens passam a ser somados por produto ANTES de qualquer conta.
--
-- 3) TETO EM TUDO. Nome, observação de entrega, quantidade por item,
--    número de itens e pedidos pendentes por telefone. Nada disso tinha
--    limite, e a combinação de endpoint aberto + reserva de 24h é o que
--    permite zerar um catálogo com um script. Isto não substitui um rate
--    limit de verdade; limita o estrago de cada requisição enquanto ele
--    não existe.
--
-- 4) O DESCONTO DA SEXTA UNIDADE (ver 20260910150000). A cada 6 unidades
--    acumuladas pelo cliente, uma sai premiada. Ela vira uma LINHA PRÓPRIA
--    em order_items, com o preço já descontado — order_items não tem
--    unique em (order_id, product_id), então o mesmo produto pode aparecer
--    duas vezes, 5 no preço cheio e 1 no premiado. É o formato que o resto
--    do sistema já entende: confirm_order percorre item a item e repassa
--    unit_price para create_sale, então a venda nasce com o valor certo e
--    a comissão e o lucro saem sozinhos.
--
-- E o retorno deixa de ser só o uuid: a loja precisa do TOTAL que o banco
-- gravou para escrever a mensagem do WhatsApp e o comprovante. Enquanto
-- ela montava os dois a partir do carrinho, um preço mudado entre abrir a
-- página e confirmar fazia o cliente mandar um valor e o vendedor cobrar
-- outro.
-- ============================================================

-- ------------------------------------------------------------
-- 1. A chave do reenvio
-- ------------------------------------------------------------
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS client_token uuid;

-- Parcial: pedido antigo (e venda manual, que não passa por aqui) fica com
-- NULL, e NULL não conflita com NULL num índice único de qualquer jeito —
-- o WHERE só deixa isso explícito e o índice menor.
CREATE UNIQUE INDEX IF NOT EXISTS orders_client_token_key
  ON public.orders (client_token) WHERE client_token IS NOT NULL;

-- ------------------------------------------------------------
-- 2. O comprovante, montado do que ficou gravado
-- ------------------------------------------------------------
-- Uma função só para os dois caminhos de saída (pedido novo e reenvio do
-- mesmo token) devolverem exatamente o mesmo formato. O desconto não
-- precisa de coluna: ele É a diferença entre o preço cheio do produto e o
-- unit_price que ficou na linha.
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
    'discount_total', COALESCE(SUM((p.sale_price - oi.unit_price) * oi.quantity)
                        FILTER (WHERE oi.unit_price < p.sale_price), 0),
    'discount_units', COALESCE(SUM(oi.quantity)
                        FILTER (WHERE oi.unit_price < p.sale_price), 0)
  )
  FROM public.orders o
  JOIN public.order_items oi ON oi.order_id = o.id
  JOIN public.products p     ON p.id = oi.product_id
  WHERE o.id = p_order_id
  GROUP BY o.id, o.total_amount;
$order_receipt$;

REVOKE EXECUTE ON FUNCTION public.order_receipt(uuid) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 3. O pedido
-- ------------------------------------------------------------
-- Lista de parâmetros diferente E retorno diferente: o DROP é obrigatório
-- nos dois motivos. Sem ele ficariam duas versões coexistindo e a antiga
-- continuaria sendo chamada.
DROP FUNCTION IF EXISTS public.create_pending_order(uuid, text, text, text, jsonb);

CREATE FUNCTION public.create_pending_order(
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
  v_preco_cheio   numeric;
  v_preco_premio  numeric;
BEGIN
  -- ---- 0) Reenvio do mesmo pedido devolve o mesmo pedido ----
  IF p_client_token IS NOT NULL THEN
    SELECT id INTO v_order_id FROM public.orders WHERE client_token = p_client_token;
    IF v_order_id IS NOT NULL THEN
      RETURN public.order_receipt(v_order_id);
    END IF;
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
  -- O único freio que existe hoje contra pedido falso em massa. Conta só
  -- o que ainda está de pé: pendente e dentro do prazo da reserva.
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

  -- Tira da frente os pendentes vencidos antes de contar reserva. Não é
  -- o que garante o estoque livre (o filtro de idade abaixo garante) —
  -- serve para o pedido sumir da lista do vendedor.
  PERFORM public.expire_stale_orders();

  -- ---- 3) Valida e trava cada item ANTES de reservar qualquer coisa ----
  -- jsonb_to_recordset + GROUP BY: item repetido no payload vira UMA
  -- linha somada, então a checagem de estoque enxerga o total pedido.
  -- ORDER BY product_id dá ordem estável de travamento — dois pedidos
  -- simultâneos com os mesmos produtos pegam os locks na mesma sequência
  -- e não se enroscam.
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
  INSERT INTO public.customers (name, whatsapp)
  VALUES (v_name, v_whatsapp)
  ON CONFLICT (whatsapp) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO v_customer_id;

  BEGIN
    INSERT INTO public.orders (customer_id, seller_id, freight_notes, status, client_token)
    VALUES (v_customer_id, p_seller_id, v_freight, 'pendente', p_client_token)
    RETURNING id INTO v_order_id;
  EXCEPTION WHEN unique_violation THEN
    -- Dois envios do mesmo token quase juntos: o outro chegou primeiro e
    -- já commitou. O pedido dele é o pedido.
    --
    -- Só o token explica um conflito aqui. Qualquer outro sobe: engolir uma
    -- violação que não é esta devolveria um recibo vazio em vez de um erro.
    IF p_client_token IS NULL THEN
      RAISE;
    END IF;
    SELECT id INTO v_order_id FROM public.orders WHERE client_token = p_client_token;
    RETURN public.order_receipt(v_order_id);
  END;

  -- ---- 5) Quantas unidades saem premiadas ----
  -- As unidades deste pedido ocupam as posições v_historico+1 até
  -- v_historico+v_unidades na vida do cliente. Ganha desconto toda posição
  -- múltipla do ciclo — a conta abaixo é "quantos múltiplos cabem no
  -- trecho", sem precisar percorrer unidade por unidade.
  v_historico := public.customer_units(v_whatsapp);
  v_premiadas := ((v_historico + v_unidades) / public.loyalty_cycle())
               - (v_historico / public.loyalty_cycle());
  v_restam := v_premiadas;

  -- ---- 6) Itens, com o desconto caindo nas unidades mais baratas ----
  -- ORDER BY sale_price: o desconto vale para a unidade mais barata do
  -- pedido. É a leitura que protege a margem e é a mesma ordem que o front
  -- usa para prever o total (p.id desempata para os dois lados chegarem
  -- na mesma resposta quando dois produtos custam igual).
  --
  -- O JOIN com products não perde item: produto inexistente não teria
  -- product_assignments, e o passo 3 já teria levantado estoque_insuficiente.
  FOR v_item IN
    SELECT x.product_id AS pid,
           SUM(x.quantity)::integer AS qty,
           p.sale_price,
           p.purchase_price
    FROM jsonb_to_recordset(p_items) AS x(product_id uuid, quantity integer)
    JOIN public.products p ON p.id = x.product_id
    GROUP BY x.product_id, p.id, p.sale_price, p.purchase_price
    ORDER BY p.sale_price, p.id
  LOOP
    v_preco_cheio := v_item.sale_price;
    v_aqui := 0;

    IF v_restam > 0 THEN
      v_preco_premio := public.loyalty_unit_price(v_item.sale_price, v_item.purchase_price);
      -- Desconto que não desconta não vira linha e NÃO é consumido: em
      -- produto de margem curta o piso encosta no preço cheio, e gastar o
      -- prêmio ali entregaria nada. Ele passa para o próximo item.
      IF v_preco_premio < v_preco_cheio THEN
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
      VALUES (v_order_id, v_item.pid, v_item.qty - v_aqui, v_preco_cheio);
      v_total := v_total + ((v_item.qty - v_aqui) * v_preco_cheio);
    END IF;
  END LOOP;

  UPDATE public.orders SET total_amount = v_total WHERE id = v_order_id;

  RETURN public.order_receipt(v_order_id);
END;
$create_pending_order$;

-- O DROP levou o GRANT junto.
GRANT EXECUTE ON FUNCTION public.create_pending_order(uuid, text, text, text, jsonb, uuid)
  TO anon, authenticated;
