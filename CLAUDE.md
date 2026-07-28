# CLAUDE.md — C4T 打卡鐘

Entry point for any coding agent working in this repo. Read `proposal.md` first (what to
build), then the contracts below (how it must be built).

## Doc map

| File | Role |
|---|---|
| `proposal.md` | Product spec: mission, roles, screens, data models, build order, acceptance checklist. Source of truth for scope. |
| `BACKEND-CONTRACT.md` | API boundaries, security invariants, RLS rules. Source of truth for backend behavior. |
| `UI-UX-SPEC.md` | Screen-by-screen UI spec + mono design tokens. Source of truth for layout/visual detail. |
| `DESIGN.md` | Superseded by `UI-UX-SPEC.md` §2 for color tokens (mono theme replaced the blue "attendance beacon" theme). Layout primitives (`AppShell`, card radius, shadow rules) still apply. |
| `AGENTS.md` | Legacy note that `C4T Attendance.dc.html` is a visual contract. Treat `UI-UX-SPEC.md` as authoritative for any screen it covers; `AGENTS.md`'s dev conventions (Bun, `apply_patch`, test-first) still apply. |

## Current implementation status (2026-07-24)

**Real, live, do not casually rewrite:**
- Supabase Auth + Postgres schema, single-tenant: `profiles`, `work_schedules`,
  `attendance_policy`, `attendance_records`, `attendance_audit_events`, `employee_roster`,
  `trusted_wifi_gateways`, plus `punch_attendance()` RPC (security-definer, geofence math,
  Wi-Fi-gateway-assertion aware). 7 migrations in `supabase/migrations/`. Connects to a real
  Supabase project (see `runtime-config.js` — publishable key only, safe to commit).
- `index.html` / `app.js` / `style.css`: mono-themed login + a minimal employee/admin shell
  (home, records, profile / overview, records, approvals, employees, settings). This covers a
  fraction of the screens in `proposal.md` — most are not built yet.
- `live-auth.js`: real Supabase sign-in + real `punch_attendance` RPC call, role-routed from
  `profiles.role` (never from the email string).

**Not built yet:** organizations/multi-tenancy, clock-in point CRUD, shifts/scheduling, leave
requests, correction requests, reports/export, QR clock-in. See `proposal.md` build order.

## Hard rules (carried from `BACKEND-CONTRACT.md` — do not relax)

1. No Supabase, Vercel, Auth user, database, or credential changes without explicit approval
   in chat first — this includes new migrations. Ask, then act.
2. Role is always `profiles.role` read server-side / via RLS. Never infer role from an email
   string or any client-supplied value.
3. **Amended 2026-07-27 (GPS-only MVP, approved in chat).** GPS may auto-verify, but only via
   `attendance_policy.allow_single_signal` — currently `true`. With it on, a punch inside the
   geofence whose accuracy is within `maximum_gps_accuracy_m` is marked `verified`;
   out-of-range stays `blocked`, poor or missing accuracy stays `pending`. Set the flag back to
   `false` to restore the original strict behaviour — no code change needed. Browser GPS is
   spoofable; this is an accepted risk for one 6-person co-located site, not a general rule.
   Wi-Fi auto-verification (when built) still requires a signed trusted-gateway assertion
   (`trusted_wifi_gateways`), never a client-side SSID string match.
4. Every admin review, policy change, schedule change, and account status change writes a row
   to `attendance_audit_events`.
5. No mock names/dates as production seed data; no DAKA or BIPO source, copy, or brand assets
   — C4T's own name/logo only, and only on Welcome/Login/Create/Join screens.

## Tenancy decision — resolved 2026-07-24

Staying single-tenant. The live schema keeps its current shape (no `organizations` table, no
`organization_id`). Consequences:
- Create Org (建立機構) and Join Org (加入機構) are UI-only against the existing single org:
  Create Org becomes "set up the admin account for this org" (there's only ever one), Join Org
  becomes "request to join" — validate the invite code against `employee_roster`
  (`provisioning_status = 'pending'`) rather than creating a new `organizations` row.
- `Organization` is dropped from active scope in `proposal.md`'s data models. Revisit only if a
  second organization is ever actually needed — do not build it speculatively.
- `ClockInPoint`, `Shift`, `LeaveRequest`, `CorrectionRequest` still get built, just without an
  `organization_id` column (single implicit org, same as every other table today).

Migrations for the four tables above are still new schema changes on the live project and each
still needs rule 1's explicit-approval gate before being applied to the remote database — write
the migration files, but don't run `supabase db push` (or equivalent) without a chat go-ahead.

## Dev conventions

- Static frontend: no build step for `index.html`/`app.js`/`style.css`. `support.js` is
  generated from `dc-runtime/src/*.ts` — do not hand-edit; rebuild with
  `cd dc-runtime && bun run build` if that source exists.
- Supabase schema changes go in a new file under `supabase/migrations/`, timestamp-prefixed,
  additive (`add column if not exists`, etc.) matching the existing style — see any file in
  that folder for the house SQL style (RLS policy naming, `private.touch_updated_at()` trigger
  pattern, `security definer` + `set search_path` on every function).
- Prefer Bun and platform APIs before new dependencies (`AGENTS.md`).
- Keep generated screenshots/debug artifacts out of the repo (`.gitignore` already excludes
  local tool state — `.agents/`, `.omo/`, `.freebuff/`, `.codegraph`).
