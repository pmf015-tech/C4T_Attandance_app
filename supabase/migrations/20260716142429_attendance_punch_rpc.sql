create or replace function public.punch_attendance(
  p_gps_latitude numeric default null,
  p_gps_longitude numeric default null,
  p_gps_accuracy_m numeric default null
)
returns public.attendance_records
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_employee_id uuid := auth.uid();
  v_day date := (now() at time zone 'Asia/Hong_Kong')::date;
  v_policy public.attendance_policy%rowtype;
  v_record public.attendance_records%rowtype;
  v_distance_m numeric;
  v_status attendance_verification := 'pending';
  v_reason text := 'GPS evidence submitted; waiting for trusted Wi-Fi gateway or admin review.';
begin
  if v_employee_id is null then
    raise exception 'Authentication is required';
  end if;

  if not exists (
    select 1 from public.profiles
    where user_id = v_employee_id and role = 'employee' and active = true
  ) then
    raise exception 'An active employee account is required';
  end if;

  if (p_gps_latitude is null) <> (p_gps_longitude is null) then
    raise exception 'GPS latitude and longitude must be supplied together';
  end if;

  if p_gps_latitude is not null and (p_gps_latitude not between -90 and 90 or p_gps_longitude not between -180 and 180) then
    raise exception 'GPS coordinates are out of range';
  end if;

  if p_gps_accuracy_m is not null and p_gps_accuracy_m not between 0 and 10000 then
    raise exception 'GPS accuracy is out of range';
  end if;

  select * into v_policy from public.attendance_policy where id = true;

  if p_gps_latitude is not null and v_policy.office_latitude is not null and v_policy.office_longitude is not null then
    v_distance_m := 6371000 * 2 * asin(sqrt(
      power(sin(radians(p_gps_latitude - v_policy.office_latitude) / 2), 2) +
      cos(radians(v_policy.office_latitude)) * cos(radians(p_gps_latitude)) *
      power(sin(radians(p_gps_longitude - v_policy.office_longitude) / 2), 2)
    ));

    if v_distance_m > v_policy.geofence_radius_m then
      v_status := 'blocked';
      v_reason := 'GPS is outside the configured office geofence.';
    elsif p_gps_accuracy_m is not null and p_gps_accuracy_m > v_policy.maximum_gps_accuracy_m then
      v_reason := 'GPS evidence is within range but accuracy requires review.';
    end if;
  end if;

  select * into v_record from public.attendance_records
  where employee_id = v_employee_id and attendance_day = v_day
  for update;

  if not found then
    insert into public.attendance_records (
      employee_id, attendance_day, check_in_at, clock_in_at,
      verification_status, wifi_assertion_status,
      gps_latitude, gps_longitude, gps_accuracy_m, gps_distance_m,
      verification_reason
    ) values (
      v_employee_id, v_day, now(), now(),
      v_status, 'unavailable',
      p_gps_latitude, p_gps_longitude, p_gps_accuracy_m, v_distance_m,
      v_reason
    ) returning * into v_record;
  elsif v_record.clock_out_at is null then
    update public.attendance_records
    set clock_out_at = now(),
        gps_latitude = coalesce(p_gps_latitude, gps_latitude),
        gps_longitude = coalesce(p_gps_longitude, gps_longitude),
        gps_accuracy_m = coalesce(p_gps_accuracy_m, gps_accuracy_m),
        gps_distance_m = coalesce(v_distance_m, gps_distance_m),
        verification_status = case when verification_status = 'blocked' then 'blocked' else v_status end,
        verification_reason = case when verification_status = 'blocked' then verification_reason else v_reason end
    where id = v_record.id
    returning * into v_record;
  else
    raise exception 'Today\'s attendance already has a clock-out time';
  end if;

  return v_record;
end;
$$;

revoke all on function public.punch_attendance(numeric, numeric, numeric) from public;
grant execute on function public.punch_attendance(numeric, numeric, numeric) to authenticated;
