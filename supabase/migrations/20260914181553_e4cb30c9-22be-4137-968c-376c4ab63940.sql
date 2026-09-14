CREATE TABLE IF NOT EXISTS public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  at timestamptz NOT NULL DEFAULT now(),
  tx bigint NOT NULL DEFAULT txid_current(),
  actor_id uuid,
  actor_email text,
  actor_name text,
  actor_source text NOT NULL,
  action text NOT NULL CHECK (action IN ('insert', 'update', 'delete')),
  entity text NOT NULL,
  entity_id uuid,
  changed_fields text[],
  row_data jsonb NOT NULL
);

REVOKE ALL ON public.audit_log FROM anon, authenticated, public;
GRANT SELECT ON public.audit_log TO authenticated;
GRANT ALL ON public.audit_log TO service_role;

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read audit_log" ON public.audit_log;
CREATE POLICY "Admins read audit_log" ON public.audit_log
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS audit_log_at_idx ON public.audit_log (at DESC);
CREATE INDEX IF NOT EXISTS audit_log_entity_idx ON public.audit_log (entity, entity_id, at DESC);
CREATE INDEX IF NOT EXISTS audit_log_actor_idx ON public.audit_log (actor_id, at DESC);

COMMENT ON TABLE public.audit_log IS
  'Quem fez cada escrita nas tabelas de dinheiro/estoque/permissão. Escrito só por gatilho; append-only para o app.';

CREATE OR REPLACE FUNCTION public.audit_row_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $audit_row_change$
DECLARE
  v_actor uuid := auth.uid();
  v_email text;
  v_name text;
  v_source text;
  v_old jsonb;
  v_data jsonb;
  v_changed text[];
  v_id text;
BEGIN
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

    IF v_changed IS NULL THEN
      RETURN NULL;
    END IF;
  END IF;

  IF v_actor IS NOT NULL THEN
    BEGIN
      SELECT u.email INTO v_email FROM auth.users u WHERE u.id = v_actor;
    EXCEPTION WHEN OTHERS THEN
      v_email := NULL;
    END;

    SELECT s.name INTO v_name FROM public.sellers s WHERE s.user_id = v_actor;
  END IF;

  v_id := v_data ->> 'id';
  IF v_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    v_id := NULL;
  END IF;

  INSERT INTO public.audit_log (
    actor_id, actor_email, actor_name, actor_source,
    action, entity, entity_id, changed_fields, row_data
  )
  VALUES (
    v_actor, v_email, v_name, v_source,
    lower(TG_OP), TG_TABLE_NAME, v_id::uuid, v_changed, v_data
  );

  RETURN NULL;
END;
$audit_row_change$;

REVOKE ALL ON FUNCTION public.audit_row_change() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.audit_row_change() TO service_role;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'sales',
    'products',
    'stock_entries',
    'stock_losses',
    'product_assignments',
    'orders',
    'expenses',
    'commission_payments',
    'pro_labore_payments',
    'seller_manual_debts',
    'seller_debt_payments',
    'sellers',
    'partners',
    'partner_payments',
    'partner_contributions',
    'dividends',
    'investors',
    'loans',
    'loan_payments',
    'purchase_orders',
    'user_roles'
  ] LOOP
    IF to_regclass('public.' || quote_ident(t)) IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS audit_%1$s ON public.%1$I', t);
    EXECUTE format(
      'CREATE TRIGGER audit_%1$s AFTER INSERT OR UPDATE OR DELETE ON public.%1$I '
      'FOR EACH ROW EXECUTE FUNCTION public.audit_row_change()', t
    );
  END LOOP;
END $$;