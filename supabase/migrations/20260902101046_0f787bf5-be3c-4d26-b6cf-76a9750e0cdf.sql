-- ============================================================
-- Busca cliente por WhatsApp + retorna informações de fidelidade
-- (baseado em quantas compras confirmadas ele já fez)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_customer_loyalty(p_whatsapp text)
RETURNS TABLE(
  customer_id uuid,
  customer_name text,
  whatsapp text,
  total_purchases integer,
  purchases_for_next_reward integer,
  next_reward_name text,
  loyalty_tier text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id AS customer_id,
    c.name AS customer_name,
    c.whatsapp,
    COALESCE(COUNT(o.id), 0)::integer AS total_purchases,
    CASE
      WHEN COALESCE(COUNT(o.id), 0) < 5 THEN (5 - COALESCE(COUNT(o.id), 0))::integer
      ELSE 0
    END AS purchases_for_next_reward,
    CASE
      WHEN COALESCE(COUNT(o.id), 0) >= 5 THEN 'Compra de bônus (5º pedido)'
      ELSE 'Desconto na 5º compra'
    END AS next_reward_name,
    CASE
      WHEN COALESCE(COUNT(o.id), 0) >= 5 THEN 'VIP'
      WHEN COALESCE(COUNT(o.id), 0) >= 3 THEN 'Frequente'
      ELSE 'Novo'
    END AS loyalty_tier
  FROM public.customers c
  LEFT JOIN public.orders o ON o.customer_id = c.id AND o.status = 'confirmada'
  WHERE TRIM(c.whatsapp) = TRIM(p_whatsapp)
  GROUP BY c.id, c.name, c.whatsapp;
$$;

GRANT EXECUTE ON FUNCTION public.get_customer_loyalty(text) TO anon, authenticated;