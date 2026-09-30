-- ============================================================
-- Vendedor não edita nem apaga venda: quitar e excluir são do dono
-- ============================================================
-- A venda do vendedor nasce do pedido do catálogo, por `confirm_order`
-- (SECURITY DEFINER), sempre como "falta receber". Quem registra que o
-- dinheiro chegou é o DONO, na tela de Vendas, depois de ver o dinheiro na
-- conta; e quem corrige uma venda (excluir e lançar de novo) também é ele.
--
-- A tela do vendedor (/minhas-vendas) não oferece nenhuma das duas coisas,
-- mas regra que só existe no cliente não existe para quem chega pelo
-- PostgREST. Até aqui, pelo console, o vendedor podia:
--   * QUITAR a própria venda: `from("sales").update({ paid_amount })`, pela
--     policy "Sellers update own sales" (20260607170629) — e a comissão dele
--     sobe com venda quitada;
--   * APAGAR a própria venda: `from("sales").delete()`, pela policy "Sellers
--     delete own sales", ou `rpc("delete_sale")`, que aceita o dono da venda
--     (20260915130000) — some a cobrança em aberto e o estoque volta para a
--     caixa dele.
--
-- Nada do vendedor depende disso: confirmar e recusar pedido passam por
-- functions DEFINER que não atualizam nem apagam venda, e o UPDATE/DELETE do
-- front é só das telas do admin ("Admins manage all sales" / `delete_sale`).
--
-- Fica de fora, de propósito: "Sellers insert own sales" (a consequência já
-- assumida no CLAUDE.md).


-- ------------------------------------------------------------
-- 1. As policies do vendedor saem
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Sellers update own sales" ON public.sales;
DROP POLICY IF EXISTS "Sellers delete own sales" ON public.sales;


-- ------------------------------------------------------------
-- 2. Apagar venda: só admin, por qualquer caminho
-- ------------------------------------------------------------
-- Tirar a policy fecha o DELETE direto, mas não o `delete_sale`: ele é
-- DEFINER, passa por cima da RLS e hoje deixa o vendedor apagar a venda dele.
-- Em vez de reescrever a function (o corpo no banco pode estar à frente do
-- desta pasta — ver "Gotchas de Postgres" no CLAUDE.md), a trava fica na
-- TABELA: vale para a function, para o PostgREST e para o que vier depois.
--
-- `auth.uid()` continua sendo quem chamou mesmo dentro de function DEFINER (vem
-- do JWT, não do dono da function). Nulo = SQL Editor / service role:
-- manutenção do dono, passa.
CREATE OR REPLACE FUNCTION public.sales_delete_only_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $so_admin_apaga$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'nao_autorizado';
  END IF;
  RETURN OLD;
END;
$so_admin_apaga$;

DROP TRIGGER IF EXISTS sales_delete_only_admin ON public.sales;
CREATE TRIGGER sales_delete_only_admin
  BEFORE DELETE ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.sales_delete_only_admin();


-- ------------------------------------------------------------
-- 3. Conferência: policies se SOMAM
-- ------------------------------------------------------------
-- Se sobrar qualquer outra policy que permita UPDATE ou DELETE em sales sem
-- exigir admin, a porta continua aberta, e esta migration não pode terminar
-- como se tivesse fechado.
DO $vendedor_sem_escrita$
DECLARE
  v_abertas text;
BEGIN
  SELECT string_agg(policyname || ' (' || cmd || ')', ', ')
    INTO v_abertas
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename = 'sales'
     AND cmd IN ('UPDATE', 'DELETE', 'ALL')
     AND coalesce(qual, '') NOT ILIKE '%has_role%admin%';

  IF v_abertas IS NOT NULL THEN
    RAISE EXCEPTION 'Ainda há policy de escrita em sales sem exigir admin: %', v_abertas;
  END IF;
END
$vendedor_sem_escrita$;


-- ------------------------------------------------------------
-- Para desfazer (SQL Editor), se um dia o vendedor voltar a editar/apagar:
--
-- DROP TRIGGER IF EXISTS sales_delete_only_admin ON public.sales;
-- DROP FUNCTION IF EXISTS public.sales_delete_only_admin();
-- CREATE POLICY "Sellers update own sales" ON public.sales FOR UPDATE TO authenticated
--   USING (seller_id = public.get_my_seller_id())
--   WITH CHECK (seller_id = public.get_my_seller_id());
-- CREATE POLICY "Sellers delete own sales" ON public.sales FOR DELETE TO authenticated
--   USING (seller_id = public.get_my_seller_id());
-- ------------------------------------------------------------
