# C4T Attendance — Delivery Status

Updated: 2026-07-30 (HKT)

## Current stage

Stage 4 — Building. A-2 complete: the app no longer ships any mock data.

## Completed 2026-07-30

### A-2 — every screen reads the real database
`data/mock-data.js` is deleted. The invented staff (黃嘉怡 / 潘家明 / 陳雅雯) are
gone from the codebase; every name, employee number, shift and time on screen now
comes from Postgres.

- `lib/admin-dashboard.js` (new): pure `initials()`, `weekday()`,
  `adminAttendanceRow()`, `todaySummary()`, `rosterEntry()`. Delegates clock and
  lateness shaping to `attendance-history.js` so the employee and admin sides can
  never disagree about the same record.
- `tests/admin-dashboard.test.js` (new): 17 tests, written failing-first.
- `live-auth.js`: `routeAuthenticatedUser()` now loads the full `profiles` row into
  state; `refreshAdminDashboard()` loads `attendance_records` (with the joined
  profile), `work_schedules`, `employee_roster` and `attendance_policy`.
- `app.js`: 總覽, 出勤紀錄, 審批中心, 員工管理, 系統設定 and the employee
  home/profile screens all render from that state, with explicit loading, empty
  and read-failure states instead of sample rows.
- 員工管理 lists all six real staff with each person's **own** shift and their
  啟用/待啟用 status, and a per-row 建立 QR button that prefills the employee number.
- 系統設定 shows the live `attendance_policy` read-only — it was hard-coded to a
  150 m geofence while the database has enforced 50 m since 2026-07-29.

**Lateness is per employee.** The six staff do not share a shift (09:30–16:30
through 09:00–18:00), and each record is judged against that employee's own
`work_schedules.work_start`. `attendance_policy.default_work_*` is only the
fallback for an account with no schedule, and the settings screen says so.

**Evidence**: `bun run check` → 47 pass / 0 fail, biome clean, syntax clean.
Admin overview, records, employees, settings, the invite modal, and the employee
home/profile screens rendered in a real browser against database-shaped rows,
plus the loading / empty / read-failure states. The PostgREST embed was proven
against the live API (correct FK → `[]` under RLS; a deliberately wrong FK →
`PGRST200`), and the new grant was proven safe in SQL: an employee sees 0 roster
rows, the admin sees 6, anon is denied outright.

### Schema change (owner-approved 2026-07-30)
`20260730120000_employee_roster_read_grant.sql` — `grant select on
public.employee_roster to authenticated`. Closes the A-5 gap: the RLS policy
"Admins can read employee roster" existed with no grant behind it, so the query
returned nothing. SELECT only; the admin-only policy is unchanged.

### Cache-busting
Local scripts and `style.css` now carry a shared `?v=` token in `index.html`.
The static host serves them with heuristic freshness, which is why every previous
verification round needed a fresh port. Bump the token when these files change.

## Completed 2026-07-29 (previous session)

### Accounts and schema
- Six pending migrations applied to the live project: `rpc_search_path_hardening`,
  `clock_in_points`, `leave_requests`, `correction_requests`, `shifts`,
  `qr_phone_onboarding_phone_regex_fix`. Local migration filenames and remote
  ledger versions still disagree — see issue #1; do **not** run `supabase db push`.
- `SS-ADM-001` (admin) and `SS-001` (employee) activated end-to-end through the
  real QR onboarding flow. Roster already matches the real six-person staff list.

### A-1 — punch state now reads from the database
- `lib/punch-state.js` (new): pure `derivePunchState()` / `hongKongAttendanceDay()`.
- `tests/punch-state.test.js` (new): 6 tests, written failing-first.
- `live-auth.js`: `refreshPunchState()` reads today's `attendance_records` row on
  sign-in and after every punch; the local `clockedIn` toggle is gone.
- `app.js`: button label/disabled state and clock-in time derive from that row;
  read failures surface on the punch card instead of a hidden `#login-error`.
