-- Run on an exported/restored copy, or read-only in production. Zero rows = intact chain.
set timezone='UTC';
with records as (
 select *,coalesce(lag(record_hash) over(partition by event_id order by audit_id),repeat('0',64)) expected_previous,
 encode(sha256(convert_to(jsonb_build_array(event_id,entity_id,action,actor_id,device_id,timestamp,details,previous_hash)::text,'UTF8')),'hex') expected_hash
 from fgl.audit_ledger
)
select audit_id,event_id from records where previous_hash<>expected_previous or record_hash<>expected_hash;
-- Keep periodic final (event_id,audit_id,record_hash) checkpoints outside this database.
-- A privileged database owner can rewrite the entire chain; an external checkpoint detects that.
