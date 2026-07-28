-- ══════════════════════════════════════════════════════════════
-- Clock-in points — admin-managed GPS / Wi-Fi / QR locations
-- Single-tenant (see CLAUDE.md "Tenancy decision"): no org scoping.
-- ══════════════════════════════════════════════════════════════

create table public.clock_in_points (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  type text not null check (type in ('gps', 'wifi', 'qr')),
  address text check (address is null or char_length(address) <= 200),
  latitude numeric(9, 6),
  longitude numeric(9, 6),
  radius_m integer check (radius_m is null or radius_m between 10 and 2000),
  wifi_ssid text check (wifi_ssid is null or char_length(wifi_ssid) between 1 and 64),
  wifi_bssid text check (wifi_bssid is null or char_length(wifi_bssid) between 1 and 64),
  qr_code text unique,
  active boolean not null default true,
  created_by uuid references public.profiles (user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (type = 'gps' and latitude is not null and longitude is not null)
    or (type = 'wifi' and wifi_ssid is not null)
    or (type = 'qr' and qr_code is not null)
  ),
  check (
    (latitude is null and longitude is null)
    or (latitude between -90 and 90 and longitude between -180 and 180)
  )
);

create index clock_in_points_active_idx on public.clock_in_points (type, active);

alter table public.clock_in_points enable row level security;

revoke all on table public.clock_in_points from anon, authenticated;

grant select on public.clock_in_points to authenticated;
grant insert, update, delete on public.clock_in_points to authenticated;

create policy "Clock-in points: admins manage"
on public.clock_in_points for all to authenticated
using ((select private.is_attendance_admin()))
with check ((select private.is_attendance_admin()));

create policy "Clock-in points: employees read active points"
on public.clock_in_points for select to authenticated
using (active = true);

create trigger clock_in_points_touch_updated_at
before update on public.clock_in_points
for each row execute procedure private.touch_updated_at();

-- Keep punch_attendance() working unchanged: mirror the active GPS/Wi-Fi
-- point onto the single attendance_policy row it already reads.
create or replace function private.sync_clock_in_point_to_policy()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.active is not true then
    return new;
  end if;

  if new.type = 'gps' then
    update public.attendance_policy
    set office_latitude = new.latitude,
        office_longitude = new.longitude,
        geofence_radius_m = coalesce(new.radius_m, geofence_radius_m),
        office_address = coalesce(new.address, office_address)
    where id = true;
  elsif new.type = 'wifi' then
    update public.attendance_policy
    set wifi_ssid = new.wifi_ssid,
        gateway_name = coalesce(new.name, gateway_name)
    where id = true;
  end if;

  return new;
end;
$$;

revoke all on function private.sync_clock_in_point_to_policy() from public, anon, authenticated;

create trigger clock_in_points_sync_policy
after insert or update of active, latitude, longitude, radius_m, wifi_ssid, address, name
on public.clock_in_points
for each row execute procedure private.sync_clock_in_point_to_policy();
