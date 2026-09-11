-- ============================================================
-- Combo de modelo: 2 ou mais unidades do mesmo modelo, R$ 7 a menos em cada
-- ------------------------------------------------------------
-- O segundo desconto da loja, e o primeiro que NÃO depende de quem está
-- comprando: a fidelidade premia o histórico do cliente, o combo premia o
-- tamanho do pedido. Por isso ele aparece no carrinho antes mesmo de o
-- telefone ser digitado — não há o que consultar.
--
-- A REGRA, em uma frase: somadas as unidades de um MESMO MODELO no pedido
-- (misturando sabores — 1 Menta + 1 Uva do V155 é combo), a partir de 2
-- todas elas saem R$ 7,00 mais baratas.
--
-- Três decisões que a regra carrega:
--
--   * MODELO, não sabor. É como a loja já mostra o catálogo (um card por
--     marca+modelo, sabores dentro) e é como o cliente fala: "leva dois
--     V155". A chave é normalizada igual à do catálogo,
--     lower(btrim(marca)) + modelo, senão "Ignite" e "ignite " seriam dois
--     modelos e ninguém alcançaria o combo.
--   * O MESMO PISO DA FIDELIDADE. O preço do combo nunca fica igual ou
--     abaixo do custo; quando os R$ 7 bateriam ali, o preço vira custo +
--     15%, em reais inteiros. Sem custo cadastrado, o combo não passa da
--     metade do preço — é o mesmo "sem informação não é margem infinita"
--     da loyalty_unit_price.
--   * O DESCONTO NÃO É PROPORCIONAL. R$ 7 pesa muito num produto barato e
--     pouco num caro. Foi escolha do dono: é o número que se fala no
--     WhatsApp. Quem protege o barato é o piso acima, que morde antes de o
--     desconto virar prejuízo.
--
-- E o encontro com a fidelidade: NÃO ACUMULA. A unidade premiada sai pelo
-- MELHOR dos dois preços, nunca pelos dois juntos. Como o prêmio (metade)
-- quase sempre bate o combo (R$ 7), na prática é a metade que vale ali, e
-- as OUTRAS unidades daquele modelo continuam com o combo. Quando o
-- prêmio não é melhor que o preço do combo, ele não é gasto: passa para o
-- próximo item, exatamente como já acontecia com o prêmio que encosta no
-- piso.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Os dois números da regra, num lugar só
-- ------------------------------------------------------------
-- Mesma escolha do loyalty_cycle() e do order_reservation_ttl(): o número
-- mora numa função para que o pedido, o catálogo e o texto da loja leiam o
-- MESMO valor. Trocar o desconto de R$ 7 para R$ 5 é uma linha aqui — e a
-- loja passa a dizer R$ 5 sozinha, porque ela também lê daqui
-- (get_store_rules, no fim do arquivo).
CREATE OR REPLACE FUNCTION public.combo_discount()
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $combo_discount$
  SELECT 7::numeric;
$combo_discount$;

CREATE OR REPLACE FUNCTION public.combo_min_units()
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $combo_min_units$
  SELECT 2;
$combo_min_units$;

