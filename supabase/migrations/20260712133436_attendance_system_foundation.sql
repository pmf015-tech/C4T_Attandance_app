alter table public.profiles
  add column if not exists department text,
  add column if not exists position text,
  add column if not exists active boolean not null default true,
  add column if not exists updated_at timestamptz not null default now(),
  add constraint profiles_department_length_check check (department is null or char_length(department) between 1 and 80),
  add constraint profiles_position_length_check check (position is null or char_length(position) between 1 and 80);

create table public.work_schedules (
  employee_id uuid primary key references public.profiles (user_id) on delete cascade,
  work_start time not null default '09:00',
  work_end time not null default '18:00',
  work_days jsonb not null default '[0,1,1,1,1,1,0]'::jsonb,
  timezone text not null default 'Asia/Hong_Kong',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (work_end > work_start),
  check (jsonb_typeof(work_days) = 'array' and jsonb_array_length(work_days) = 7)
);

insert into public.work_schedules (employee_id)
select user_id from public.profiles
on conflict (employee_id) do nothing;

create table public.attendance_policy (
  id boolean primary key default true check (id),
  office_name text not null default 'C4T Office' check (char_length(office_name) between 1 and 80),
  office_address text,
  wifi_ssid text,
  gateway_name text,
  office_latitude numeric(9, 6),
  office_longitude numeric(9, 6),
  geofence_radius_m integer not null default 150 check (geofence_radius_m between 50 and 500),
  maximum_gps_accuracy_m integer not null default 80 check (maximum_gps_accuracy_m between 5 and 1000),
  default_work_start time not null default '09:00',
  default_work_end time not null default '18:00',
  late_tolerance_minutes integer not null default 10 check (late_tolerance_minutes between 0 and 180),
  allow_single_signal boolean not null default false,
  updated_by uuid references public.profiles (user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((office_latitude is null and office_longitude is null) or (office_latitude between -90 and 90 and office_longitude between -180 and 180)),
  check (default_work_end > default_work_start)
);

insert into public.attendance_policy (id)
values (true)
on conflict (id) do nothing;

alter table public.attendance_records
  add column if not exists clock_in_at timestamptz,
  add column if not exists clock_out_at timestamptz,
  add column if not exists wifi_assertion_status text not null default 'unavailable' check (wifi_assertion_status in ('unavailable', 'verified', 'failed')),
  add column if not exists gateway_assertion_at timestamptz,
  add column if not exists gps_latitude numeric(9, 6),
  add column if not exists gps_longitude numeric(9, 6),
  add column if not exists gps_accuracy_m numeric(8, 2),
  add column if not exists gps_distance_m numeric(10, 2),
  add column if not exists verification_reason text not null default '' check (char_length(verification_reason) <= 400),
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references public.profiles (user_id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

update public.attendance_records
set clock_in_at = check_in_at
where clock_in_at is null;

alter table public.attendance_records
  alter column clock_in_at set not null,
  add constraint attendance_records_clock_order_check check (clock_out_at is null or clock_out_at > clock_in_at),
  add constraint attendance_records_gps_coordinates_check check (
    (gps_latitude is null and gps_longitude is null)
    or (gps_latitude between -90 and 90 and gps_longitude between -180 and 180)
  ),
  add constraint attendance_records_gps_measurements_check check (
    (gps_accuracy_m is null or gps_accuracy_m >= 0)
    and (gps_distance_m is null or gps_distance_m >= 0)
  );

create index attendance_records_day_employee_idx
on public.attendance_records (attendance_day desc, employee_id);

create index attendance_records_review_queue_idx
on public.attendance_records (verification_status, attendance_day desc)
where verification_status = 'pending';

create table public.attendance_audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles (user_id) on delete set null,
  action text not null check (char_length(action) between 1 and 80),
  resource_type text not null check (char_length(resource_type) between 1 and 80),
  resource_key text not null check (char_length(resource_key) between 1 and 120),
  previous_value jsonb,
  next_value jsonb,
  note text,
  created_at timestamptz not null default now()
);

create index attendance_audit_events_resource_idx
on public.attendance_audit_events (resource_type, resource_key, created_at desc);

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function private.touch_updated_at() from public;

create trigger profiles_touch_updated_at
before update on public.profiles
for each row execute procedure private.touch_updated_at();

create trigger work_schedules_touch_updated_at
before update on public.work_schedules
for each row execute procedure private.touch_updated_at();

create trigger attendance_policy_touch_updated_at
before update on public.attendance_policy
for each row execute procedure private.touch_updated_at();

create trigger attendance_records_touch_updated_at
before update on public.attendance_records
for each row execute procedure private.touch_updated_at();

create or replace function public.handle_new_attendance_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (user_id, full_name)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1))
  );
  insert into public.work_schedules (employee_id)
  values (new.id);
  return new;
end;
$$;

revoke all on function public.handle_new_attendance_user() from public, anon, authenticated;

alter table public.work_schedules enable row level security;
alter table public.attendance_policy enable row level security;
alter table public.attendance_audit_events enable row level security;

grant select, update on public.profiles to authenticated;
grant select, update on public.attendance_records to authenticated;
grant select on public.work_schedules to authenticated;
grant select on public.attendance_audit_events to authenticated;

drop policy if exists "Employees can read their own profile" on public.profiles;
drop policy if exists "Admins can read all profiles" on public.profiles;
create policy "Profiles: owner or admin can read"
on public.profiles for select to authenticated
using (((select auth.uid()) = user_id) or (select private.is_attendance_admin()));

create policy "Admins can update profiles"
on public.profiles for update to authenticated
using ((select private.is_attendance_admin()))
with check ((select private.is_attendance_admin()));

create policy "Schedules: owner or admin can read"
on public.work_schedules for select to authenticated
using (((select auth.uid()) = employee_id) or (select private.is_attendance_admin()));

create policy "Admins can manage schedules"
on public.work_schedules for all to authenticated
using ((select private.is_attendance_admin()))
with check ((select private.is_attendance_admin()));

create policy "Admins can read attendance policy"
on public.attendance_policy for select to authenticated
using ((select private.is_attendance_admin()));

create policy "Admins can update attendance policy"
on public.attendance_policy for update to authenticated
using ((select private.is_attendance_admin()))
with check ((select private.is_attendance_admin()));

drop policy if exists "Employees can read their attendance" on public.attendance_records;
drop policy if exists "Admins can read all attendance" on public.attendance_records;
create policy "Attendance: owner or admin can read"
on public.attendance_records for select to authenticated
using (((select auth.uid()) = employee_id) or (select private.is_attendance_admin()));

drop policy if exists "Admins can review attendance" on public.attendance_records;
create policy "Admins can update attendance"
on public.attendance_records for update to authenticated
using ((select private.is_attendance_admin()))
with check ((select private.is_attendance_admin()));

create policy "Admins can read attendance audit events"
on public.attendance_audit_events for select to authenticated
using ((select private.is_attendance_admin()));
