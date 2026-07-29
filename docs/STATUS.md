# C4T Attendance — Delivery Status

Updated: 2026-07-29 (HKT)

## Current stage

Stage 4 — Building. One slice accepted this session (A-1).

## Completed this session

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
- **A-2** — every list/summary screen still renders `data/mock-data.js`, so an
  employee punch never reaches the admin side.
- **A-3** — no `review_attendance_record()` RPC exists; the admin approve/reject
  buttons have no backend. Needs a migration (approval required).
- **A-5** — `employee_roster` has no grant to `authenticated`; the admin employee
  screen will break when it moves off mock data. Needs a migration.
- **Schema** — `attendance_records` has no unique constraint on
  `(employee_id, attendance_day)`, only a primary key on `id`. Concurrent punches
  could create duplicate rows for one day. A-1 fails safe (the read errors and the
  button stays disabled) but the constraint should be added. Needs a migration.

## Next vertical slice

**A-2** — replace `data/mock-data.js` on the employee records screen with the
signed-in employee's own `attendance_records` query. This is the slice that first
makes a punch visible outside the punch card. Frontend only, no migration.

## External-change boundary

Do not change hosted Supabase data/schema/Auth, Vercel, credentials or deployment
settings without explicit user approval. Never commit activation tokens, phone
numbers, or auth UUIDs — the GitHub repository is public.
