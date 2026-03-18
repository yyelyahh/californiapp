
ALTER TABLE public.sellers ADD COLUMN user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL UNIQUE;

-- Link rafa@california.com to seller Rafa
UPDATE public.sellers 
SET user_id = (SELECT id FROM auth.users WHERE email = 'rafa@california.com')
WHERE id = 'bb22a8b6-2784-434a-a376-fbfc76b0fb54';
