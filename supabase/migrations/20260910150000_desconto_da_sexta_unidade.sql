-- ============================================================
-- A sexta unidade sai com desconto (a fidelidade deixa de ser brinde)
-- ------------------------------------------------------------
-- O brinde a cada 5 unidades era só um cálculo: ninguém registrava qual
-- brinde tinha sido entregue, então o "quantos são devidos" crescia para
-- sempre e o acerto acontecia por fora, no WhatsApp. A regra nova nasce
-- do outro lado — o desconto entra no PREÇO da unidade, dentro do pedido,
-- e por isso ele é entregue no mesmo instante em que é ganho. Não existe
-- resgate pendente porque não existe resgate: a linha descontada em
-- order_items É o comprovante, e o confirm_order já repassa unit_price
-- para o create_sale, então a venda, a comissão e o lucro nascem com o
-- valor certo sem tocar em mais nada.
--
-- A REGRA, em uma frase: a cada 6 unidades acumuladas pelo cliente, uma
-- sai por metade do preço — e nunca por um valor igual ou abaixo do que
-- aquele produto custou para a casa; quando 50% bateria nesse piso, o
-- preço vira o de compra + 15%.
--
-- Três cuidados que a regra exige e que estão escritos em loyalty_unit_price:
--
--   * purchase_price ZERADO OU NULO não é margem infinita, é ausência de
--     informação. Aplicar "custo + 15%" ali venderia a R$ 0,00. Sem custo
--     cadastrado, vale os 50% e ponto.
--   * O PISO PODE PASSAR O PREÇO CHEIO. Produto de margem curta (compra
--     R$ 9,50, venda R$ 10,00) daria custo+15% = R$ 10,93 — um "desconto"
--     que encarece. O LEAST() trava no preço de venda, e o pedido trata
--     desconto que não desconta como desconto não usado (ver a migration
--     seguinte): ele passa para a próxima unidade em vez de sumir.
--   * O cálculo é do BANCO, não do cliente. purchase_price é revogado de
--     authenticated por GRANT de coluna e anon não enxerga products de
--     jeito nenhum — quem lê o custo aqui são funções SECURITY DEFINER,
--     e o que sai delas é só o preço final.
--
-- Efeito colateral consciente: quem receber um preço vindo do piso
-- consegue deduzir o custo daquele produto dividindo por 1,15. Só vale
-- para os itens de margem curta e só para quem já é cliente — se isso
-- incomodar, o piso vira uma % do preço de VENDA e o custo deixa de
-- aparecer em qualquer conta.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Os dois números da regra, num lugar só
-- ------------------------------------------------------------
-- Mesma escolha do order_reservation_ttl(): o número mora numa função para
-- que a loja, o pedido e a fidelidade leiam o MESMO 6. O front não repete
-- essa constante — ele recebe o ciclo de get_customer_loyalty.
CREATE OR REPLACE FUNCTION public.loyalty_cycle()
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $loyalty_cycle$
  SELECT 6;
$loyalty_cycle$;

