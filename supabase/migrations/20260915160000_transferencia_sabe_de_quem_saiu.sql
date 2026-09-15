-- ============================================================
-- A transferência precisa saber DE QUEM a unidade saiu
-- ------------------------------------------------------------
-- Conserta um furo da 20260915150000: ela debitava só o total da cidade
-- (`product_branch.stock`) e não encostava em `product_assignments`.
--
-- O modelo é de SUBCONJUNTO, e é isso que torna o furo grave:
--   product_branch.stock      = tudo o que a cidade tem, INCLUSIVE o que está
--                               na mão dos vendedores
--   product_assignments.qty   = a parte que está com cada vendedor
-- Venda debita os DOIS (create_sale). Perda com vendedor debita os DOIS.
-- Atribuir não mexe no estoque — só marca de quem é a parte.
--
-- Com a transferência mexendo só no total, tirar 2 unidades da caixa de um
-- vendedor deixava ele marcado com 2 que não tem. E quando a soma das
-- atribuições encosta no estoque, o total cai abaixo dela: a loja daquele
-- vendedor passa a oferecer unidade que a cidade não possui mais, porque
-- `get_seller_catalog` calcula o disponível a partir da ATRIBUIÇÃO, não do
-- estoque da filial.
--
-- NÃO EXISTE PRIORIDADE ENTRE VENDEDORES, e não se inventa uma. "Tirou 2, e o
-- A tinha 4 e o B tinha 2 — de quem saiu?" é uma pergunta que só quem estava
-- lá responde; um FIFO por data de atribuição, ou qualquer outra regra
-- automática, acertaria o total e erraria a pessoa, em silêncio. A origem
-- vira CAMPO, exatamente como a origem da perda em /losses: estoque da casa,
-- ou um vendedor.
--
-- E entra a checagem que faltava para o caso "estoque da casa": o LIVRE é
-- `stock - (o que está com os vendedores desta filial)`. Sem ela, transferir
-- "da casa" quando tudo está distribuído derruba o total abaixo das
-- atribuições — o mesmo estrago, por outro caminho.
--
-- O FIFO que SOBRA é o de dentro de um vendedor só (percorrer as linhas dele
-- por created_at), e esse não escolhe nada: é o mesmo laço do create_sale, e
-- `product_assignments` tem UNIQUE (seller_id, product_id), então na prática é
-- uma linha. Fica defensivo, como lá.
--
-- O DESTINO não ganha atribuição nenhuma: unidade que chega em outra cidade
-- entra no estoque da CASA de lá. Quem distribui para um vendedor de lá faz
-- isso depois, pela Distribuição — são dois movimentos porque são duas
-- decisões, e a segunda é de quem recebeu.
-- ============================================================

ALTER TABLE public.stock_transfers
  ADD COLUMN IF NOT EXISTS from_seller_id uuid REFERENCES public.sellers(id);

COMMENT ON COLUMN public.stock_transfers.from_seller_id IS
  'De quem saiu a unidade. NULO = estoque da casa. Não se deduz: quem estava lá informa.';


-- Lista de parâmetros diferente ⇒ DROP obrigatório. Sem ele ficariam duas
-- versões coexistindo e a de 6 argumentos continuaria sendo chamada — voltando
-- a debitar só o total, sem erro nenhum para denunciar.
DROP FUNCTION IF EXISTS public.transfer_branch_stock(uuid, uuid, uuid, integer, timestamptz, text);

