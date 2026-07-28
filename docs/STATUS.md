# C4T Attendance — Delivery Status

Updated: 2026-07-28 (HKT)

## Current stage

Stage 2 — Repository Readiness is complete.

- Bun runtime and package version are pinned.
- Biome lint, JavaScript syntax checks and Bun tests run through `bun run check`.
- The auth boundary test locks script order, profile-backed role routing and the no-service-role-key browser rule.
- A real browser smoke check renders the Traditional Chinese login page without application console errors.

## Next vertical slice

Stage 4 — replace the employee attendance-history mock with the signed-in employee's own `attendance_records` query, protected by the existing Supabase RLS policy, and refresh it after a successful punch.

This slice does not require a new database migration. Live UAT will require an approved temporary employee account or credentials supplied through the browser by the user.

## External-change boundary

Do not change hosted Supabase data/schema/Auth, Vercel, credentials or deployment settings without explicit user approval.
