import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("browser authentication boundary", () => {
  const html = read("index.html");
  const auth = read("live-auth.js");
  const runtimeConfig = read("runtime-config.js");

  test("loads configuration and Supabase before live authentication", () => {
    expect(html.indexOf('src="runtime-config.js"')).toBeGreaterThan(
      html.indexOf('src="app.js"'),
    );
    expect(
      html.indexOf("cdn.jsdelivr.net/npm/@supabase/supabase-js@2"),
    ).toBeGreaterThan(html.indexOf('src="runtime-config.js"'));
    expect(html.indexOf('src="live-auth.js"')).toBeGreaterThan(
      html.indexOf("cdn.jsdelivr.net/npm/@supabase/supabase-js@2"),
    );
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
