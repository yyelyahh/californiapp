
-- Helper: get current user's seller_id
CREATE OR REPLACE FUNCTION public.get_my_seller_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.sellers WHERE user_id = auth.uid() LIMIT 1
$$;

-- PRODUCTS: admin manages everything; sellers only via products_public view (no purchase_price)
DROP POLICY IF EXISTS "Authenticated can manage products" ON public.products;
CREATE POLICY "Admins manage products" ON public.products FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));

CREATE OR REPLACE VIEW public.products_public AS
  SELECT id, name, brand, model, flavor, sale_price, stock, created_at
  FROM public.products;
GRANT SELECT ON public.products_public TO authenticated;

-- STOCK_ENTRIES: admin only
DROP POLICY IF EXISTS "Authenticated can manage stock_entries" ON public.stock_entries;
CREATE POLICY "Admins manage stock_entries" ON public.stock_entries FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));

-- STOCK_LOSSES: admin only
DROP POLICY IF EXISTS "Authenticated can manage stock_losses" ON public.stock_losses;
CREATE POLICY "Admins manage stock_losses" ON public.stock_losses FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));

-- EXPENSES: admin only
DROP POLICY IF EXISTS "Authenticated can manage expenses" ON public.expenses;
CREATE POLICY "Admins manage expenses" ON public.expenses FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));

-- DELETED_PRODUCTS: admin only
DROP POLICY IF EXISTS "Authenticated can manage deleted_products" ON public.deleted_products;
CREATE POLICY "Admins manage deleted_products" ON public.deleted_products FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));

-- SALES: admin all; sellers only own
DROP POLICY IF EXISTS "Authenticated can manage sales" ON public.sales;
CREATE POLICY "Admins manage all sales" ON public.sales FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));
CREATE POLICY "Sellers read own sales" ON public.sales FOR SELECT TO authenticated
  USING (seller_id = public.get_my_seller_id());
CREATE POLICY "Sellers insert own sales" ON public.sales FOR INSERT TO authenticated
  WITH CHECK (seller_id = public.get_my_seller_id());
CREATE POLICY "Sellers update own sales" ON public.sales FOR UPDATE TO authenticated
  USING (seller_id = public.get_my_seller_id()) WITH CHECK (seller_id = public.get_my_seller_id());
CREATE POLICY "Sellers delete own sales" ON public.sales FOR DELETE TO authenticated
  USING (seller_id = public.get_my_seller_id());

-- PRODUCT_ASSIGNMENTS: admin all; sellers read own
DROP POLICY IF EXISTS "Authenticated can manage product_assignments" ON public.product_assignments;
CREATE POLICY "Admins manage product_assignments" ON public.product_assignments FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));
CREATE POLICY "Sellers read own assignments" ON public.product_assignments FOR SELECT TO authenticated
  USING (seller_id = public.get_my_seller_id());

-- SELLER_DEBT_PAYMENTS: admin all; sellers read own
DROP POLICY IF EXISTS "Authenticated can manage seller_debt_payments" ON public.seller_debt_payments;
CREATE POLICY "Admins manage seller_debt_payments" ON public.seller_debt_payments FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));
CREATE POLICY "Sellers read own debt_payments" ON public.seller_debt_payments FOR SELECT TO authenticated
  USING (seller_id = public.get_my_seller_id());

-- SELLER_MANUAL_DEBTS: admin all; sellers read own
DROP POLICY IF EXISTS "Authenticated can manage seller_manual_debts" ON public.seller_manual_debts;
CREATE POLICY "Admins manage seller_manual_debts" ON public.seller_manual_debts FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));
CREATE POLICY "Sellers read own manual_debts" ON public.seller_manual_debts FOR SELECT TO authenticated
  USING (seller_id = public.get_my_seller_id());

-- SELLERS: admin all; seller can read own row only
DROP POLICY IF EXISTS "Authenticated can manage sellers" ON public.sellers;
CREATE POLICY "Admins manage sellers" ON public.sellers FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));
CREATE POLICY "Sellers read own row" ON public.sellers FOR SELECT TO authenticated
  USING (user_id = auth.uid());
