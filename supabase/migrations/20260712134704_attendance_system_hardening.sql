alter table public.profiles
  add column employee_number text,
  add column phone text,
  add column employment_start_date date,
  add constraint profiles_employee_number_length_check check (employee_number is null or char_length(employee_number) between 1 and 32),
  add constraint profiles_phone_length_check check (phone is null or char_length(phone) between 1 and 32);

create unique index profiles_employee_number_unique_idx
on public.profiles (employee_number)
where employee_number is not null;

alter table public.attendance_records
  add column review_note text not null default '' check (char_length(review_note) <= 400);

create function private.is_valid_work_days(days jsonb)
returns boolean
language sql
immutable
security invoker
set search_path = pg_catalog
as $$
  select jsonb_typeof(days) = 'array'
    and jsonb_array_length(days) = 7
    and not exists (
      select 1
      from jsonb_array_elements_text(days) as item(value)
      where item.value not in ('0', '0.5', '1')
    );
$$;

revoke all on function private.is_valid_work_days(jsonb) from public;

alter table public.work_schedules
  add constraint work_schedules_work_days_values_check check (private.is_valid_work_days(work_days));
