-- ══════════════════════════════════════════════════════════════
-- Leave requests — employee submit, admin review
-- ══════════════════════════════════════════════════════════════

create table public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles (user_id) on delete cascade,
  leave_type text not null check (leave_type in ('sick', 'annual', 'personal', 'other')),
  start_date date not null,
  end_date date not null,
  reason text check (reason is null or char_length(reason) <= 400),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references public.profiles (user_id) on delete set null,
  reviewed_at timestamptz,
  review_note text check (review_note is null or char_length(review_note) <= 400),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date)
);

create index leave_requests_employee_idx on public.leave_requests (employee_id, start_date desc);
create index leave_requests_pending_idx on public.leave_requests (status, start_date) where status = 'pending';

alter table public.leave_requests enable row level security;

revoke all on table public.leave_requests from anon, authenticated;

grant select, insert on public.leave_requests to authenticated;

create policy "Leave requests: owner or admin can read"
on public.leave_requests for select to authenticated
using (((select auth.uid()) = employee_id) or (select private.is_attendance_admin()));

create policy "Leave requests: employee can submit their own"
on public.leave_requests for insert to authenticated
with check ((select auth.uid()) = employee_id and status = 'pending');

create trigger leave_requests_touch_updated_at
before update on public.leave_requests
for each row execute procedure private.touch_updated_at();

-- Admin-only review RPC: approve/reject + write audit event + reflect
-- approval on attendance_records.status for each affected day.
create or replace function public.review_leave_request(
  p_request_id uuid,
  p_decision text,
  p_note text default null
)
returns public.leave_requests
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_admin_id uuid := auth.uid();
  v_request public.leave_requests;
begin
  if v_admin_id is null or not (select private.is_attendance_admin()) then
    raise exception 'Admin privileges are required';
  end if;

  if p_decision not in ('approved', 'rejected') then
    raise exception 'Decision must be approved or rejected';
  end if;

  select * into v_request from public.leave_requests where id = p_request_id for update;
  if not found then
    raise exception 'Leave request not found';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'Leave request has already been reviewed';
  end if;

  update public.leave_requests
  set status = p_decision,
      reviewed_by = v_admin_id,
      reviewed_at = now(),
      review_note = p_note
  where id = p_request_id
  returning * into v_request;

  -- Note: attendance_records requires a real clock_in_at (not-null,
  -- one row per punched day) so an approved leave does not synthesize
  -- a punch row. "Reflected on schedule view" (proposal.md) is done by
  -- reading approved leave_requests for the date range at query time,
  -- not by mutating attendance_records.

  insert into public.attendance_audit_events (actor_id, action, resource_type, resource_key, previous_value, next_value, note)
  values (
    v_admin_id, 'review_leave_request', 'leave_request', p_request_id::text,
    jsonb_build_object('status', 'pending'),
    jsonb_build_object('status', p_decision),
    p_note
  );

  return v_request;
end;
$$;

revoke all on function public.review_leave_request(uuid, text, text) from public, anon, authenticated;
grant execute on function public.review_leave_request(uuid, text, text) to authenticated;
