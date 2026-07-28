-- ══════════════════════════════════════════════════════════════
-- Link employee_roster rows to their Supabase Auth users
--
-- NOT a migration: this only works once the six Auth accounts
-- exist, and account creation is a human step (passwords must
-- never pass through an agent or a repo file).
--
-- ── Step 1 — the admin creates six users in the Supabase
--    dashboard (Authentication -> Users -> Add user), using the
--    phone-as-login addresses below and "Auto Confirm User" ON.
--    Passwords are set by the admin and handed to staff directly.
--
--      92896230@staff.sunspeed.invalid   SS-001      龔德香
--      53006893@staff.sunspeed.invalid   SS-002      潘水容
--      69315605@staff.sunspeed.invalid   SS-003      呂立勤
--      63550186@staff.sunspeed.invalid   SS-004      徐永艷
--      60741588@staff.sunspeed.invalid   SS-005      黃凱勇
--      64112221@staff.sunspeed.invalid   SS-ADM-001  黃麗霞 (admin)
--
--    The `.invalid` TLD is reserved by RFC 2606 and can never
--    receive mail — deliberate. These accounts have no email
--    recovery; the admin resets passwords. Real contact addresses
--    stay in employee_roster.email for future notifications.
--
--    Creating a user fires on_auth_user_created_for_attendance,
--    which inserts the matching public.profiles row.
--
-- ── Step 2 — run this script. It matches each roster row to its
--    Auth user by phone number and links them. The
--    employee_roster_sync_profile trigger then pushes name,
--    position, role and work schedule into profiles/work_schedules.
--
-- ── Step 3 — verify with the SELECT at the bottom. Every row
--    should read linked = true.
-- ══════════════════════════════════════════════════════════════

begin;

update public.employee_roster r
set auth_user_id       = u.id,
    provisioning_status = 'provisioned'
from auth.users u
where u.email = r.phone || '@staff.sunspeed.invalid'
  and r.auth_user_id is null;

insert into public.attendance_audit_events (
  actor_id, action, resource_type, resource_key,
  previous_value, next_value, note
)
select null,
       'account.provision',
       'employee_roster',
       r.employee_number,
       jsonb_build_object('provisioning_status', 'pending', 'auth_user_id', null),
       jsonb_build_object('provisioning_status', 'provisioned', 'auth_user_id', r.auth_user_id),
       'Linked to Auth user via phone-as-login address.'
from public.employee_roster r
where r.auth_user_id is not null
  and r.provisioning_status = 'provisioned';

commit;

-- Verification
select employee_number, full_name_zh, role, provisioning_status,
       (auth_user_id is not null) as linked
from public.employee_roster
order by employee_number;
