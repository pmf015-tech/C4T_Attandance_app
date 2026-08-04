-- ══════════════════════════════════════════════════════════════
-- punch_attendance(): add the office network signal
--
-- Second signal alongside GPS, from public.trusted_office_networks.
-- Unlike GPS — which the browser reports and which is trivially
-- spoofable — the source IP is observed by Cloudflare at the edge,
-- so a client cannot fabricate it. See the header trust notes in
-- 20260804090000_trusted_office_networks.sql: `cf-connecting-ip`
-- and `sb-forwarded-for` resist forgery, `x-forwarded-for` does
-- not and is deliberately never read here.
--
-- Combination rule (approved in chat 2026-08-04): EITHER signal
-- may auto-verify, evaluated in this order —
--
--   GPS present but outside geofence -> blocked   (a network match
--       must not rescue an off-site punch; off-site is off-site)
--   on a trusted office network      -> verified
--   otherwise                        -> existing GPS logic, unchanged
--
-- The client sends nothing new; the signature is unchanged.
-- ══════════════════════════════════════════════════════════════

create or replace function public.punch_attendance(
  p_gps_latitude   numeric default null,
  p_gps_longitude  numeric default null,
  p_gps_accuracy_m numeric default null
)
returns public.attendance_records
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_employee_id  uuid := auth.uid();
  v_day          date := (now() at time zone 'Asia/Hong_Kong')::date;
  v_policy       record;
  v_record       public.attendance_records;
  v_distance_m   numeric;
  v_status       public.attendance_verification := 'pending';
  v_reason       text := 'No GPS evidence supplied; awaiting admin review.';
  v_geo_radius   integer;
  v_max_accuracy integer;
  v_office_lat   numeric(9,6);
  v_office_lng   numeric(9,6);
  v_allow_single boolean;
  v_headers      jsonb;
  v_client_ip    inet;
  v_on_network   boolean := false;
  v_wifi_status  text := 'unavailable';
begin
  if v_employee_id is null then
    raise exception 'Authentication is required';
  end if;

  if not exists (
    select 1 from public.profiles
    where user_id = v_employee_id
      and role = 'employee'
      and active = true
  ) then
    raise exception 'An active employee account is required';
  end if;

  if (p_gps_latitude is null) <> (p_gps_longitude is null) then
    raise exception 'GPS latitude and longitude must be supplied together';
  end if;

  if p_gps_latitude is not null and
     (p_gps_latitude not between -90 and 90 or
      p_gps_longitude not between -180 and 180)
  then
    raise exception 'GPS coordinates are out of range';
  end if;

  if p_gps_accuracy_m is not null and
     p_gps_accuracy_m not between 0 and 10000
  then
    raise exception 'GPS accuracy is out of range';
  end if;

  /* Resolve the caller's IP. Anything unexpected here — no PostgREST request
     context, absent headers, an unparseable address — must degrade to "no
     network signal" and let GPS decide. A punch must never fail because a
     header was malformed. */
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
    v_client_ip := nullif(
      coalesce(v_headers ->> 'cf-connecting-ip', v_headers ->> 'sb-forwarded-for'),
      ''
    )::inet;
  exception when others then
    v_client_ip := null;
  end;

  if v_client_ip is not null then
    select exists (
      select 1
      from public.trusted_office_networks n
      where n.active
        and n.network >>= v_client_ip
    ) into v_on_network;

    v_wifi_status := case when v_on_network then 'verified' else 'failed' end;
  end if;

  select office_latitude, office_longitude, geofence_radius_m,
         maximum_gps_accuracy_m, allow_single_signal
  into   v_policy
  from   public.attendance_policy
  where  id;

  v_geo_radius   := v_policy.geofence_radius_m;
  v_max_accuracy := v_policy.maximum_gps_accuracy_m;
  v_office_lat   := v_policy.office_latitude;
  v_office_lng   := v_policy.office_longitude;
  v_allow_single := coalesce(v_policy.allow_single_signal, false);

  if p_gps_latitude is not null and
     v_office_lat is not null and
     v_office_lng is not null
  then
    v_distance_m := 6371000 * 2 * asin(sqrt(
      power(sin(radians(p_gps_latitude - v_office_lat) / 2), 2) +
      cos(radians(v_office_lat)) *
      cos(radians(p_gps_latitude)) *
      power(sin(radians(p_gps_longitude - v_office_lng) / 2), 2)
    ));

    if v_distance_m > v_geo_radius then
      v_status := 'blocked';
      v_reason := 'GPS is outside the configured office geofence.';

    elsif v_on_network then
      v_status := 'verified';
      v_reason := 'Punch arrived from a trusted office network, '
               || 'and GPS is inside the geofence.';

    elsif p_gps_accuracy_m is null or p_gps_accuracy_m > v_max_accuracy then
      v_status := 'pending';
      v_reason := 'GPS evidence is within range but accuracy requires review.';

    elsif v_allow_single then
      v_status := 'verified';
      v_reason := 'GPS inside geofence with acceptable accuracy; '
               || 'single-signal verification enabled by attendance policy.';

    else
      v_status := 'pending';
      v_reason := 'GPS evidence submitted; awaiting a second signal or admin review.';
    end if;

  elsif v_on_network then
    v_status := 'verified';
    v_reason := 'Punch arrived from a trusted office network; '
             || 'no usable GPS evidence was supplied.';

  elsif p_gps_latitude is not null then
    v_status := 'pending';
    v_reason := 'GPS evidence submitted but no office geofence is configured.';
  end if;

  select * into v_record
  from   public.attendance_records
  where  employee_id = v_employee_id
    and  attendance_day = v_day
  for update;

  if not found then
    insert into public.attendance_records (
      employee_id, attendance_day, check_in_at, clock_in_at,
      verification_status, wifi_assertion_status,
      gps_latitude, gps_longitude, gps_accuracy_m, gps_distance_m,
      verification_reason
    ) values (
      v_employee_id, v_day, now(), now(),
      v_status, v_wifi_status,
      p_gps_latitude, p_gps_longitude, p_gps_accuracy_m, v_distance_m,
      v_reason
    )
    returning * into v_record;

  elsif v_record.clock_out_at is null then
    update public.attendance_records
    set clock_out_at         = now(),
        gps_latitude         = coalesce(p_gps_latitude,   gps_latitude),
        gps_longitude        = coalesce(p_gps_longitude,  gps_longitude),
        gps_accuracy_m       = coalesce(p_gps_accuracy_m, gps_accuracy_m),
        gps_distance_m       = coalesce(v_distance_m,     gps_distance_m),
        wifi_assertion_status = v_wifi_status,
        verification_status  = case
                                 when verification_status = 'blocked'
                                 then 'blocked'
                                 else v_status
                               end,
        verification_reason  = case
                                 when verification_status = 'blocked'
                                 then verification_reason
                                 else v_reason
                               end
    where id = v_record.id
    returning * into v_record;

  else
    raise exception 'Today''s attendance already has a clock-out time';
  end if;

  return v_record;
end;
$$;

revoke all on function public.punch_attendance(numeric, numeric, numeric)
  from public, anon;
grant execute on function public.punch_attendance(numeric, numeric, numeric)
  to authenticated;
