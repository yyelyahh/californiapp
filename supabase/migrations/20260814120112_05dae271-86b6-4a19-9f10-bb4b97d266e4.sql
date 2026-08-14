ALTER TABLE public.purchase_order_items
  ADD COLUMN IF NOT EXISTS unit_price numeric NOT NULL DEFAULT 0;