create type public.attendance_role as enum ('admin', 'employee');
create type public.attendance_verification as enum ('pending', 'verified', 'blocked');

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null check (char_length(full_name) between 1 and 80),
  role public.attendance_role not null default 'employee',
  created_at timestamptz not null default now()
);

create table public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles (user_id) on delete cascade,
  check_in_at timestamptz not null default now(),
  attendance_day date not null default ((now() at time zone 'Asia/Hong_Kong')::date),
  verification_status public.attendance_verification not null default 'pending',
  network_label text check (char_length(network_label) <= 64),
  note text not null default '' check (char_length(note) <= 240),
  created_at timestamptz not null default now()
);

create index attendance_records_employee_time_idx on public.attendance_records (employee_id, check_in_at desc);
create index attendance_records_status_time_idx on public.attendance_records (verification_status, check_in_at desc);
create unique index attendance_records_one_check_in_per_day_idx on public.attendance_records (employee_id, attendance_day);

create schema if not exists private;

create function private.is_attendance_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles
    where user_id = (select auth.uid())
      and role = 'admin'
  );
$$;

revoke all on function private.is_attendance_admin() from public;
grant usage on schema private to authenticated;
grant execute on function private.is_attendance_admin() to authenticated;

create function public.handle_new_attendance_user()
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
  return new;
end;
$$;

revoke all on function public.handle_new_attendance_user() from public;

create trigger on_auth_user_created_for_attendance
after insert on auth.users
for each row execute procedure public.handle_new_attendance_user();

alter table public.profiles enable row level security;
alter table public.attendance_records enable row level security;

grant select on public.profiles to authenticated;
grant select, update on public.attendance_records to authenticated;

create policy "Employees can read their own profile"
on public.profiles
for select to authenticated
using ((select auth.uid()) = user_id);

create policy "Admins can read all profiles"
on public.profiles
for select to authenticated
using ((select private.is_attendance_admin()));

create policy "Employees can read their attendance"
on public.attendance_records
for select to authenticated
using ((select auth.uid()) = employee_id);

create policy "Admins can read all attendance"
on public.attendance_records
for select to authenticated
using ((select private.is_attendance_admin()));

create policy "Admins can review attendance"
on public.attendance_records
for update to authenticated
using ((select private.is_attendance_admin()))
with check ((select private.is_attendance_admin()));
