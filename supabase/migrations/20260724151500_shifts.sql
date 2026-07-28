-- ══════════════════════════════════════════════════════════════
-- Shifts — admin-managed schedule, employees see their own assignments
-- ══════════════════════════════════════════════════════════════

create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  shift_date date not null,
  start_time time not null,
  end_time time not null,
  assigned_user_ids uuid[] not null default '{}',
  created_by uuid references public.profiles (user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_time > start_time)
);

create index shifts_date_idx on public.shifts (shift_date);
create index shifts_assigned_users_idx on public.shifts using gin (assigned_user_ids);

alter table public.shifts enable row level security;

revoke all on table public.shifts from anon, authenticated;

grant select on public.shifts to authenticated;
grant insert, update, delete on public.shifts to authenticated;

create policy "Shifts: admins manage"
on public.shifts for all to authenticated
using ((select private.is_attendance_admin()))
with check ((select private.is_attendance_admin()));

create policy "Shifts: employees read their own assignments"
on public.shifts for select to authenticated
using ((select auth.uid()) = any (assigned_user_ids));

create trigger shifts_touch_updated_at
before update on public.shifts
for each row execute procedure private.touch_updated_at();

-- Reject an assignee that isn't a real, active profile — avoids a
-- shift silently pointing at a stale/deleted user id.
create or replace function private.validate_shift_assignees()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_invalid_count integer;
begin
  select count(*) into v_invalid_count
  from unnest(new.assigned_user_ids) as assignee(user_id)
  where not exists (
    select 1 from public.profiles where profiles.user_id = assignee.user_id
  );

  if v_invalid_count > 0 then
    raise exception 'assigned_user_ids contains % unknown profile id(s)', v_invalid_count;
  end if;

  return new;
end;
$$;

revoke all on function private.validate_shift_assignees() from public, anon, authenticated;

create trigger shifts_validate_assignees
before insert or update of assigned_user_ids on public.shifts
for each row execute procedure private.validate_shift_assignees();
