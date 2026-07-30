import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

/* admin-dashboard reuses attendance-history for clock/lateness shaping, so both
   scripts run against one stub window exactly as index.html loads them. */
const loadDashboard = () => {
  const stubWindow = {};
  for (const file of ["../lib/attendance-history.js", "../lib/admin-dashboard.js"]) {
    new Function("window", readFileSync(new URL(file, import.meta.url), "utf8"))(stubWindow);
  }
  return stubWindow.C4T_ADMIN_DASHBOARD;
};

/* Real row shape, placeholder people: this repository is public, the roster is
   not. 01:30Z === 09:30 HKT. */
const record = (overrides = {}) => ({
  attendance_day: "2026-07-30",
  clock_in_at: "2026-07-30T01:25:00Z",
  clock_out_at: null,
  verification_status: "verified",
  gps_distance_m: null,
  gps_accuracy_m: null,
  wifi_assertion_status: "unavailable",
  profiles: { full_name: "陳大文", position: "員工", employee_number: "SS-001" },
  ...overrides,
});

describe("initials", () => {
  const { initials } = loadDashboard();

  test("takes the last two characters of a Chinese name", () => {
    expect(initials("陳大文")).toBe("大文");
    expect(initials("李小明")).toBe("小明");
  });

  test("takes initials from a Latin name", () => {
    expect(initials("Chan Tai Man")).toBe("CT");
  });

  test("never throws on a missing name", () => {
    expect(initials(null)).toBe("—");
    expect(initials("")).toBe("—");
  });
});

describe("adminAttendanceRow", () => {
  const { adminAttendanceRow } = loadDashboard();

  test("carries the employee's real identity through from the joined profile", () => {
    const row = adminAttendanceRow(record(), "09:30:00");

    expect(row.name).toBe("陳大文");
    expect(row.employeeNumber).toBe("SS-001");
    expect(row.clockIn).toBe("09:25");
    expect(row.late).toBe(false);
  });

  test("marks a late arrival against that employee's own schedule", () => {
    const row = adminAttendanceRow(record({ clock_in_at: "2026-07-30T01:47:00Z" }), "09:30:00");

    expect(row.late).toBe(true);
  });

  test("reports the measured distance rather than a verdict it cannot make", () => {
    expect(adminAttendanceRow(record({ gps_distance_m: 42.7 }), null).gps).toBe("42 米");
    expect(adminAttendanceRow(record(), null).gps).toBe("未提供");
  });

  test("distinguishes an unavailable Wi-Fi assertion from a failed one", () => {
    expect(adminAttendanceRow(record({ wifi_assertion_status: "verified" }), null).wifi).toBe("已確認");
    expect(adminAttendanceRow(record({ wifi_assertion_status: "failed" }), null).wifi).toBe("驗證失敗");
    expect(adminAttendanceRow(record(), null).wifi).toBe("未確認");
  });

  test("survives a record whose employee has no profile row", () => {
    const row = adminAttendanceRow(record({ profiles: null }), null);

    expect(row.name).toBe("未知員工");
    expect(row.employeeNumber).toBe("—");
  });
});

describe("todaySummary", () => {
  const { adminAttendanceRow, todaySummary } = loadDashboard();

  const rows = [
    adminAttendanceRow(record({ clock_in_at: "2026-07-30T01:25:00Z" }), "09:30:00"),
    adminAttendanceRow(
      record({ clock_in_at: "2026-07-30T01:50:00Z", verification_status: "pending" }),
      "09:30:00",
    ),
    adminAttendanceRow(
      record({ clock_in_at: "2026-07-30T01:20:00Z", verification_status: "blocked" }),
      "09:30:00",
    ),
  ];

  test("counts punched, verified, pending and late against the expected headcount", () => {
    const summary = todaySummary(rows, 5);

    expect(summary).toEqual({ expected: 5, punched: 3, verified: 1, pending: 1, late: 1 });
  });

  test("reports a quiet morning as zero rather than a placeholder", () => {
    expect(todaySummary([], 5)).toEqual({ expected: 5, punched: 0, verified: 0, pending: 0, late: 0 });
  });
});

describe("rosterEntry", () => {
  const { rosterEntry } = loadDashboard();

  const roster = (overrides = {}) => ({
    employee_number: "SS-002",
    full_name_zh: "李小明",
    position: "員工",
    role: "employee",
    active: true,
    provisioning_status: "pending",
    auth_user_id: null,
    work_start: "09:00:00",
    work_end: "18:00:00",
    ...overrides,
  });

  test("shows that employee's own shift, not a company-wide default", () => {
    /* The six staff do not share one shift: 09:00–18:00 and 09:30–16:30 both
       exist on the real roster, and each is judged against their own. */
    expect(rosterEntry(roster()).shift).toBe("09:00 — 18:00");
    expect(rosterEntry(roster({ work_start: "09:30:00", work_end: "16:30:00" })).shift)
      .toBe("09:30 — 16:30");
  });

  test("an admin has no shift rather than a fabricated one", () => {
    expect(rosterEntry(roster({ role: "admin", work_start: null, work_end: null })).shift)
      .toBe("—");
  });

  test("shows an unactivated employee as awaiting a QR", () => {
    const entry = rosterEntry(roster());

    expect(entry.name).toBe("李小明");
    expect(entry.employeeNumber).toBe("SS-002");
    expect(entry.activated).toBe(false);
    expect(entry.canInvite).toBe(true);
    expect(entry.accountLabel).toBe("待啟用");
  });

  test("shows an activated employee and offers no second QR", () => {
    const entry = rosterEntry(roster({ provisioning_status: "provisioned", auth_user_id: "uuid" }));

    expect(entry.activated).toBe(true);
    expect(entry.canInvite).toBe(false);
    expect(entry.accountLabel).toBe("已啟用");
  });

  test("refuses to offer a QR for a disabled account", () => {
    /* create_onboarding_invite rejects these server-side; offering the button
       would only produce an error the admin cannot act on. */
    expect(rosterEntry(roster({ provisioning_status: "disabled" })).canInvite).toBe(false);
    expect(rosterEntry(roster({ active: false })).canInvite).toBe(false);
  });
});

describe("weekday", () => {
  const { weekday } = loadDashboard();

  test("names the Hong Kong weekday for an attendance day", () => {
    /* 2026-07-30 is a Thursday in Hong Kong. */
    expect(weekday("2026-07-30")).toBe("星期四");
  });

  test("returns an empty string for an unparseable day", () => {
    expect(weekday("not a date")).toBe("");
  });
});
