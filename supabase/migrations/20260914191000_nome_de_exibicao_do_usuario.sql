-- ============================================================
-- Nome de exibição: como a auditoria chama cada pessoa
-- ------------------------------------------------------------
-- A tela vinha mostrando "gabi0csr", os caracteres antes do @, porque era
-- o melhor que existia: o gatilho copia `actor_name` de `sellers.name`, e
-- admin não é vendedor — aquela coluna nasce nula para quem administra.
--
-- Por que uma tabela e não um campo copiado no log:
-- `actor_email` é copiado de propósito, para o registro sobreviver à conta
-- apagada — é a IDENTIDADE, e identidade não se reescreve. Nome de
-- exibição é RÓTULO, e rótulo se resolve na leitura: assim trocar o nome
-- conserta a tela inteira de uma vez, inclusive o que já está gravado, sem
-- encostar numa linha sequer do `audit_log`. Um log que precisa ser
-- reescrito para mostrar o nome certo é um log que se aprendeu a reescrever.
--
-- O gatilho de auditoria NÃO muda com isto, e essa é metade da graça: o
-- caminho de escrita — o que roda dentro de toda venda — fica exatamente
-- como está. Quem passa a consultar esta tabela é só a tela.
--
-- Atalho tentador que não se deve usar: cadastrar o admin em `sellers` só
-- para o nome aparecer. Funcionaria hoje, sem migration nenhuma, e traria
-- um vendedor fantasma para a Distribuição, para os rateios de comissão e
-- para toda lista de vendedor do app.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.user_display_names (
  -- Sem FK para auth.users, pelo mesmo motivo do audit_log: apagar a conta
  -- não pode apagar o nome de quem aparece no histórico. O jeito seguro de
  -- preencher está no rodapé — um INSERT ... SELECT que pega o id do
  -- próprio auth.users, onde não há uuid para digitar errado.
  user_id    uuid PRIMARY KEY,
  name       text NOT NULL CHECK (btrim(name) <> ''),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.user_display_names IS
  'Como cada usuário é chamado na tela de Auditoria. Rótulo resolvido na leitura — trocar aqui muda o histórico inteiro.';

ALTER TABLE public.user_display_names ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.user_display_names FROM anon, public;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_display_names TO authenticated;

-- Só admin, como a própria auditoria: quem não pode ver o log não tem o que
-- fazer com a lista de quem aparece nele.
DROP POLICY IF EXISTS "Admins manage user_display_names" ON public.user_display_names;
CREATE POLICY "Admins manage user_display_names" ON public.user_display_names
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Trocar o nome pelo qual alguém aparece no histórico é, ele próprio, um
-- movimento que o histórico deve guardar. Mesmo gatilho de todas as outras.
DROP TRIGGER IF EXISTS audit_user_display_names ON public.user_display_names;
CREATE TRIGGER audit_user_display_names
  AFTER INSERT OR UPDATE OR DELETE ON public.user_display_names
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();

-- ------------------------------------------------------------
-- Como usar
-- ------------------------------------------------------------
-- 1. Veja quem existe:
--
--      SELECT id, email, created_at FROM auth.users ORDER BY created_at;
--
-- 2. Dê o nome (pelo e-mail, para não copiar uuid na mão). Rodar de novo
--    com outro nome apenas troca — e a tela toda, passado incluído, passa
--    a mostrar o novo:
--
--      INSERT INTO public.user_display_names (user_id, name)
--      SELECT id, 'Gabi' FROM auth.users WHERE email = 'gabi0csr@gmail.com'
--      ON CONFLICT (user_id) DO UPDATE
--        SET name = EXCLUDED.name, updated_at = now();
--
-- 3. Para voltar ao e-mail, apague a linha:
--
--      DELETE FROM public.user_display_names
--       WHERE user_id = (SELECT id FROM auth.users WHERE email = 'gabi0csr@gmail.com');
