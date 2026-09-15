-- ============================================================
-- Filiais, fase 1: as filiais existem e o acesso é nominal
-- ------------------------------------------------------------
-- Esta migration NÃO muda nenhuma tela. Depois de aplicada o app continua
-- exatamente como está: ninguém lê `branches`, ninguém lê `sellers.branch_id`.
-- Ela existe para que a fase 2 (o corte de verdade — preço e estoque por
-- filial) encontre o terreno pronto, e para que o acesso já esteja escrito
-- ANTES de existir algo a esconder.
--
-- A regra que carrega o desenho inteiro: SEM LINHA EM `user_branches`, SEM
-- ACESSO. A alternativa — "sem linha = vê tudo" — falha em silêncio e falha
-- do lado errado: o sócio abriria o ERP e veria os números da outra cidade
-- sem que nada acusasse. Aqui a falha é alta e barulhenta: quem ficou sem
-- linha não vê nada e reclama no primeiro minuto. Por isso o dono recebe as
-- linhas dele na MESMA transação que cria as filiais, logo abaixo.
--
-- A filial tem DUAS ÂNCORAS, não uma coluna em toda tabela:
--   * `branch_id` próprio só onde não há vendedor de quem derivar
--     (`sales`, `stock_entries`, `stock_losses`, `expenses`, `sellers`);
--   * tudo que é coisa de vendedor (`product_assignments`, `orders`,
--     `commission_payments`, …) herda de `sellers.branch_id` pelo mesmo
--     `EXISTS` que `order_items` e `customers` já usam.
-- São 5 colunas e 3 tabelas novas, não 15 colunas que podem divergir.
--
-- Consequência assumida: TROCAR UM VENDEDOR DE FILIAL NÃO É SUPORTADO. As
-- tabelas dele herdam a filial pela linha em `sellers`, então mudar
-- `sellers.branch_id` reescreveria o passado — a venda de janeiro na cidade A
-- passaria a contar na cidade B. Quem muda de cidade ganha cadastro novo.
-- ============================================================


-- ------------------------------------------------------------
-- ⬇⬇⬇ PREENCHER ANTES DE APLICAR ⬇⬇⬇
-- ------------------------------------------------------------
-- Os nomes das duas cidades. Enquanto não vierem, nascem 'Matriz' e
-- 'Filial 2' — trocar depois é um UPDATE numa linha, sem efeito em mais
-- nada: o resto do sistema só conhece o uuid (passo 1 do rodapé).
--
-- A PRIMEIRA da lista é a MATRIZ: é para ela que todo o histórico existente
-- (produtos, vendas, entradas, perdas, despesas, vendedores) é carimbado no
-- backfill. Não inverta a ordem depois de aplicar.
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.branches (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL CHECK (btrim(name) <> ''),
  -- Filial desativada continua existindo: o histórico dela não pode sumir.
  -- `active` é só o que aparece no switch do topo do ERP.
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.branches IS
  'Cidades onde a operação acontece. Semeadas por migration — não há tela de gestão. A mais antiga (created_at) é a matriz.';

-- `clock_timestamp()` e não o default `now()`: dentro de uma transação
-- `now()` é o MESMO instante em todas as linhas, e a matriz deixaria de ser
-- reconhecível por "a mais antiga". O relógio de parede anda entre os dois
-- INSERTs e dá a ordem estável que o backfill e o switch da tela leem.
INSERT INTO public.branches (name, created_at)
SELECT 'Matriz', clock_timestamp()
 WHERE NOT EXISTS (SELECT 1 FROM public.branches);

INSERT INTO public.branches (name, created_at)
SELECT 'Filial 2', clock_timestamp()
 WHERE (SELECT count(*) FROM public.branches) = 1;


-- ------------------------------------------------------------
-- Quem alcança qual filial
-- ------------------------------------------------------------
-- Sem FK para auth.users, pelo mesmo motivo do audit_log e do
-- user_display_names: apagar a conta não pode apagar o registro de acesso
-- que o histórico explica. O modelo de INSERT está no rodapé.
CREATE TABLE IF NOT EXISTS public.user_branches (
  user_id    uuid NOT NULL,
  branch_id  uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, branch_id)
);

