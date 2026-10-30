-- T12.7 (expand): stored media paths may carry the row's own venue id as a first folder, `{venue_id}/<legacy path>`.
-- The legacy shape stays valid until the contract migration (T12.11) drops it.
alter table public.court_photos drop constraint court_photos_path_check;
alter table public.court_photos add constraint court_photos_path_check
  check (path ~ ('^(' || venue_id::text || '/)?courts/' || court_id::text || '/[0-9a-f-]{36}\.(webp|jpg|jpeg|png)$'));

alter table public.venue_settings drop constraint venue_settings_banner_path_check;
alter table public.venue_settings add constraint venue_settings_banner_path_check
  check (banner_path ~ ('^(' || venue_id::text || '/)?banner/[0-9a-f-]{36}\.(webp|jpg|jpeg|png)$'));

alter table public.venue_payment_accounts drop constraint venue_payment_accounts_qr_path;
alter table public.venue_payment_accounts add constraint venue_payment_accounts_qr_path
  check (qr_path ~ ('^(' || venue_id::text || '/)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$'));
