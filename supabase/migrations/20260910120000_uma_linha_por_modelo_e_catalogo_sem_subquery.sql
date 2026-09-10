-- ============================================================
-- Uma linha por modelo, e o catálogo lendo a foto de uma vez só
-- ============================================================
-- Três coisas que a migration anterior (20260909140000) deixou em pé:
--
-- 1) LEITURA E ESCRITA COM CHAVES DIFERENTES. get_seller_catalog casa
--    marca+modelo com lower(btrim(...)) dos dois lados; o ModelImagesDialog
--    gravava e apagava por igualdade EXATA. Com uma linha ('ignite','v150')
--    no banco e o modelo cadastrado como ('Ignite','V150'), apagar a foto
--    rodava um DELETE que não pegava linha nenhuma — a tela dizia "Foto
--    removida" e a loja continuava mostrando a foto, para sempre. Na edição
--    dava o mesmo desencontro: o upsert acertava a linha exata e o
--    `created_at DESC` continuava elegendo a OUTRA, a antiga.
--
--    Correção: set_model_image() abaixo, que passa a ser a única porta de
--    escrita e usa exatamente a chave da leitura. Ela apaga tudo o que casa e
--    insere uma linha só, então deixa de existir duplicata para desempatar.
--
-- 2) A FOTO ERA UMA SUBQUERY CORRELACIONADA. Com lower(btrim(...)) nos dois
--    lados nenhum índice serve, e ela re-varria product_model_images uma vez
--    POR SABOR do catálogo — 200 sabores, 200 varreduras, a cada visita
--    anônima a /loja/:sellerId, que é rota aberta e sem rate limit. Agora o
--    mapa marca+modelo -> foto é montado uma vez e entra por LEFT JOIN.
--
-- 3) O COALESCE NÃO CAÍA NO FALLBACK QUANDO A URL ERA ''. image_url é NOT
--    NULL, então string vazia é o único jeito de representar "em branco" — e
--    '' ganhava o COALESCE, escondendo products.image_url, que ainda serve de
--    resíduo útil. Pior: o front trata '' como "sem foto" e desenha o
--    placeholder. O NULLIF() devolve o fallback.
--
-- ATENÇÃO — a limpeza abaixo APAGA LINHA. Ela colapsa duplicatas de
-- marca+modelo (mesma chave normalizada) guardando a mais recente, que é
-- justamente a que get_seller_catalog já elegia. Confira antes o que vai sair:
--   SELECT lower(btrim(brand)) AS marca,
--          lower(btrim(coalesce(model,''))) AS modelo,
--          count(*), array_agg(image_url ORDER BY created_at DESC)
--     FROM public.product_model_images
--    GROUP BY 1, 2 HAVING count(*) > 1;
-- ============================================================

-- ------------------------------------------------------------
-- 1. Uma linha por marca+modelo, garantido pelo banco
-- ------------------------------------------------------------
DELETE FROM public.product_model_images a
USING public.product_model_images b
WHERE lower(btrim(a.brand)) = lower(btrim(b.brand))
  AND lower(btrim(COALESCE(a.model, ''))) = lower(btrim(COALESCE(b.model, '')))
  AND (b.created_at, b.id) > (a.created_at, a.id);

-- Espaço nas pontas some da própria coluna: a chave normalizada é a que vale,
-- e assim o que está gravado é igual ao que a chave enxerga.
UPDATE public.product_model_images
   SET brand = btrim(brand),
       model = btrim(COALESCE(model, ''))
 WHERE brand <> btrim(brand)
    OR model IS DISTINCT FROM btrim(COALESCE(model, ''));

-- A unicidade que a leitura sempre assumiu e o banco nunca exigiu. Daqui em
-- diante duas linhas para o mesmo modelo não entram, nem pelo SQL Editor.
CREATE UNIQUE INDEX IF NOT EXISTS product_model_images_modelo_normalizado
  ON public.product_model_images (lower(btrim(brand)), lower(btrim(COALESCE(model, ''))));

