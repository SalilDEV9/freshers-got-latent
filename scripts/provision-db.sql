-- Run once as database owner. Set a unique LOGIN password separately using secure tooling.
-- Do not put a real password into this file or Git history.
create role fgl_api nologin;
grant usage on schema fgl to fgl_api;
grant select,insert,update on all tables in schema fgl to fgl_api;
revoke update on fgl.audit_ledger from fgl_api;
grant usage,select on all sequences in schema fgl to fgl_api;
grant execute on all functions in schema fgl to fgl_api;
do $$declare t record;begin
 for t in select tablename from pg_tables where schemaname='fgl' loop
  execute format('create policy server_only on fgl.%I to fgl_api using (true) with check (true)',t.tablename);
 end loop;
end $$;
