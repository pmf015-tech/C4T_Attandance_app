create table public.employee_roster (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users (id) on delete set null,
  employee_number text not null unique check (char_length(employee_number) between 1 and 32),
  full_name_zh text not null check (char_length(full_name_zh) between 1 and 80),
  full_name_en text not null check (char_length(full_name_en) between 1 and 120),
  phone text not null check (char_length(phone) between 8 and 32),
  email text unique,
  department text check (department is null or char_length(department) between 1 and 80),
  position text not null check (char_length(position) between 1 and 80),
  role attendance_role not null default 'employee',
  active boolean not null default true,
  work_start time,
  work_end time,
  work_days jsonb not null default '[0,1,1,1,1,1,0]'::jsonb,
  timezone text not null default 'Asia/Hong_Kong',
  provisioning_status text not null default 'pending'
    check (provisioning_status in ('pending', 'provisioned', 'needs_email', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((role = 'admin' and work_start is null and work_end is null) or (role = 'employee' and work_start is not null and work_end is not null and work_end > work_start)),
  check (private.is_valid_work_days(work_days))
);

create table public.trusted_wifi_gateways (
  id uuid primary key default gen_random_uuid(),
  gateway_name text not null unique check (char_length(gateway_name) between 1 and 80),
  issuer text not null unique check (char_length(issuer) between 1 and 255),
  audience text not null check (char_length(audience) between 1 and 255),
  key_id text not null unique check (char_length(key_id) between 1 and 120),
  public_jwk jsonb not null check (jsonb_typeof(public_jwk) = 'object'),
  allowed_ssid text not null check (char_length(allowed_ssid) between 1 and 64),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.employee_roster enable row level security;
alter table public.trusted_wifi_gateways enable row level security;

revoke all on table public.employee_roster from anon, authenticated;
revoke all on table public.trusted_wifi_gateways from anon, authenticated;

create policy "Admins can read employee roster"
on public.employee_roster for select to authenticated
using ((select private.is_attendance_admin()));

create policy "Admins can read trusted gateways"
on public.trusted_wifi_gateways for select to authenticated
using ((select private.is_attendance_admin()));

create trigger employee_roster_touch_updated_at
before update on public.employee_roster
for each row execute procedure private.touch_updated_at();

create trigger trusted_wifi_gateways_touch_updated_at
before update on public.trusted_wifi_gateways
for each row execute procedure private.touch_updated_at();

create or replace function private.sync_employee_roster_to_profile()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.auth_user_id is not null and new.role = 'employee' then
    update public.profiles
    set full_name = new.full_name_zh,
        department = new.department,
        position = new.position,
        employee_number = new.employee_number,
        phone = new.phone,
        active = new.active
    where user_id = new.auth_user_id;

    insert into public.work_schedules (employee_id, work_start, work_end, work_days, timezone)
    values (new.auth_user_id, new.work_start, new.work_end, new.work_days, new.timezone)
    on conflict (employee_id) do update
    set work_start = excluded.work_start,
        work_end = excluded.work_end,
        work_days = excluded.work_days,
        timezone = excluded.timezone;
  elsif new.auth_user_id is not null and new.role = 'admin' then
    update public.profiles
    set full_name = new.full_name_zh,
        department = new.department,
        position = new.position,
        employee_number = new.employee_number,
        phone = new.phone,
        active = new.active,
        role = 'admin'
    where user_id = new.auth_user_id;
  end if;

  return new;
end;
$$;

revoke all on function private.sync_employee_roster_to_profile() from public;

create trigger employee_roster_sync_profile
after insert or update of auth_user_id, full_name_zh, department, position, employee_number, phone, active, work_start, work_end, work_days, timezone, role
on public.employee_roster
for each row execute procedure private.sync_employee_roster_to_profile();