-- Preço da unidade em combo. Pura, como a loyalty_unit_price, e com a
-- MESMA forma de piso — as duas contas protegem a margem do mesmo jeito,
-- e qualquer ajuste futuro precisa ser feito nas duas.
--
-- Os centavos do preço cheio são preservados de propósito aqui (R$ 44,90
-- vira R$ 37,90): o combo é uma subtração que a pessoa refaz de cabeça, e
-- arredondar quebraria a conta na frente dela. Quem sai em reais inteiros
-- é o ramo do piso, que é preço novo, não subtração.
CREATE OR REPLACE FUNCTION public.combo_unit_price(
  p_sale_price     numeric,
  p_purchase_price numeric
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $combo_unit_price$
  SELECT LEAST(
    CASE
      -- Sem custo cadastrado não há piso a respeitar, mas também não há o
      -- que proteger: o combo não passa de metade do preço.
      WHEN p_purchase_price IS NULL OR p_purchase_price <= 0
        THEN GREATEST(
               COALESCE(p_sale_price, 0) - public.combo_discount(),
               ceil(COALESCE(p_sale_price, 0) * 0.5)
             )
      -- Os R$ 7 ainda deixam o preço ACIMA do custo: é o desconto cheio.
      WHEN (COALESCE(p_sale_price, 0) - public.combo_discount()) > p_purchase_price
        THEN COALESCE(p_sale_price, 0) - public.combo_discount()
      -- Os R$ 7 encostariam no custo: sobe para custo + 15%.
      ELSE ceil(p_purchase_price * 1.15)
    END,
    COALESCE(p_sale_price, 0)
  );
$combo_unit_price$;

-- Produto de margem curta pode sair daqui com o preço CHEIO (o LEAST
-- morde). Igual ao prêmio que não desconta: quem chama trata isso como
-- "não tem combo neste item", nunca como linha de desconto de R$ 0,00.
REVOKE EXECUTE ON FUNCTION public.combo_unit_price(numeric, numeric) FROM PUBLIC, anon;

-- ------------------------------------------------------------
-- 2. A chave do modelo, escrita uma vez
-- ------------------------------------------------------------
-- A MESMA normalização do catálogo (get_seller_catalog casa a foto assim) e
-- a mesma do front (`modelKey` em src/lib/cart-discount.ts). Produto sem
-- marca E sem modelo vira um modelo só dele: senão todos os "sem modelo" do
-- catálogo virariam um combo entre si, que é o oposto da regra.
CREATE OR REPLACE FUNCTION public.product_model_key(
  p_id    uuid,
  p_brand text,
  p_model text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $product_model_key$
  SELECT CASE
    WHEN btrim(COALESCE(p_brand, '')) = '' AND btrim(COALESCE(p_model, '')) = ''
      THEN 'sem-modelo:' || p_id::text
    ELSE lower(btrim(COALESCE(p_brand, ''))) || '|||' || lower(btrim(COALESCE(p_model, '')))
  END;
$product_model_key$;

-- Não é endereço de ninguém: existe para as functions acima chamarem.
REVOKE EXECUTE ON FUNCTION public.product_model_key(uuid, text, text) FROM PUBLIC, anon;

-- ------------------------------------------------------------
-- 3. As regras que a loja precisa dizer em voz alta
-- ------------------------------------------------------------
-- O card da promoção e o tira-dúvidas falam "2 ou mais" e "R$ 7". Esses
-- números não são digitados no .tsx pelo mesmo motivo que o ciclo 6 não é:
-- o dia em que a promoção mudar, ela tem que mudar no banco e a loja
-- acompanhar. Devolve só constantes — nenhum dado de ninguém.
CREATE OR REPLACE FUNCTION public.get_store_rules()
RETURNS TABLE(
  loyalty_cycle     integer,
  combo_min_units   integer,
  combo_discount    numeric,
  reservation_hours integer
)
LANGUAGE sql
STABLE
AS $get_store_rules$
  SELECT public.loyalty_cycle(),
         public.combo_min_units(),
         public.combo_discount(),
         -- O tira-dúvidas promete "guardado por 24 horas". O prazo mora em
         -- order_reservation_ttl() e é o mesmo que create_pending_order e
         -- get_seller_catalog usam para calcular a reserva: mudar o intervalo
         -- lá muda a frase da loja junto.
         (EXTRACT(epoch FROM public.order_reservation_ttl()) / 3600)::integer;
$get_store_rules$;

GRANT EXECUTE ON FUNCTION public.get_store_rules() TO anon, authenticated;

-- ------------------------------------------------------------
-- 4. O catálogo carrega o preço do combo
-- ------------------------------------------------------------
-- Uma coluna a mais, pelo mesmo motivo do loyalty_price: o carrinho mostra
-- o desconto ANTES de o pedido existir, e a prévia do front precisa do
-- preço final calculado aqui dentro — o custo não sai desta function.
--
-- Formato de retorno diferente ⇒ DROP antes (o gotcha de sempre). O corpo é
-- o da 20260910150000; só a coluna nova entra.
DROP FUNCTION IF EXISTS public.get_seller_catalog(uuid);

CREATE FUNCTION public.get_seller_catalog(p_seller_id uuid)
RETURNS TABLE(
  seller_name   text,
  product_id    uuid,
  name          text,
  brand         text,
  model         text,
  flavor        text,
  sale_price    numeric,
  loyalty_price numeric,
  combo_price   numeric,
  available     integer,
  image_url     text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $get_seller_catalog$
  WITH foto AS (
    SELECT DISTINCT ON (lower(btrim(pmi.brand)), lower(btrim(COALESCE(pmi.model, ''))))
           lower(btrim(pmi.brand))               AS brand_key,
           lower(btrim(COALESCE(pmi.model, ''))) AS model_key,
           NULLIF(btrim(pmi.image_url), '')      AS image_url
      FROM public.product_model_images pmi
     ORDER BY lower(btrim(pmi.brand)),
              lower(btrim(COALESCE(pmi.model, ''))),
              pmi.created_at DESC
  )
  SELECT
    s.name AS seller_name,
    p.id AS product_id,
    p.name,
    p.brand,
    COALESCE(p.model, '') AS model,
    p.flavor,
    p.sale_price,
    public.loyalty_unit_price(p.sale_price, p.purchase_price) AS loyalty_price,
    public.combo_unit_price(p.sale_price, p.purchase_price)   AS combo_price,
    GREATEST(0, pa.assigned - COALESCE((
      SELECT SUM(oi.quantity)
      FROM public.order_items oi
      JOIN public.orders o ON o.id = oi.order_id
      WHERE o.seller_id = p_seller_id
        AND oi.product_id = p.id
        AND o.status = 'pendente'
        AND o.created_at > now() - public.order_reservation_ttl()
    ), 0))::integer AS available,
    COALESCE(foto.image_url, NULLIF(btrim(p.image_url), '')) AS image_url
  FROM (
    SELECT product_id, SUM(quantity) AS assigned
    FROM public.product_assignments
    WHERE seller_id = p_seller_id
    GROUP BY product_id
  ) pa
  JOIN public.products p ON p.id = pa.product_id
  JOIN public.sellers s ON s.id = p_seller_id
  LEFT JOIN foto
    ON foto.brand_key = lower(btrim(p.brand))
   AND foto.model_key = lower(btrim(COALESCE(p.model, '')))
  ORDER BY p.brand, p.flavor;
$get_seller_catalog$;

-- O DROP levou o GRANT junto: sem esta linha a loja quebra na primeira
-- visita anônima.
GRANT EXECUTE ON FUNCTION public.get_seller_catalog(uuid) TO anon, authenticated;

-- ------------------------------------------------------------
-- 5. O pedido aplica o combo antes da fidelidade
-- ------------------------------------------------------------
-- Mesma assinatura e mesmo retorno da 20260910160000 ⇒ CREATE OR REPLACE
-- basta, e o GRANT é preservado. O que muda é só o passo 6: cada produto
-- ganha um PREÇO BASE (cheio ou de combo) antes de a fidelidade escolher
-- onde cai o prêmio.
--
-- Duas consequências de ordem, e as duas importam:
--
--   * A fila do prêmio passa a ser pelo PREÇO BASE, não pelo preço cheio.
--     O prêmio cai na unidade mais barata do pedido, e "mais barata" é o
--     que a pessoa vai pagar — com o combo aplicado. O front ordena igual
--     (`base_price`, depois `product_id`), senão os dois números divergem.
--   * O prêmio só é gasto se for MELHOR que o preço base (é aqui que mora
--     o "não acumula"). Se a metade não bater o combo, a unidade fica com
--     o combo e o prêmio passa adiante, intacto.
--
-- O order_receipt não muda: ele lê o desconto como a diferença entre
-- products.sale_price e o unit_price gravado, então o combo entra no
-- 'discount_total' sozinho, sem coluna nova.
CREATE OR REPLACE FUNCTION public.create_pending_order(
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
  v_preco_base    numeric;
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

  -- ---- 6) Itens: combo no preço base, fidelidade na unidade mais barata ----
  -- A janela SUM(qty) OVER (PARTITION BY modelo) é o combo inteiro: ela
  -- soma as unidades do MESMO modelo espalhadas por sabores diferentes, e
  -- é essa soma que decide se o preço base daquele produto é o cheio ou o
  -- de combo. Produto cujo combo não desconta (piso mordendo, margem
  -- curta) fica com o preço cheio e nem vira linha diferente.
  --
  -- O JOIN com products não perde item: produto inexistente não teria
  -- product_assignments, e o passo 3 já teria levantado estoque_insuficiente.
  FOR v_item IN
    WITH pedido AS (
      SELECT x.product_id AS pid, SUM(x.quantity)::integer AS qty
      FROM jsonb_to_recordset(p_items) AS x(product_id uuid, quantity integer)
      GROUP BY x.product_id
    ),
    com_modelo AS (
      SELECT ped.pid,
             ped.qty,
             p.sale_price,
             p.purchase_price,
             public.combo_unit_price(p.sale_price, p.purchase_price) AS preco_combo,
             SUM(ped.qty) OVER (
               PARTITION BY public.product_model_key(p.id, p.brand, p.model)
             ) AS unidades_do_modelo
      FROM pedido ped
      JOIN public.products p ON p.id = ped.pid
    )
    SELECT pid,
           qty,
           sale_price,
           purchase_price,
           CASE
             WHEN unidades_do_modelo >= public.combo_min_units()
              AND preco_combo < sale_price
               THEN preco_combo
             ELSE sale_price
           END AS base_price
    FROM com_modelo
    ORDER BY base_price, pid
  LOOP
    v_preco_base := v_item.base_price;
    v_aqui := 0;

    IF v_restam > 0 THEN
      v_preco_premio := public.loyalty_unit_price(v_item.sale_price, v_item.purchase_price);
      -- "Não acumula: vale o melhor dos dois". O prêmio só entra se for
      -- melhor que o preço base — e prêmio que não desconta NÃO é
      -- consumido: passa para o próximo item em vez de entregar nada.
      IF v_preco_premio < v_preco_base THEN
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
      VALUES (v_order_id, v_item.pid, v_item.qty - v_aqui, v_preco_base);
      v_total := v_total + ((v_item.qty - v_aqui) * v_preco_base);
    END IF;
  END LOOP;

  UPDATE public.orders SET total_amount = v_total WHERE id = v_order_id;

  RETURN public.order_receipt(v_order_id);
END;
$create_pending_order$;
