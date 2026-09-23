-- Supabase-only migration. No audience PII or scores are broadcast.
create function fgl.can_receive_staff_topic(topic text) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(
  select 1 from fgl.event_staff where user_id=auth.uid() and active and 'fgl:'||event_id::text=topic
 );
$$;
revoke all on function fgl.can_receive_staff_topic(text) from public;
grant usage on schema fgl to authenticated;
grant execute on function fgl.can_receive_staff_topic(text) to authenticated;
create policy fgl_staff_receive on realtime.messages for select to authenticated
using (extension='broadcast' and fgl.can_receive_staff_topic((select realtime.topic())));
-- No INSERT policy: browser clients cannot spoof event notifications.
create function fgl.broadcast_revision() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 perform realtime.send(jsonb_build_object('revision',new.staff_revision),'revision','fgl:'||new.id::text,true);
 return new;
end $$;
revoke all on function fgl.broadcast_revision() from public;
create trigger staff_revision after update of staff_revision on fgl.events for each row execute function fgl.broadcast_revision();
