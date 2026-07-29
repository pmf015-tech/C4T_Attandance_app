/**
 * C4T Attendance — attendance history shaping
 *
 * Turns `attendance_records` rows into what the employee records screen shows.
 * Lateness is judged against the employee's own `work_schedules.work_start`,
 * both read under RLS, so nothing here needs to filter by employee.
 *
 * Classic browser script (no build step) — also loaded by tests via a stub
 * window, so keep it dependency-free and side-effect-free.
 */

window.C4T_ATTENDANCE_HISTORY = (() => {
  const ATTENDANCE_TIMEZONE = "Asia/Hong_Kong";

  const NO_TIME = "--:--";

  /* Postgres renders timestamptz as "…+00", which Date() rejects. Whatever the
     cause, one unparseable value must not take the whole screen down. */
  const hkClock = (timestamp) => {
    const parsed = new Date(timestamp);
    if (Number.isNaN(parsed.getTime())) return NO_TIME;
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: ATTENDANCE_TIMEZONE,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(parsed);
  };

  /** "09:47" -> 587 minutes past midnight. */
  const toMinutes = (clock) => {
    const [hours, minutes] = clock.split(":").map(Number);
    return hours * 60 + minutes;
  };

  /**
   * @param {{attendance_day: string, clock_in_at: ?string, clock_out_at: ?string, verification_status: ?string}} record
   * @param {?string} workStart e.g. "09:30:00" — null when no schedule exists
   */
  const classifyAttendanceRow = (record, workStart) => {
    const clockIn = record.clock_in_at ? hkClock(record.clock_in_at) : NO_TIME;
    const clockOut = record.clock_out_at ? hkClock(record.clock_out_at) : NO_TIME;

    /* Without a schedule there is no line to be late against — never guess one,
       and never judge lateness off a clock-in we could not parse. */
    const late = Boolean(
      workStart && clockIn !== NO_TIME && toMinutes(clockIn) > toMinutes(workStart.slice(0, 5)),
    );

    return {
      day: record.attendance_day,
      clockIn,
      clockOut,
      late,
      verification: record.verification_status ?? null,
    };
  };

  /** @param {ReturnType<typeof classifyAttendanceRow>[]} rows */
  const summariseAttendance = (rows) => {
    const lateDays = rows.filter((row) => row.late).length;
    return {
      daysWorked: rows.length,
      onTime: rows.length - lateDays,
      lateDays,
      awaitingReview: rows.filter((row) => row.verification === "pending").length,
    };
  };

  return { classifyAttendanceRow, summariseAttendance };
})();
