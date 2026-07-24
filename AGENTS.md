# C4T Attendance System

## Overview

The Claude Design export in `C4T Attendance.dc.html` is the accepted visual and interaction contract. Build real functionality behind it; do not replace its layouts or invent a second UI.

## Source of truth

- `C4T Attendance.dc.html`: employee and admin routes, labels, controls and visual hierarchy.
- `BACKEND-CONTRACT.md`: API boundaries, data model, authorization and security invariants.
- `support.js`: the Claude Design runtime; do not edit unless the UI export itself requires a compatibility repair.

## Product rules

- Interface copy is Traditional Chinese with natural Hong Kong Cantonese.
- Employee and admin actions must use server-side authorization; never infer role from email text.
- GPS is a one-time advisory signal. A browser location must never alone auto-verify attendance.
- Wi-Fi auto-verification comes only from a trusted office gateway assertion; never expose gateway or service-role secrets to browser code.
- Preserve audit records for every admin review, policy change, schedule change and account status change.
- Do not make Supabase, Vercel, Auth user, database or credential changes without explicit approval.

## Development conventions

- Prefer Bun and platform APIs before new dependencies.
- Use `apply_patch` for text file edits.
- Create a failing-first test for non-trivial domain behavior, then make it pass.
- Run the narrowest relevant test, TypeScript check and real browser flow before claiming a slice complete.
- Keep generated screenshots and temporary browser/debug data outside the repository or clean them before handoff.

## Initial architecture

- Static design shell: root `C4T Attendance.dc.html` and `uploads/`.
- Planned API/data boundary: Supabase Auth + Postgres/RLS through server-only Bun/Vercel functions.
- Planned first vertical slice: authentication and employee/admin authorization routing.

## Avoid

- Do not use mock names, dates or attendance records as production seed data.
- Do not copy BIPO source code or brand assets.
- Do not add a maps API unless a design requirement cannot be served by browser Geolocation plus an admin-entered address.
