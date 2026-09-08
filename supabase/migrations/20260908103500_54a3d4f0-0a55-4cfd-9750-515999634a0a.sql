-- ============================================================
-- Uma linha de atribuição por (vendedor, produto) — de verdade
-- ------------------------------------------------------------
-- O código do projeto está dividido sobre isso:
--
--   create_pending_order e create_sale somam SUM(quantity) sobre
--   VÁRIAS linhas de product_assignments do mesmo par;
--
--   get_seller_catalog lê pa.quantity de UMA linha, e como faz
--   JOIN direto, um par com duas linhas vira DUAS linhas no
--   catálogo — o mesmo sabor aparece duplicado, cada cópia com um
--   "available" menor que o real (cada uma desconta a reserva
--   inteira do produto).
--
-- Hoje o que segura isso é a consolidação feita no client
-- (StoreContext.addProductAssignment), não uma regra do banco:
-- não existe UNIQUE nenhum na tabela. Qualquer caminho que insira
-- direto — delete_sale, restauração de perda, uma inserção manual
-- no SQL Editor — pode criar a segunda linha.
--
-- Esta migration resolve pelos dois lados: consolida o que já
-- existe, impede que aconteça de novo, e ainda deixa a função de
-- catálogo agregando (redundante com o UNIQUE, mas ela passa a
-- estar certa sozinha, sem depender da constraint).
--
-- Como get_seller_catalog é reescrita aqui de qualquer jeito, ela
-- já sai com o prazo de reserva de 24h aplicado (migration
-- 20260908102500) em vez de exigir uma terceira cópia do corpo.
--
-- ATENÇÃO: o passo 1 REESCREVE dados já gravados. Ele é o mesmo
-- merge que o client já faz (soma as quantidades, mantém a linha
-- mais antiga), então nenhuma unidade é perdida — mas confira o
-- resultado da query de diagnóstico abaixo antes de aplicar.
--
--   SELECT seller_id, product_id, count(*), sum(quantity)
--   FROM public.product_assignments
--   GROUP BY 1, 2 HAVING count(*) > 1;
--
-- Se ela não voltar nada, o passo 1 não muda linha nenhuma.
-- ============================================================

-- ----------------------------------------------------------
-- 1) Consolida duplicatas: a linha mais antiga do par fica com a
--    soma de todas, as outras somem.
-- ----------------------------------------------------------
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (PARTITION BY seller_id, product_id ORDER BY created_at, id) AS rn,
    SUM(quantity) OVER (PARTITION BY seller_id, product_id) AS merged_quantity
  FROM public.product_assignments
)
UPDATE public.product_assignments pa
SET quantity = r.merged_quantity
FROM ranked r
WHERE pa.id = r.id
  AND r.rn = 1
  AND pa.quantity <> r.merged_quantity;

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (PARTITION BY seller_id, product_id ORDER BY created_at, id) AS rn
  FROM public.product_assignments
)
DELETE FROM public.product_assignments pa
USING ranked r
WHERE pa.id = r.id
  AND r.rn > 1;

-- ----------------------------------------------------------
-- 2) A regra passa a ser do banco, não do client.
-- ----------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.product_assignments'::regclass
      AND conname = 'product_assignments_seller_product_key'
  ) THEN
    ALTER TABLE public.product_assignments
      ADD CONSTRAINT product_assignments_seller_product_key UNIQUE (seller_id, product_id);
  END IF;
END $$;

-- ----------------------------------------------------------
-- 3) get_seller_catalog passa a agregar em vez de fazer JOIN
--    linha a linha. Com o UNIQUE acima isso é redundante — e é
--    de propósito: a função deixa de depender da constraint para
--    estar correta, então uma restauração de backup antiga ou um
--    ambiente sem a migration não volta a duplicar o catálogo.
--
--    O tipo de retorno não muda, então CREATE OR REPLACE basta
--    (não precisa do DROP FUNCTION).
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
    p.image_url
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
