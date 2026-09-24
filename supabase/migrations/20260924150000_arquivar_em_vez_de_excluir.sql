-- ============================================================
-- Nada se exclui: produto e vendedor só se ARQUIVAM
-- ------------------------------------------------------------
-- Excluir apagava história. Produto levava junto vendas, entradas e perdas
-- (resolvido com RESTRICT na 20260924140000); vendedor ainda leva, em
-- CASCADE, os pagamentos de comissão e as atribuições dele — e com os
-- pagamentos some uma saída de caixa do razão, mudando caixa e lucro do
-- passado sem rastro.
--
-- A decisão é não excluir nenhum dos dois pelo app: o DELETE sai do alcance
-- de quem está logado (REVOKE), e a tela oferece arquivar. Produto já tinha
-- arquivo (archived_models, por marca+modelo e por filial). Vendedor ganha
-- `archived_at` aqui.
--
-- ARQUIVAR VENDEDOR TEM DUAS CONDIÇÕES, e quem garante é o banco:
-- * caixa vazia (nenhuma atribuição com quantidade) — arquivado sai das listas
--   de escolha, e unidade na mão dele sumiria da Distribuição, da perda e da
--   transferência, continuando a contar no estoque da cidade;
-- * nenhum pedido pendente — o pedido é da loja dele e ficaria sem dono para
--   confirmar.
-- O saldo de comissão zerado também é condição, mas é conta do front
-- (computeSellerBalance), então quem recusa é a tela.
--
-- E arquivado não recebe estoque: a atribuição que cresce para um vendedor
-- arquivado é recusada. Sem estoque, a loja pública dele fica vazia sozinha
-- (get_seller_catalog monta o catálogo pela atribuição) — nenhuma function da
-- loja precisou mudar.
-- ============================================================

ALTER TABLE public.sellers ADD COLUMN IF NOT EXISTS archived_at timestamptz;

COMMENT ON COLUMN public.sellers.archived_at IS
  'Quando o vendedor foi arquivado. NULO = ativo. Arquivado some das listas de escolha e continua dando nome ao histórico.';


-- ------------------------------------------------------------
-- Arquivar só com a caixa vazia e sem pedido pendente
-- ------------------------------------------------------------
-- DEFINER para contar TUDO do vendedor, não só o que a RLS de quem clicou
-- deixa ver — uma contagem menor aprovaria o que não devia.
CREATE OR REPLACE FUNCTION public.seller_archive_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $seller_archive_guard$
DECLARE
  v_units   integer;
  v_pending integer;
BEGIN
  IF NEW.archived_at IS NOT NULL AND OLD.archived_at IS NULL THEN
    SELECT COALESCE(SUM(quantity), 0) INTO v_units
      FROM public.product_assignments
     WHERE seller_id = NEW.id;
    IF v_units > 0 THEN
      RAISE EXCEPTION 'vendedor_com_estoque:%', v_units;
    END IF;

    SELECT count(*) INTO v_pending
      FROM public.orders
     WHERE seller_id = NEW.id AND status = 'pendente';
    IF v_pending > 0 THEN
      RAISE EXCEPTION 'vendedor_com_pedido_pendente:%', v_pending;
    END IF;
  END IF;
  RETURN NEW;
END;
$seller_archive_guard$;

DROP TRIGGER IF EXISTS sellers_archive_guard ON public.sellers;
CREATE TRIGGER sellers_archive_guard
  BEFORE UPDATE OF archived_at ON public.sellers
  FOR EACH ROW EXECUTE FUNCTION public.seller_archive_guard();


-- ------------------------------------------------------------
-- Vendedor arquivado não recebe estoque
-- ------------------------------------------------------------
-- Só o que CRESCE é recusado, pela mesma razão do
-- validate_assignment_fits_stock: diminuir sempre passa (é o caminho de
-- esvaziar a caixa dele).
CREATE OR REPLACE FUNCTION public.assignment_not_to_archived_seller()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $assignment_not_to_archived_seller$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.quantity <= OLD.quantity THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.sellers WHERE id = NEW.seller_id AND archived_at IS NOT NULL) THEN
    RAISE EXCEPTION 'vendedor_arquivado';
  END IF;
  RETURN NEW;
END;
$assignment_not_to_archived_seller$;

DROP TRIGGER IF EXISTS product_assignments_not_to_archived ON public.product_assignments;
CREATE TRIGGER product_assignments_not_to_archived
  BEFORE INSERT OR UPDATE OF quantity ON public.product_assignments
  FOR EACH ROW EXECUTE FUNCTION public.assignment_not_to_archived_seller();


-- ------------------------------------------------------------
-- O DELETE sai do alcance do app
-- ------------------------------------------------------------
-- Sem GRANT de DELETE, nenhuma policy libera a exclusão — nem para admin.
-- O SQL Editor (postgres) continua podendo, para o dia em que for preciso
-- apagar um cadastro de teste de verdade; e aí a decisão é explícita.
REVOKE DELETE ON public.products FROM authenticated, anon, public;
REVOKE DELETE ON public.sellers  FROM authenticated, anon, public;

-- ------------------------------------------------------------
-- Para arquivar/desarquivar pelo SQL Editor:
--
--   UPDATE public.sellers SET archived_at = now() WHERE name = 'Fulano';
--   UPDATE public.sellers SET archived_at = NULL  WHERE name = 'Fulano';
-- ------------------------------------------------------------
