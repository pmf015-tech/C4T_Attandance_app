/**
 * C4T Attendance — admin dashboard shaping
 *
 * Turns the admin's three reads — `attendance_records` (with the joined
 * profile), `work_schedules` and `employee_roster` — into what the 總覽,
 * 出勤紀錄 and 員工管理 screens show. Every name, number and time here comes
 * from the database; there is no placeholder roster to fall back to.
 *
 * Lateness and clock formatting are delegated to C4T_ATTENDANCE_HISTORY so the
 * employee and admin sides can never disagree about the same record.
 *
 * Classic browser script (no build step) — also loaded by tests via a stub
 * window, so keep it dependency-free apart from that sibling script.
 */

window.C4T_ADMIN_DASHBOARD = (() => {
  const { classifyAttendanceRow } = window.C4T_ATTENDANCE_HISTORY;

  const ATTENDANCE_TIMEZONE = "Asia/Hong_Kong";
  const UNKNOWN = "—";

  const WIFI_LABELS = {
    verified: "已確認",
    failed: "驗證失敗",
    unavailable: "未確認",
  };

  const HAN = /\p{Script=Han}/u;

  /** Avatar text. Han names read best as the given name, Latin ones as initials. */
  const initials = (fullName) => {
    const name = String(fullName ?? "").trim();
    if (!name) return UNKNOWN;
    if (HAN.test(name)) return name.slice(-2);
    return name
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0].toUpperCase())
      .join("");
  };

  /** Hong Kong weekday for an `attendance_day` such as "2026-07-30". */
  const weekday = (day) => {
    const parsed = new Date(`${day}T12:00:00Z`);
    if (Number.isNaN(parsed.getTime())) return "";
    return new Intl.DateTimeFormat("zh-HK", {
      timeZone: ATTENDANCE_TIMEZONE,
      weekday: "long",
    }).format(parsed);
  };

  /**
   * One row of the admin attendance table.
   *
   * @param {object} record `attendance_records` row with an embedded `profiles`
   * @param {?string} workStart that employee's own `work_schedules.work_start`
   */
  const adminAttendanceRow = (record, workStart) => {
    const profile = record.profiles ?? null;
    const distance = record.gps_distance_m;

    return {
      ...classifyAttendanceRow(record, workStart),
      id: record.id,
      employeeId: record.employee_id ?? null,
      /* A record with no profile row is a data fault, not a reason to blank the
         table — name it so the admin can see something is wrong. */
      name: profile?.full_name ?? "未知員工",
      position: profile?.position ?? UNKNOWN,
      employeeNumber: profile?.employee_number ?? UNKNOWN,
      /* The distance is measured; "in range" is a policy verdict this layer
         cannot make, and verification_status already carries it. */
      gps: distance === null || distance === undefined ? "未提供" : `${Math.floor(Number(distance))} 米`,
      wifi: WIFI_LABELS[record.wifi_assertion_status] ?? WIFI_LABELS.unavailable,
    };
  };

  /**
   * @param {ReturnType<typeof adminAttendanceRow>[]} rows today's records
   * @param {number} expected active employees on the roster
   */
  const todaySummary = (rows, expected) => ({
    expected,
    punched: rows.length,
    verified: rows.filter((row) => row.verification === "verified").length,
    pending: rows.filter((row) => row.verification === "pending").length,
    late: rows.filter((row) => row.late).length,
  });

  /** "09:30:00" -> "09:30" */
  const clock = (time) => (time ? String(time).slice(0, 5) : null);

  /** One row of 員工管理, straight off `employee_roster`. */
  const rosterEntry = (entry) => {
    const activated = Boolean(entry.auth_user_id) || entry.provisioning_status === "provisioned";
    const start = clock(entry.work_start);
    const end = clock(entry.work_end);

    return {
      employeeNumber: entry.employee_number,
      name: entry.full_name_zh,
      position: entry.position,
      role: entry.role,
      active: entry.active,
      activated,
      /* Each employee keeps their own hours — there is no company-wide shift to
         fall back on, and admins have none at all. */
      shift: start && end ? `${start} — ${end}` : UNKNOWN,
      accountLabel: activated ? "已啟用" : "待啟用",
      /* Mirrors create_onboarding_invite's own guard. Offering the button for a
         row the RPC will reject just hands the admin an error they cannot fix. */
      canInvite: !activated && entry.active && entry.provisioning_status !== "disabled",
    };
  };

  return { initials, weekday, adminAttendanceRow, todaySummary, rosterEntry };
})();
