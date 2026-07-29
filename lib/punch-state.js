/**
 * C4T Attendance — punch state derivation
 *
 * The employee home screen used to toggle a local boolean, so a refresh showed
 * "尚未打卡" even after both punches had been recorded. Today's attendance row
 * is the only authority on where the employee is in their day; these helpers
 * turn that row into what the button should say and whether it may be pressed.
 *
 * Classic browser script (no build step) — also loaded by tests via a stub
 * window, so keep it dependency-free and side-effect-free.
 */

window.C4T_PUNCH_STATE = (() => {
  const ATTENDANCE_TIMEZONE = "Asia/Hong_Kong";

  /** The attendance day is always the Hong Kong calendar day, never the browser's. */
  const hongKongAttendanceDay = (now = new Date()) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: ATTENDANCE_TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);

  /**
   * @param {{clock_in_at: ?string, clock_out_at: ?string, verification_status: ?string} | null} record
   * @returns {{clockedIn: boolean, canPunch: boolean, action: "clock_in"|"clock_out"|"done", verification: ?string}}
   */
  const derivePunchState = (record) => {
    if (!record?.clock_in_at) {
      return { clockedIn: false, canPunch: true, action: "clock_in", verification: null, clockInAt: null };
    }

    const verification = record.verification_status ?? null;
    const clockInAt = record.clock_in_at;

    if (!record.clock_out_at) {
      return { clockedIn: true, canPunch: true, action: "clock_out", verification, clockInAt };
    }

    /* Both punches exist. punch_attendance() rejects a third punch, so stop the
       employee at the button instead of surfacing a raw Postgres error. */
    return { clockedIn: false, canPunch: false, action: "done", verification, clockInAt };
  };

  return { derivePunchState, hongKongAttendanceDay };
})();
