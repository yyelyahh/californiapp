-- 1) financial_events view respects querying user's RLS
ALTER VIEW public.financial_events SET (security_invoker = on);
REVOKE ALL ON public.financial_events FROM anon;
GRANT SELECT ON public.financial_events TO authenticated, service_role;

-- 2) public catalog without SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.get_public_catalog()
RETURNS TABLE(id uuid, name text, brand text, model text, flavor text, stock integer)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT id, name, brand, COALESCE(model,'') AS model, flavor, stock
  FROM public.products
  WHERE stock > 0
  ORDER BY brand, flavor;
$$;

-- anon may read only non-financial catalog columns of in-stock products
GRANT SELECT (id, name, brand, model, flavor, stock) ON public.products TO anon;
DROP POLICY IF EXISTS "Public catalog read" ON public.products;
CREATE POLICY "Public catalog read"
ON public.products FOR SELECT TO anon
USING (stock > 0);

-- 3) sales price/payment integrity enforced in the database
CREATE OR REPLACE FUNCTION public.validate_sale_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_sale_price numeric;
BEGIN
  IF NEW.quantity IS NULL OR NEW.quantity <= 0 THEN
    RAISE EXCEPTION 'Quantidade inválida';
  END IF;
  IF NEW.unit_price IS NULL OR NEW.unit_price < 0 THEN
    RAISE EXCEPTION 'Valor unitário inválido';
  END IF;
  IF NEW.total_price IS NULL
     OR round(NEW.total_price, 2) <> round(NEW.unit_price * NEW.quantity, 2) THEN
    RAISE EXCEPTION 'Total da venda não confere com quantidade x valor unitário';
  END IF;
  IF COALESCE(NEW.paid_amount, 0) < 0
     OR round(COALESCE(NEW.paid_amount, 0), 2) > round(NEW.total_price, 2) THEN
    RAISE EXCEPTION 'Valor pago inválido';
  END IF;

  IF NEW.type = 'venda' AND NOT public.has_role(auth.uid(), 'admin') THEN
    SELECT sale_price INTO v_sale_price FROM public.products WHERE id = NEW.product_id;
    IF v_sale_price IS NOT NULL AND NEW.unit_price < v_sale_price * 0.7 THEN
      RAISE EXCEPTION 'Valor unitário abaixo do permitido para este produto';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_sale_integrity_trg ON public.sales;
CREATE TRIGGER validate_sale_integrity_trg
BEFORE INSERT OR UPDATE ON public.sales
FOR EACH ROW EXECUTE FUNCTION public.validate_sale_integrity();

-- keep has_role / get_my_seller_id / get_product_costs unavailable to anon
REVOKE ALL ON FUNCTION public.validate_sale_integrity() FROM anon, public;