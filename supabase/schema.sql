-- Private schema: never add fgl to Supabase's exposed Data API schemas.
create schema if not exists fgl;
revoke all on schema fgl from public;
create table fgl.events (
 id uuid primary key default gen_random_uuid(), title text not null,
 phase text not null default 'DRAFT' check(phase in ('DRAFT','LIVE','PAUSED','ENDED')),
 voting_open boolean not null default false, announcement text not null default '',
 revision bigint not null default 0, staff_revision bigint not null default 0, expires_at timestamptz not null,
 match_mode text not null default 'exact' check(match_mode in ('exact','nearest','quarter','half'))
);
create table fgl.event_staff (
 event_id uuid references fgl.events not null, user_id uuid not null,
 role text not null check(role in ('super_admin','event_admin','gate','judge','controller','backstage','host')),
 active boolean not null default true, primary key(event_id,user_id)
);
create table fgl.import_batches (
 id uuid primary key default gen_random_uuid(),event_id uuid not null references fgl.events,
 actor_id uuid not null,source text not null,mapping jsonb not null,preview jsonb not null,
 status text not null default 'PREVIEW' check(status in ('PREVIEW','IMPORTED')),
 created_at timestamptz not null default now()
);
create table fgl.audience_registrations (
 id uuid primary key default gen_random_uuid(),event_id uuid not null references fgl.events,
 batch_id uuid references fgl.import_batches,name text not null check(length(name) between 1 and 100),
 email text not null check(email=lower(trim(email))),phone text not null default '',
 roll_number text not null check(roll_number=upper(trim(roll_number))),auth_id uuid,
 status text not null default 'IMPORTED' check(status in ('IMPORTED','VALIDATED','PAYMENT_PENDING','PAYMENT_VERIFIED','APPROVED','PASS_ISSUED','CHECKED_IN','REJECTED','BLOCKED','REVOKED','NEEDS_REVIEW')),
 created_at timestamptz not null default now(),
 unique(event_id,email),unique(event_id,roll_number),unique(event_id,auth_id),unique(event_id,id)
);
create table fgl.payments (
 id uuid primary key default gen_random_uuid(),event_id uuid not null,
 attendee_id uuid not null,reference text,proof text not null default '',
 status text not null default 'PENDING' check(status in ('PENDING','VERIFIED','REJECTED')),
 verified_by uuid,verified_at timestamptz,
 foreign key(event_id,attendee_id) references fgl.audience_registrations(event_id,id),
 unique(event_id,attendee_id),unique(event_id,reference),
 check(reference is null or (reference=upper(trim(reference)) and length(reference) between 6 and 64))
);
create table fgl.gate_devices (
 id uuid primary key default gen_random_uuid(),event_id uuid not null references fgl.events,
 label text not null,staff_id uuid not null,active boolean not null default true,
 foreign key(event_id,staff_id) references fgl.event_staff(event_id,user_id),unique(event_id,id)
);
create table fgl.tickets (
 id uuid primary key default gen_random_uuid(),event_id uuid not null,attendee_id uuid not null,
 nonce text not null,key_id text not null,issued_at bigint not null,qr text,
 status text not null default 'ACTIVE' check(status in ('ACTIVE','REDEEMED','REVOKED','BLOCKED','EXPIRED')),
 redeemed_at timestamptz,redeemed_by uuid,gate_id uuid,
 unique(event_id,attendee_id),unique(event_id,id),
 foreign key(event_id,attendee_id) references fgl.audience_registrations(event_id,id),
 foreign key(event_id,gate_id) references fgl.gate_devices(event_id,id)
);
create table fgl.entry_attempts (
 id uuid primary key default gen_random_uuid(),event_id uuid not null references fgl.events,
 ticket_id uuid,actor_id uuid not null,device_id uuid,action text not null,
 reason text not null,created_at timestamptz not null default now()
);
create table fgl.performances (
 id uuid primary key default gen_random_uuid(),event_id uuid not null references fgl.events,
 name text not null,category text not null,bio text not null default '',members jsonb not null default '[]',
 position int not null,state text not null default 'REGISTERED'
 check(state in ('REGISTERED','CHECKED_IN','BACKSTAGE','READY','ON_STAGE','PERFORMING','JUDGING','REVEAL','COMPLETED','ABSENT','SKIPPED','VOID')),
 self_score numeric check(self_score between 1 and 10),panel uuid[] not null default '{}',
 timer_end timestamptz,timer_remaining int,unique(event_id,id)
);
create unique index one_active_act on fgl.performances(event_id) where state in ('ON_STAGE','PERFORMING','JUDGING','REVEAL');
create table fgl.judge_scores (
 event_id uuid not null,performance_id uuid not null,judge_id uuid not null,
 value numeric not null check(value between 1 and 10),remarks text not null default '' check(length(remarks)<=1000),
 primary key(event_id,performance_id,judge_id),
 foreign key(event_id,performance_id) references fgl.performances(event_id,id)
);
create table fgl.audience_votes (
 event_id uuid not null,performance_id uuid not null,audience_id uuid not null,
 creativity int not null check(creativity between 1 and 5),entertainment int not null check(entertainment between 1 and 5),originality int not null check(originality between 1 and 5),
 primary key(event_id,performance_id,audience_id),
 foreign key(event_id,performance_id) references fgl.performances(event_id,id),
 foreign key(event_id,audience_id) references fgl.audience_registrations(event_id,id)
);
create table fgl.audit_ledger (
 audit_id bigint generated always as identity primary key,event_id uuid not null references fgl.events,
 entity_id text not null,action text not null,actor_id uuid,device_id uuid,
 timestamp timestamptz not null default clock_timestamp(),details jsonb not null default '{}',
 previous_hash text not null,record_hash text not null
);
create index ledger_event_tail on fgl.audit_ledger(event_id,audit_id desc);
create index attempts_event_time on fgl.entry_attempts(event_id,created_at desc);
create index performances_event_order on fgl.performances(event_id,position);
create index tickets_event_status on fgl.tickets(event_id,status);
create function fgl.append_audit(e uuid,entity text,act text,actor uuid,device uuid,details jsonb default '{}') returns void
language plpgsql set search_path='' set timezone='UTC' as $$
declare prev text; stamp timestamptz:=clock_timestamp(); body text;
begin
 -- A single event lock serializes ledger appends; operations take this lock first.
 perform 1 from fgl.events where id=e for update;
 select record_hash into prev from fgl.audit_ledger where event_id=e order by audit_id desc limit 1;
 prev:=coalesce(prev,repeat('0',64));
 body:=jsonb_build_array(e,entity,act,actor,device,stamp,details,prev)::text;
 insert into fgl.audit_ledger(event_id,entity_id,action,actor_id,device_id,timestamp,details,previous_hash,record_hash)
 values(e,entity,act,actor,device,stamp,details,prev,encode(sha256(convert_to(body,'UTF8')),'hex'));
 update fgl.events set staff_revision=staff_revision+1 where id=e;