-- ------------------------------------------------------------
-- 2. A porta única de escrita
-- ------------------------------------------------------------
-- URL vazia (ou nula) REMOVE a foto — é o mesmo gesto na tela: apagar o campo
-- e sair.
--
-- SECURITY DEFINER com a checagem de admin no corpo, como todas as outras
-- funções daqui. A primeira versão era INVOKER, apoiada na RLS da tabela — mas
-- product_model_images nasceu no SQL Editor e ninguém sabe que política ela tem
-- no banco vivo: a policy de admin que a 20260909140000 escreve só chega em
-- quem aplicar aquela migration de novo. Com RLS ligada e política nenhuma, o
-- DELETE casaria zero linhas e o INSERT seria barrado — a tela diria "Foto
-- salva" e nada teria acontecido, que é a mesma falha silenciosa que esta
-- migration veio consertar.
--
-- Duas defesas contra a ferramenta que aplica isto, não contra o Postgres:
--   * rótulo nomeado no dollar-quote ($set_model_image$) em vez de $$ — o
--     arquivo tem duas funções, e quem quebra o script em statements olhando
--     para $$ pode parear o fechamento de uma com a abertura da outra;
--   * SEM bloco DECLARE, corpo começando direto no BEGIN. A primeira versão
--     declarava três variáveis e voltou com
--     `42601: syntax error at or near "DECLARE"`, com o DECLARE reindentado —
--     sinal de que o corpo chegou ao servidor remontado, fora do
--     dollar-quote. Sem DECLARE não há o que remontar: as três expressões são
--     btrim(COALESCE(...)) repetido, que custa nada e não depende de bloco.
DROP FUNCTION IF EXISTS public.set_model_image(text, text, text);

CREATE FUNCTION public.set_model_image(
  p_brand     text,
  p_model     text,
  p_image_url text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $set_model_image$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'nao_autorizado';
  END IF;

  IF btrim(COALESCE(p_brand, '')) = '' THEN
    RAISE EXCEPTION 'marca_vazia';
  END IF;

  -- Apaga por chave NORMALIZADA: é o que faz a remoção alcançar a linha que a
  -- loja está lendo, mesmo que ela tenha sido gravada com outra caixa.
  DELETE FROM public.product_model_images pmi
   WHERE lower(btrim(pmi.brand)) = lower(btrim(p_brand))
     AND lower(btrim(COALESCE(pmi.model, ''))) = lower(btrim(COALESCE(p_model, '')));

  IF btrim(COALESCE(p_image_url, '')) <> '' THEN
    INSERT INTO public.product_model_images (brand, model, image_url)
    VALUES (btrim(p_brand), btrim(COALESCE(p_model, '')), btrim(p_image_url));
  END IF;
END;
$set_model_image$;

REVOKE EXECUTE ON FUNCTION public.set_model_image(text, text, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.set_model_image(text, text, text) TO authenticated;

-- ------------------------------------------------------------
-- 3. O catálogo, com o mapa de fotos montado uma vez só
-- ------------------------------------------------------------
-- Mesmo formato de retorno da versão anterior — só a origem da foto muda, de
-- subquery por linha para join contra um mapa pronto. Por isso CREATE OR
-- REPLACE basta aqui, sem DROP.
CREATE OR REPLACE FUNCTION public.get_seller_catalog(p_seller_id uuid)
RETURNS TABLE(
  seller_name text,
  product_id uuid,
  name text,
  brand text,
  model text,
  flavor text,
  sale_price numeric,
  available integer,
  image_url text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH foto AS (
    -- DISTINCT ON resolve o desempate aqui, uma vez por consulta, em vez de
    -- uma vez por sabor. Depois do índice único acima é no máximo uma linha
    -- por chave, mas o ORDER BY fica: ele é a regra escrita.
    -- Tudo qualificado por `pmi`: brand, model e image_url são também nomes de
    -- coluna de saída desta função, e nome solto aqui dependeria da regra de
    -- desempate do Postgres para cair no lugar certo.
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
    GREATEST(0, pa.assigned - COALESCE((
      SELECT SUM(oi.quantity)
      FROM public.order_items oi
      JOIN public.orders o ON o.id = oi.order_id
      WHERE o.seller_id = p_seller_id
        AND oi.product_id = p.id
        AND o.status = 'pendente'
        -- Reserva vencida não segura mais nada. Esta função é STABLE e
        -- chamada por anon, então ela não pode rodar a varredura — e é
        -- justamente por isso que o prazo entra aqui como filtro: o
        -- estoque volta ao catálogo mesmo que nada tenha varrido ainda.
        AND o.created_at > now() - public.order_reservation_ttl()
    ), 0))::integer AS available,
    -- A foto do modelo manda; products.image_url é só o que sobrou de antes,
    -- e URL em branco dos dois lados conta como "não tem foto".
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
$$;

GRANT EXECUTE ON FUNCTION public.get_seller_catalog(uuid) TO anon, authenticated;
