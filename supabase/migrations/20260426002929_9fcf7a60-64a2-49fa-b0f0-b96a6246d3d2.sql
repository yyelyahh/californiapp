CREATE TABLE public.partner_payments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  partner_id UUID NOT NULL,
  month TEXT NOT NULL,
  amount NUMERIC NOT NULL DEFAULT 0,
  date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.partner_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on partner_payments"
ON public.partner_payments
FOR ALL
USING (true)
WITH CHECK (true);

CREATE INDEX idx_partner_payments_partner_month ON public.partner_payments(partner_id, month);