CREATE FUNCTION public.transfer_branch_stock(
  p_product_id     uuid,
  p_from_branch_id uuid,
  p_to_branch_id   uuid,
  p_quantity       integer,
  p_date           timestamptz DEFAULT NULL,
  p_notes          text DEFAULT NULL,
  p_from_seller_id uuid DEFAULT NULL   -- NULO = sai do estoque da casa
) RETURNS public.stock_transfers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $transfer_branch_stock$
DECLARE
  v_origem     public.product_branch;
  v_row        public.stock_transfers;
  v_assigned   integer;
  v_livre      integer;
  v_remaining  integer;
  v_assignment record;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'nao_autorizado';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'quantidade_invalida';
  END IF;

  IF p_from_branch_id IS NULL OR p_to_branch_id IS NULL THEN
    RAISE EXCEPTION 'filial_obrigatoria';
  END IF;

  IF p_from_branch_id = p_to_branch_id THEN
    RAISE EXCEPTION 'mesma_filial';
  END IF;

  -- As DUAS pontas precisam ser alcançáveis para ESCREVER.
  IF NOT EXISTS (SELECT 1 FROM public.my_branch_ids() b WHERE b = p_from_branch_id)
     OR NOT EXISTS (SELECT 1 FROM public.my_branch_ids() b WHERE b = p_to_branch_id) THEN
    RAISE EXCEPTION 'nao_autorizado';
  END IF;

  -- Trava a linha de estoque da origem antes de qualquer conta, para a
  -- checagem e o débito enxergarem o mesmo número.
  SELECT * INTO v_origem
    FROM public.product_branch
   WHERE product_id = p_product_id AND branch_id = p_from_branch_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'estoque_insuficiente';
  END IF;

  IF p_from_seller_id IS NULL THEN
    -- ---- Sai do estoque da CASA: só pode o que não está com ninguém ----
    -- FOR UPDATE não convive com agregação na mesma query: trava numa
    -- subconsulta e soma por fora dela (o gotcha de sempre).
    SELECT COALESCE(SUM(l.quantity), 0) INTO v_assigned
      FROM (
        SELECT quantity
          FROM public.product_assignments
         WHERE product_id = p_product_id
           AND seller_id IN (SELECT id FROM public.sellers WHERE branch_id = p_from_branch_id)
         FOR UPDATE
      ) l;

    v_livre := v_origem.stock - v_assigned;
    IF v_livre < p_quantity THEN
      RAISE EXCEPTION 'estoque_livre_insuficiente:%', GREATEST(v_livre, 0);
    END IF;
  ELSE
    -- ---- Sai da MÃO de um vendedor ----
    -- Ele tem que ser desta filial: tirar da caixa de alguém da outra cidade
    -- acertaria o total daqui e furaria o de lá.
    PERFORM 1 FROM public.sellers
      WHERE id = p_from_seller_id AND branch_id = p_from_branch_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'vendedor_de_outra_filial';
    END IF;

    SELECT COALESCE(SUM(l.quantity), 0) INTO v_assigned
      FROM (
        SELECT quantity
          FROM public.product_assignments
         WHERE seller_id = p_from_seller_id AND product_id = p_product_id
         FOR UPDATE
      ) l;

    IF v_assigned < p_quantity THEN
      RAISE EXCEPTION 'estoque_vendedor_insuficiente:%', v_assigned;
    END IF;
  END IF;

  -- ---- Sai da origem ----
  UPDATE public.product_branch
     SET stock = stock - p_quantity
   WHERE product_id = p_product_id
     AND branch_id = p_from_branch_id
     AND stock >= p_quantity
  RETURNING * INTO v_origem;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'estoque_insuficiente';
  END IF;

  -- ---- E sai da caixa dele, quando foi dele que saiu ----
  -- Mesmo laço do create_sale. A UNIQUE (seller_id, product_id) garante uma
  -- linha só; o laço fica pelo mesmo motivo que lá — defesa contra o dia em
  -- que a constraint não existir mais.
  IF p_from_seller_id IS NOT NULL THEN
    v_remaining := p_quantity;
    FOR v_assignment IN
      SELECT id, quantity FROM public.product_assignments
       WHERE seller_id = p_from_seller_id AND product_id = p_product_id
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

  -- ---- Entra no destino, no estoque da casa de lá ----
  -- Sem atribuição: quem distribui na outra cidade decide lá, pela
  -- Distribuição. No INSERT o preço e o mínimo da origem servem de semente
  -- (product_branch é esparsa); no conflito só estoque e custo mudam.
  INSERT INTO public.product_branch (
    product_id, branch_id, sale_price, purchase_price, stock, min_stock
  )
  VALUES (
    p_product_id, p_to_branch_id, v_origem.sale_price, v_origem.purchase_price,
    p_quantity, v_origem.min_stock
  )
  ON CONFLICT (product_id, branch_id) DO UPDATE
     SET stock          = product_branch.stock + EXCLUDED.stock,
         purchase_price = EXCLUDED.purchase_price;

  -- ---- Fica registrado, com a origem ----
  INSERT INTO public.stock_transfers (
    product_id, from_branch_id, to_branch_id, from_seller_id,
    quantity, unit_cost, date, notes
  )
  VALUES (
    p_product_id, p_from_branch_id, p_to_branch_id, p_from_seller_id,
    p_quantity, v_origem.purchase_price, COALESCE(p_date, now()),
    nullif(btrim(left(btrim(COALESCE(p_notes, '')), 200)), '')
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$transfer_branch_stock$;

-- O DROP levou o GRANT junto.
REVOKE ALL ON FUNCTION public.transfer_branch_stock(uuid, uuid, uuid, integer, timestamptz, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_branch_stock(uuid, uuid, uuid, integer, timestamptz, text, uuid) TO authenticated;


-- ------------------------------------------------------------
-- Onde já dá para ver se alguma cidade está furada
-- ------------------------------------------------------------
-- Nada garante hoje que a soma das atribuições caiba no estoque da filial —
-- `addProductAssignment` também não checa, e isso é anterior às filiais. Esta
-- consulta mostra os casos em que a conta não fecha, para conferir depois de
-- aplicar (o certo é não voltar linha nenhuma):
--
--   SELECT b.name AS filial,
--          p.brand, p.model, p.flavor,
--          pb.stock AS estoque_da_filial,
--          SUM(pa.quantity) AS com_vendedores
--     FROM public.product_assignments pa
--     JOIN public.sellers s       ON s.id = pa.seller_id
--     JOIN public.branches b      ON b.id = s.branch_id
--     JOIN public.products p      ON p.id = pa.product_id
--     JOIN public.product_branch pb
--       ON pb.product_id = pa.product_id AND pb.branch_id = s.branch_id
--    GROUP BY b.name, p.brand, p.model, p.flavor, pb.stock
--   HAVING SUM(pa.quantity) > pb.stock;
