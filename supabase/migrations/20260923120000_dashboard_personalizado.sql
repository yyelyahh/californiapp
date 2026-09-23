-- ============================================================
-- Dashboard personalizado: cada pessoa monta a própria tela
-- ------------------------------------------------------------
-- O layout (quais blocos aparecem, em que ordem, na coluna ou no trilho, e o
-- tamanho de cada um no modo de cards) é PREFERÊNCIA DE QUEM USA, não dado do
-- negócio. Por isso:
--
-- * Uma linha por usuário, e só a própria pessoa lê e escreve a sua. Não há
--   leitura de admin: o layout de outra pessoa não responde pergunta nenhuma.
-- * Mora no banco e não só no navegador para seguir a pessoa entre aparelhos —
--   monta-se no notebook e o celular abre igual. O navegador guarda uma cópia
--   só para a tela não piscar o layout padrão enquanto o banco responde.
-- * NÃO entra na auditoria: arrastar um card não é escrita de dinheiro,
--   estoque nem permissão, e cada ajuste viraria linha no log.
-- * FK para auth.users COM cascade, ao contrário do audit_log: preferência de
--   uma conta apagada não tem para quem servir.
--
-- O conteúdo de `layout` é validado no FRONT (normalizeLayout, em
-- src/lib/dashboard-layout.ts): jsonb gravado por uma versão antiga do app é
-- lido com o que ainda vale e o resto volta ao padrão. O banco só segura o
-- tamanho, para a coluna não virar depósito de qualquer coisa.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.dashboard_layouts (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  layout     jsonb NOT NULL CHECK (jsonb_typeof(layout) = 'object' AND pg_column_size(layout) < 16384),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.dashboard_layouts IS
  'Layout do Dashboard de cada usuário (blocos, ordem, modo vertical/cards). Preferência, não dado do negócio.';

ALTER TABLE public.dashboard_layouts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.dashboard_layouts FROM anon, public;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dashboard_layouts TO authenticated;

DROP POLICY IF EXISTS "Users manage own dashboard layout" ON public.dashboard_layouts;
CREATE POLICY "Users manage own dashboard layout" ON public.dashboard_layouts
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ------------------------------------------------------------
-- Para devolver alguém ao layout padrão pelo SQL Editor:
--
--   DELETE FROM public.dashboard_layouts
--    WHERE user_id = (SELECT id FROM auth.users WHERE email = '<email>');
--
-- Pela tela, é o "Restaurar padrão" do painel Personalizar.
-- ------------------------------------------------------------