end $$;
create function fgl.immutable_audit() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Audit history is append-only';end $$;
create trigger audit_immutable before update or delete or truncate on fgl.audit_ledger for each statement execute function fgl.immutable_audit();
create function fgl.redeem(e uuid,t uuid,a uuid,d uuid,identity_confirmed boolean,override_reason text default null) returns jsonb
language plpgsql set search_path='' as $$
declare reg fgl.audience_registrations; ticket fgl.tickets; why text; staff_role text; changed uuid;
begin
 perform 1 from fgl.events where id=e for update;
 select role into staff_role from fgl.event_staff where event_id=e and user_id=a and active;
 if staff_role is null or staff_role not in ('gate','event_admin','super_admin') then raise exception 'Forbidden';end if;
 if not exists(select 1 from fgl.gate_devices where id=d and event_id=e and active and (staff_id=a or staff_role in ('event_admin','super_admin'))) then raise exception 'Gate device not authorized';end if;
 if identity_confirmed is distinct from true then raise exception 'College identity verification required';end if;
 if override_reason is not null and (staff_role not in ('event_admin','super_admin') or length(trim(override_reason))<10 or length(override_reason)>500) then raise exception 'Administrator and detailed reason required';end if;
 select * into ticket from fgl.tickets where id=t and event_id=e for update;
 select * into reg from fgl.audience_registrations where id=ticket.attendee_id and event_id=e for update;
 if ticket.id is null then why:='UNKNOWN_TICKET';
 elsif ticket.status='REDEEMED' then why:='ALREADY_USED';
 elsif ticket.status<>'ACTIVE' then why:=ticket.status;
 elsif not exists(select 1 from fgl.events where id=e and expires_at>now() and phase<>'ENDED') then why:='EXPIRED';
 elsif reg.status<>'PASS_ISSUED' then why:='REGISTRATION_NOT_APPROVED';
 elsif not exists(select 1 from fgl.payments where attendee_id=reg.id and event_id=e and status='VERIFIED') then why:='PAYMENT_NOT_VERIFIED';
 else
  update fgl.tickets set status='REDEEMED',redeemed_at=now(),redeemed_by=a,gate_id=d where id=t and event_id=e and status='ACTIVE' returning id into changed;
  if changed is not null then update fgl.audience_registrations set status='CHECKED_IN' where id=reg.id;why:='ENTRY_GRANTED';else why:='ALREADY_USED';end if;
 end if;
 insert into fgl.entry_attempts(event_id,ticket_id,actor_id,device_id,action,reason) values(e,t,a,d,case when changed is null then 'ENTRY_REJECTED' else 'ENTRY_GRANTED' end,why);
 perform fgl.append_audit(e,t::text,case when changed is null then 'ENTRY_REJECTED' when override_reason is not null then 'ADMIN_OVERRIDE' else 'ENTRY_GRANTED' end,a,d,jsonb_build_object('result',why,'reason',override_reason));
 return jsonb_build_object('allowed',changed is not null,'reason',why,'first_entry',ticket.redeemed_at,'gate_id',ticket.gate_id);
