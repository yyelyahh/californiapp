-- ============================================================
-- Transferência de estoque entre filiais
-- ------------------------------------------------------------
-- A unidade muda de cidade. Não é venda, não é perda, não é compra — e não é
-- a "Movimentação de estoque" da Distribuição, que é consignação: aquela mexe
-- em `product_assignments` (o que está NA MÃO de um vendedor) e não tira nada
-- da loja. Esta tira de uma cidade e põe em outra.
--
-- POR QUE TABELA PRÓPRIA, e não duas linhas em `stock_entries`. O razão lê
-- `stock_entries` como 'stock_purchase', com cash_delta = -total_cost e
-- inventory_delta = +total_cost. Uma transferência não gasta caixa nenhum e
-- não cria estoque nenhum: as mesmas unidades trocam de prateleira. Lançada
-- ali, ela inventaria uma saída de caixa que não houve e contaria o estoque
-- duas vezes.
--
-- Pelo mesmo motivo ela NÃO ENTRA em `financial_events`. O razão é do negócio
-- inteiro, e do ponto de vista dele nada aconteceu — nem no caixa, nem no
-- valor do estoque, nem no lucro. Um par de linhas que se anulam seria ruído
-- com efeito zero. Quando "resultado por cidade" existir (a view já carrega
-- branch_id para isso), esta tabela é o que vai explicar a diferença.
--
-- O CUSTO VIAJA COM A UNIDADE. `product_branch.purchase_price` da cidade de
-- destino passa a ser o da origem, seguindo a convenção que já vale em todo
-- lugar: o custo é o do último lote que chegou (`addStockEntry` e o
-- recebimento de compra fazem exatamente isso). Aqui ela não é só convenção,
-- é o que mantém o razão honesto: o estoque entrou no balanço pelo custo pago
-- na origem, então o CPV da venda futura no destino tem que sair por esse
-- mesmo custo. Deixar o custo velho do destino faria a mesma unidade entrar
-- por um valor e sair por outro.
--
-- O PREÇO DE VENDA NÃO VIAJA. Preço é decisão da cidade — é a razão de existir
-- do preço por filial. Ele só é semeado quando a linha de `product_branch` do
-- destino ainda não existe (aquela cidade não vendia o sabor), e aí o preço da
-- origem é o único palpite honesto disponível: zero venderia de graça. O
-- mesmo vale para o estoque mínimo.
--
-- NÃO HÁ EXCLUSÃO. Transferência errada se conserta com uma transferência de
-- volta, não apagando a primeira. Dois motivos: o histórico fica contando o
-- que de fato aconteceu com a caixa (é o que um depósito faz), e apagar seria
-- impossível de honrar quando o destino já vendeu as unidades — o estorno não
-- teria de onde tirar. É a mesma razão pela qual "Compra #N" é posição e não
-- identidade: o que já aconteceu não se reescreve.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.stock_transfers (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id     uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  from_branch_id uuid NOT NULL REFERENCES public.branches(id),
  to_branch_id   uuid NOT NULL REFERENCES public.branches(id),
  quantity       integer NOT NULL CHECK (quantity > 0),
  -- O custo com que a unidade saiu da origem. Copiado no momento da
  -- transferência, e não lido depois: é o que permite reconstruir a conta
  -- quando o custo da origem mudar no lote seguinte.
  unit_cost      numeric NOT NULL DEFAULT 0,
  date           timestamptz NOT NULL DEFAULT now(),
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_transfers_filiais_distintas CHECK (from_branch_id <> to_branch_id)
);

COMMENT ON TABLE public.stock_transfers IS
  'Unidades que mudaram de cidade. Fora do razão de propósito: não mexe em caixa nem no valor total do estoque.';

CREATE INDEX IF NOT EXISTS stock_transfers_from_idx ON public.stock_transfers (from_branch_id, date DESC);
CREATE INDEX IF NOT EXISTS stock_transfers_to_idx   ON public.stock_transfers (to_branch_id, date DESC);

ALTER TABLE public.stock_transfers ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.stock_transfers FROM anon, public;
GRANT SELECT ON public.stock_transfers TO authenticated;
GRANT ALL ON public.stock_transfers TO service_role;

