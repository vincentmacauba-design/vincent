-- =====================================================================================================================
-- DRAFT — NOT EXECUTED.  CMMS P2b migration 0008: job-order notifications (server-side recipients + de-duplication)
-- Spec: docs/P2A_MIGRATION.md §8.  Not run on any Supabase project; tested locally on PGlite (tests/p2/db.test.mjs).  Requires 0005 (hook) and 0007.
-- Rollback: rollback/0008_notifications.down.sql (restores the no-op hook, drops the tables).
-- =====================================================================================================================
-- Events are produced ONLY by the server-side job-order functions (0005/0007 call private.on_jo_event), never by a
-- client. Recipients are computed here from public.profiles (role, section, legacy_id), never sent by the browser:
--   Admin, Assistant Engineer, Senior Engineer : OPEN, IN_PROGRESS, COMPLETED, CLOSED (every job order)
--   Job Card Editor                            : OPEN, CLOSED for job orders whose section = the editor's section
--   Department User                            : IN_PROGRESS, COMPLETED, CLOSED for job orders they raised (requesterId)
--   Viewer                                     : none.   Only active accounts. The acting user is included (N-D2).
-- De-duplication: one jo_events row per real status transition, unique (job_no, event, seq); one notification per
-- (event, recipient). The job-order functions hold the jobOrders row lock, so seq cannot race.
-- Same rules: p2/model/notifications.mjs (tests/p2/static.test.mjs compares the role/event lists).
-- =====================================================================================================================
begin;

create table public.jo_events (
  id        bigint generated always as identity primary key,
  job_no    text not null,
  event     text not null check (event in ('OPEN','IN_PROGRESS','COMPLETED','CLOSED')),
  seq       integer not null check (seq > 0),
  at        timestamptz not null default now(),
  actor     uuid,
  summary   jsonb not null default '{}'::jsonb,      -- assetNum, assetDesc, dept, section at the time of the event
  unique (job_no, event, seq)
);
create table public.notifications (
  id         bigint generated always as identity primary key,
  event_id   bigint not null references public.jo_events(id) on delete cascade,
  recipient  uuid not null references public.profiles(user_id) on delete cascade,
  read_at    timestamptz,
  unique (event_id, recipient)
);
create index notifications_recipient_idx on public.notifications (recipient, id desc);

-- No direct table access for API roles; reading and marking go through the two functions below.
alter table public.jo_events enable row level security;-- (no FORCE row level security on public.jo_events: it only affects the table owner, whose SECURITY DEFINER functions must keep working; API roles are never owners)
alter table public.notifications enable row level security;-- (no FORCE row level security on public.notifications: it only affects the table owner, whose SECURITY DEFINER functions must keep working; API roles are never owners)
revoke all on public.jo_events from public, anon, authenticated;
revoke all on public.notifications from public, anon, authenticated;

create or replace function private.on_jo_event(jo jsonb, prev_status text, actor uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare ev text := case jo ->> 'status' when 'OPEN' then 'OPEN' when 'IN PROGRESS' then 'IN_PROGRESS'
                                       when 'COMPLETED' then 'COMPLETED' when 'CLOSED' then 'CLOSED' end;
        n integer; eid bigint;
begin
  if ev is null or prev_status is not distinct from (jo ->> 'status') then return; end if;   -- no real transition
  select coalesce(max(e.seq), 0) + 1 into n from public.jo_events e where e.job_no = jo ->> 'jobNo' and e.event = ev;
  insert into public.jo_events (job_no, event, seq, actor, summary)
       values (jo ->> 'jobNo', ev, n, actor, jsonb_build_object('assetNum', coalesce(jo ->> 'assetNum', ''), 'assetDesc', coalesce(jo ->> 'assetDesc', ''),
                                                               'dept', coalesce(jo ->> 'dept', ''), 'section', coalesce(jo ->> 'section', '')))
  on conflict (job_no, event, seq) do nothing
  returning id into eid;
  if eid is null then return; end if;
  insert into public.notifications (event_id, recipient)
  select eid, p.user_id from public.profiles p
   where p.active and (
         (p.role in ('Admin','Assistant Engineer','Senior Engineer') and ev in ('OPEN','IN_PROGRESS','COMPLETED','CLOSED'))
      or (p.role = 'Job Card Editor' and ev in ('OPEN','CLOSED') and coalesce(btrim(jo ->> 'section'), '') <> ''
          and lower(btrim(jo ->> 'section')) = lower(btrim(coalesce(p.section, ''))))
      or (p.role = 'Department User' and ev in ('IN_PROGRESS','COMPLETED','CLOSED') and coalesce(jo ->> 'requesterId', '') ~ '^[0-9]+$'
          and (jo ->> 'requesterId')::integer = p.legacy_id))
  on conflict (event_id, recipient) do nothing;
end $$;

-- The caller's own notifications only (recipient = the signed-in user, never a parameter). Active accounts only.
create function public.my_notifications(p_limit integer default 50) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare me public.profiles := private.active_me();
begin
  return coalesce((select jsonb_agg(x order by x.id desc) from (
           select n.id, e.job_no as "jobNo", e.event, e.at, n.read_at is not null as read,
                  e.summary ->> 'assetNum' as "assetNum", e.summary ->> 'assetDesc' as "assetDesc", e.summary ->> 'dept' as dept, e.summary ->> 'section' as section
             from public.notifications n join public.jo_events e on e.id = n.event_id
            where n.recipient = me.user_id order by n.id desc limit least(greatest(coalesce(p_limit, 50), 1), 200)) x), '[]'::jsonb);
end $$;

-- Mark the caller's own notifications as read (all unread ones when p_ids is null). Returns the number changed.
create function public.notification_mark_read(p_ids bigint[] default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare me public.profiles := private.active_me(); c integer;
begin
  update public.notifications set read_at = now()
   where recipient = me.user_id and read_at is null and (p_ids is null or id = any(p_ids));
  get diagnostics c = row_count;
  return c;
end $$;

revoke all on function private.on_jo_event(jsonb, text, uuid) from public, anon, authenticated;
revoke all on function public.my_notifications(integer), public.notification_mark_read(bigint[]) from public, anon;
grant execute on function public.my_notifications(integer), public.notification_mark_read(bigint[]) to authenticated;

commit;
