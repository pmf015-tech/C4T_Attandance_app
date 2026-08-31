import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const renderEmployeeHome = (record) => {
  const windowStub = {};
  new Function("window", read("lib/punch-state.js"))(windowStub);

  windowStub.C4T_ADMIN_DASHBOARD = {
    initials: () => "水容",
    weekday: () => "星期四",
  };

  const root = { innerHTML: "" };
  const documentStub = {
    addEventListener: () => {},
    getElementById: (id) => (id === "app" ? root : null),
    querySelectorAll: () => [],
  };

  new Function("window", "document", read("app.js"))(windowStub, documentStub);
  windowStub.c4tState.view = "employee";
  windowStub.c4tState.profile = { full_name: "陳水容" };
  windowStub.c4tState.schedule = { work_start: "09:00:00", work_end: "18:00:00" };
  windowStub.c4tState.punchState = windowStub.C4T_PUNCH_STATE.derivePunchState(record);
  windowStub.c4tRender();

  return { html: root.innerHTML, state: windowStub.c4tState.punchState };
};

describe("employee home punch times", () => {
  test("keeps and displays each user's distinct clock-in and clock-out timestamps", () => {
    const { html, state } = renderEmployeeHome({
      clock_in_at: "2026-08-27T01:07:00Z",
      clock_out_at: "2026-08-27T10:11:00Z",
      verification_status: "verified",
    });

    expect(state.clockInAt).toBe("2026-08-27T01:07:00Z");
    expect(state.clockOutAt).toBe("2026-08-27T10:11:00Z");
    expect(html).toContain('<div class="clock">18:11</div>');
    expect(html).toContain("已於 09:07 上班，並已於 18:11 下班打卡");
    expect(html).toContain("今日打卡位置已驗證");
    expect(html).not.toContain(">尚未打卡</span>");
  });
});