-- Ninguém INSERE por aqui: a escrita passa pela function abaixo, que é quem
-- debita e credita na mesma transação. Sem o GRANT de INSERT, um caminho novo
-- que esqueça a function não consegue gravar meia transferência.
--
-- Na LEITURA basta alcançar UMA das pontas: quem administra só Curitiba
-- precisa ver a carga que chegou de São Paulo — esconder a origem de quem
-- recebeu a mercadoria seria esconder exatamente a explicação do estoque
-- dele. O nome da outra filial ele não vê (a RLS de `branches` cuida disso),
-- e a tela cai no id curto, como já faz com produto excluído.
DROP POLICY IF EXISTS "Admins read stock_transfers" ON public.stock_transfers;
CREATE POLICY "Admins read stock_transfers" ON public.stock_transfers FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    AND (
      from_branch_id IN (SELECT public.my_branch_ids())
      OR to_branch_id IN (SELECT public.my_branch_ids())
    )
  );


-- ------------------------------------------------------------
-- A transferência, atômica
-- ------------------------------------------------------------
-- Três escritas que não podem existir separadas: debitar a origem, creditar o
-- destino e registrar o movimento. Feito no cliente, um erro de rede no meio
-- deixaria unidade sumida ou duplicada — a mesma razão pela qual venda passa
-- por `create_sale`.
--
-- O débito é um UPDATE CONDICIONAL (`stock >= p_quantity`), não um SELECT
-- seguido de UPDATE: a checagem acontece no instante exato da escrita, e é
-- isso que fecha a janela de corrida com uma venda simultânea na origem.
CREATE OR REPLACE FUNCTION public.transfer_branch_stock(
  p_product_id     uuid,
  p_from_branch_id uuid,
  p_to_branch_id   uuid,
  p_quantity       integer,
  p_date           timestamptz DEFAULT NULL,
  p_notes          text DEFAULT NULL
) RETURNS public.stock_transfers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $transfer_branch_stock$
DECLARE
  v_origem public.product_branch;
  v_row    public.stock_transfers;
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

  -- As DUAS pontas precisam ser alcançáveis para ESCREVER. Ler uma carga que
  -- chegou é uma coisa; tirar estoque de uma cidade que não é sua é outra.
  IF NOT EXISTS (SELECT 1 FROM public.my_branch_ids() b WHERE b = p_from_branch_id)
     OR NOT EXISTS (SELECT 1 FROM public.my_branch_ids() b WHERE b = p_to_branch_id) THEN
    RAISE EXCEPTION 'nao_autorizado';
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

  -- ---- Entra no destino ----
  -- `product_branch` é esparsa: a cidade de destino pode não vender esse sabor
  -- ainda, e aí a linha nasce aqui. No INSERT o preço e o mínimo da origem
  -- servem de semente; no conflito (a linha já existe) só estoque e custo
  -- mudam — preço e mínimo são decisão de quem vende ali.
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

  -- ---- Fica registrado ----
  INSERT INTO public.stock_transfers (
    product_id, from_branch_id, to_branch_id, quantity, unit_cost, date, notes
  )
  VALUES (
    p_product_id, p_from_branch_id, p_to_branch_id, p_quantity,
    v_origem.purchase_price, COALESCE(p_date, now()),
    nullif(btrim(left(btrim(COALESCE(p_notes, '')), 200)), '')
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$transfer_branch_stock$;

REVOKE ALL ON FUNCTION public.transfer_branch_stock(uuid, uuid, uuid, integer, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_branch_stock(uuid, uuid, uuid, integer, timestamptz, text) TO authenticated;


-- ------------------------------------------------------------
-- Auditoria
-- ------------------------------------------------------------
-- Mover estoque entre cidades é movimento de dinheiro em forma de mercadoria:
-- entra na auditoria como todas as outras. O gatilho é o mesmo de sempre — a
-- lista canônica de tabelas auditadas mora no DO block da 20260914181553.
DROP TRIGGER IF EXISTS audit_stock_transfers ON public.stock_transfers;
CREATE TRIGGER audit_stock_transfers
  AFTER INSERT OR UPDATE OR DELETE ON public.stock_transfers
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
