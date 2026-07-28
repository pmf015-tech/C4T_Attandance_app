# C4T 打卡鐘 — Product Proposal

Master build spec. This is the scope document — `BACKEND-CONTRACT.md` and `UI-UX-SPEC.md`
govern *how* each piece is implemented; read `CLAUDE.md` for current build status and the one
open decision (multi-tenancy) blocking backend work below.

## Mission

Mobile-first attendance clock-in app: **C4T 打卡鐘**.
- DAKA-style minimal black/white/gray UI only — layout grammar reference, nothing else.
- Do **not** use DAKA name/logo/assets. C4T name/logo only, on Welcome/Login/Create/Join.
- Traditional Chinese (Hong Kong Cantonese) UI copy throughout.
- Mock data first where a screen has no backend yet; clean repository-style access so mocks
  swap for real Supabase calls without a rewrite.

## Design system

| Token | Value |
|---|---|
| Background | `#FFFFFF` |
| Primary text/button | `#111111` |
| Secondary text | `#777777` |
| Card | `#F4F4F4` |
| Divider | `#EAEAEA` |
| Success accent | `#8FD1A5` |

Large rounded pills/cards, iOS-like spacing, minimal black line icons, no blue anywhere except
the C4T logo file. Full token/state detail: `UI-UX-SPEC.md` §2.

Reusable components: `PhoneScreen`, `Header`, `RoundedCard`, `PillButton`, `SearchBar`,
`StatCard`, `StaffCard`, `AttendanceRow`, `ShiftCard`, `FAB`, `BottomActionBar`, `TabSwitcher`.

## Roles

| Role | Scope |
|---|---|
| Admin | org settings, staff CRUD, clock-in points, all attendance, approve leave/corrections, schedules, reports |
| Employee | clock in/out, own attendance/schedule, leave + correction requests, profile |
| Manager (optional) | team leave/corrections/attendance only; no org-wide settings |

Routing after login: Admin → Admin Dashboard, Employee → Clock-in Home. Role always comes from
`profiles.role` server-side — never inferred from the client (`BACKEND-CONTRACT.md` rule 2).

## Navigation tree

```text
Welcome
 ├ Create Org
 ├ Join Org
 └ Login
     ├ Employee
     │  ├ Clock-in Home
     │  ├ Method select (GPS / Wi-Fi / QR / 補打卡)
     │  ├ GPS / Wi-Fi screens
     │  ├ My Attendance + Detail
     │  ├ My Schedule
     │  ├ Leave request
     │  └ Correction request
     └ Admin
        ├ Dashboard
        ├ 人員 (list/add/detail)
        ├ 打卡點 (list/add/edit)
        ├ 考勤 (內勤/外勤/假單 + detail)
        ├ 排班 (calendar/shift detail/add)
        └ 報表 (filter/export)
```

## Screens

Full per-screen layout, states, and copy: `UI-UX-SPEC.md` §4–6. Summary:

**A) Account** — Welcome, Create Org, Join Org, Login. Validation: name required, valid email,
password ≥ 8 chars, inline red errors.

**B) Employee clock-in** — Clock-in Home (greeting/time, org card, stat cards, punch CTA in one
of three states), Method select, GPS screen, Wi-Fi screen. Clock-in flow: check permissions →
validate against org rules → save + success toast, or an exact error (`你不在允許的打卡範圍內`,
`目前 Wi-Fi 不符合打卡規則`, missing permission, already punched, network retry). Clock-out:
find today's record → no clock-in prompts correction → validate → save out time → compute
hours. **Corrected against `BACKEND-CONTRACT.md`: GPS/Wi-Fi client checks are advisory hints,
never a client-side-only success gate — the server always issues the final `verified /
pending_review / rejected` verdict** (see `UI-UX-SPEC.md` §10.1). This matches how
`punch_attendance()` already behaves in the live schema.

**C) Admin** — Dashboard, 人員 list/add/detail, 打卡點 list/add-edit, 假單 under 考勤 tabs,
edit/review leave.

**D) Attendance / schedule / reports** — 考勤 overview + detail, 補打卡, 排班 calendar + shift
detail/add, 報表 (filter + export CSV/Excel/share).

