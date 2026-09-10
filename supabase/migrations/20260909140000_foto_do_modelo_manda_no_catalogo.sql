-- ============================================================
-- A foto do modelo passa a vir de product_model_images
-- ============================================================
-- SINTOMA: ao salvar a foto de um modelo em Produtos → "Fotos por Modelo",
-- alguns sabores ficam com uma foto ANTIGA, e às vezes é a antiga que aparece
-- no card do modelo na loja.
--
-- CAUSA: a foto é definida por marca+modelo (product_model_images), mas o
-- catálogo devolvia `p.image_url` — uma coluna POR SABOR. São duas fontes para
-- o mesmo dado, e nada no app copia uma na outra: nenhuma tela grava
-- products.image_url (o único lugar que escreve foto é o diálogo, e ele escreve
-- em product_model_images). O que sobrou em products.image_url é resíduo de
-- antes, sabor a sabor.
--
-- E o resíduo não fica quieto: a loja monta o card do modelo com
-- `firstModelImage`, que pega o PRIMEIRO sabor com imagem, na ordem
-- (brand, flavor) que esta função devolve. Basta UM sabor com URL velha e em
-- ordem alfabética anterior para ele mandar na foto do modelo inteiro.
--
-- CORREÇÃO: o catálogo passa a ler a foto de product_model_images, que é a
-- tabela com a chave certa (marca+modelo), e só cai em products.image_url
-- quando não existe foto cadastrada para aquele modelo. Assim todos os sabores
-- do mesmo modelo devolvem a MESMA url e um resíduo por sabor não vence mais.
--
-- Duas defesas no casamento das chaves:
--   * lower(btrim(...)) nos dois lados — "V150" e " v150 " são o mesmo modelo
--     para quem cadastrou, e um match exato deixaria de fora justamente os
--     sabores digitados com espaço ou caixa diferente;
--   * ORDER BY created_at DESC — se houver linha duplicada para o mesmo
--     marca+modelo (o upsert usa onConflict "brand,model" e depende dessa
--     unicidade existir no banco), vale a mais recente, não uma qualquer.
--
-- ANTES DE APLICAR: confirme que o corpo vivo desta função é o mesmo em que
-- este arquivo se baseia (20260908103500) antes de substituir:
--   SELECT prosrc FROM pg_proc WHERE proname = 'get_seller_catalog';
-- Só a expressão de image_url muda aqui; o resto do corpo é cópia.
--
-- Diagnóstico do estrago atual (quais modelos têm sabores discordando):
--   SELECT brand, model, count(DISTINCT coalesce(image_url,'')) AS fotos,
--          array_agg(DISTINCT coalesce(image_url,'(vazio)'))
--     FROM public.products
--    GROUP BY brand, model
--   HAVING count(DISTINCT coalesce(image_url,'')) > 1;
--
-- Depois desta migration o resíduo deixa de aparecer, mas continua gravado. Se
-- quiser limpar de vez (opcional, e só depois de conferir o diagnóstico acima):
--   UPDATE public.products p SET image_url = NULL
--    WHERE EXISTS (
--      SELECT 1 FROM public.product_model_images pmi
--       WHERE lower(btrim(pmi.brand)) = lower(btrim(p.brand))
--         AND lower(btrim(coalesce(pmi.model,''))) = lower(btrim(coalesce(p.model,'')))
--    );
-- ============================================================

-- ------------------------------------------------------------
-- A tabela vem ANTES da função que a lê
-- ------------------------------------------------------------
-- product_model_images nasceu no SQL Editor e nunca teve migration nenhuma.
-- O corpo desta função é validado na hora do CREATE (check_function_bodies vem
-- ligado), então um banco novo — `supabase db reset`, CI, ambiente novo —
-- parava exatamente aqui, com
--     relation "public.product_model_images" does not exist
-- e junto com ele parava toda migration posterior. No banco que já existe o
-- IF NOT EXISTS não encosta em nada.
CREATE TABLE IF NOT EXISTS public.product_model_images (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand      text NOT NULL,
  model      text NOT NULL DEFAULT '',
  image_url  text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- O upsert do diálogo (onConflict "brand,model") depende desta unicidade
-- existir. Quem já tem a tabela viva já tem a restrição — é ela que faz o
-- upsert funcionar hoje.
CREATE UNIQUE INDEX IF NOT EXISTS product_model_images_brand_model_key
  ON public.product_model_images (brand, model);

ALTER TABLE public.product_model_images ENABLE ROW LEVEL SECURITY;

-- Só o admin cadastra foto — o diálogo vive dentro da tela de Produtos. A loja
-- não lê esta tabela direto: quem lê é get_seller_catalog, que é SECURITY
-- DEFINER e por isso passa por cima da RLS.
DROP POLICY IF EXISTS "Admins manage product_model_images" ON public.product_model_images;
CREATE POLICY "Admins manage product_model_images" ON public.product_model_images
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_model_images TO authenticated;
GRANT ALL ON public.product_model_images TO service_role;

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
    -- A foto do modelo manda; products.image_url é só o que sobrou de antes.
    COALESCE(
      (
        SELECT pmi.image_url
        FROM public.product_model_images pmi
        WHERE lower(btrim(pmi.brand)) = lower(btrim(p.brand))
          AND lower(btrim(COALESCE(pmi.model, ''))) = lower(btrim(COALESCE(p.model, '')))
        ORDER BY pmi.created_at DESC
        LIMIT 1
      ),
      p.image_url
    ) AS image_url
  FROM (
    SELECT product_id, SUM(quantity) AS assigned
    FROM public.product_assignments
    WHERE seller_id = p_seller_id
    GROUP BY product_id
  ) pa
  JOIN public.products p ON p.id = pa.product_id
  JOIN public.sellers s ON s.id = p_seller_id
  ORDER BY p.brand, p.flavor;
$$;

GRANT EXECUTE ON FUNCTION public.get_seller_catalog(uuid) TO anon, authenticated;
