-- One-time QR activation for phone-password attendance accounts.
-- The browser receives only a high-entropy bearer token. Postgres stores a
-- SHA-256 hash, consumes it once, and assigns all employee fields from roster.

create extension if not exists pgcrypto with schema extensions;

create table public.onboarding_invites (
  id uuid primary key default gen_random_uuid(),
  employee_roster_id uuid not null references public.employee_roster (id) on delete cascade,
  token_hash text not null unique check (char_length(token_hash) = 64),
  created_by uuid not null references public.profiles (user_id) on delete restrict,
  expires_at timestamptz not null,
  redeemed_at timestamptz,
  redeemed_by uuid references public.profiles (user_id) on delete set null,
  created_at timestamptz not null default now(),
  check (expires_at > created_at),
  check ((redeemed_at is null and redeemed_by is null) or (redeemed_at is not null and redeemed_by is not null))
);

create index onboarding_invites_roster_pending_idx
on public.onboarding_invites (employee_roster_id, expires_at desc)
where redeemed_at is null;

alter table public.onboarding_invites enable row level security;
revoke all on table public.onboarding_invites from anon, authenticated;

create or replace function public.create_onboarding_invite(p_employee_number text)
returns table (
  token text,
  employee_number text,
  full_name_zh text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_actor_id uuid := auth.uid();
  v_roster public.employee_roster;
  v_token text := encode(extensions.gen_random_bytes(32), 'hex');
  v_expires_at timestamptz := now() + interval '15 minutes';
begin
  if v_actor_id is null or not private.is_attendance_admin() then
    raise exception 'Administrator access is required';
  end if;

  select * into v_roster
  from public.employee_roster
  where employee_number = upper(trim(p_employee_number))
    and active
    and auth_user_id is null
    and provisioning_status <> 'disabled'
  for update;

  if not found then
    raise exception 'Active unprovisioned employee was not found';
  end if;

  update public.onboarding_invites
  set expires_at = now()
  where employee_roster_id = v_roster.id
    and redeemed_at is null
    and expires_at > now();

  insert into public.onboarding_invites (
    employee_roster_id, token_hash, created_by, expires_at
  ) values (
    v_roster.id,
    encode(extensions.digest(v_token, 'sha256'), 'hex'),
    v_actor_id,
    v_expires_at
  );

  insert into public.attendance_audit_events (
    actor_id, action, resource_type, resource_key, next_value, note
  ) values (
    v_actor_id,
    'account.onboarding_invite.create',
    'employee_roster',
    v_roster.employee_number,
    jsonb_build_object('expires_at', v_expires_at),
    'One-time QR account activation invitation issued.'
  );

  return query select v_token, v_roster.employee_number, v_roster.full_name_zh, v_expires_at;
end;
$$;

revoke all on function public.create_onboarding_invite(text) from public, anon;
grant execute on function public.create_onboarding_invite(text) to authenticated;

create or replace function public.handle_new_attendance_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_token text := nullif(new.raw_user_meta_data ->> 'onboarding_token', '');
  v_roster public.employee_roster;
  v_invite public.onboarding_invites;
  v_expected_email text;
begin
  if v_token is null or v_token !~ '^[0-9a-f]{64}$' then
    raise exception 'A valid onboarding QR code is required';
  end if;

  select i.* into v_invite
  from public.onboarding_invites i
  where i.token_hash = encode(extensions.digest(v_token, 'sha256'), 'hex')
    and i.redeemed_at is null
    and i.expires_at > now()
  for update;

  if not found then
    raise exception 'The onboarding QR code is invalid or expired';
  end if;

  select * into v_roster
  from public.employee_roster
  where id = v_invite.employee_roster_id
    and active
    and auth_user_id is null
  for update;

  if not found then
    raise exception 'The employee account is unavailable for onboarding';
  end if;

  v_expected_email := lower(regexp_replace(v_roster.phone, '\\D', '', 'g') || '@staff.sunspeed.invalid');
  if lower(new.email) <> v_expected_email then
    raise exception 'The phone number does not match this onboarding QR code';
  end if;

  insert into public.profiles (
    user_id, full_name, role, department, position, employee_number, phone, active
  ) values (
    new.id,
    v_roster.full_name_zh,
    v_roster.role,
    v_roster.department,
    v_roster.position,
    v_roster.employee_number,
    v_roster.phone,
    true
  );

  if v_roster.role = 'employee' then
    insert into public.work_schedules (
      employee_id, work_start, work_end, work_days, timezone
    ) values (
      new.id, v_roster.work_start, v_roster.work_end, v_roster.work_days, v_roster.timezone
    );
  end if;

  update public.employee_roster
  set auth_user_id = new.id,
      provisioning_status = 'provisioned'
  where id = v_roster.id;

  update public.onboarding_invites
  set redeemed_at = now(),
      redeemed_by = new.id
  where id = v_invite.id;

  insert into public.attendance_audit_events (
    actor_id, action, resource_type, resource_key, previous_value, next_value, note
  ) values (
    new.id,
    'account.onboarding_invite.redeem',
    'employee_roster',
    v_roster.employee_number,
    jsonb_build_object('provisioning_status', v_roster.provisioning_status),
    jsonb_build_object('provisioning_status', 'provisioned', 'auth_user_id', new.id),
    'Account created through a one-time QR onboarding invitation.'
  );

  return new;
end;
$$;

revoke all on function public.handle_new_attendance_user() from public, anon, authenticated;
