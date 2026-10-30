-- T12.8 follow-up (the user's decision, 2026-10-31): deleting a booking removes its billing charges. Only the
-- service role and postgres can delete bookings (test cleanup, data fixes); the app never does. A charge on its own
-- still can't be deleted or edited (except invoice_id).
alter table public.billing_charges drop constraint billing_charges_booking_fkey;
alter table public.billing_charges add constraint billing_charges_booking_fkey foreign key (venue_id, booking_id)
  references public.bookings (venue_id, id) on delete cascade;

create or replace function private.guard_billing_charge()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    -- The cascade from a deleted booking runs after the booking row is gone; any other delete is refused.
    if exists (select 1 from public.bookings b where b.id = old.booking_id) then
      raise exception 'Billing charges are never deleted. Add an adjustment instead.' using errcode = 'P0001', hint = 'ledger_immutable';
    end if;
    return old;
  end if;
  if (new.id, new.venue_id, new.booking_id, new.kind, new.amount, new.charged_at, new.billing_month)
     is distinct from (old.id, old.venue_id, old.booking_id, old.kind, old.amount, old.charged_at, old.billing_month) then
    raise exception 'Only a charge''s invoice can change. Add an adjustment instead.' using errcode = 'P0001', hint = 'ledger_immutable';
  end if;
  return new;
end;
$$;
