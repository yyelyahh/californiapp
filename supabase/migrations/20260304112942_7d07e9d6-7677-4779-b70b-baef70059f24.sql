ALTER TABLE public.sales ADD COLUMN installments integer NOT NULL DEFAULT 1;
ALTER TABLE public.sales ADD COLUMN paid_amount numeric NOT NULL DEFAULT 0;