
-- Create sellers table
CREATE TABLE public.sellers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.sellers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on sellers" ON public.sellers FOR ALL TO public USING (true) WITH CHECK (true);

-- Add seller_id to sales (nullable for backward compat)
ALTER TABLE public.sales ADD COLUMN seller_id uuid REFERENCES public.sellers(id) ON DELETE SET NULL;

-- Create product_assignments table to track which seller has which products
CREATE TABLE public.product_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL REFERENCES public.sellers(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  quantity integer NOT NULL DEFAULT 0,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.product_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on product_assignments" ON public.product_assignments FOR ALL TO public USING (true) WITH CHECK (true);
