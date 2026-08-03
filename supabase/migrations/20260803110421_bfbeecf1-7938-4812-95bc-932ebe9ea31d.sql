ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS paid_at timestamptz;

UPDATE public.sales
SET paid_at = date
WHERE paid_at IS NULL
  AND type = 'venda'
  AND paid_amount >= total_price - 0.01;