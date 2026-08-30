ALTER TABLE public.order_items DROP CONSTRAINT IF EXISTS order_items_sale_id_fkey;
ALTER TABLE public.order_items
  ADD CONSTRAINT order_items_sale_id_fkey
  FOREIGN KEY (sale_id) REFERENCES public.sales(id) ON DELETE SET NULL;