## Data models

**Decided 2026-07-24: staying single-tenant** (see `CLAUDE.md`). `Organization` is dropped from
active scope; every other model below is single-tenant (no `organizationId` field) and maps
onto the live Supabase schema plus four new tables.

```ts
User { id, name, email, phone?, employeeCode?, role: "admin"|"manager"|"employee", department?, status: "active"|"pending"|"disabled" }
ClockInPoint { id, name, type: "gps"|"wifi"|"qr", address?, latitude?, longitude?, radiusMeters?, wifiSSID?, wifiBSSID?, qrCode?, assignedUserIds?, assignedDepartmentIds?, active }
AttendanceRecord { id, userId, date, clockInTime?, clockOutTime?, clockInPointId?, clockOutPointId?, workMinutes?, status: "normal"|"late"|"early_leave"|"missing"|"leave"|"pending_correction", notes? }
Shift { id, name, date, startTime, endTime, assignedUserIds[] }
LeaveRequest { id, userId, type: "sick"|"annual"|"personal"|"other", startDate, endDate, reason?, status: "pending"|"approved"|"rejected", reviewedBy? }
CorrectionRequest { id, userId, date, type: "clock_in"|"clock_out", requestedTime, reason, status: "pending"|"approved"|"rejected" }
```

**Mapping to the live schema:** `User` = `profiles` + `employee_roster`. `AttendanceRecord` =
`attendance_records` (already has `clock_in_at`/`clock_out_at`/status/verification columns).
`ClockInPoint`, `Shift`, `LeaveRequest`, `CorrectionRequest` are new tables — see `CLAUDE.md`
for the migration plan and the explicit-approval gate before anything is applied to the remote
database.

## Core business rules

- Leave approved → attendance status = `leave`; reflected on schedule view.
- Correction approved → patch attendance + recalc `workMinutes`; rejected keeps the original
  record and shows the employee the rejection reason.
- Role-based nav guards on every screen (enforced server-side via RLS, not just hidden UI).
- Mock store lives in one place (`data/mock-data.js` today) so screens never hardcode data
  inline; swap the mock functions for real Supabase calls behind the same call signature.

## Build order

1. Design tokens + reusable components + app shell/nav — **done** (`style.css` mono pivot,
   existing `employeeView`/`adminView` shells in `app.js`).
2. Auth screens + role routing — **done** for Login; Create Org / Join Org **not built yet**
   (unblocked: build as single-tenant UI — Create Org sets up the one admin account, Join Org
   validates an invite code against `employee_roster.provisioning_status = 'pending'`).
3. Employee clock-in home + method flows + attendance write — **partially done**: home + GPS
   punch via `punch_attendance()` RPC works; Method select, Wi-Fi screen, QR, My Attendance
   detail, My Schedule, Leave request, Correction request **not built**.
4. Admin dashboard + staff + clock-in points — **partially done**: dashboard/staff list/records
   table are mock-data only, not wired to `employee_roster`; clock-in point CRUD **not built**
   (schema only has one implicit office, not a generalized point list).
5. Attendance/leave/correction approval loops — approvals tab UI exists as mock data; no real
   `LeaveRequest`/`CorrectionRequest` tables or RPCs yet.
6. Scheduling — **not built** (no `Shift` table).
7. Reports export — **not built**.
8. Wire all empty states/errors/toasts — partial (clock-in method already shows verified/
   pending pill states; most other screens still mock).

## Acceptance checklist

- [ ] Every screen in `UI-UX-SPEC.md` §4–6 exists and navigates
- [ ] Admin vs Employee see different homes/menus
- [ ] Clock-in/out changes button state + writes a real record
- [ ] GPS/Wi-Fi validation success + failure messages work end-to-end against real RLS/RPC
- [ ] Leave + correction pending → approve/reject updates records + writes an audit event
- [ ] Schedule assign/remove staff works
- [ ] Report filter + export action works
- [ ] UI matches the mono design system; no DAKA branding anywhere
- [ ] ZH-HK labels exact where specified
- [ ] No Supabase/Auth/DB change shipped without prior explicit chat approval
