-- ============================================================
-- Campo de foto do produto (opcional). Nulo por enquanto — o front
-- usa um bloco de cor como placeholder quando não houver foto, e
-- troca automaticamente pra imagem real assim que o campo for
-- preenchido. Nenhum retrabalho de layout necessário depois.
-- ============================================================
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS image_url text;

-- Necessário dropar primeiro porque o tipo de retorno da função mudou
DROP FUNCTION IF EXISTS public.get_seller_catalog(uuid);

-- get_seller_catalog passa a expor image_url pro front decidir o que renderizar
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
    GREATEST(0, pa.quantity - COALESCE((
      SELECT SUM(oi.quantity)
      FROM public.order_items oi
      JOIN public.orders o ON o.id = oi.order_id
      WHERE o.seller_id = p_seller_id
        AND oi.product_id = p.id
        AND o.status = 'pendente'
    ), 0))::integer AS available,
    p.image_url
  FROM public.product_assignments pa
  JOIN public.products p ON p.id = pa.product_id
  JOIN public.sellers s ON s.id = pa.seller_id
  WHERE pa.seller_id = p_seller_id
  ORDER BY p.brand, p.flavor;
$$;

GRANT EXECUTE ON FUNCTION public.get_seller_catalog(uuid) TO anon, authenticated;