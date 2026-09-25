create table fgl.audience_feedback (
  event_id uuid not null,
  attendee_id uuid not null,

  rating int not null
    check (rating between 1 and 5),

  liked text not null default ''
    check (length(liked) <= 1000),

  improvement text not null default ''
    check (length(improvement) <= 1000),

  comment text not null default ''
    check (length(comment) <= 1500),

  anonymous boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  primary key (event_id, attendee_id),

  foreign key (event_id, attendee_id)
    references fgl.audience_registrations(event_id, id)
    on delete cascade
);

create index audience_feedback_event
  on fgl.audience_feedback(event_id, created_at desc);

alter table fgl.audience_feedback enable row level security;

revoke all on fgl.audience_feedback from public;

-- Existing production already has the restricted fgl_api role.
-- A fresh installation may create that role later through provision-db.sql,
-- so only apply these grants here when the role already exists.
do $$
begin
  if exists (
    select 1
    from pg_roles
    where rolname = 'fgl_api'
  ) then
    grant select, insert, update
      on fgl.audience_feedback
      to fgl_api;

    create policy server_only
      on fgl.audience_feedback
      to fgl_api
      using (true)
      with check (true);
  end if;
end
$$;