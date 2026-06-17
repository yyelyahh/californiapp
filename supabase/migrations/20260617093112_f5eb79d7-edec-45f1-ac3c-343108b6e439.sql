
CREATE OR REPLACE FUNCTION public.get_public_catalog()
RETURNS TABLE(id uuid, name text, brand text, model text, flavor text, stock integer)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, name, brand, COALESCE(model,'') AS model, flavor, stock
  FROM public.products
  WHERE stock > 0
  ORDER BY brand, flavor;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_catalog() TO anon, authenticated;
