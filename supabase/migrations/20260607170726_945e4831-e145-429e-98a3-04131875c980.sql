
-- Drop the security-definer view; switch to column-level privileges
DROP VIEW IF EXISTS public.products_public;

-- Allow authenticated users to read products (sellers need name, sale_price, stock for sales)
CREATE POLICY "Authenticated read products" ON public.products FOR SELECT TO authenticated
  USING (true);

-- Hide purchase_price from non-admin clients at the column level
REVOKE SELECT (purchase_price) ON public.products FROM authenticated;
REVOKE SELECT (purchase_price) ON public.products FROM anon;

-- Admin-only RPC to fetch product costs
CREATE OR REPLACE FUNCTION public.get_product_costs()
RETURNS TABLE(product_id uuid, purchase_price numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id, purchase_price FROM public.products
  WHERE public.has_role(auth.uid(),'admin')
$$;
REVOKE EXECUTE ON FUNCTION public.get_product_costs() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_product_costs() TO authenticated;

-- Lock down execute on existing SECURITY DEFINER helpers
REVOKE EXECUTE ON FUNCTION public.get_my_seller_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_seller_id() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;
