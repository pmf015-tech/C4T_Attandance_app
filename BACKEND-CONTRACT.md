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
4. Browser GPS is a one-time, advisory signal. Server validates shape, precision, and distance. It may block clear out-of-range attempts, but browser GPS alone never auto-verifies attendance.
5. Auto-verification requires an office gateway/reverse proxy which validates company Wi-Fi server-side and passes a short-lived signed assertion. Do not expose a static gateway secret to browser code.
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

## First vertical slice

**Auth and authorization boundary:** real sign-in, profile role lookup, active-account guard, and correct employee/admin workspace routing. It unlocks every other UI journey without changing the Claude Design visual contract.
