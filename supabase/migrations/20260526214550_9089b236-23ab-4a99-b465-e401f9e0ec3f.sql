
-- =========================================================
-- 1. Drop all permissive "Allow all" policies
-- =========================================================
DROP POLICY IF EXISTS "Allow all on dividends" ON public.dividends;
DROP POLICY IF EXISTS "Allow all on expenses" ON public.expenses;
DROP POLICY IF EXISTS "Allow all on investors" ON public.investors;
DROP POLICY IF EXISTS "Allow all on partner_payments" ON public.partner_payments;
DROP POLICY IF EXISTS "Allow all on partners" ON public.partners;
DROP POLICY IF EXISTS "Allow all on product_assignments" ON public.product_assignments;
DROP POLICY IF EXISTS "Allow all on products" ON public.products;
DROP POLICY IF EXISTS "Allow all on sales" ON public.sales;
DROP POLICY IF EXISTS "Allow all on seller_debt_payments" ON public.seller_debt_payments;
DROP POLICY IF EXISTS "Allow all on seller_manual_debts" ON public.seller_manual_debts;
DROP POLICY IF EXISTS "Allow all on sellers" ON public.sellers;
DROP POLICY IF EXISTS "Allow all on stock_entries" ON public.stock_entries;

-- =========================================================
-- 2. Revoke anon access from sensitive function
-- =========================================================
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;

-- =========================================================
-- 3. Tighten grants: remove anon access from all data tables
-- =========================================================
REVOKE ALL ON public.dividends, public.expenses, public.investors,
              public.partner_payments, public.partners, public.product_assignments,
              public.products, public.sales, public.seller_debt_payments,
              public.seller_manual_debts, public.sellers, public.stock_entries,
              public.user_roles
  FROM anon, public;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.dividends, public.expenses, public.investors,
  public.partner_payments, public.partners, public.product_assignments,
  public.products, public.sales, public.seller_debt_payments,
  public.seller_manual_debts, public.sellers, public.stock_entries
  TO authenticated;

GRANT ALL ON
  public.dividends, public.expenses, public.investors,
  public.partner_payments, public.partners, public.product_assignments,
  public.products, public.sales, public.seller_debt_payments,
  public.seller_manual_debts, public.sellers, public.stock_entries,
  public.user_roles
  TO service_role;

-- =========================================================
-- 4. Authenticated-only operational tables
-- =========================================================
CREATE POLICY "Authenticated can manage products" ON public.products
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated can manage sales" ON public.sales
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated can manage stock_entries" ON public.stock_entries
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated can manage expenses" ON public.expenses
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated can manage sellers" ON public.sellers
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated can manage product_assignments" ON public.product_assignments
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated can manage seller_debt_payments" ON public.seller_debt_payments
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated can manage seller_manual_debts" ON public.seller_manual_debts
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- =========================================================
-- 5. Admin-only sensitive financial tables
-- =========================================================
CREATE POLICY "Admins can manage investors" ON public.investors
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can manage partners" ON public.partners
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can manage partner_payments" ON public.partner_payments
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can manage dividends" ON public.dividends
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- =========================================================
-- 6. user_roles: admin-only writes (SELECT policy already exists)
-- =========================================================
CREATE POLICY "Admins can manage user_roles" ON public.user_roles
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
