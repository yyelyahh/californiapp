-- ============================================================
-- A auditoria passa a guardar o valor ANTERIOR
-- ------------------------------------------------------------
-- CUIDADO COM O NÚMERO DESTE ARQUIVO. Ele precisa vir DEPOIS da
-- 20260914181553, que é onde a auditoria nasce (tabela, gatilho e a
-- primeira versão de audit_row_change). Como aquela migration termina num
-- CREATE OR REPLACE da mesma função, um arquivo numerado antes dela seria
-- desfeito em todo banco novo: a coluna old_data existiria e nunca seria
-- preenchida, sem erro nenhum para denunciar. Já esteve numerado como
-- 20260914160000 e foi renomeado por isso.
--
-- A migration anterior gravava `row_data` (a linha como ficou) e
-- `changed_fields` (quais colunas mudaram). Isso responde "o preço agora
-- é R$ 30,00", mas não responde a pergunta que se faz olhando um log de
-- auditoria: "era quanto antes?". Sem o valor antigo, a tela só consegue
-- dizer que alguém mexeu no preço — e "mexeu no preço" é exatamente o
-- tipo de frase que obriga a abrir o WhatsApp e perguntar.
--
-- Dá para reconstruir o valor anterior lendo o registro ANTERIOR da mesma
-- linha, mas só quando ele existe: a primeira alteração de cada produto
-- ficaria para sempre sem o "de quanto". Uma coluna resolve de vez.
--
-- É seguro aplicar agora e caro aplicar depois: o log ainda está vazio
-- (nada escreveu desde a migration anterior), então não há histórico para
-- ficar pela metade. Daqui a um mês, metade das linhas teria o antes e a
-- outra metade não, e a tela precisaria explicar isso na cara do usuário.
--
-- Só UPDATE preenche `old_data`. Em INSERT não existe "antes", e em
-- DELETE o "antes" já é o próprio `row_data` — duplicar ali seria guardar
-- a mesma linha duas vezes em toda exclusão.
-- ============================================================

ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS old_data jsonb;

COMMENT ON COLUMN public.audit_log.old_data IS
  'A linha como estava ANTES do update. Nula em insert (não existia) e em delete (o antes é o row_data).';

-- Mesma assinatura de antes, então CREATE OR REPLACE basta — não é o caso
-- do DROP FUNCTION que mudança de retorno ou de parâmetro exige.
CREATE OR REPLACE FUNCTION public.audit_row_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $audit_row_change$
DECLARE
  v_actor   uuid := auth.uid();
  v_email   text;
  v_name    text;
  v_source  text;
  v_old     jsonb;
  v_data    jsonb;
  v_changed text[];
  v_id      text;
BEGIN
  -- O papel do JWT da requisição. Sem JWT (SQL Editor, psql, job) o
  -- current_setting devolve vazio e a escrita é marcada como 'sql' —
  -- ação sem dono, mas com origem declarada, que é o que importa quando
  -- alguém mexe por fora do app.
  v_source := COALESCE(
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    'sql'
  );

  IF TG_OP = 'DELETE' THEN
    v_data := to_jsonb(OLD);
  ELSE
    v_data := to_jsonb(NEW);
  END IF;

  IF TG_OP = 'UPDATE' THEN
    v_old := to_jsonb(OLD);
    SELECT array_agg(e.col ORDER BY e.col)
      INTO v_changed
      FROM jsonb_each(v_data) AS e(col, val)
     WHERE v_old -> e.col IS DISTINCT FROM e.val;

    -- Update que não mudou nada não é evento. Várias telas reenviam a
    -- linha inteira ao salvar, e sem esta saída o log encheria de
    -- "alterou" que não alterou coisa nenhuma.
    IF v_changed IS NULL THEN
      RETURN NULL;
    END IF;

    -- Só o que mudou. Guardar a linha antiga INTEIRA dobraria o tamanho
    -- do log para repetir, em toda alteração, dez colunas que ficaram
    -- iguais — e a tela leria do mesmo jeito, porque ela só pergunta
    -- pelo antes das colunas que estão em changed_fields.
    SELECT jsonb_object_agg(k, v_old -> k)
      INTO v_old
      FROM unnest(v_changed) AS k;
  ELSE
    v_old := NULL;
  END IF;

  IF v_actor IS NOT NULL THEN
    -- O e-mail é COPIADO, não referenciado: se a conta for removida
    -- depois, o log continua dizendo quem foi. A exceção existe porque
    -- auditoria não pode derrubar venda — se a leitura de auth.users
    -- falhar, o registro sai sem e-mail, mas sai.
    BEGIN
      SELECT u.email INTO v_email FROM auth.users u WHERE u.id = v_actor;
    EXCEPTION WHEN OTHERS THEN
      v_email := NULL;
    END;

    SELECT s.name INTO v_name FROM public.sellers s WHERE s.user_id = v_actor;
  END IF;

  -- Todas as tabelas auditadas têm id uuid. A checagem de formato é o
  -- seguro para o dia em que uma tabela de id diferente entrar na lista:
  -- o log perde o entity_id daquela linha em vez de abortar a escrita
  -- que ele deveria apenas observar.
  v_id := v_data ->> 'id';
  IF v_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    v_id := NULL;
  END IF;

  INSERT INTO public.audit_log (
    actor_id, actor_email, actor_name, actor_source,
    action, entity, entity_id, changed_fields, row_data, old_data
  )
  VALUES (
    v_actor, v_email, v_name, v_source,
    lower(TG_OP), TG_TABLE_NAME, v_id::uuid, v_changed, v_data, v_old
  );

  RETURN NULL;  -- AFTER trigger: o retorno é ignorado
END;
$audit_row_change$;

-- Teste de fumaça, sem deixar rastro (o ROLLBACK derruba as duas coisas):
--
--   BEGIN;
--     UPDATE public.products SET sale_price = sale_price + 1
--      WHERE id = (SELECT id FROM public.products ORDER BY created_at LIMIT 1);
--     SELECT changed_fields, old_data, row_data -> 'sale_price' AS agora
--       FROM public.audit_log ORDER BY at DESC LIMIT 1;
--   ROLLBACK;
--
-- Esperado: changed_fields = {sale_price}, old_data = {"sale_price": <o
-- valor de antes>}, agora = <o valor de antes + 1>.
