import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const token = "a".repeat(56); // Synthetic; never a real recovery link.
function harness({ verifyError = null, updateError = null, beforeVerify = async () => {}, initialHash = `#recovery=${token}`, initialSession = null, profileResult = Promise.resolve({ data: null }) } = {}) {
  const calls = [];
  const button = { disabled: false, textContent: "" };
  const form = { querySelector: () => button };
  const message = { textContent: "", classList: { remove() {} } };
  const fields = {
    "#recovery-password": { value: "Synthetic-pass-123" },
    "#recovery-password-confirm": { value: "Synthetic-pass-123" },
    "#recovery-message": message,
  };
  const events = {};
  const location = { hash: initialHash, pathname: "/", search: "", origin: "https://attendance.example" };
  let clients = 0;
  const window = {
    C4T_RUNTIME_CONFIG: { supabaseUrl: "https://supabase.example", supabasePublishableKey: "synthetic-public", staffLoginDomain: "staff.sunspeed.invalid" },
    c4tState: {}, c4tRender() {},
    c4tResetSession() { window.c4tState.view = "login"; window.c4tState.profile = null; },
    C4T_ADMIN_DASHBOARD: {}, C4T_PUNCH_STATE: { hongKongAttendanceDay: () => "2026-08-30" },
    addEventListener(name, callback) { events[name] = callback; },
    supabase: { createClient(_url, _key, options) {
      const id = clients++;
      calls.push(["client", id, options]);
      const query = Object.assign(Promise.resolve({ data: [], error: { message: "No fixture data" } }), {
        select() { return query; }, eq() { return query; }, order() { return query; }, gte() { return query; },
        single() { return profileResult; }, maybeSingle() { return Promise.resolve({ data: null }); },
      });
      return { from() { return query; }, auth: {
        getSession: async () => { calls.push(["getSession", id]); return { data: { session: initialSession } }; },
        verifyOtp: async (input) => { calls.push(["verify", id, input]); await beforeVerify(); return { data: { user: { id: "synthetic-user" }, session: verifyError ? null : { user: { id: "synthetic-user" } } }, error: verifyError }; },
        updateUser: async (input) => { calls.push(["update", id, input]); return { data: { user: { id: "synthetic-user" } }, error: updateError }; },
        signOut: async (input) => { calls.push(["signOut", id, input]); return { error: null }; },
      } };
    } },
  };
  runInNewContext(readFileSync(new URL("../live-auth.js", import.meta.url), "utf8"), {
    window, location, URLSearchParams, history: { replaceState() { location.hash = ""; } },
    document: { addEventListener(name, callback) { events[name] = callback; }, querySelector: (selector) => fields[selector] },
    console, navigator: {},
  });
  const submit = () => events.submit({
    target: { closest: (selector) => selector === "#recovery-form" ? form : null },
    preventDefault() {}, stopImmediatePropagation() {},
  });
  return { calls, window, location, fields, submit, button, message, events };
}

test("recovery route strips the token from the URL without signing into the main app", () => {
  const h = harness();
  expect(h.window.c4tState.view).toBe("recover");
  expect(h.location.hash).toBe("");
  expect(h.calls.some(([name]) => name === "getSession" || name === "verify")).toBe(false);
});

test("matching passwords verify once on an isolated client, update and revoke sessions", async () => {
  const h = harness();
  await h.submit();
  const client = h.calls.find(([name, id]) => name === "client" && id === 1);
  expect(client?.[2]?.auth.persistSession).toBe(false);
  expect(client?.[2]?.auth.detectSessionInUrl).toBe(false);
  expect(h.calls.filter(([name]) => ["verify", "update"].includes(name))).toEqual([
    ["verify", 1, { token_hash: token, type: "recovery" }],
    ["update", 1, { password: "Synthetic-pass-123" }],
  ]);
  expect(h.calls).toContainEqual(["signOut", 1, { scope: "global" }]);
  expect(h.window.c4tState.view).toBe("login");
});

test("a mismatch or too-short password never consumes a recovery token", async () => {
  const h = harness();
  h.fields["#recovery-password-confirm"].value = "different";
  await h.submit();
  expect(h.calls.some(([name]) => name === "verify" || name === "update")).toBe(false);
  expect(h.message.textContent).not.toBe("");
});

test("expired or reused links never change a password", async () => {
  const h = harness({ verifyError: { message: "expired" } });
  await h.submit();
  expect(h.calls.some(([name]) => name === "update")).toBe(false);
  expect(h.button.disabled).toBe(false);
  expect(h.message.textContent).not.toBe("");
});

test("a rejected password can be retried without redeeming a one-use token again", async () => {
  const h = harness({ updateError: { code: "weak_password" } });
  await h.submit();
  await h.submit();
  expect(h.calls.filter(([name]) => name === "verify")).toHaveLength(1);
  expect(h.calls.filter(([name]) => name === "update")).toHaveLength(2);
  expect(h.window.c4tState.view).toBe("recover");
  expect(h.button.disabled).toBe(false);
});

test("a new hash cannot switch recovery clients while a password submission is running", async () => {
  let h;
  h = harness({ beforeVerify: async () => {
    h.location.hash = `#recovery=${"b".repeat(56)}`;
    h.events.hashchange();
  } });
  await h.submit();
  expect(h.calls.filter(([name]) => name === "update")).toHaveLength(1);
  expect(h.window.c4tState.view).toBe("login");
});

test("a delayed old profile response cannot restore an account after recovery and logout", async () => {
  let resolveProfile;
  const profileResult = new Promise(resolve => { resolveProfile = resolve; });
  const h = harness({ initialHash: "", initialSession: { user: { id: "old-admin" } }, profileResult });
  await Promise.resolve();
  h.location.hash = `#recovery=${token}`;
  h.events.hashchange();
  await h.submit();
  resolveProfile({ data: { user_id: "old-admin", active: true, role: "admin" }, error: null });
  await Promise.resolve();
  await Promise.resolve();
  expect(h.window.c4tState.view).toBe("login");
  expect(h.window.c4tState.profile).toBe(null);
});
