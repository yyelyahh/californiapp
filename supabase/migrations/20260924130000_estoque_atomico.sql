-- ============================================================
-- Estoque atômico: entrada, perda e as duas exclusões no banco
-- ------------------------------------------------------------
-- Até aqui o front mexia em product_branch.stock lendo o número, somando e
-- gravando por cima (addBranchStock). Três defeitos saíam disso:
--
-- 1. CORRIDA. Entre a leitura e a escrita, uma venda confirmada pela loja
--    podia debitar a mesma linha; a escrita do front gravava o número velho
--    mais a entrada e a venda "desaparecia" — a unidade vendida voltava para
--    a prateleira. create_sale já era atômico; a outra ponta, não.
-- 2. PERDA DA CASA SEM TETO NO LIVRE. A perda "do estoque interno" só
--    conferia o estoque TOTAL, que inclui o que está com os vendedores. Com
--    tudo distribuído, ela derrubava o estoque abaixo da soma das atribuições
--    e a loja de um vendedor passava a oferecer unidade que a cidade não tem
--    (get_seller_catalog calcula pela ATRIBUIÇÃO). É a mesma regra que a
--    transferência já aplica: saindo da casa, o teto é o livre.
-- 3. MEIO CAMINHO. Excluir uma entrada apagava a linha e só DEPOIS tirava o
--    estoque, com um Math.max(0) no meio: se as unidades já tinham sido
--    vendidas, o estoque ficava em zero calado e a conta não fechava mais.
--
-- As quatro functions abaixo fazem cada movimento numa transação só, com o
-- mesmo desenho da transfer_branch_stock: admin, filial alcançável, linha
-- travada antes da conta, UPDATE condicional, e o erro volta com o número que
-- o banco viu (`codigo:N`) para a tela dizer o limite em vez de "não deu".
-- ============================================================


-- ------------------------------------------------------------
-- Entrada: soma ao estoque de uma filial (cria a linha se preciso)
-- ------------------------------------------------------------
-- Usada pela entrada manual e pelo recebimento de compra. Só soma — tirar
-- estoque tem regra (livre, vendedor) e mora nas functions de perda e de
-- exclusão. Na linha nova, preço e mínimo são semente (product_branch é
-- esparsa); na existente, só estoque e custo mudam, e o custo é o do lote
-- que está chegando (a convenção de sempre).
CREATE OR REPLACE FUNCTION public.add_branch_stock(
  p_product_id uuid,
  p_branch_id  uuid,
  p_quantity   integer,
  p_unit_cost  numeric DEFAULT NULL,
  p_sale_price numeric DEFAULT NULL,
  p_min_stock  integer DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $add_branch_stock$
DECLARE
  v_stock integer;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'nao_autorizado';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'quantidade_invalida';
  END IF;
  IF p_branch_id IS NULL THEN
    RAISE EXCEPTION 'filial_obrigatoria';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.my_branch_ids() b WHERE b = p_branch_id) THEN
    RAISE EXCEPTION 'nao_autorizado';
  END IF;

  INSERT INTO public.product_branch (
    product_id, branch_id, stock, purchase_price, sale_price, min_stock
  )
  VALUES (
    p_product_id, p_branch_id, p_quantity,
    COALESCE(p_unit_cost, 0), COALESCE(p_sale_price, 0), COALESCE(p_min_stock, 0)
  )
  ON CONFLICT (product_id, branch_id) DO UPDATE
     SET stock          = product_branch.stock + EXCLUDED.stock,
         purchase_price = COALESCE(p_unit_cost, product_branch.purchase_price)
  RETURNING stock INTO v_stock;

  RETURN v_stock;
END;
$add_branch_stock$;

