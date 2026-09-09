-- ============================================================
-- Remove o catálogo público (LandingPage, rota `/`)
-- ============================================================
-- A tela foi apagada do front por não ser usada. O que ela consumia era um
-- conjunto de três coisas, criadas juntas em 20260814121115 e que só existiam
-- para ela:
--
--   1. a function get_public_catalog()
--   2. o GRANT SELECT por coluna em products para anon
--   3. a policy "Public catalog read"
--
-- Os três andam juntos porque get_public_catalog() é SECURITY INVOKER: ela roda
-- com o papel de quem chama, então o anon precisava de leitura DIRETA em
-- products para a function devolver alguma coisa. Dropar só a function deixaria
-- de pé uma leitura pública da tabela inteira de produtos em estoque, agora sem
-- nenhum consumidor — e alcançável pelo PostgREST sem passar por function
-- nenhuma (`/rest/v1/products?select=...`).
--
-- A LOJA PÚBLICA (/loja/:sellerId) NÃO DEPENDE DISTO. As três funções que o
-- anon usa lá são SECURITY DEFINER e leem products por dentro, com o papel do
-- dono da function:
--   get_seller_catalog(uuid)                        -- catálogo do vendedor
--   create_pending_order(uuid, text, text, text, jsonb)
--   get_customer_loyalty(text)                      -- cartão de fidelidade
-- O SellerStorePage não faz nenhuma leitura direta de tabela como anon (só
-- essas três chamadas de RPC), então depois desta migration o anon fica sem
-- acesso nenhum a public.products e a loja continua igual.
--
-- Para restaurar, a definição que estava viva era:
--
--   CREATE OR REPLACE FUNCTION public.get_public_catalog()
--   RETURNS TABLE(id uuid, name text, brand text, model text, flavor text, stock integer)
--   LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public'
--   AS $$
--     SELECT id, name, brand, COALESCE(model,'') AS model, flavor, stock
--     FROM public.products WHERE stock > 0 ORDER BY brand, flavor;
--   $$;
--
-- Depois de aplicar, regerar src/integrations/supabase/types.ts: ele continua
-- listando get_public_catalog até ser gerado de novo.
-- ============================================================

DROP FUNCTION IF EXISTS public.get_public_catalog();

DROP POLICY IF EXISTS "Public catalog read" ON public.products;

-- O REVOKE por coluna espelha o GRANT que criou o acesso; o REVOKE ALL fecha
-- qualquer privilégio de tabela que tenha sobrado em products para anon.
REVOKE SELECT (id, name, brand, model, flavor, stock) ON public.products FROM anon;
REVOKE ALL ON public.products FROM anon;
