import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const loadHistory = () => {
  const source = readFileSync(new URL("../lib/attendance-history.js", import.meta.url), "utf8");
  const stubWindow = {};
  new Function("window", source)(stubWindow);
  return stubWindow.C4T_ATTENDANCE_HISTORY;
};

/* SS-001's real schedule: 09:30–16:30 HKT. Timestamps below are UTC, so
   01:30Z === 09:30 HKT. */
const WORK_START = "09:30:00";

const record = (day, inUtc, outUtc, status = "verified") => ({
  attendance_day: day,
  clock_in_at: inUtc,
  clock_out_at: outUtc,
  verification_status: status,
});

describe("classifyAttendanceRow", () => {
  const { classifyAttendanceRow } = loadHistory();

  test("marks an on-time arrival against the Hong Kong schedule", () => {
    const row = classifyAttendanceRow(record("2026-07-29", "2026-07-29T01:28:00Z", "2026-07-29T08:30:00Z"), WORK_START);

    expect(row.late).toBe(false);
    expect(row.clockIn).toBe("09:28");
    expect(row.clockOut).toBe("16:30");
  });

  test("marks a late arrival", () => {
    const row = classifyAttendanceRow(record("2026-07-29", "2026-07-29T01:47:00Z", null), WORK_START);

    expect(row.late).toBe(true);
    expect(row.clockIn).toBe("09:47");
  });

  test("shows a missing clock-out as a dash rather than a fake time", () => {
    const row = classifyAttendanceRow(record("2026-07-29", "2026-07-29T01:28:00Z", null), WORK_START);

    expect(row.clockOut).toBe("--:--");
  });

  test("cannot judge lateness without a schedule", () => {
    const row = classifyAttendanceRow(record("2026-07-29", "2026-07-29T01:47:00Z", null), null);

    expect(row.late).toBe(false);
  });

  test("carries the verification status through to the row", () => {
    expect(classifyAttendanceRow(record("2026-07-29", "2026-07-29T01:28:00Z", null, "pending"), WORK_START).verification)
      .toBe("pending");
    expect(classifyAttendanceRow(record("2026-07-29", "2026-07-29T01:28:00Z", null, "blocked"), WORK_START).verification)
      .toBe("blocked");
  });
});

describe("summariseAttendance", () => {
  const { summariseAttendance, classifyAttendanceRow } = loadHistory();

  test("counts worked, on-time and late days", () => {
    const rows = [
      record("2026-07-27", "2026-07-27T01:20:00Z", "2026-07-27T08:30:00Z"),
      record("2026-07-28", "2026-07-28T01:55:00Z", "2026-07-28T08:30:00Z"),
      record("2026-07-29", "2026-07-29T01:25:00Z", null),
    ].map((row) => classifyAttendanceRow(row, WORK_START));

    const summary = summariseAttendance(rows);

    expect(summary.daysWorked).toBe(3);
    expect(summary.lateDays).toBe(1);
    expect(summary.onTime).toBe(2);
  });

  test("counts days awaiting review so the employee sees the backlog", () => {
    const rows = [
      record("2026-07-28", "2026-07-28T01:20:00Z", "2026-07-28T08:30:00Z", "pending"),
      record("2026-07-29", "2026-07-29T01:20:00Z", null, "verified"),
    ].map((row) => classifyAttendanceRow(row, WORK_START));

    expect(summariseAttendance(rows).awaitingReview).toBe(1);
  });

  test("returns a zeroed summary for an empty month", () => {
    const summary = summariseAttendance([]);

    expect(summary).toEqual({ daysWorked: 0, onTime: 0, lateDays: 0, awaitingReview: 0 });
  });
});

describe("malformed timestamps", () => {
  const { classifyAttendanceRow } = loadHistory();

  test("degrades to a dash instead of throwing and blanking the screen", () => {
    /* Postgres renders timestamptz as "…+00", which Date() cannot parse. A
       throw here took the whole records screen down with it. */
    const row = classifyAttendanceRow(
      record("2026-07-29", "2026-07-29T14:34:42.739+00", "not a timestamp"),
      WORK_START,
    );

    expect(row.clockIn).toBe("--:--");
    expect(row.clockOut).toBe("--:--");
    expect(row.late).toBe(false);
  });
});