- `index.html`, `package.json`: load and lint/syntax-check the new file.

**Evidence**: `bun run check` → 12 pass / 0 fail, biome clean, syntax clean.
Six render states verified in a real browser (loading, no record, clocked in,
pending, done, blocked) plus the read-failure state. RLS-scoped SQL confirmed the
query returns exactly one row for the signed-in employee, and the client's HKT
date matches the database's.

**Verification note**: the preview browser caches `app.js` aggressively; each
verification round needed a fresh port. `.claude/launch.json` is back on 4173.

### A-4 — a location-less punch is no longer silent
- `lib/geolocation-notice.js` (new): pure `geolocationFailureReason()` mapping
  denied / unavailable / timeout / unsupported / insecure-origin to a message
  that always states "需要管理員審批".
- `tests/geolocation-notice.test.js` (new): 8 tests, written failing-first,
  including regression locks so `() => submitPunch(null)` cannot return.
- `live-auth.js`: geolocation failure now explains the cause and asks the
  employee to confirm; declining re-enables the button and records nothing.
  An insecure (non-HTTPS) origin is treated as a failure up front.

**Evidence**: `bun run check` → 20 pass / 0 fail. All five messages rendered in
a real browser; `window.isSecureContext` confirmed true on localhost.

### Attendance policy tightened (owner-approved, 2026-07-29)
`geofence_radius_m` 150 → **50**, `maximum_gps_accuracy_m` 80 → **50**, with an
`attendance_policy.update` audit event. Accuracy had to move with the radius:
leaving it at 80 would have stamped "verified" on readings whose true position
could be 130 m away. Verified read-only against the deployed haversine — 0/20/45 m
with accuracy ≤50 auto-verify; 55 m and 120 m block; accuracy 51 or null stays
pending.

## Known gaps (not fixed)

- **GPS end-to-end unproven** — no punch has ever carried real coordinates. The
  only live record has `gps_accuracy_m = null`. Needs one real phone punch at the
  office; today's record already has a clock-out so `punch_attendance()` will
  reject another punch until 2026-07-30.
- **HTTPS required in production** — `navigator.geolocation` only works in a
  secure context. A plain-http deployment sends every punch to `pending`.
- **A-3** — no `review_attendance_record()` RPC exists; the admin approve/reject
  buttons have no backend, so they now render **disabled** with the reason stated
  on screen rather than faking an approval. Needs a migration (approval required).
- **Settings are read-only** — editing `attendance_policy` from the browser needs
  an audited write path (BACKEND-CONTRACT rule 4) that does not exist. The screen
  says so instead of offering a save button that discards input.
- **Leftover UAT accounts** — `profiles` still holds two test rows from earlier
  UAT: `employee.uat` and, more seriously, **`UAT Admin` with `role = 'admin'`**.
  Neither has a roster row, so they do not appear on any screen, but the admin
  account is a live privilege. Removing them touches Auth users and live data —
  needs owner approval.
- **No CSV export / search on 出勤紀錄** — the previous toolbar had a search box,
  a status filter and an 匯出 CSV button that were decorative and did nothing.
  They were removed rather than left as false affordances; build them for real
  when needed.
- **Schema note (corrected)** — the earlier entry claiming no unique constraint on
  `(employee_id, attendance_day)` was wrong:
  `attendance_records_one_check_in_per_day_idx` is a unique index created in
  `20260711074725_attendance_portals.sql`. No migration needed.

## Next vertical slice

**A-3** — `review_attendance_record()` RPC so the admin approve/reject buttons
work: admin-only, writes `verification_status` + `reviewed_by` + `reviewed_at`,
and one `attendance_audit_events` row per decision (rule 4). Needs a migration,
so it needs approval first.

## External-change boundary

Do not change hosted Supabase data/schema/Auth, Vercel, credentials or deployment
settings without explicit user approval. Never commit activation tokens, phone
numbers, or auth UUIDs — the GitHub repository is public.
