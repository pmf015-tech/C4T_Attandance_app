# C4T 打卡鐘 — UI/UX Spec (v2, mono redesign)

Hand this file to Claude Design (the same tool that produced `C4T Attendance.dc.html`) as the
brief for the redesign. It supersedes the visual direction in `DESIGN.md` (blue "attendance
beacon" theme) and extends the product boundary in `BACKEND-CONTRACT.md`. Read section 1 first —
it lists what changed from the current build and what is still open.

## 0. Reference and scope

- Layout grammar only is inspired by DAKA-style attendance apps: a minimal mono clock-in surface,
  card-based lists, bottom pill actions, iOS-style spacing.
- **Do not** reuse DAKA name, logo, copy, or asset files. Only `uploads/c4t-logo-cropped.png` /
  `uploads/C4T neon blue logo transparent.png` may appear, and only on Welcome/Login/Create/Join
  screens.
- Interface copy stays Traditional Chinese, Hong Kong Cantonese phrasing, matching the existing
  build (`C4T 出勤`, `landing.html`, `AGENTS.md`).

## 1. What this spec changes vs. the current build — flag before generating

| # | Topic | Current build | This spec | Status |
|---|---|---|---|---|
| 1 | Visual theme | Light-blue "attendance beacon" (`DESIGN.md`: `--sky-600` etc.) | Black/white/gray mono, DAKA-style | **Intentional pivot** — replaces `DESIGN.md` tokens |
| 2 | Tenancy | Single organization, admin identity hard-coded (Lisa Huang) | Multi-tenant: 建立機構 / 加入機構 with invite codes | **Scope expansion** — needs an `organizations` table and `organization_id` on every row before backend work starts. Confirm with the team before building the join/create flow for real, since it changes the RLS model in `BACKEND-CONTRACT.md`. |
| 3 | GPS clock-in validation | N/A (not yet implemented) | Corrected below — see 8.1 | The originally pasted flow said "if inside radius, enable 打卡 button" as a **client-side gate**. That contradicts `BACKEND-CONTRACT.md` rule 4 ("browser GPS alone never auto-verifies attendance"). This spec keeps GPS as an advisory hint in the UI, with the server issuing the actual `verified / pending / rejected` status. |
| 4 | Wi-Fi clock-in validation | N/A | Corrected below — see 8.1 | Same reasoning: the UI compares SSID as a hint; only a signed gateway assertion (rule 5) can auto-verify. Client-only SSID match must show a `pending review` state, not instant success. |
| 5 | Role check | Must be server-side (`profiles.role` + RLS) | Same | No change — this spec never routes by email string. |

Everything else below assumes these five points are accepted. If tenancy (#2) is out of scope for
this round, drop §3.2–3.3 (Create/Join Organization) and treat the app as single-org, and skip the
`Organization` model in §7.

## 2. Design tokens (mono theme)

| Token | Value | Use |
|---|---|---|
| `--bg` | `#FFFFFF` | App background |
| `--ink` | `#111111` | Primary text, primary buttons |
| `--muted` | `#777777` | Secondary text, placeholders |
| `--surface` | `#F4F4F4` | Cards, input fills |
| `--line` | `#EAEAEA` | Dividers, card borders |
| `--accent-success` | `#8FD1A5` | Success/verified state only — never used for primary actions |
| `--danger` | `#C2413C` | Error text/state (kept from current build for consistency) |
| `--warning` | `#B7791F` | Pending/late state (kept from current build) |

- No blue anywhere except the C4T logo file itself.
- Font: system sans stack. Titles 600–700 weight; body 400–500.
- Radius: 20–24px on pill buttons, 16px on cards, 12px on inputs.
- Spacing: 4px rhythm, generous vertical whitespace (iOS-style), min 16px screen margin.
- Motion: 150–200ms ease-out on press/hover states only; no motion implies verification — status
  is always written in text (carried over from `DESIGN.md` §6 accessibility rule).
- Icons: single-weight black line icons, 24px grid, no filled icon unless active/selected.

## 3. Navigation structure

```text
App Start
 ├─ Welcome                         (public)
 │   ├─ Create Organization         → admin onboarding
 │   ├─ Join Organization           → employee onboarding
 │   └─ Login                       → existing user
 │
 ├─ Employee workspace
 │   ├─ Clock-in Home
 │   ├─ Clock-in Method Picker
 │   ├─ GPS Clock-in
 │   ├─ Wi-Fi Clock-in
 │   ├─ QR Clock-in
 │   ├─ My Attendance (calendar + list)
 │   ├─ My Schedule
 │   ├─ Leave Request
 │   └─ Correction Request (補打卡)
 │
 └─ Admin workspace
     ├─ Admin Dashboard
     ├─ Staff Management (人員)
     │   ├─ Add Staff
     │   └─ Staff Detail
     ├─ Clock-in Point Management (打卡點)
     │   └─ Add/Edit Clock-in Point
     ├─ Attendance Overview (考勤)
     │   └─ Attendance Detail
     ├─ Leave Management (假單)
     │   └─ Edit/Review Leave
     ├─ Scheduling Calendar (排班)
     │   ├─ Shift Detail
     │   └─ Add/Edit Shift
     └─ Reports (報表)
```

Bottom tab bar (employee, mobile): `打卡` · `考勤` · `排班` · `我的`.
Side rail (admin, ≥900px): `總覽` · `人員` · `打卡點` · `考勤` · `排班` · `報表` · collapses to a
bottom sheet menu below 900px, per the existing `AppShell` primitive in `DESIGN.md` §5 — keep that
primitive, restyle it mono.

## 4. Screens — 帳戶與打卡流程

### 4.1 Welcome
- White full-bleed background, C4T logo centered lower-middle, subtitle `手機就是打卡鐘`.
- Three stacked pill buttons, bottom-anchored with safe-area padding: `建立機構` (outline), `加入機構`
  (outline), `登入` (solid black, primary).
- No back button; this is the root.

### 4.2 Create Organization *(admin onboarding — requires §1 #2 confirmed)*
- Header: back arrow, title `建立帳號`.
- Fields (label-above-placeholder, no visible borders, underline on focus only): `機構名稱`,
  `管理者 Email`, `密碼`.
- Footer link: `使用條款與隱私權政策`.
- Primary action: bottom-right black pill `同意條款並申請`, disabled until all fields pass
  validation.
- Validation: name required (non-empty, ≤60 chars); email RFC-valid; password ≥8 chars. Inline red
  caption under the invalid field, not a toast.
- Success → creates `organizations` row + first `profiles` row with `role = admin` → Admin
  Dashboard.

### 4.3 Join Organization *(employee onboarding — requires §1 #2 confirmed)*
- Fields: `機構代碼`, `員工姓名`, `Email`, `電話`, `密碼`.
- States to design explicitly (each its own full-screen result, not a toast):
  - 無效代碼 (invalid code)
  - 帳號已存在 (account exists — offer 登入 link)
  - 待審核 (pending admin approval) — shown when the organization requires manual approval
  - 加入成功 (auto-join allowed) → Employee Clock-in Home
- Server, not the client, decides auto-join vs. pending — mirror the role-check rule in
  `BACKEND-CONTRACT.md` (never trust the browser for a status decision).

### 4.4 Login
- Fields: `Email`, `密碼`. Secondary link: `忘記密碼`.
- Primary pill: `登入`.
- Auth via Supabase Auth password flow (per `BACKEND-CONTRACT.md`); route by `profiles.role` after
  session is established, never by parsing the email string.

### 4.5 Employee Home / Clock-in Dashboard
- Top: greeting (`Hello`) + live clock (`現在上午 9:28:57`, client-side tick, not a server value).
- Organization card: org name, user's role/department, chevron → org switcher (only if a user can
  belong to >1 org; otherwise omit the chevron).
- Stat row (3–4 `StatCard`s): 人員, 打卡卡點, 目前狀態, 補打卡 shortcut.
- Bottom action, one of three mutually exclusive states:
  1. Not clocked in today → solid black pill `上班打卡`
  2. Clocked in, not out → solid black pill `下班打卡`
  3. Completed today → `InfoCard`, non-interactive, `今日已完成` + total hours
- Tapping the primary pill opens the Clock-in Method Picker if the org has >1 method configured;
  if only one method is active, skip straight to that method's screen.

### 4.6 Clock-in Method Picker
- Card list, each row: icon, method name, one-line description, chevron.
- Methods: `GPS 定位`, `Wi-Fi 打卡`, `QR Code`, `手動補打卡` (routes to Correction Request, §4.9,
  not a live clock-in path).

### 4.7 GPS Clock-in
- Header `GPS 打卡` (employee) or `設定 GPS 定位` (admin editing a clock-in point).
- Coordinate card (lat/lng + resolved address), static map preview.
- Employee flow: show current position on the map; show a **hint** label (`看起來喺允許範圍內` /
  `看起來喺範圍外`) — this is advisory copy, not a gate. The `打卡` button stays enabled either way;
  submitting always goes to the server, which returns one of `verified` / `pending_review` /
  `rejected`. Show the returned status on a result screen with the reason if rejected.
- Admin flow: `使用現在位置` to set org's GPS anchor, radius stepper, `完成` to save.

### 4.8 Wi-Fi Clock-in
- Header `Wi-Fi 打卡` (employee) / `設定 Wi-Fi 定位` (admin).
- SSID/BSSID display, hint text.
- Employee flow: client reads current SSID as a **hint only**; button always submits to the
  server. Only a signed gateway assertion can return `verified`; a same-SSID-but-no-gateway
  submission must resolve to `pending_review`, matching `BACKEND-CONTRACT.md` rule 5. Show that
  distinction in the result screen copy so the employee understands why it's pending.
- Admin flow: detect current Wi-Fi, save as the allowed point, `完成`.

### 4.9 Correction Request (補打卡)
- Fields: date, type (`上班補打卡` / `下班補打卡`), requested time, reason, optional photo
  attachment.
- Submit → `pending`, appears in Admin → 考勤 → 假單/correction queue.
- Employee sees own request as a card with status pill (`待審核` / `已批准` / `已拒絕`).

## 5. Screens — 管理者功能

### 5.1 Admin Dashboard
- Greeting + time, organization card (same primitive as employee home).
- Cards: 總員工數, 總打卡點, 今日出勤摘要, 待審核, 假單, 報表 shortcut.
- Quick-action row: `人員` · `打卡點` · `排班` · `考勤` · `報表`.
- Optional floating `+` → quick-create sheet (新增人員 / 新增打卡點 / 新增排班).

### 5.2 Staff Management (人員)
- Title + subtitle `X名人員 / 上限Y` (Y from plan/org limit).
- Search bar, two secondary actions (`邀請連結`, `新增人員`), then a `StaffCard` list: avatar,
  name, employee ID, phone, chevron.
- Tap → Staff Detail.

### 5.3 Add Staff
- Fields: name, email, phone, employee ID, department, role (`admin`/`manager`/`employee`),
  default shift, clock-in permission group.
- `儲存` / `取消`. Saving either creates the row directly or issues an invite link, admin's choice
  via a toggle at the top of the form.

### 5.4 Staff Detail
- Sections: basic info, role, department, attendance records, assigned shifts, leave balance,
  permissions.
- Actions: edit, disable account, delete, reset password — each of the last three behind a
  confirmation sheet (irreversible or hard-to-reverse actions).

### 5.5 Clock-in Point Management (打卡點)
- Title, search bar, numbered list: type badge (GPS/Wi-Fi/QR), name, short address/Wi-Fi ID,
  chevron.
- Floating `+` → Add Clock-in Point (§5.6). Tap row → same screen in edit mode.

### 5.6 Add/Edit Clock-in Point
- Type selector: GPS / Wi-Fi / QR / manual-approval-only.
- Fields per type as in §4.7/§4.8, plus name, assigned departments/users, active toggle.
- `儲存` / `刪除` (delete behind confirmation).

### 5.7 Leave Management (假單)
- Lives under the 考勤 tab set (see §6), tab `假單`.
- Grouped-by-date leave request cards: employee, date, type, status icon, chevron.

### 5.8 Edit/Review Leave
- Fields: status (`未審核`/`已批准`/`已拒絕`), employee, type (`病假`/`年假`/`事假`), date/time,
  reason.
- `保存` / `刪除`. Approving flips the matching `attendance_records.status` to `leave` and reflects
  on the schedule view — write an audit event per `BACKEND-CONTRACT.md` rule 6.

## 6. Screens — 考勤、排班與報表

### 6.1 Attendance Overview (考勤)
- Month selector card (`4月 2026`), tabs `內勤` / `外勤` / `假單`.
- Summary row: work days, total hours, late count, missing-punch count.
- Date rows: date, clock-in time, clock-out time, worked hours, status pill.
- Tap row → Attendance Detail.

### 6.2 Attendance Detail
- Date, employee, clock-in/out records, verification result per §4.7/§4.8 (verified/pending/
  rejected + reason), worked hours, status, notes.
- Admin actions: edit record, approve correction, add note (each writes an audit event).
- Employee actions: request correction (routes to §4.9); read-only once approved.

### 6.3 Scheduling Calendar (排班)
- Month selector, calendar grid with selected-date highlight, shift cards below: name, time
  range, assigned count (`早班 9:00–12:00`, etc.).
- Floating `+` → Add/Edit Shift. Tap a shift card → Shift Detail.

### 6.4 Shift Detail
- Top row: date, delete icon, close icon.
- Shift card: name, time range, total hours.
- Assigned staff list with remove icon per row.
- Floating actions: add staff, edit shift.

### 6.5 Add/Edit Shift
- Fields: name, start/end time, break time, repeat rule (one-day / every weekday / custom dates),
  assigned employees/department.
- Validation: end > start; at least one assignee; block overlapping shifts for the same employee
  unless the org explicitly allows it.

### 6.6 Reports (報表)
- Date range (start/end month), staff filter, preview card, export sheet.
- Report types: monthly attendance, per-staff attendance, leave, late/missing-punch, hours
  summary.
- Actions: preview, export CSV, export Excel, share — CSV export already has a contract in
  `BACKEND-CONTRACT.md` (`GET /api/admin/attendance.csv`); Excel/share are new surface, flag for
  backend scoping.

## 7. Reusable components

`PhoneScreen`, `Header` (back/menu), `RoundedCard`, `PillButton` (solid/outline/disabled),
`SearchBar`, `StatCard`, `StaffCard`, `AttendanceRow`, `ShiftCard`, `StatusPill` (verified/pending/
late/rejected/leave), `FloatingActionButton`, `BottomActionBar`, `TabSwitcher`, `AppShell`
(mobile rail / admin sidebar — carried over from `DESIGN.md` §5, restyled mono).

Each component needs default, hover/press, focus, disabled, and (where relevant) error states
defined before handoff — don't let Claude Design improvise these.

## 8. Role permissions

| Action | Admin | Manager | Employee |
|---|---|---|---|
| Create organization | ✓ | – | – |
| Add/edit/delete staff | ✓ | – | – |
| Manage clock-in points | ✓ | – | – |
| View all attendance | ✓ | team only | own only |
| Edit attendance record | ✓ | – | – |
| Approve leave/correction | ✓ | own team | – |
| Create schedules | ✓ | – | – |
| Export reports | ✓ | – | – |
| Clock in/out | ✓ | ✓ | ✓ |
| Apply leave / submit correction | ✓ | ✓ | ✓ |

Manager scope is optional for this round — include only if the org's plan supports departments.

## 9. Data models

Extends the tables already defined in `BACKEND-CONTRACT.md` §"Data model required". New tables
needed for the multi-tenant + scheduling/leave/QR surface in this spec:

```ts
Organization {
  id: string
  name: string
  ownerId: string
  inviteCode: string
  joinMode: "auto" | "approval"
  createdAt: Date
}

ClockInPoint {
  id: string
  organizationId: string
  name: string
  type: "gps" | "wifi" | "qr"
  address?: string
  latitude?: number
  longitude?: number
  radiusMeters?: number
  wifiSSID?: string
  wifiBSSID?: string
  qrCode?: string
  assignedUserIds?: string[]
  assignedDepartmentIds?: string[]
  active: boolean
}

Shift {
  id: string
  organizationId: string
  name: string
  date: string
  startTime: string
  endTime: string
  assignedUserIds: string[]
}

LeaveRequest {
  id: string
  organizationId: string
  userId: string
  type: "sick" | "annual" | "personal" | "other"
  startDate: Date
  endDate: Date
  reason?: string
  status: "pending" | "approved" | "rejected"
  reviewedBy?: string
}

CorrectionRequest {
  id: string
  organizationId: string
  userId: string
  date: string
  type: "clock_in" | "clock_out"
  requestedTime: Date
  reason: string
  status: "pending" | "approved" | "rejected"
}
```

`profiles`, `work_schedules`, `attendance_policy`, `attendance_records`,
`attendance_audit_events` stay as defined in `BACKEND-CONTRACT.md`, each gaining an
`organization_id` column if §1 #2 is confirmed.

## 10. Core interaction logic (corrected for the existing security contract)

### 10.1 Clock-in submit (GPS or Wi-Fi)
```text
1. Client reads GPS/Wi-Fi as an advisory hint only; renders a hint label, never a hard gate.
2. Client always submits: user, org, point id, raw signal (coords or SSID), timestamp.
3. Server validates shape/precision/distance, or checks for a signed gateway assertion (Wi-Fi).
4. Server returns one of: verified | pending_review | rejected (+ reason).
5. UI renders the returned status. Only "verified" shows the soft-green success state;
   "pending_review" shows the warning state and explains an admin will confirm it;
   "rejected" shows the danger state with the reason and a link to submit a correction request.
```

### 10.2 Leave approval
```text
1. Employee submits leave → status = pending.
2. Admin reviews → approves/rejects (+ optional note) → writes audit event.
3. If approved: matching attendance_records.status → "leave"; schedule view reflects it.
```

### 10.3 Correction approval
```text
1. Employee submits correction request → status = pending.
2. Admin reviews → approves/rejects → writes audit event.
3. If approved: attendance record updated, work_minutes recalculated.
4. If rejected: original record stands, employee sees the rejection reason.
```

## 11. Brief to paste into Claude Design

```text
Redesign C4T 打卡鐘 (C4T Attendance) from its current light-blue theme to a minimal
black/white/gray mono UI, DAKA-layout-inspired but with only C4T's own logo/name/assets
(uploads/c4t-logo-cropped.png). White background (#FFFFFF), near-black primary buttons/text
(#111111), gray secondary text (#777777), light-gray cards (#F4F4F4), #EAEAEA dividers, soft
green (#8FD1A5) reserved for verified/success states only. Rounded pill buttons, 16px card
radius, iOS-style spacing, minimal single-weight black line icons, Traditional Chinese
(Hong Kong Cantonese) copy throughout.

Rebuild every screen listed in UI-UX-SPEC.md sections 4–6 (account/clock-in flow, admin
management, attendance/scheduling/leave/reports) as a working screen with role-based
navigation (admin sidebar ≥900px / employee bottom tabs on mobile), using the component set
in section 7 and the data models in section 9. Keep GPS/Wi-Fi clock-in as advisory-hint-plus-
server-verdict per section 10.1 — never a client-side-only success state. Use mock data
matching the shapes in section 9, structured so it can later bind to the real
Supabase/Bun API described in BACKEND-CONTRACT.md.
```