-- Preço da unidade premiada. Pura: recebe os dois valores e devolve o
-- terceiro, sem tocar em tabela — assim ela pode ser chamada de dentro de
-- qualquer function sem carregar privilégio nenhum junto.
CREATE OR REPLACE FUNCTION public.loyalty_unit_price(
  p_sale_price     numeric,
  p_purchase_price numeric
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $loyalty_unit_price$
  SELECT CASE
    -- Sem custo cadastrado não há piso a respeitar: metade do preço.
    WHEN p_purchase_price IS NULL OR p_purchase_price <= 0
      THEN round(COALESCE(p_sale_price, 0) * 0.5, 2)
    -- Metade ainda fica ACIMA do custo: é o desconto cheio.
    WHEN round(COALESCE(p_sale_price, 0) * 0.5, 2) > p_purchase_price
      THEN round(COALESCE(p_sale_price, 0) * 0.5, 2)
    -- Metade encostaria no custo: sobe para custo + 15%, sem nunca passar
    -- do preço de prateleira.
    ELSE LEAST(round(p_purchase_price * 1.15, 2), COALESCE(p_sale_price, 0))
  END;
$loyalty_unit_price$;

-- ------------------------------------------------------------
-- 2. As unidades que o cliente já comprou de verdade
-- ------------------------------------------------------------
-- Mesma conta que o get_customer_loyalty fazia embutida, agora sozinha:
-- o pedido (migration seguinte) precisa EXATAMENTE deste número para
-- decidir quantas unidades entram com desconto, e duas cópias da regra
-- divergiriam no primeiro ajuste.
--
-- Continua contando só o que virou venda: pedido 'confirmada' E item com
-- sale_id preenchido. Venda manual da SalesPage não conta.
--
-- REVOKE de PUBLIC no fim do arquivo: ela recebe um telefone e devolve
-- histórico de compra. Quem chama é sempre outra function SECURITY
-- DEFINER, que roda como dona e não passa por essa checagem.
CREATE OR REPLACE FUNCTION public.customer_units(p_whatsapp text)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $customer_units$
  SELECT COALESCE(SUM(oi.quantity), 0)::integer
  FROM public.customers c
  JOIN public.orders o
    ON o.customer_id = c.id AND o.status = 'confirmada'
  JOIN public.order_items oi
    ON oi.order_id = o.id AND oi.sale_id IS NOT NULL
  WHERE regexp_replace(COALESCE(p_whatsapp, ''), '\D', '', 'g') <> ''
    AND regexp_replace(c.whatsapp, '\D', '', 'g')
      = regexp_replace(COALESCE(p_whatsapp, ''), '\D', '', 'g');
$customer_units$;

-- ------------------------------------------------------------
-- 3. get_customer_loyalty: fala de desconto, e devolve menos sobre o cliente
-- ------------------------------------------------------------
-- Mudam duas coisas ao mesmo tempo, e as duas exigem o DROP (o formato de
-- retorno é outro; CREATE OR REPLACE devolveria "cannot change return type"):
--
--   * o vocabulário deixa de ser brinde. `units_until_next_discount` nunca
--     é 0 — quando vale 1, a PRÓXIMA unidade é a premiada, que é o que a
--     loja precisa dizer. O antigo 0-quer-dizer-ganhou obrigava o front a
--     conhecer a regra para escrever a frase.
--   * sai o que a tela não usa. Esta função é GRANT ... TO anon: qualquer
--     pessoa com o link da loja pode varrer telefones. Ela devolvia nome
--     COMPLETO, customer_id e o próprio whatsapp de volta — nada disso é
--     lido pela loja. Fica o primeiro nome, que é o que aparece no "Oi,
--     Fulano!". Continua sendo um endereço aberto que confirma se um
--     telefone é cliente: o teto de pedidos pendentes (migration seguinte)
--     limita o abuso do pedido, não o desta consulta.
--
-- `cycle_units` vai junto de propósito: é assim que o front prevê o
-- desconto do carrinho sem repetir o número 6 do lado de cá.
DROP FUNCTION IF EXISTS public.get_customer_loyalty(text);

CREATE FUNCTION public.get_customer_loyalty(p_whatsapp text)
RETURNS TABLE(
  customer_name             text,
  total_units               integer,
  cycle_units               integer,
  units_until_next_discount integer,
  discounts_used            integer,
  loyalty_tier              text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $get_customer_loyalty$
  SELECT
    split_part(btrim(c.name), ' ', 1) AS customer_name,
    u.total_units,
    public.loyalty_cycle() AS cycle_units,
    public.loyalty_cycle() - (u.total_units % public.loyalty_cycle()) AS units_until_next_discount,
    (u.total_units / public.loyalty_cycle()) AS discounts_used,
    -- As faixas continuam em 5 e 20: são sobre o tamanho da relação, não
    -- sobre o ciclo do desconto. O nome é string literal aqui dentro e o
    -- front imprime cru — trocar o texto muda a loja sem tocar em .tsx.
    CASE
      WHEN u.total_units >= 20 THEN 'Fiel'
      WHEN u.total_units >= 5  THEN 'Frequente'
      ELSE 'Novo'
    END AS loyalty_tier
  FROM public.customers c
  CROSS JOIN LATERAL (SELECT public.customer_units(c.whatsapp) AS total_units) u
  WHERE regexp_replace(COALESCE(p_whatsapp, ''), '\D', '', 'g') <> ''
    AND regexp_replace(c.whatsapp, '\D', '', 'g')
      = regexp_replace(COALESCE(p_whatsapp, ''), '\D', '', 'g');
$get_customer_loyalty$;

-- ------------------------------------------------------------
-- 4. O catálogo passa a carregar o preço premiado
-- ------------------------------------------------------------
-- Uma coluna a mais: `loyalty_price`, o que aquela unidade custaria se
-- fosse a premiada. É o que deixa a loja mostrar o total JÁ descontado
-- no carrinho, em vez de o desconto aparecer só depois de o pedido
-- existir. O custo não sai daqui — sai o preço final, calculado dentro
-- desta function, que é SECURITY DEFINER e lê products por dentro.
--
-- Formato de retorno diferente ⇒ DROP antes (o gotcha de sempre). O corpo
-- é o mesmo da 20260910120000; só a coluna nova entra.
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

-- ------------------------------------------------------------
-- 5. Quem pode chamar o quê
-- ------------------------------------------------------------
-- O DROP levou os GRANTs junto: sem estas duas linhas a loja quebra na
-- primeira visita anônima.
GRANT EXECUTE ON FUNCTION public.get_seller_catalog(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_customer_loyalty(text) TO anon, authenticated;

-- Function nova nasce executável por PUBLIC no Postgres. Estas duas não
-- são endereço de ninguém: só existem para as de cima chamarem.
REVOKE EXECUTE ON FUNCTION public.customer_units(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.loyalty_unit_price(numeric, numeric) FROM PUBLIC, anon;