end $$;
-- Defense in depth: no anonymous/authenticated SQL access, even if accidentally exposed.
do $$declare t record;begin
 for t in select tablename from pg_tables where schemaname='fgl' loop
  execute format('alter table fgl.%I enable row level security',t.tablename);
 end loop;
end $$;
revoke all on all tables in schema fgl from public;
revoke all on all functions in schema fgl from public;
revoke all on all sequences in schema fgl from public;
-- API connects through a dedicated server credential with a non-public database role.
-- Provision the role via scripts/provision-db.sql; never use browser credentials for SQL.
create table fgl.request_limits(event_id uuid not null references fgl.events,actor_id uuid not null,window_start timestamptz not null,count int not null,primary key(event_id,actor_id,window_start));
alter table fgl.request_limits enable row level security;
revoke all on fgl.request_limits from public;
alter table fgl.judge_scores add column criteria jsonb not null default '{}';
create view fgl.results with(security_invoker=true) as
with totals as (
 select p.event_id,p.id,p.name,p.self_score,e.match_mode,
 sum((s.criteria->>'creativity')::int+(s.criteria->>'entertainment')::int+(s.criteria->>'originality')::int)::numeric total,
 count(*)::numeric*3 divisor
 from fgl.performances p join fgl.events e on e.id=p.event_id join fgl.judge_scores s on s.performance_id=p.id
 where p.state in ('REVEAL','COMPLETED') group by p.id,e.match_mode
)
select event_id,id,name,self_score,total/divisor average,
 abs(total-self_score*divisor)/divisor difference,
 case match_mode when 'exact' then total=self_score*divisor
 when 'nearest' then round(total/divisor)=self_score
 when 'quarter' then abs(total-self_score*divisor)<=divisor/4
 else abs(total-self_score*divisor)<=divisor/2 end match,
 rank() over(partition by event_id order by total/divisor desc) judge_rank
from totals;
revoke all on fgl.results from public;
