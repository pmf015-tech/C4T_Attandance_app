-- ══════════════════════════════════════════════════════════════
-- review_attendance_record(): let an admin overturn a blocked record
--
-- 'blocked' was a one-way door. The function rejected anything that
-- was not already 'pending', so once the system decided a punch was
-- off-site there was no path back through the app — not even when
-- the system itself was wrong.
--
-- It was wrong on 2026-08-04. The geofence centre pointed at Kerry
-- Warehouse, 274.7 m from the actual office, so the first two real
-- punches (SS-003, SS-002) were both blocked while the employees
-- were standing in the office. The admin panel showed two absent
-- staff and offered no button; both records had to be repaired
-- directly in the database.
--
-- Overturning now requires a written reason. A blocked record is an
-- accusation that someone was not where they claimed, so reversing
-- it should cost a sentence and leave a name attached — hence the
-- mandatory note, and its own audit action so overturns can be
-- listed on their own.
--
-- 'verified' stays final. Revoking an approval is the mirror case
-- and a different risk conversation; it is deliberately not opened
-- here.
-- ══════════════════════════════════════════════════════════════

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
  v_previous public.attendance_verification;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_action text;
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

  v_previous := v_record.verification_status;

  if v_previous = 'verified' then
    raise exception 'A verified record cannot be changed';
  end if;

  /* Overturning an accusation costs a sentence. A pending record is
     merely undecided, so its note stays optional as before. */
  if v_previous = 'blocked' then
    if p_decision <> 'verified' then
      raise exception 'This record is already blocked';
    end if;
    if v_note is null then
      raise exception 'A reason is required to overturn a blocked record';
    end if;
    v_action := 'attendance_record.overturn_block';
  else
    v_action := 'attendance_record.review';
  end if;

  update public.attendance_records
  set verification_status = p_decision::public.attendance_verification,
      reviewed_at = now(),
      reviewed_by = v_admin_id,
      review_note = coalesce(v_note, '')
  where id = v_record.id
  returning * into v_record;

  insert into public.attendance_audit_events (
    actor_id, action, resource_type, resource_key, previous_value, next_value, note
  ) values (
    v_admin_id,
    v_action,
    'attendance_record',
    v_record.id::text,
    jsonb_build_object('verification_status', v_previous),
    jsonb_build_object('verification_status', v_record.verification_status),
    v_note
  );

  return v_record;
end;
$$;

revoke all on function public.review_attendance_record(uuid, text, text)
  from public, anon;
grant execute on function public.review_attendance_record(uuid, text, text)
  to authenticated;
