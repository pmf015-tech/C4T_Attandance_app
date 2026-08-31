import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

test("employee home uses each person's actual in and out times, including after checkout", () => {
  const context = { window: {}, document: { addEventListener() {} }, Date, Intl };
  for (const file of ["lib/punch-state.js", "lib/attendance-history.js", "lib/admin-dashboard.js", "app.js"]) {
    runInNewContext(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), context);
  }
  for (const [start, end] of [["09:07", "18:42"], ["10:11", "16:25"]]) {
    context.window.c4tState.punchState = context.window.C4T_PUNCH_STATE.derivePunchState({
      clock_in_at: `2026-08-30T${start}:00+08:00`,
      clock_out_at: `2026-08-30T${end}:00+08:00`,
      verification_status: "verified",
    });
    const html = runInNewContext("employeeHome()", context);
    expect(html).toContain(`class="clock">${end}`);
    expect(html).toContain(`${start} 上班`);
    expect(html).toContain(`${end} 下班`);
  }
});
