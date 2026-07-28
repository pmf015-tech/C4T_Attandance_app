-- ══════════════════════════════════════════════════════════════
-- Correction requests (補打卡) — employee submit, admin review
-- ══════════════════════════════════════════════════════════════

create table public.correction_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles (user_id) on delete cascade,
  request_date date not null,
  correction_type text not null check (correction_type in ('clock_in', 'clock_out')),
  requested_time timestamptz not null,
  reason text not null check (char_length(reason) between 1 and 400),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references public.profiles (user_id) on delete set null,
  reviewed_at timestamptz,
  review_note text check (review_note is null or char_length(review_note) <= 400),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index correction_requests_employee_idx on public.correction_requests (employee_id, request_date desc);
create index correction_requests_pending_idx on public.correction_requests (status, request_date) where status = 'pending';

alter table public.correction_requests enable row level security;

revoke all on table public.correction_requests from anon, authenticated;

grant select, insert on public.correction_requests to authenticated;

create policy "Correction requests: owner or admin can read"
on public.correction_requests for select to authenticated
using (((select auth.uid()) = employee_id) or (select private.is_attendance_admin()));

create policy "Correction requests: employee can submit their own"
on public.correction_requests for insert to authenticated
with check ((select auth.uid()) = employee_id and status = 'pending');

create trigger correction_requests_touch_updated_at
before update on public.correction_requests
for each row execute procedure private.touch_updated_at();

-- Admin-only review RPC: approve patches attendance_records
-- (creating the day's row if a clock-in was missing entirely),
-- rejected leaves the original record untouched. Writes an audit event.
create or replace function public.review_correction_request(
  p_request_id uuid,
  p_decision text,
  p_note text default null
)
returns public.correction_requests
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_admin_id uuid := auth.uid();
  v_request public.correction_requests;
  v_record public.attendance_records;
begin
  if v_admin_id is null or not (select private.is_attendance_admin()) then
    raise exception 'Admin privileges are required';
  end if;

  if p_decision not in ('approved', 'rejected') then
    raise exception 'Decision must be approved or rejected';
  end if;

  select * into v_request from public.correction_requests where id = p_request_id for update;
  if not found then
    raise exception 'Correction request not found';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'Correction request has already been reviewed';
  end if;

  if p_decision = 'approved' then
    select * into v_record
    from public.attendance_records
    where employee_id = v_request.employee_id and attendance_day = v_request.request_date
    for update;

    if v_request.correction_type = 'clock_in' then
      if not found then
        insert into public.attendance_records (
          employee_id, attendance_day, check_in_at, clock_in_at,
          verification_status, wifi_assertion_status, verification_reason
        ) values (
          v_request.employee_id, v_request.request_date, v_request.requested_time, v_request.requested_time,
          'verified', 'unavailable', 'Approved correction request'
        );
      else
        update public.attendance_records
        set clock_in_at = v_request.requested_time,
            verification_reason = 'Approved correction request'
        where id = v_record.id;
      end if;
    else
      if not found then
        raise exception 'Cannot correct a clock-out with no clock-in record for that day';
      end if;
      update public.attendance_records
      set clock_out_at = v_request.requested_time,
          verification_reason = 'Approved correction request'
      where id = v_record.id;
    end if;
  end if;

  update public.correction_requests
  set status = p_decision,
      reviewed_by = v_admin_id,
      reviewed_at = now(),
      review_note = p_note
  where id = p_request_id
  returning * into v_request;

  insert into public.attendance_audit_events (actor_id, action, resource_type, resource_key, previous_value, next_value, note)
  values (
    v_admin_id, 'review_correction_request', 'correction_request', p_request_id::text,
    jsonb_build_object('status', 'pending'),
    jsonb_build_object('status', p_decision),
    p_note
  );

  return v_request;
end;
$$;

revoke all on function public.review_correction_request(uuid, text, text) from public, anon, authenticated;
grant execute on function public.review_correction_request(uuid, text, text) to authenticated;
