import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

/* lib/punch-state.js is a classic browser script (no build step, matching the
   rest of the app), so evaluate it against a stub window to get at the pure
   helpers rather than importing it as a module. */
const loadPunchState = () => {
  const source = readFileSync(new URL("../lib/punch-state.js", import.meta.url), "utf8");
  const stubWindow = {};
  new Function("window", source)(stubWindow);
  return stubWindow.C4T_PUNCH_STATE;
};

describe("derivePunchState", () => {
  const { derivePunchState } = loadPunchState();

  test("treats a missing record as not yet clocked in", () => {
    const state = derivePunchState(null);

    expect(state.clockedIn).toBe(false);
    expect(state.canPunch).toBe(true);
    expect(state.action).toBe("clock_in");
  });

  test("reports clocked in when the day has a clock-in but no clock-out", () => {
    const state = derivePunchState({
      clock_in_at: "2026-07-29T01:30:00Z",
      clock_out_at: null,
      verification_status: "verified",
    });

    expect(state.clockedIn).toBe(true);
    expect(state.canPunch).toBe(true);
    expect(state.action).toBe("clock_out");
  });

  test("closes the day once both punches exist", () => {
    const state = derivePunchState({
      clock_in_at: "2026-07-29T01:30:00Z",
      clock_out_at: "2026-07-29T10:30:00Z",
      verification_status: "verified",
    });

    expect(state.clockedIn).toBe(false);
    expect(state.canPunch).toBe(false);
    expect(state.action).toBe("done");
  });

  test("carries the recorded clock-in time rather than a local clock reading", () => {
    expect(derivePunchState({ clock_in_at: "2026-07-29T01:30:00Z", clock_out_at: null }).clockInAt)
      .toBe("2026-07-29T01:30:00Z");
    expect(derivePunchState(null).clockInAt).toBe(null);
  });

  test("surfaces the verification status so the employee is not misled", () => {
    expect(derivePunchState({ clock_in_at: "x", clock_out_at: null, verification_status: "pending" }).verification)
      .toBe("pending");
    expect(derivePunchState({ clock_in_at: "x", clock_out_at: null, verification_status: "blocked" }).verification)
      .toBe("blocked");
    expect(derivePunchState(null).verification).toBe(null);
  });
});

describe("hongKongAttendanceDay", () => {
  const { hongKongAttendanceDay } = loadPunchState();

  test("resolves the HKT calendar day, not the browser's local day", () => {
    /* 2026-07-29T17:10Z is already 2026-07-30 in Hong Kong (UTC+8). */
    expect(hongKongAttendanceDay(new Date("2026-07-29T17:10:00Z"))).toBe("2026-07-30");
    expect(hongKongAttendanceDay(new Date("2026-07-29T01:30:00Z"))).toBe("2026-07-29");
  });
});
