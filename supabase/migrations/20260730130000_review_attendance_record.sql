-- A-3: admin review of a pending attendance signal.
-- The browser can only request this RPC; authorization and the audit trail
-- remain in Postgres so an employee cannot approve their own record.
create or replace function public.review_attendance_record(
  p_record_id uuid,
  p_decision text,
  p_note text default null
)
returns public.attendance_records
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_admin_id uuid := auth.uid();
  v_record public.attendance_records;
begin
  if v_admin_id is null or not (select private.is_attendance_admin()) then
    raise exception 'Admin privileges are required';
  end if;

  if p_decision not in ('verified', 'blocked') then
    raise exception 'Decision must be verified or blocked';
  end if;

  select * into v_record
  from public.attendance_records
  where id = p_record_id
  for update;

  if not found then
    raise exception 'Attendance record not found';
  end if;

  if v_record.verification_status <> 'pending' then
    raise exception 'Attendance record has already been reviewed';
  end if;

  update public.attendance_records
  set verification_status = p_decision::public.attendance_verification,
      reviewed_at = now(),
      reviewed_by = v_admin_id,
      review_note = coalesce(p_note, '')
  where id = v_record.id
  returning * into v_record;

  insert into public.attendance_audit_events (
    actor_id, action, resource_type, resource_key, previous_value, next_value, note
  ) values (
    v_admin_id,
    'attendance_record.review',
    'attendance_record',
    v_record.id::text,
    jsonb_build_object('verification_status', 'pending'),
    jsonb_build_object('verification_status', v_record.verification_status),
    nullif(p_note, '')
  );

  return v_record;
end;
$$;

revoke all on function public.review_attendance_record(uuid, text, text)
  from public, anon;
grant execute on function public.review_attendance_record(uuid, text, text)
  to authenticated;
