-- ══════════════════════════════════════════════════════════════
-- Let the admin employee screen read the roster.
--
-- `employee_roster_and_gateway_contract` revoked every privilege from
-- `authenticated` and then created the RLS policy "Admins can read
-- employee roster". A policy without a grant selects nothing: the
-- admin 員工管理 screen came back empty, which is why it was still
-- rendering mock rows.
--
-- SELECT only, and the existing policy still restricts the visible rows
-- to `private.is_attendance_admin()`. Employees remain unable to read
-- any roster row, including their own — nothing about RLS changes here.
--
-- Owner-approved 2026-07-30 (BACKEND-CONTRACT rule 1).
-- ══════════════════════════════════════════════════════════════

grant select on table public.employee_roster to authenticated;