COMMENT ON TABLE public.user_branches IS
  'Acesso nominal por filial. Sem linha aqui, sem acesso — a falha é alta e barulhenta de propósito.';


-- ------------------------------------------------------------
-- O vendedor pertence a uma filial
-- ------------------------------------------------------------
-- Nulável, backfill, NOT NULL: a ordem de sempre para coluna obrigatória em
-- tabela que já tem linha.
--
-- Este bloco vem ANTES da `my_branch_ids()` e a ordem é obrigatória: o corpo
-- de uma function SQL é validado no CREATE (check_function_bodies), e aquela
-- function lê `sellers.branch_id`. Com a coluna criada depois, o arquivo morre
-- em `column s.branch_id does not exist` — o mesmo tropeço que a
-- `product_model_images` já deu na 20260909140000, e pelo mesmo motivo.
ALTER TABLE public.sellers
  ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id);

UPDATE public.sellers
   SET branch_id = (SELECT id FROM public.branches ORDER BY created_at LIMIT 1)
 WHERE branch_id IS NULL;

ALTER TABLE public.sellers ALTER COLUMN branch_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS sellers_branch_idx ON public.sellers (branch_id);

COMMENT ON COLUMN public.sellers.branch_id IS
  'A cidade do vendedor. Âncora de TUDO que é dele (atribuições, pedidos, comissões) — por isso não se troca: crie outro cadastro.';


-- ------------------------------------------------------------
-- my_branch_ids(): a única fonte de "o que eu alcanço"
-- ------------------------------------------------------------
-- No molde do get_my_seller_id(): STABLE, SET search_path, uma linha de SQL.
--
-- A UNION com `sellers` é o que dispensa o vendedor de ter linha em
-- `user_branches`: a filial dele já está no cadastro, e duas fontes de
-- verdade para o mesmo fato divergiriam no dia em que uma fosse esquecida.
--
-- SECURITY DEFINER aqui é obrigatório, e não estilo: esta função é chamada
-- DENTRO das policies de `sellers`. Como INVOKER, ler `sellers` para decidir
-- quem pode ler `sellers` seria recursão. Rodando como dona, ela passa por
-- baixo da RLS e a pergunta tem resposta.
CREATE OR REPLACE FUNCTION public.my_branch_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $my_branch_ids$
  SELECT ub.branch_id
    FROM public.user_branches ub
   WHERE ub.user_id = auth.uid()
  UNION
  SELECT s.branch_id
    FROM public.sellers s
   WHERE s.user_id = auth.uid()
     AND s.branch_id IS NOT NULL;
$my_branch_ids$;

REVOKE ALL ON FUNCTION public.my_branch_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_branch_ids() TO authenticated;


-- ------------------------------------------------------------
-- Leitura das duas tabelas novas
-- ------------------------------------------------------------
-- Escrita não é dada a ninguém: filial é semeada por migration, e acesso é
-- concedido pelo SQL Editor (o rodapé mostra como). Mesma escolha do
-- audit_log — o que o app não precisa escrever, o app não pode escrever.
ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_branches ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.branches FROM anon, authenticated, public;
REVOKE ALL ON public.user_branches FROM anon, authenticated, public;
GRANT SELECT ON public.branches TO authenticated;
GRANT SELECT ON public.user_branches TO authenticated;
GRANT ALL ON public.branches TO service_role;
GRANT ALL ON public.user_branches TO service_role;

-- O front lê `branches` sem filtro nenhum no cliente e confia nisto: só
-- chega o que a pessoa alcança. É o que faz a lista do switch nascer certa
-- para o sócio sem uma linha de código a mais.
DROP POLICY IF EXISTS "Read own branches" ON public.branches;
CREATE POLICY "Read own branches" ON public.branches FOR SELECT TO authenticated
  USING (id IN (SELECT public.my_branch_ids()));

