-- T17.12: existing transactions survive a later schedule change.
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);
insert into auth.users (id,email) values ('00000000-0000-0000-0000-000000001723','schedule-payment@example.com');
insert into public.venue_members (venue_id,user_id,role) values (private.default_venue_id(),'00000000-0000-0000-0000-000000001723','staff');
insert into public.courts (id,venue_id,name,sport,default_hourly_rate) values ('c0000000-0000-0000-0000-000000001723',private.default_venue_id(),'Payment preservation','tennis',500);
create temp table fx as select private.local_today(private.default_venue_id()) + 5 as d;
insert into public.bookings (id,venue_id,reference_code,court_id,guest_name,during,total_amount,status,source,expires_at)
select ('b0000000-0000-0000-0000-00000000172' || n)::uuid, private.default_venue_id(), 'CB-TSPAA' || (n+1),
 'c0000000-0000-0000-0000-000000001723', 'Preserved',
 tstzrange((d + time '08:00' + make_interval(hours=>n)) at time zone 'Asia/Manila', (d + time '09:00' + make_interval(hours=>n)) at time zone 'Asia/Manila'),
 500, case when n=4 then 'expired'::public.booking_status else 'pending_payment'::public.booking_status end,
 'online', case when n in (3,4) then now()-interval '5 minutes' else now()+interval '1 hour' end
from fx cross join generate_series(1,4) n;
insert into public.paymongo_checkouts (booking_id,checkout_id,checkout_url,amount_centavos)
values ('b0000000-0000-0000-0000-000000001724','cs_schedule_revive','https://checkout.paymongo.test/revive',50000);
set local role service_role;
select public.record_payment_proof('b0000000-0000-0000-0000-000000001721','b0000000-0000-0000-0000-000000001721/1.png','gcash',500);
select public.record_payment_proof('b0000000-0000-0000-0000-000000001722','b0000000-0000-0000-0000-000000001722/1.png','gcash',500);
reset role;
update public.venue_schedule_state set schedule_v2_active=true where venue_id=private.default_venue_id();
update public.court_schedule_modes set schedule_mode='custom' where court_id='c0000000-0000-0000-0000-000000001723';
select is((select count(*)::int from public.bookings where guest_name='Preserved'),4,'schedule change preserves existing bookings');
select is((select sum(total_amount) from public.bookings where guest_name='Preserved'),2000::numeric,'schedule change preserves booking amounts');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000001723","role":"authenticated"}';
select is((select status::text from public.review_payment('b0000000-0000-0000-0000-000000001721',true)),'confirmed','submitted proof can be approved after hours close');
select is((select status::text from public.review_payment('b0000000-0000-0000-0000-000000001722',false,'Retry')),'pending_payment','submitted proof can be rejected after hours close');
reset role;
select private.expire_holds();
select is((select status::text from public.bookings where id='b0000000-0000-0000-0000-000000001723'),'expired','expired hold is swept after hours close');
set local role service_role;
select is((select outcome from public.record_paymongo_payment('cs_schedule_revive','pay_schedule_revive','evt_schedule_revive',50000,'PHP','gcash','b0000000-0000-0000-0000-000000001724')),'revived','late PayMongo payment revives free expired booking after hours close');
reset role;
select is((select total_amount from public.bookings where id='b0000000-0000-0000-0000-000000001724'),500::numeric,'revival preserves the stored booking amount');
select * from finish();
rollback;
