ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS paid_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS freight_cost numeric NOT NULL DEFAULT 0;