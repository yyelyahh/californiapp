-- ============================================================
-- Modelos arquivados: o que saiu de linha some das listas
-- ------------------------------------------------------------
-- Modelo que o fornecedor parou de trazer, ou que ninguém pede mais, continua
-- para sempre em toda lista de escolha da operação — no seletor da Entrada, nos
-- diálogos de preço e de mínimo, na lista de Produtos. Ele não pode ser
-- EXCLUÍDO: `deleteProduct` apaga a linha de `products`, e a linha de products é
-- o que dá nome a toda venda, entrada e perda do passado. Arquivar é a terceira
-- opção que faltava — a identidade fica, a oferta some.
--
-- É POR MODELO (marca + modelo), não por sabor. Sabor a sabor não existe decisão
-- de descontinuar: quem sai de linha é o modelo inteiro, e é por marca+modelo
-- que o resto do sistema já agrupa (o estoque na tela de Produtos, o "Repor
-- agora" do Dashboard, a foto em `product_model_images`). A chave normalizada
-- (sem caixa, sem sobra de espaço) é a mesma escolha da `set_model_image`, pelo
-- mesmo motivo: marca e modelo são texto digitado, e "elfbar" tem que encontrar
-- "Elfbar" — senão arquivar não alcança o que a pessoa vê na tela.
--
-- É POR FILIAL. O catálogo é compartilhado, mas sair de linha não é: Curitiba
-- pode ter parado de pedir o que São Paulo ainda vende toda semana. Por isso a
-- filial está na chave, e não existe "arquivar na rede" — são duas decisões.
-- Em "Todas as filiais" a tela só esconde o que está arquivado nas DUAS, porque
-- ali ela mostra a soma: esconder o que uma cidade ainda vende seria apagar
-- estoque vivo da lista consolidada.
--
-- SÓ COM ESTOQUE ZERO, e o gatilho é quem garante. Arquivar um modelo que ainda
-- tem unidades esconderia as unidades: elas sumiriam do seletor da venda, da
-- perda e da transferência, e continuariam somando no valor do estoque a custo —
-- dinheiro na tela sem linha que o explique. Com estoque zero nada disso existe,
-- e a loja pública não precisa mudar uma linha sequer: ela monta o catálogo a
-- partir da ATRIBUIÇÃO, que não passa do estoque, que é zero. A regra mora aqui
-- e não no cliente porque regra que mora só no cliente não existe para quem
-- chega pelo PostgREST — mesma escolha do `validate_assignment_fits_stock`.
--
-- DESARQUIVAR É APAGAR A LINHA. Não há coluna de "ativo": a ausência é o estado
-- normal, e um DELETE não deixa lixo acumulado de modelo que voltou. Quem
-- guarda o histórico de quem arquivou e quando é a auditoria, como em toda
-- tabela de estoque e de dinheiro.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.archived_models (
  branch_id   uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  -- Como está escrito no cadastro — é o que a tela mostra na lista de
  -- arquivados, inclusive quando o último sabor daquele modelo for excluído.
  brand       text NOT NULL,
  model       text NOT NULL,
  -- A chave de verdade. Preenchida pelo gatilho a partir das duas de cima, para
  -- não haver como gravar uma chave que não corresponde ao texto.
  brand_key   text NOT NULL,
  model_key   text NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (branch_id, brand_key, model_key)
);

COMMENT ON TABLE public.archived_models IS
  'Modelos fora de linha, por filial. Só entra com estoque zero; some das listas de escolha, nunca do histórico.';

ALTER TABLE public.archived_models ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.archived_models FROM anon, public;
-- Sem UPDATE: não há o que editar numa linha que só afirma "este modelo saiu de
-- linha aqui". Voltar atrás é apagar.
GRANT SELECT, INSERT, DELETE ON public.archived_models TO authenticated;
GRANT ALL ON public.archived_models TO service_role;

DROP POLICY IF EXISTS "Admins manage archived_models" ON public.archived_models;
CREATE POLICY "Admins manage archived_models" ON public.archived_models FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    AND branch_id IN (SELECT public.my_branch_ids())
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    AND branch_id IN (SELECT public.my_branch_ids())
  );


-- ------------------------------------------------------------
-- A regra: chave normalizada, e estoque zero
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.archived_model_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $archived_model_guard$
DECLARE
  v_stock integer;
BEGIN
  NEW.brand     := btrim(COALESCE(NEW.brand, ''));
  NEW.model     := btrim(COALESCE(NEW.model, ''));
  NEW.brand_key := lower(NEW.brand);
  NEW.model_key := lower(NEW.model);

  IF NEW.brand_key = '' OR NEW.model_key = '' THEN
    RAISE EXCEPTION 'modelo_invalido';
  END IF;

  -- O estoque daquele modelo NAQUELA filial, somando os sabores. `product_branch`
  -- é esparsa: sabor sem linha na cidade não soma nada, que é o certo.
  SELECT COALESCE(SUM(pb.stock), 0) INTO v_stock
    FROM public.product_branch pb
    JOIN public.products p ON p.id = pb.product_id
   WHERE pb.branch_id = NEW.branch_id
     AND lower(btrim(p.brand)) = NEW.brand_key
     AND lower(btrim(COALESCE(p.model, ''))) = NEW.model_key;

  IF v_stock > 0 THEN
    -- O número E o modelo vão junto do código: a tela arquiva em LOTE, e num
    -- lote de dez "ainda tem estoque" sem dizer qual não diria o que fazer.
    -- Mesma solução da `transfer_branch_stock_batch`.
    RAISE EXCEPTION 'modelo_com_estoque:%@% %', v_stock, NEW.brand, NEW.model;
  END IF;

  RETURN NEW;
END;
$archived_model_guard$;

DROP TRIGGER IF EXISTS archived_models_guard ON public.archived_models;
CREATE TRIGGER archived_models_guard
  BEFORE INSERT ON public.archived_models
  FOR EACH ROW EXECUTE FUNCTION public.archived_model_guard();


-- ------------------------------------------------------------
-- Auditoria
-- ------------------------------------------------------------
-- Mesmo gatilho genérico das outras tabelas de estoque: quem arquivou e quando
-- é pergunta que se faz quando um modelo some da lista de alguém.
DROP TRIGGER IF EXISTS audit_archived_models ON public.archived_models;
CREATE TRIGGER audit_archived_models
  AFTER INSERT OR UPDATE OR DELETE ON public.archived_models
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
