-- Milestone 7: PayMongo payments are stored with method = 'paymongo' (RESEARCH "Data model for PayMongo payments").
-- On its own because a new enum value can't be used until the transaction that adds it commits; the next
-- migration (paymongo_payments) uses it.
alter type public.payment_method add value if not exists 'paymongo';
