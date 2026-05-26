
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'products','sales','stock_entries','expenses','sellers',
    'product_assignments','seller_debt_payments','seller_manual_debts'
  ]) LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Authenticated can manage %I" ON public.%I', t, t);
    EXECUTE format($f$
      CREATE POLICY "Authenticated can manage %I" ON public.%I
        FOR ALL TO authenticated
        USING (auth.uid() IS NOT NULL)
        WITH CHECK (auth.uid() IS NOT NULL)
    $f$, t, t);
  END LOOP;
END $$;
