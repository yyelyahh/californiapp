CREATE TABLE public.deleted_products (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  original_id uuid NOT NULL,
  name text NOT NULL DEFAULT '',
  brand text NOT NULL DEFAULT '',
  model text NOT NULL DEFAULT '',
  flavor text NOT NULL DEFAULT '',
  purchase_price numeric NOT NULL DEFAULT 0,
  sale_price numeric NOT NULL DEFAULT 0,
  stock integer NOT NULL DEFAULT 0,
  original_created_at timestamptz,
  deleted_by uuid,
  deleted_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.deleted_products TO authenticated;
GRANT ALL ON public.deleted_products TO service_role;

ALTER TABLE public.deleted_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can manage deleted_products"
ON public.deleted_products FOR ALL
USING (auth.uid() IS NOT NULL)
WITH CHECK (auth.uid() IS NOT NULL);

CREATE INDEX idx_deleted_products_deleted_at ON public.deleted_products (deleted_at DESC);