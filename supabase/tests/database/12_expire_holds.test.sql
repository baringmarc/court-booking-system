-- T4.7: expiry sweep and its pg_cron schedule.
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

create function pg_temp.hint_of(p_sql text) returns text language plpgsql as $$
declare h text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return coalesce(nullif(h, ''), 'sqlstate ' || sqlstate);
end $$;

insert into public.courts (id, name, sport, default_hourly_rate) values
  ('c0000000-0000-0000-0000-000000000001', 'Expiry Court', 'tennis', 500);
-- Release anything already lapsed in the local database so the count below is exact.
select private.expire_holds();

insert into public.bookings (reference_code, court_id, guest_name, during, total_amount, status, expires_at, guest_token_hash) values
  ('CB-EXPAA2', 'c0000000-0000-0000-0000-000000000001', 'Lapsed',  tstzrange('2030-01-07 10:00+08', '2030-01-07 11:00+08'), 500, 'pending_payment',   now() - interval '1 minute', sha256('t1'::bytea)),
  ('CB-EXPBB3', 'c0000000-0000-0000-0000-000000000001', 'Exact',   tstzrange('2030-01-07 11:00+08', '2030-01-07 12:00+08'), 500, 'pending_payment',   now(),                      null),
  ('CB-EXPCC4', 'c0000000-0000-0000-0000-000000000001', 'Live',    tstzrange('2030-01-07 12:00+08', '2030-01-07 13:00+08'), 500, 'pending_payment',   now() + interval '5 minutes', null),
  ('CB-EXPDD5', 'c0000000-0000-0000-0000-000000000001', 'Review',  tstzrange('2030-01-07 13:00+08', '2030-01-07 14:00+08'), 500, 'payment_submitted', now() - interval '1 hour', null),
  ('CB-EXPEE6', 'c0000000-0000-0000-0000-000000000001', 'Paid',    tstzrange('2030-01-07 14:00+08', '2030-01-07 15:00+08'), 500, 'confirmed',         now() - interval '1 hour', null);

select is(private.expire_holds(), 2, 'the sweep reports how many holds it expired');
select results_eq(
  $$ select reference_code, status::text from public.bookings where reference_code like 'CB-EXP%' order by reference_code $$,
  $$ values ('CB-EXPAA2', 'expired'), ('CB-EXPBB3', 'expired'), ('CB-EXPCC4', 'pending_payment'),
            ('CB-EXPDD5', 'payment_submitted'), ('CB-EXPEE6', 'confirmed') $$,
  'only pending holds at or past expires_at expire; holds still running, proofs under review and confirmed bookings are untouched'
);
select is(private.expire_holds(), 0, 'running it again changes nothing');

-- A late proof for a swept hold still says hold_expired
set local role service_role;
select is(pg_temp.hint_of($$ select * from public.proof_target('CB-EXPAA2', 't1', null) $$), 'hold_expired', 'proof_target: a swept hold reports hold_expired');
select is(pg_temp.hint_of($$ select * from public.record_payment_proof((select id from public.bookings where reference_code = 'CB-EXPAA2'), (select id::text || '/x.png' from public.bookings where reference_code = 'CB-EXPAA2'), 'gcash', 500) $$),
  'hold_expired', 'record_payment_proof: a swept hold reports hold_expired');
reset role;

-- Schedule and privileges
select ok(exists (select 1 from pg_extension where extname = 'pg_cron'), 'pg_cron is installed');
select results_eq(
  $$ select schedule, command, active from cron.job where jobname = 'expire-holds' $$,
  $$ values ('* * * * *'::text, 'select private.expire_holds()'::text, true) $$,
  'the expire-holds job runs every minute'
);
select is((select count(*)::int from cron.job where jobname = 'expire-holds'), 1, 'there is exactly one expire-holds job');
select ok(not has_function_privilege('anon', 'private.expire_holds()', 'execute'), 'anon cannot run the sweep');
select ok(not has_function_privilege('authenticated', 'private.expire_holds()', 'execute'), 'authenticated cannot run the sweep');

select * from finish();
rollback;
