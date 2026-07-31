-- Fix: `create_onboarding_invite` failed on every call with
-- `column reference "employee_number" is ambiguous` (SQLSTATE 42702), which
-- PostgREST returned as HTTP 400, so the admin's "建立 QR" button could never
-- produce a QR code.
--
-- The cause is the function's own RETURNS TABLE columns. `employee_number` and
-- `expires_at` are plpgsql variables inside the body, and they were also used
-- unqualified as column references in the roster lookup and the invite-expiry
-- update — plpgsql cannot decide which one is meant and raises at runtime.
-- Qualifying every column reference with a table alias resolves it; the
-- returned column names, signature, and grants are unchanged.
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

  select r.* into v_roster
  from public.employee_roster r
  where r.employee_number = upper(trim(p_employee_number))
    and r.active
    and r.auth_user_id is null
    and r.provisioning_status <> 'disabled'
  for update;

  if not found then
    raise exception 'Active unprovisioned employee was not found';
  end if;

  update public.onboarding_invites i
  set expires_at = now()
  where i.employee_roster_id = v_roster.id
    and i.redeemed_at is null
    and i.expires_at > now();

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
