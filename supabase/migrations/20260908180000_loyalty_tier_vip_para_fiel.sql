-- ============================================================
-- Renomeia o tier de topo: 'VIP' -> 'Fiel'
-- ------------------------------------------------------------
-- Mudança só de rótulo. Os limiares (20 / 5) e toda a regra de
-- contagem continuam idênticos aos da 20260908104500 — o corpo
-- abaixo é aquele, com uma única string trocada.
--
-- Aplicado direto no SQL Editor em 2026-09-08; este arquivo é o
-- espelho, pra migration e banco não divergirem de novo.
--
-- Sem DROP desta vez, de propósito: o RETURNS TABLE não mudou
-- (mesmas 7 colunas, mesmos tipos), então CREATE OR REPLACE
-- basta. O DROP da migration anterior existia porque lá as
-- colunas de retorno tinham mudado de nome.
--
-- O tier não é gravado em lugar nenhum: é calculado a cada
-- chamada, então a troca vale retroativamente pra todo mundo.
-- O front imprime o valor cru (SellerStorePage), não há nenhum
-- if/switch por nome de tier pra acompanhar.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_customer_loyalty(p_whatsapp text)
RETURNS TABLE(
  customer_id uuid,
  customer_name text,
  whatsapp text,
  total_units integer,
  units_until_next_gift integer,
  gifts_earned integer,
  loyalty_tier text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH unit_count AS (
    SELECT
      c.id AS customer_id,
      c.name AS customer_name,
      c.whatsapp,
      COALESCE(SUM(oi.quantity), 0)::integer AS total_units
    FROM public.customers c
    LEFT JOIN public.orders o
      ON o.customer_id = c.id AND o.status = 'confirmada'
    LEFT JOIN public.order_items oi
      ON oi.order_id = o.id AND oi.sale_id IS NOT NULL
    WHERE regexp_replace(c.whatsapp, '\D', '', 'g') = regexp_replace(p_whatsapp, '\D', '', 'g')
      AND regexp_replace(p_whatsapp, '\D', '', 'g') != ''
    GROUP BY c.id, c.name, c.whatsapp
  )
  SELECT
    customer_id,
    customer_name,
    whatsapp,
    total_units,
    CASE
      WHEN total_units = 0 THEN 5
      WHEN total_units % 5 = 0 THEN 0
      ELSE 5 - (total_units % 5)
    END AS units_until_next_gift,
    (total_units / 5) AS gifts_earned,
    CASE
      WHEN total_units >= 20 THEN 'Fiel'
      WHEN total_units >= 5 THEN 'Frequente'
      ELSE 'Novo'
    END AS loyalty_tier
  FROM unit_count;
$$;

GRANT EXECUTE ON FUNCTION public.get_customer_loyalty(text) TO anon, authenticated;