DROP POLICY IF EXISTS "Read own branch access" ON public.user_branches;
CREATE POLICY "Read own branch access" ON public.user_branches FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));


-- ------------------------------------------------------------
-- O dono recebe as duas filiais AGORA, na mesma transação
-- ------------------------------------------------------------
-- Sem isto ele sai desta migration sem acesso a nada — inclusive sem acesso
-- para se conceder acesso pela tela. Todo admin existente hoje recebe todas
-- as filiais.
--
-- ATENÇÃO ao dia em que o sócio virar admin: ele NÃO pode passar por aqui.
-- Esta migration roda uma vez só, então quem for promovido depois entra pelo
-- rodapé — e entra com UMA linha, a da cidade dele.
INSERT INTO public.user_branches (user_id, branch_id)
SELECT ur.user_id, b.id
  FROM public.user_roles ur
 CROSS JOIN public.branches b
 WHERE ur.role = 'admin'
ON CONFLICT (user_id, branch_id) DO NOTHING;


-- ------------------------------------------------------------
-- As duas tabelas novas entram na auditoria
-- ------------------------------------------------------------
-- A lista canônica de tabelas auditadas mora no DO block da
-- 20260914181553. Aqui só penduramos o gatilho nas duas que nasceram agora,
-- com o mesmo padrão — quem criar tabela auditada depois faz igual.
--
-- Conceder acesso a uma filial é exatamente o tipo de movimento que a
-- auditoria existe para guardar, ainda que só aconteça pelo SQL Editor
-- (onde o gatilho grava actor_source = 'sql').
DO $audit_branches$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['branches', 'user_branches'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS audit_%1$s ON public.%1$I', t);
    EXECUTE format(
      'CREATE TRIGGER audit_%1$s AFTER INSERT OR UPDATE OR DELETE ON public.%1$I '
      'FOR EACH ROW EXECUTE FUNCTION public.audit_row_change()', t
    );
  END LOOP;
END $audit_branches$;


-- ------------------------------------------------------------
-- Como usar (SQL Editor)
-- ------------------------------------------------------------
-- 1. Dê nome às cidades (o uuid não muda, nada mais precisa ser tocado):
--
--      UPDATE public.branches SET name = 'São Paulo'
--       WHERE id = (SELECT id FROM public.branches ORDER BY created_at LIMIT 1);
--
--      UPDATE public.branches SET name = 'Curitiba'
--       WHERE id = (SELECT id FROM public.branches ORDER BY created_at OFFSET 1 LIMIT 1);
--
-- 2. Dê acesso a alguém — pelo e-mail e pelo nome da filial, para não copiar
--    uuid na mão. UMA linha por cidade que a pessoa pode ver:
--
--      INSERT INTO public.user_branches (user_id, branch_id)
--      SELECT u.id, b.id
--        FROM auth.users u, public.branches b
--       WHERE u.email = 'socio@exemplo.com'
--         AND b.name  = 'Curitiba'
--      ON CONFLICT (user_id, branch_id) DO NOTHING;
--
-- 3. Tirar o acesso:
--
--      DELETE FROM public.user_branches
--       WHERE user_id = (SELECT id FROM auth.users WHERE email = 'socio@exemplo.com')
--         AND branch_id = (SELECT id FROM public.branches WHERE name = 'Curitiba');
--
-- 4. Conferir quem alcança o quê:
--
--      SELECT u.email, b.name
--        FROM public.user_branches ub
--        JOIN auth.users u      ON u.id = ub.user_id
--        JOIN public.branches b ON b.id = ub.branch_id
--       ORDER BY u.email, b.name;
--
--    Vendedor não aparece nessa lista e está certo: a filial dele sai de
--    `sellers.branch_id`, e é a `my_branch_ids()` que junta as duas fontes.
