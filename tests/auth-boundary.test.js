import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("browser authentication boundary", () => {
  const html = read("index.html");
  const auth = read("live-auth.js");
  const runtimeConfig = read("runtime-config.js");

  /* Local scripts carry a ?v= cache-busting token, so match the path only. */
  const at = (script) => {
    const index = html.indexOf(`src="${script}`);
    expect(index).toBeGreaterThan(-1);
    return index;
  };

  test("loads configuration and Supabase before live authentication", () => {
    expect(at("runtime-config.js")).toBeGreaterThan(at("app.js"));
    expect(html.indexOf("cdn.jsdelivr.net/npm/@supabase/supabase-js@2")).toBeGreaterThan(
      at("runtime-config.js"),
    );
    expect(at("live-auth.js")).toBeGreaterThan(
      html.indexOf("cdn.jsdelivr.net/npm/@supabase/supabase-js@2"),
    );
  });

  test("loads the pure helpers before the app reads them", () => {
    /* app.js binds window.C4T_ADMIN_DASHBOARD at evaluation time, and that
       script in turn reads window.C4T_ATTENDANCE_HISTORY. Reordering these
       leaves every admin screen throwing on first render. */
    expect(at("lib/admin-dashboard.js")).toBeGreaterThan(at("lib/attendance-history.js"));
    expect(at("app.js")).toBeGreaterThan(at("lib/admin-dashboard.js"));
    expect(at("lib/attendance-history.js")).toBeGreaterThan(at("lib/punch-state.js"));
  });

  test("routes by the RLS-backed profile role, never by email text", () => {
    expect(auth).toContain('.from("profiles")');
    expect(auth).toContain('profile.role === "admin"');
    expect(auth).not.toMatch(/email\.(?:includes|endsWith|startsWith)\(/);
  });

  test("does not expose a Supabase service-role credential", () => {
    expect(`${html}\n${auth}\n${runtimeConfig}`).not.toContain(
      "SUPABASE_SERVICE_ROLE_KEY",
    );
  });
});
