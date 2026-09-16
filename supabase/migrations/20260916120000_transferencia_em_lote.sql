-- ============================================================
-- Transferência em LOTE: uma operação, N sabores
-- ------------------------------------------------------------
-- Mandar uma caixa para a outra cidade é UM movimento com vários sabores
-- dentro, não oito movimentos independentes. Com uma chamada por sabor o
-- histórico virava oito linhas sem nada que dissesse que foram juntas, e —
-- pior — oito transações separadas: a quinta podia falhar por estoque e as
-- quatro anteriores já estavam feitas, com a caixa física inteira já na mão de
-- quem ia viajar. Ou vai tudo, ou não vai nada.
--
-- Duas peças:
--
--   1. `stock_transfers.batch_id` — a operação. NULO nas linhas antigas, e a
--      tela lê isso como "operação de um item só", que é exatamente o que elas
--      eram. Não há backfill: carimbar id novo em linha velha inventaria um
--      agrupamento que ninguém fez (e acordaria o gatilho de auditoria — o
--      gotcha de sempre).
--
--   2. `transfer_branch_stock_batch(...)` — percorre os itens chamando a
--      function de sempre. Ela NÃO reimplementa nada: toda a regra (o livre da
--      casa, o que o vendedor tem, o custo que viaja, o destino sem
--      atribuição) continua num lugar só, e um laço dentro de uma function é
--      uma transação — qualquer RAISE derruba o lote inteiro.
--
-- As N linhas nascem na MESMA transação, então dividem o `txid_current()` e a
-- Auditoria já as mostra como um movimento só, sem precisar saber o que é um
-- lote. O `batch_id` é para a tela de Entrada, que lê `stock_transfers` direto.
--
-- A ORIGEM É POR ITEM (`from_seller_id` dentro de cada elemento), não do lote:
-- juntar o que sobrou com dois vendedores e mandar tudo junto é uma viagem só,
-- e obrigar a fazer dois lotes por causa disso seria o mesmo ruído por outro
-- caminho. A filial de origem continua sendo a ativa, uma só — é o estoque que
-- está na tela.
-- ============================================================

ALTER TABLE public.stock_transfers
  ADD COLUMN IF NOT EXISTS batch_id uuid;

COMMENT ON COLUMN public.stock_transfers.batch_id IS
  'A operação de que esta linha faz parte. NULO = linha anterior ao lote, que era uma operação de um item só.';

CREATE INDEX IF NOT EXISTS stock_transfers_batch_idx
  ON public.stock_transfers (batch_id)
  WHERE batch_id IS NOT NULL;


-- ------------------------------------------------------------
-- A function de sempre, agora sabendo em que operação ela entra
-- ------------------------------------------------------------
-- Parâmetro novo ⇒ DROP obrigatório. Sem ele ficariam duas versões e a de 7
-- argumentos continuaria sendo chamada, gravando `batch_id` nulo em lote —
-- sem erro nenhum para denunciar. O corpo é o mesmo da 20260915160000; a
-- única mudança é o `p_batch_id` chegando ao INSERT.
DROP FUNCTION IF EXISTS public.transfer_branch_stock(uuid, uuid, uuid, integer, timestamptz, text, uuid);

CREATE FUNCTION public.transfer_branch_stock(
  p_product_id     uuid,
  p_from_branch_id uuid,
  p_to_branch_id   uuid,
  p_quantity       integer,
  p_date           timestamptz DEFAULT NULL,
  p_notes          text DEFAULT NULL,
  p_from_seller_id uuid DEFAULT NULL,   -- NULO = sai do estoque da casa
  p_batch_id       uuid DEFAULT NULL    -- NULO = operação de um item só
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

  -- ---- Fica registrado, com a origem e a operação ----
  INSERT INTO public.stock_transfers (
    product_id, from_branch_id, to_branch_id, from_seller_id,
    quantity, unit_cost, date, notes, batch_id
  )
  VALUES (
    p_product_id, p_from_branch_id, p_to_branch_id, p_from_seller_id,
    p_quantity, v_origem.purchase_price, COALESCE(p_date, now()),
    nullif(btrim(left(btrim(COALESCE(p_notes, '')), 200)), ''),
    p_batch_id
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$transfer_branch_stock$;

-- O DROP levou o GRANT junto.
REVOKE ALL ON FUNCTION public.transfer_branch_stock(uuid, uuid, uuid, integer, timestamptz, text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_branch_stock(uuid, uuid, uuid, integer, timestamptz, text, uuid, uuid) TO authenticated;


-- ------------------------------------------------------------
-- O lote
-- ------------------------------------------------------------
-- Percorre os itens na ordem em que chegaram e devolve as linhas gravadas, na
-- mesma ordem — é desse retorno que a tela monta a lista, nunca do que ela
-- mandou (o mesmo princípio do `create_pending_order`: o que o cliente enviou
-- não é fonte de verdade de nada).
--
-- O item que falha carrega o produto no erro (`<codigo>:<n>@<product_id>`).
-- Sem isso o toast diria "estoque insuficiente" sobre um lote de dez sabores e
-- a pessoa teria que adivinhar qual. O bloco EXCEPTION é uma subtransação, mas
-- o RAISE em seguida derruba tudo: nenhum item do lote sobrevive ao erro de
-- outro.
DROP FUNCTION IF EXISTS public.transfer_branch_stock_batch(uuid, uuid, jsonb, timestamptz, text);

CREATE FUNCTION public.transfer_branch_stock_batch(
  p_from_branch_id uuid,
  p_to_branch_id   uuid,
  p_items          jsonb,   -- [{product_id, quantity, from_seller_id?}, ...]
  p_date           timestamptz DEFAULT NULL,
  p_notes          text DEFAULT NULL
) RETURNS SETOF public.stock_transfers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $transfer_branch_stock_batch$
DECLARE
  v_batch uuid := gen_random_uuid();
  v_item  jsonb;
  v_count integer;
  v_row   public.stock_transfers;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'itens_invalidos';
  END IF;

  v_count := jsonb_array_length(p_items);

  IF v_count = 0 THEN
    RAISE EXCEPTION 'itens_invalidos';
  END IF;

  -- Teto de estrago por requisição, como os do `create_pending_order`: uma
  -- viagem de verdade não leva 60 sabores diferentes, e o laço trava linha de
  -- estoque a cada volta.
  IF v_count > 60 THEN
    RAISE EXCEPTION 'itens_demais';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    BEGIN
      v_row := public.transfer_branch_stock(
        (v_item->>'product_id')::uuid,
        p_from_branch_id,
        p_to_branch_id,
        (v_item->>'quantity')::integer,
        p_date,
        p_notes,
        nullif(v_item->>'from_seller_id', '')::uuid,
        v_batch
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION '%@%', SQLERRM, COALESCE(v_item->>'product_id', '');
    END;

    RETURN NEXT v_row;
  END LOOP;
END;
$transfer_branch_stock_batch$;

REVOKE ALL ON FUNCTION public.transfer_branch_stock_batch(uuid, uuid, jsonb, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_branch_stock_batch(uuid, uuid, jsonb, timestamptz, text) TO authenticated;
