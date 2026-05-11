CREATE TABLE public.seller_manual_debts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  seller_id UUID NOT NULL,
  amount NUMERIC NOT NULL DEFAULT 0,
  date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.seller_manual_debts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on seller_manual_debts"
ON public.seller_manual_debts
FOR ALL
USING (true)
WITH CHECK (true);