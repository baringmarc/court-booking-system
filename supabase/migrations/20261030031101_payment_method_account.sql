-- T11.27: payments made to one of the venue's payment accounts are stored with method = 'account' (the label is kept
-- in payments.paid_with, next migration). On its own because a new enum value can't be used until the transaction
-- that adds it commits (as 20261018123351_paymongo_method.sql).
alter type public.payment_method add value if not exists 'account';
