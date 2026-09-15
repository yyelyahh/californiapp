-- ============================================================
-- Atribuir estoque a um vendedor não pode passar do que a filial tem
-- ------------------------------------------------------------
-- Fecha o buraco irmão do que a 20260915160000 fechou. Lá era a
-- transferência que mexia no total sem mexer na atribuição; aqui é a
-- atribuição que cresce sem ninguém conferir se cabe no total.
--
-- O modelo é de SUBCONJUNTO: `product_branch.stock` é tudo o que a cidade
-- tem, INCLUSIVE o que está na mão dos vendedores, e `product_assignments`
-- é a parte de cada um. Logo, a soma das atribuições de um sabor entre os
-- vendedores de uma filial nunca pode passar o estoque daquela filial. Todo
-- o sistema já assume isso — `get_seller_catalog` calcula o que a loja
-- oferece a partir da ATRIBUIÇÃO, não do estoque — mas nada garantia.
--
-- A tela da Distribuição já fazia a conta certa (só oferece o LIVRE, que é
-- estoque menos o distribuído). O que faltava era a garantia: regra que mora
-- só no cliente é regra que não existe para quem chega por outro caminho —
-- e a RLS permite `UPDATE` direto em `product_assignments` pelo PostgREST.
--
-- GATILHO, e não uma function nova com REVOKE do acesso direto: o gatilho
-- pega TODOS os caminhos, inclusive os que eu não conheço, sem reescrever o
-- `addProductAssignment` nem o `transferProductAssignment`. É a mesma escolha
-- que a auditoria fez, e pelo mesmo motivo.
--
-- SÓ O QUE CRESCE PRECISA CABER. Um UPDATE que diminui (ou mantém) passa
-- sempre, e isso não é frouxidão: se alguma linha já está furada — resíduo
-- das transferências feitas antes da 20260915160000 —, bloquear a redução
-- tiraria justamente a única saída para consertá-la.
-- ============================================================

CREATE OR REPLACE FUNCTION public.validate_assignment_fits_stock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $validate_assignment_fits_stock$
DECLARE
  v_branch uuid;
  v_stock  integer;
  v_outros integer;
BEGIN
  -- Diminuir sempre pode. É o que deixa uma linha furada ser consertada.
  IF TG_OP = 'UPDATE' AND NEW.quantity <= OLD.quantity THEN
    RETURN NEW;
  END IF;

  SELECT s.branch_id INTO v_branch FROM public.sellers s WHERE s.id = NEW.seller_id;
  IF v_branch IS NULL THEN
    -- Vendedor sem filial não deveria existir (a coluna é NOT NULL), mas se
    -- existisse não haveria estoque com que comparar. Deixa passar em vez de
    -- travar por um dado que não é deste assunto.
    RETURN NEW;
  END IF;

  SELECT pb.stock INTO v_stock
    FROM public.product_branch pb
   WHERE pb.product_id = NEW.product_id AND pb.branch_id = v_branch;

  IF v_stock IS NULL THEN
    -- `product_branch` é esparsa: sem linha, aquela cidade não vende o sabor.
    -- Atribuir a um vendedor dela seria dar o que não existe ali.
    RAISE EXCEPTION 'produto_nao_vendido_nesta_filial';
  END IF;

  -- Quanto já está com os OUTROS (a própria linha sai da conta — no UPDATE
  -- ela seria contada duas vezes, e no INSERT ela ainda nem está na tabela).
  -- FOR UPDATE não convive com agregação na mesma query: trava numa
  -- subconsulta e soma por fora dela.
  SELECT COALESCE(SUM(l.quantity), 0) INTO v_outros
    FROM (
      SELECT pa.quantity
        FROM public.product_assignments pa
       WHERE pa.product_id = NEW.product_id
         AND pa.id <> NEW.id
         AND pa.seller_id IN (SELECT id FROM public.sellers WHERE branch_id = v_branch)
       FOR UPDATE
    ) l;

  IF v_outros + NEW.quantity > v_stock THEN
    -- O número vai junto do código: é o que deixa a tela dizer "cabem 3" em
    -- vez de "não deu".
    RAISE EXCEPTION 'atribuicao_maior_que_estoque:%', GREATEST(v_stock - v_outros, 0);
  END IF;

  RETURN NEW;
END;
$validate_assignment_fits_stock$;

REVOKE ALL ON FUNCTION public.validate_assignment_fits_stock() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_assignment_fits_stock() TO service_role;

DROP TRIGGER IF EXISTS validate_assignment_fits_stock_trg ON public.product_assignments;
CREATE TRIGGER validate_assignment_fits_stock_trg
  BEFORE INSERT OR UPDATE ON public.product_assignments
  FOR EACH ROW EXECUTE FUNCTION public.validate_assignment_fits_stock();


-- ------------------------------------------------------------
-- Os caminhos que passam por aqui, e por que nenhum quebra
-- ------------------------------------------------------------
-- O gatilho roda dentro de fluxos que já existem. Todos continuam válidos
-- porque, em cada um, o estoque é ajustado ANTES da atribuição:
--
--   create_sale            debita estoque, depois debita a atribuição (cai)
--   delete_sale            devolve estoque, depois devolve a atribuição
--   addStockLoss           debita estoque, depois debita a atribuição (cai)
--   deleteStockLoss        devolve estoque, depois devolve a atribuição
--   transfer_branch_stock  debita estoque, depois debita a atribuição (cai)
--   transferProductAssignment  tira de um e dá a outro: a soma não muda
--
-- Só sobe a soma quem atribui da casa — e é exatamente esse que precisava de
-- freio.
--
-- Para conferir se já existe linha furada (o certo é não voltar nenhuma):
--
--   SELECT b.name AS filial, p.brand, p.model, p.flavor,
--          pb.stock AS estoque_da_filial, SUM(pa.quantity) AS com_vendedores
--     FROM public.product_assignments pa
--     JOIN public.sellers s  ON s.id = pa.seller_id
--     JOIN public.branches b ON b.id = s.branch_id
--     JOIN public.products p ON p.id = pa.product_id
--     JOIN public.product_branch pb
--       ON pb.product_id = pa.product_id AND pb.branch_id = s.branch_id
--    GROUP BY b.name, p.brand, p.model, p.flavor, pb.stock
--   HAVING SUM(pa.quantity) > pb.stock;
--
-- Linha que aparecer ali continua podendo ser REDUZIDA (o gatilho só barra o
-- que cresce), que é como se conserta.
