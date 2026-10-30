-- Guardrail for CLAUDE.md: "RLS is enabled on every table, and every table gets explicit policies."
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

select is_empty(
  $$ select c.relname
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity $$,
  'every public table has RLS enabled'
);

select is_empty(
  $$ select c.relname
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p')
       and not exists (
         select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname
       ) $$,
  'every public table has at least one policy'
);

-- T12.4: every table with a venue_id column has venue-scoped policies only.
create temp view venue_policies as
  select p.tablename, p.policyname, p.cmd, p.roles, coalesce(p.qual, '') as qual, coalesce(p.with_check, '') as with_check,
         coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '') as body
  from pg_policies p
  where p.schemaname = 'public'
    and p.tablename in (select table_name from information_schema.columns where table_schema = 'public' and column_name = 'venue_id');

select is_empty(
  $$ select tablename, policyname from venue_policies where body ~ '\mis_admin\(' $$,
  'no policy on a table with venue_id references private.is_admin()'
);

select is_empty(
  $$ select t.table_name
     from information_schema.columns t
     where t.table_schema = 'public' and t.column_name = 'venue_id'
       and exists (select 1 from venue_policies v where v.tablename = t.table_name)
       and not exists (select 1 from venue_policies v where v.tablename = t.table_name and v.body ~ '(venue_id|is_venue_admin)')
       and exists (select 1 from venue_policies v where v.tablename = t.table_name and v.body !~ '^\s*false\s+false\s*$' and v.body !~ '^\s*false\s*$') $$,
  'every table with venue_id has a policy that references venue_id or is_venue_admin (deny-all tables excepted)'
);

select is_empty(
  $$ select tablename, policyname from venue_policies
     where cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
       and body !~ '(venue_id|is_venue_admin)'
       and not (qual in ('false', '') and with_check in ('false', '') and body ~ 'false') $$,
  'every write policy on a table with venue_id references venue_id or is_venue_admin (deny-all excepted)'
);

select is_empty(
  $$ select tablename, policyname from venue_policies
     where cmd in ('SELECT', 'ALL') and 'anon' = any (roles) and trim(qual) in ('true', '') and body !~ 'false' $$,
  'no anon-readable policy on a table with venue_id is unconditional (public reads are scoped to active venues)'
);

select is_empty(
  $$ select policyname from pg_policies where schemaname = 'public' and tablename = 'profiles'
       and coalesce(qual, '') || coalesce(with_check, '') ~ '\mis_admin\(' $$,
  'no profiles policy references private.is_admin()'
);

select * from finish();
rollback;