REVOKE ALL ON FUNCTION public.add_branch_stock(uuid, uuid, integer, numeric, numeric, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_branch_stock(uuid, uuid, integer, numeric, numeric, integer) TO authenticated;


-- ------------------------------------------------------------
-- Perda: registra e tira do estoque (e da caixa do vendedor)
-- ------------------------------------------------------------
-- p_seller_id NULO = perda da casa, teto no LIVRE (estoque − atribuído).
-- Com vendedor, teto na caixa dele, e sai das duas: product_branch.stock
-- inclui o que está com ele (modelo de subconjunto), então a perda debita o
-- total E a atribuição — mesma regra da venda.
-- O custo sai de product_branch.purchase_price, lido aqui dentro: o front não
-- enxerga essa coluna (GRANT por coluna) e não é ele quem diz quanto vale.
CREATE OR REPLACE FUNCTION public.register_stock_loss(
  p_branch_id  uuid,
  p_product_id uuid,
  p_quantity   integer,
  p_seller_id  uuid DEFAULT NULL,
  p_reason     text DEFAULT NULL,
  p_date       timestamptz DEFAULT NULL
) RETURNS public.stock_losses
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $register_stock_loss$
DECLARE
  v_pb         public.product_branch;
  v_assigned   integer;
  v_livre      integer;
  v_remaining  integer;
  v_assignment record;
  v_row        public.stock_losses;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'nao_autorizado';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'quantidade_invalida';
  END IF;
  IF p_branch_id IS NULL THEN
    RAISE EXCEPTION 'filial_obrigatoria';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.my_branch_ids() b WHERE b = p_branch_id) THEN
    RAISE EXCEPTION 'nao_autorizado';
  END IF;

  SELECT * INTO v_pb
    FROM public.product_branch
   WHERE product_id = p_product_id AND branch_id = p_branch_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'estoque_insuficiente:0';
  END IF;

  IF p_seller_id IS NULL THEN
    -- FOR UPDATE não convive com agregação: trava numa subconsulta e soma
    -- por fora (o gotcha de sempre).
    SELECT COALESCE(SUM(l.quantity), 0) INTO v_assigned
      FROM (
        SELECT quantity
          FROM public.product_assignments
         WHERE product_id = p_product_id
           AND seller_id IN (SELECT id FROM public.sellers WHERE branch_id = p_branch_id)
         FOR UPDATE
      ) l;

    v_livre := v_pb.stock - v_assigned;
    IF v_livre < p_quantity THEN
      RAISE EXCEPTION 'estoque_livre_insuficiente:%', GREATEST(v_livre, 0);
    END IF;
  ELSE
    PERFORM 1 FROM public.sellers WHERE id = p_seller_id AND branch_id = p_branch_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'vendedor_de_outra_filial';
    END IF;

    SELECT COALESCE(SUM(l.quantity), 0) INTO v_assigned
      FROM (
        SELECT quantity
          FROM public.product_assignments
         WHERE seller_id = p_seller_id AND product_id = p_product_id
         FOR UPDATE
      ) l;

    IF v_assigned < p_quantity THEN
      RAISE EXCEPTION 'estoque_vendedor_insuficiente:%', v_assigned;
    END IF;

    -- Primeiro a caixa dele, depois o total: com a atribuição já menor, o
    -- estoque que cai continua cobrindo a soma das atribuições.
    v_remaining := p_quantity;
    FOR v_assignment IN
      SELECT id, quantity FROM public.product_assignments
       WHERE seller_id = p_seller_id AND product_id = p_product_id
       ORDER BY created_at ASC
       FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0;
      IF v_assignment.quantity <= v_remaining THEN
        DELETE FROM public.product_assignments WHERE id = v_assignment.id;
        v_remaining := v_remaining - v_assignment.quantity;
      ELSE
        UPDATE public.product_assignments
           SET quantity = quantity - v_remaining
         WHERE id = v_assignment.id;
        v_remaining := 0;
      END IF;
    END LOOP;
  END IF;

  UPDATE public.product_branch
     SET stock = stock - p_quantity
   WHERE product_id = p_product_id
     AND branch_id = p_branch_id
     AND stock >= p_quantity;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'estoque_insuficiente:%', v_pb.stock;
  END IF;

  INSERT INTO public.stock_losses (
    product_id, quantity, unit_cost, total_cost, reason, date, branch_id, seller_id
  )
  VALUES (
    p_product_id, p_quantity,
    COALESCE(v_pb.purchase_price, 0),
    COALESCE(v_pb.purchase_price, 0) * p_quantity,
    NULLIF(btrim(COALESCE(p_reason, '')), ''),
    COALESCE(p_date, now()),
    p_branch_id, p_seller_id
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$register_stock_loss$;

REVOKE ALL ON FUNCTION public.register_stock_loss(uuid, uuid, integer, uuid, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_stock_loss(uuid, uuid, integer, uuid, text, timestamptz) TO authenticated;


-- ------------------------------------------------------------
-- Excluir perda: devolve a unidade para onde ela estava
-- ------------------------------------------------------------
-- Na filial GRAVADA NA PERDA, não na ativa. Primeiro o estoque, depois a
-- caixa do vendedor: com o total já de volta, a atribuição que cresce cabe, e
-- o gatilho validate_assignment_fits_stock concorda.
CREATE OR REPLACE FUNCTION public.delete_stock_loss(p_loss_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $delete_stock_loss$
DECLARE
  v_loss public.stock_losses;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'nao_autorizado';
  END IF;

  SELECT * INTO v_loss FROM public.stock_losses WHERE id = p_loss_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'perda_nao_encontrada';
  END IF;
  IF v_loss.branch_id IS NULL THEN
    RAISE EXCEPTION 'filial_obrigatoria';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.my_branch_ids() b WHERE b = v_loss.branch_id) THEN
    RAISE EXCEPTION 'nao_autorizado';
  END IF;

  UPDATE public.product_branch
     SET stock = stock + v_loss.quantity
   WHERE product_id = v_loss.product_id AND branch_id = v_loss.branch_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'produto_nao_vendido_nesta_filial';
  END IF;

  IF v_loss.seller_id IS NOT NULL THEN
    INSERT INTO public.product_assignments (seller_id, product_id, quantity)
    VALUES (v_loss.seller_id, v_loss.product_id, v_loss.quantity)
    ON CONFLICT (seller_id, product_id) DO UPDATE
       SET quantity = product_assignments.quantity + EXCLUDED.quantity;
  END IF;

  DELETE FROM public.stock_losses WHERE id = p_loss_id;
END;
$delete_stock_loss$;

REVOKE ALL ON FUNCTION public.delete_stock_loss(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_stock_loss(uuid) TO authenticated;


-- ------------------------------------------------------------
-- Excluir entrada: tira as unidades de volta, se elas ainda estão livres
-- ------------------------------------------------------------
-- Se as unidades da entrada já foram vendidas, perdidas ou distribuídas, não
-- há o que tirar — e a exclusão é RECUSADA com o livre que existe
-- (entrada_ja_consumida:N). Antes ela zerava o estoque calada e apagava a
-- entrada, e dali em diante o histórico de entradas não explicava mais o
-- estoque. O custo (purchase_price) não volta ao anterior: não há registro de
-- qual era, e a convenção é "custo do último lote".
CREATE OR REPLACE FUNCTION public.delete_stock_entry(p_entry_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $delete_stock_entry$
DECLARE
  v_entry    public.stock_entries;
  v_pb       public.product_branch;
  v_assigned integer;
  v_livre    integer;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'nao_autorizado';
  END IF;

  SELECT * INTO v_entry FROM public.stock_entries WHERE id = p_entry_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'entrada_nao_encontrada';
  END IF;
  IF v_entry.branch_id IS NULL THEN
    RAISE EXCEPTION 'filial_obrigatoria';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.my_branch_ids() b WHERE b = v_entry.branch_id) THEN
    RAISE EXCEPTION 'nao_autorizado';
  END IF;

  SELECT * INTO v_pb
    FROM public.product_branch
   WHERE product_id = v_entry.product_id AND branch_id = v_entry.branch_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'entrada_ja_consumida:0';
  END IF;

  SELECT COALESCE(SUM(l.quantity), 0) INTO v_assigned
    FROM (
      SELECT quantity
        FROM public.product_assignments
       WHERE product_id = v_entry.product_id
         AND seller_id IN (SELECT id FROM public.sellers WHERE branch_id = v_entry.branch_id)
       FOR UPDATE
    ) l;

  v_livre := v_pb.stock - v_assigned;
  IF v_livre < v_entry.quantity THEN
    RAISE EXCEPTION 'entrada_ja_consumida:%', GREATEST(v_livre, 0);
  END IF;

  UPDATE public.product_branch
     SET stock = stock - v_entry.quantity
   WHERE product_id = v_entry.product_id AND branch_id = v_entry.branch_id;

  DELETE FROM public.stock_entries WHERE id = p_entry_id;
END;
$delete_stock_entry$;

REVOKE ALL ON FUNCTION public.delete_stock_entry(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_stock_entry(uuid) TO authenticated;


-- ------------------------------------------------------------
-- Venda gravada não troca de quantidade, produto, vendedor nem filial
-- ------------------------------------------------------------
-- O estoque da venda saiu no create_sale, de um produto, de uma filial e (com
-- vendedor) da caixa de alguém. Editar qualquer um desses quatro campos pelo
-- UPDATE direto não devolve nem debita nada: editar 2 → 5 deixava 3 unidades
-- sobrando no estoque, e trocar o produto deixava um sabor com estoque a menos
-- e outro com venda que nunca saiu dele. A tela já trava esses campos; o
-- gatilho é a mesma regra para quem chega pelo PostgREST. Corrigir é excluir
-- (delete_sale devolve o estoque) e lançar de novo.
--
-- Preço, pagamento, data, observação e tipo continuam editáveis: nenhum deles
-- mexe em unidade.
--
-- A única troca aceita é vendedor → NULO: é o ON DELETE SET NULL de
-- sales.seller_id quando um vendedor é excluído, e é o próprio banco fazendo
-- o UPDATE. Bloquear isso impediria excluir vendedor com venda.
CREATE OR REPLACE FUNCTION public.sale_stock_fields_are_fixed()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $sale_stock_fields_are_fixed$
BEGIN
  IF NEW.quantity   IS DISTINCT FROM OLD.quantity
  OR NEW.product_id IS DISTINCT FROM OLD.product_id
  OR (NEW.seller_id IS DISTINCT FROM OLD.seller_id AND NEW.seller_id IS NOT NULL)
  OR NEW.branch_id  IS DISTINCT FROM OLD.branch_id THEN
    RAISE EXCEPTION 'venda_campo_de_estoque_fixo';
  END IF;
  RETURN NEW;
END;
$sale_stock_fields_are_fixed$;

DROP TRIGGER IF EXISTS sales_stock_fields_are_fixed ON public.sales;
CREATE TRIGGER sales_stock_fields_are_fixed
  BEFORE UPDATE OF quantity, product_id, seller_id, branch_id ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.sale_stock_fields_are_fixed();
