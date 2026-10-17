-- Guardrail for CLAUDE.md: "RLS is enabled on every table, and every table gets explicit policies."
begin;
create extension if not exists pgtap with schema extensions;
select plan(2);

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

select * from finish();
rollback;
