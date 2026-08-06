import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("home screen web app manifest", () => {
  const html = read("index.html");
  const manifest = JSON.parse(read("manifest.json"));

  test("index.html links the manifest and declares itself an iOS web app", () => {
    expect(html).toContain('<link rel="manifest" href="manifest.json">');
    expect(html).toContain('name="apple-mobile-web-app-capable" content="yes"');
    expect(html).toContain('name="apple-mobile-web-app-title" content="C4T 出勤"');
  });

  /* The whole point. Without a pinned start_url, iOS saves whatever URL happened
     to be in the address bar when "Add to Home Screen" was tapped — a typo or a
     preview host then becomes a permanent, uneditable shortcut with no address
     bar to diagnose it. */
  test("pins the start URL and scope to the app root", () => {
    expect(manifest.start_url).toBe("/");
    expect(manifest.scope).toBe("/");
  });

  test("opens standalone so the icon behaves like an app", () => {
    expect(manifest.display).toBe("standalone");
  });

  test("declares icons that actually exist in the repo", () => {
    expect(manifest.icons.length).toBeGreaterThan(0);
    for (const icon of manifest.icons) {
      expect(() => read(icon.src)).not.toThrow();
    }
  });

  test("keeps the traditional Chinese app name", () => {
    expect(manifest.name).toBe("C4T 出勤");
    expect(manifest.lang).toBe("zh-Hant");
  });
});
