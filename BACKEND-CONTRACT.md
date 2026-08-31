# C4T Attendance System — Backend Contract

Source of truth for UI: `C4T Attendance.dc.html` (Claude Design, 2026-07-12).

## Product boundary

One web application with role-specific workspaces:

- Employee: password login, clock in/out, inspect own attendance history and calendar, update password.
- Admin (Lisa Huang): dashboard, audit records, approve/block exceptions, employee directory, individual schedules, attendance policy and CSV export.

The supplied UI is a visual contract only. Its hard-coded people, dates, Wi-Fi/GPS values and `onLogin` email-string role check must be replaced; none are production data.

## Authoritative journeys

| Journey | UI action | Server contract | Authorization |
| --- | --- | --- | --- |
| Sign in | login form | `POST /api/auth/sign-in` or Supabase Auth password flow | unauthenticated |
| Employee clock in/out | 上班打卡／下班打卡 | `POST /api/attendance/punch` | own employee only |
| Employee attendance | 我的出勤 | `GET /api/attendance/me?month=YYYY-MM` | own records only |
| Change password | 更新密碼 | Supabase Auth password update | own user only |
| Forgotten phone-login password | 忘記密碼 → 聯絡管理員 → 重設連結 | native Supabase recovery token verification + own password update | one-use recovery proof |
| Admin password recovery | 員工管理 → 重設密碼 | `POST /api/admin/reset-password` | current active admin, checked server-side |
| Admin dashboard | 管理員總覽 | `GET /api/admin/dashboard?date=YYYY-MM-DD` | admin only |
| Attendance records | 出勤紀錄 filters/drawer | `GET /api/admin/attendance` | admin only |
| CSV export | 匯出 CSV | `GET /api/admin/attendance.csv` | admin only |
| Review exception | 批准／封鎖 + note | `PATCH /api/admin/attendance/:id/review` | admin only |
| Employee management | 新增、停用、角色、重設密碼 | `POST/PATCH /api/admin/employees` | admin only |
| Individual schedule | 編輯工時 | `PUT /api/admin/employees/:id/schedule` | admin only |
| Policy settings | Wi-Fi, GPS, shifts, tolerance | `PUT /api/admin/attendance-policy` | admin only |

## Trust and validation rules

1. The browser is untrusted: it cannot decide a role, verified Wi-Fi state, final GPS verdict, or review status.
2. Use Supabase Auth for password login and password reset. `profiles.role` is the server/RLS authority; never infer admin from an email string.
3. A punch permits one `clock_in` and one `clock_out` per employee per Hong Kong day, in that order. Database unique constraints enforce the invariant.
4. Browser GPS is a one-time signal. The server validates shape, precision, and distance, and issues the final verdict — the browser never decides it. **Amended 2026-07-27:** GPS alone may auto-verify when `attendance_policy.allow_single_signal` is true (currently the case, for the GPS-only MVP). Out-of-range is still blocked; poor or missing accuracy still lands in `pending` for review.
5. Wi-Fi auto-verification, when built, requires an office gateway/reverse proxy which validates company Wi-Fi server-side and passes a short-lived signed assertion. Do not expose a static gateway secret to browser code. No such gateway is deployed today, and a browser cannot read SSID/BSSID — never accept either from the client as evidence.
6. Every admin review, policy update, schedule update and account status change writes an audit event: actor, timestamp, previous state, new state and optional note.
7. RLS: employees can read only their profile, own schedule and own attendance; admins can read/write operational rows; service role is server-only.

## Data model required

| Table | Key fields |
| --- | --- |
| `profiles` | `user_id`, `full_name`, `role`, `department`, `position`, `active` |
| `work_schedules` | `employee_id`, `work_start`, `work_end`, `work_days`, `timezone` |
| `attendance_policy` | singleton office name/address, Wi-Fi gateway policy, GPS centre/radius/accuracy, work defaults, late tolerance |
| `attendance_records` | `employee_id`, `attendance_day`, `clock_in_at`, `clock_out_at`, Wi-Fi/GPS evidence, verification status, review fields |
| `attendance_audit_events` | actor, action, resource, old/new JSON, timestamp |

## Decisions deliberately deferred

- No external maps API: admin enters office coordinates and browser Geolocation API collects a one-time position.
- No BIPO source code or branding: only common attendance concepts are implemented.
- No automatic email delivery implementation until the Supabase Auth SMTP sender/domain is configured.
- No live database, Vercel, Auth user or credential change without explicit confirmation.

## Password recovery (local implementation)

- Phone login maps to a non-deliverable internal email address. No recovery email/SMS is sent. The administrator verifies identity via an existing company channel, creates a private link, and shares it with that person only. The administrator never enters their new password.
- The Vercel endpoint requires server-only `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and canonical `APP_URL`. Never place a service-role key in `runtime-config.js` or browser environment variables. Provisioning these values and deployment require approval; the static Python preview does not run this endpoint.
- The endpoint validates the caller with Supabase Auth, reads their current active admin profile, checks the target's roster/profile/Auth linkage, and uses native Auth `generate_link` with `type: recovery`. It preserves the Auth user ID, profile, schedule and attendance records. Issuance intent and successful generation are audited before returning a link; failures never return a token or provider error. Native Supabase Auth audit logs record password changes.
- The link stores the native recovery token in the URL fragment. The browser removes it from the address bar immediately and only verifies it when a valid password form is submitted. Recovery uses a separate memory-only client, so an existing login cannot cause a different person's password to be changed. Expiry is governed by Supabase Auth's Email OTP expiration setting; no custom lifetime or immediate revocation of previously issued links is promised.
- Passwords must be 12–128 characters and match confirmation; Auth remains the server-side password-policy authority. After saving, global sign-out revokes refresh sessions. Already-issued access JWTs remain valid until expiry. Issuing a link alone does not revoke sessions or change the password.
- An audit-based 60-second per-target cooldown limits sequential duplicate requests; it is not an atomic concurrent rate limiter. Use a database gate if stronger limits become necessary.
- Local tests cover authorization/failure boundaries and recovery state. Hosted configuration, actual link expiry/replay, real Auth audit events and staff-operated end-to-end recovery still need deployment/UAT approval.

## First vertical slice

**Auth and authorization boundary:** real sign-in, profile role lookup, active-account guard, and correct employee/admin workspace routing. It unlocks every other UI journey without changing the Claude Design visual contract.
