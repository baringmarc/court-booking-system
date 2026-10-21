-- Follow-up to T9.9/T9.10: 24 hours is only 12 AM → midnight (00:00 → 24:00). An open day can't close at its
-- opening time, through set_operating_hours or a direct write. A closed day keeps whatever times it has.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, email) values ('22222222-2222-2222-2222-222222222222', 'admin@test.local');
update public.profiles set role = 'admin' where id = '22222222-2222-2222-2222-222222222222';

-- Every day 06:00–22:00, except Wednesday: p_open → p_close, closed when p_closed.
create function pg_temp.week(p_open text, p_close text, p_closed boolean default false) returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object(
    'day_of_week', g,
    'open_time', case when g = 3 then p_open else '06:00' end,
    'close_time', case when g = 3 then p_close else '22:00' end,
    'is_closed', g = 3 and p_closed))
  from generate_series(0, 6) g
$$;
grant execute on function pg_temp.week(text, text, boolean) to authenticated;

select ok(
  exists (select 1 from pg_constraint where conrelid = 'public.operating_hours'::regclass
          and conname = 'operating_hours_open_differs_from_close'),
  'operating_hours has the open-differs-from-close check'
);
select is(
  (select count(*)::int from public.operating_hours where not is_closed and open_time = close_time), 0,
  'no open day is stored with open = close (the migration moved them to 00:00 → 24:00)'
);

select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
set local role authenticated;
select throws_ok($$ select public.set_operating_hours(pg_temp.week('06:00', '06:00')) $$, 'P0001',
  'Wednesday opens and closes at the same time. For 24 hours, open at 12 AM and close at midnight.',
  '06:00 → 06:00 is refused');
select throws_ok($$ select public.set_operating_hours(pg_temp.week('00:00', '00:00')) $$, 'P0001',
  'Wednesday opens and closes at the same time. For 24 hours, open at 12 AM and close at midnight.',
  '00:00 → 00:00 is refused');
select lives_ok($$ select public.set_operating_hours(pg_temp.week('00:00', '24:00')) $$,
  '00:00 → 24:00 (24 hours) is allowed');
select lives_ok($$ select public.set_operating_hours(pg_temp.week('06:00', '05:00')) $$,
  'a close before the open (overnight) is still allowed');
select lives_ok($$ select public.set_operating_hours(pg_temp.week('06:00', '06:00', true)) $$,
  'a closed day may keep equal times');
reset role;

select throws_ok(
  $$ update public.operating_hours set is_closed = false where day_of_week = 3 $$,
  '23514', null, 'a direct write can''t open a day with equal times either'
);
select lives_ok(
  $$ update public.operating_hours set open_time = '00:00', close_time = '24:00', is_closed = false where day_of_week = 3 $$,
  'a direct write of 00:00 → 24:00 is fine'
);

select * from finish();
rollback;
