-- ============================================================
-- Recupera get_customer_loyalty: a versão por UNIDADE
-- ------------------------------------------------------------
-- Esta função estava rodando em produção sem existir em nenhum
-- arquivo aqui. A última migration que a define
-- (20260902101158) ainda é a versão antiga, por PEDIDO:
-- retornava total_purchases / purchases_for_next_reward /
-- next_reward_name e contava COUNT(orders).
--
-- A versão viva conta UNIDADES (SUM(order_items.quantity)) e só as
-- que viraram venda de verdade (oi.sale_id IS NOT NULL) — que é o
-- que o front consome hoje em SellerStorePage. Ou seja: um
-- `supabase db reset` reinstalaria a versão antiga, o checkout
-- pediria colunas que não existiriam mais e a fidelidade quebraria
-- inteira, sem nada no repositório explicando o porquê.
--
-- Corpo copiado de pg_proc.prosrc do banco de produção em
-- 2026-09-08, sem nenhuma alteração de regra.
--
-- Atributos (SECURITY DEFINER / STABLE / search_path) não vêm no
-- prosrc; foram reconstruídos: DEFINER é obrigatório porque quem
-- chama é o cliente anônimo da loja e `customers` só tem policy de
-- admin, e STABLE porque a função só lê.
--
-- DROP obrigatório antes: os arquivos anteriores criam a versão de
-- 7 colunas por pedido, e trocar nomes de coluna num RETURNS TABLE
-- faz CREATE OR REPLACE falhar com "cannot change return type".
-- Sem o DROP, um reset do banco para na primeira tentativa.
-- ============================================================

DROP FUNCTION IF EXISTS public.get_customer_loyalty(text);

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
      WHEN total_units >= 20 THEN 'VIP'
      WHEN total_units >= 5 THEN 'Frequente'
      ELSE 'Novo'
    END AS loyalty_tier
  FROM unit_count;
$$;

GRANT EXECUTE ON FUNCTION public.get_customer_loyalty(text) TO anon, authenticated;
