-- One query, run against the SOURCE at dump time and against the RESTORED
-- scratch database, so the restore test compares like with like. Output is
-- `kind|name|value` (psql -At -F '|').
--
-- The two "vacuously true today" checks from the I9 rehearsal are kept as
-- numbers rather than dropped: rls_policies is 0 in production by design (RLS
-- is off on every application table, all access is via the service role) and
-- becomes a real check the day the first policy lands; rls_enabled_<schema>
-- proves the RLS STATE round-tripped (Supabase's auth and storage tables come
-- back with row security on, public with it off).
select 'public_tables' as kind, '' as name, count(*)::text as value
  from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'
union all
select 'table', table_name,
       (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text
  from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'
union all
select 'auth_users', '', count(*)::text from auth.users
union all
select 'rls_policies', '', count(*)::text from pg_policies
union all
select 'rls_enabled_' || n.nspname, '', count(*)::text
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where c.relkind = 'r' and c.relrowsecurity and n.nspname in ('auth', 'storage', 'public')
 group by n.nspname
order by 1, 2;
