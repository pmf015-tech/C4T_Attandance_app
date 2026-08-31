import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Readable } from "node:stream";
import handler from "../api/admin/reset-password.js";

const adminId = "00000000-0000-4000-8000-000000000001";
const employeeId = "00000000-0000-4000-8000-000000000002";
const rosterId = "00000000-0000-4000-8000-000000000003";
const token = "a".repeat(64);
const authEmail = "12345678@staff.sunspeed.invalid";
const envKeys = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "APP_URL", "NODE_ENV", "VERCEL_ENV"];
let originalFetch;
let savedEnv;
let scenario;
let calls;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  savedEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "server-only-key",
    APP_URL: "https://attendance.example.com/",
    NODE_ENV: "test",
    VERCEL_ENV: "preview",
  });
  calls = [];
  scenario = {
    actor: { id: adminId, user_metadata: { role: "admin" } },
    admin: { user_id: adminId, role: "admin", active: true },
    roster: { id: rosterId, auth_user_id: employeeId, employee_number: "SS-001", active: true, provisioning_status: "provisioned" },
    employee: { user_id: employeeId, employee_number: "SS-001", active: true },
    user: { id: employeeId, email: authEmail },
    generated: { id: employeeId, hashed_token: token, verification_type: "recovery", action_link: "https://untrusted.example.com/secret", email_otp: "123456" },
    recent: [],
  };
  globalThis.fetch = async (input, options) => {
    const url = new URL(input);
    const method = options.method || "GET";
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ url, ...options, method, body });
    const auditCount = calls.filter((call) => call.method === "POST" && call.url.pathname.endsWith("attendance_audit_events")).length;
    if (scenario.fail === url.pathname || (scenario.auditFail === auditCount && method === "POST" && url.pathname.endsWith("attendance_audit_events"))) {
      return Response.json({ message: `provider secret ${token} ${authEmail}` }, { status: 500 });
    }
    let data;
    if (url.pathname === "/auth/v1/user") {
      if (scenario.unauthorized) return Response.json({ msg: "secret" }, { status: 401 });
      data = scenario.actor;
    } else if (url.pathname === "/rest/v1/profiles") {
      const row = url.searchParams.get("user_id") === `eq.${adminId}` ? scenario.admin : scenario.employee;
      data = row ? [row] : [];
    } else if (url.pathname === "/rest/v1/employee_roster") data = scenario.roster ? [scenario.roster] : [];
    else if (url.pathname === `/auth/v1/admin/users/${employeeId}`) data = scenario.user;
    else if (url.pathname === "/auth/v1/admin/generate_link") data = scenario.generated;
    else if (url.pathname === "/rest/v1/attendance_audit_events") {
      if (method === "POST") return new Response(null, { status: 201 });
      data = scenario.recent;
    } else throw new Error(`Unexpected transport request: ${url.pathname}`);
    return Response.json(data);
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const key of envKeys) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

async function invoke(overrides = {}) {
  const req = Object.assign(Readable.from([]), {
    method: "POST",
    headers: { authorization: "Bearer valid-session", "content-type": "application/json", host: "evil.example.com" },
    body: { employeeNumber: "SS-001" },
  }, overrides);
  const response = { headers: {}, statusCode: 200, setHeader(key, value) { this.headers[key.toLowerCase()] = value; }, end(value) { this.body = JSON.parse(value); } };
  await handler(req, response);
  expect(response.headers["cache-control"]).toContain("no-store");
  return response;
}

const generatedCalls = () => calls.filter((call) => call.url.pathname.endsWith("generate_link"));
const auditCalls = () => calls.filter((call) => call.method === "POST" && call.url.pathname.endsWith("attendance_audit_events"));

describe("admin password recovery API", () => {
  test("Given an active admin and provisioned employee, returns only the canonical recovery URL after both audits", async () => {
    const response = await invoke();
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ url: `https://attendance.example.com/#recovery=${token}` });
    expect(calls[0].headers.Authorization).toBe("Bearer valid-session");
    expect(calls.every((call) => call.headers.apikey === "server-only-key")).toBe(true);
    expect(calls.slice(1).every((call) => call.headers.Authorization === "Bearer server-only-key")).toBe(true);
    expect(calls.find((call) => call.url.pathname.endsWith("employee_roster")).url.searchParams.get("employee_number")).toBe("eq.SS-001");
    expect(calls.filter((call) => call.url.pathname.endsWith("profiles")).map((call) => call.url.searchParams.get("user_id"))).toEqual([`eq.${adminId}`, `eq.${employeeId}`]);
    expect(generatedCalls()[0].body).toEqual({ type: "recovery", email: authEmail });
    expect(auditCalls().map((call) => call.body.action)).toEqual(["password_recovery_requested", "password_recovery_generated"]);
    const generateIndex = calls.indexOf(generatedCalls()[0]);
    expect(calls.indexOf(auditCalls()[0])).toBeLessThan(generateIndex);
    expect(calls.indexOf(auditCalls()[1])).toBeGreaterThan(generateIndex);
    expect(auditCalls().every((call) => call.body.actor_id === adminId && call.body.resource_key === employeeId)).toBe(true);
    const audits = JSON.stringify(auditCalls().map((call) => call.body));
    for (const secret of [token, authEmail, "valid-session", "server-only-key", "123456", "action_link"]) expect(audits).not.toContain(secret);
  });

  test("Given no valid session, never reads roster or generates a link", async () => {
    expect((await invoke({ headers: { "content-type": "application/json" } })).statusCode).toBe(401);
    expect(calls).toHaveLength(0);
    scenario.unauthorized = true;
    expect((await invoke()).statusCode).toBe(401);
    expect(calls).toHaveLength(1);
  });

  test.each([null, { user_id: adminId, role: "employee", active: true }, { user_id: adminId, role: "admin", active: false }, { user_id: employeeId, role: "admin", active: true }])("Given missing, inactive or non-admin profile, rejects despite admin metadata: %j", async (admin) => {
    scenario.admin = admin;
    expect((await invoke()).statusCode).toBe(403);
    expect(calls).toHaveLength(2);
    expect(generatedCalls()).toHaveLength(0);
  });

  test.each(["missing", "inactive", "pending", "unlinked", "wrong-number", "no-profile", "inactive-profile", "mismatched-profile", "wrong-auth-user", "missing-email"])("Given invalid target %s, no recovery is generated", async (kind) => {
    if (kind === "missing") scenario.roster = null;
    if (kind === "inactive") scenario.roster.active = false;
    if (kind === "pending") scenario.roster.provisioning_status = "pending";
    if (kind === "unlinked") scenario.roster.auth_user_id = null;
    if (kind === "wrong-number") scenario.roster.employee_number = "SS-002";
    if (kind === "no-profile") scenario.employee = null;
    if (kind === "inactive-profile") scenario.employee.active = false;
    if (kind === "mismatched-profile") scenario.employee.user_id = adminId;
    if (kind === "wrong-auth-user") scenario.user.id = adminId;
    if (kind === "missing-email") scenario.user.email = null;
    const response = await invoke();
    expect(response.statusCode).toBe(404);
    expect(generatedCalls()).toHaveLength(0);
    expect(auditCalls()).toHaveLength(0);
  });

  test.each(["/rest/v1/profiles", "/rest/v1/employee_roster", `/auth/v1/admin/users/${employeeId}`, "/auth/v1/admin/generate_link"])("Given provider failure at %s, fails closed without leaking provider details", async (path) => {
    scenario.fail = path;
    const response = await invoke();
    expect(response.statusCode).toBe(502);
    expect(response.body.url).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toMatch(/provider|12345678|aaaaaa/);
  });

  test.each([1, 2])("Given audit write %i fails, never exposes recovery token", async (auditFail) => {
    scenario.auditFail = auditFail;
    const response = await invoke();
    expect(response.statusCode).toBe(502);
    expect(response.body.url).toBeUndefined();
    expect(generatedCalls()).toHaveLength(auditFail - 1);
  });

  test("Given recent recovery intent, sequential requests are cooled down", async () => {
    scenario.recent = [{ id: rosterId }];
    expect((await invoke()).statusCode).toBe(429);
    expect(generatedCalls()).toHaveLength(0);
  });

  test.each([{ hashed_token: "" }, { hashed_token: token, verification_type: "signup" }, { hashed_token: token, verification_type: "recovery", id: adminId }])("Given malformed provider recovery result, exposes no URL: %j", async (generated) => {
    scenario.generated = generated;
    expect((await invoke()).statusCode).toBe(502);
    expect(auditCalls()).toHaveLength(1);
  });

  test.each(["z".repeat(56), "a".repeat(39), "a".repeat(129)])("Given a hash outside the frontend contract, never issues an unusable link: %s", async (hash) => {
    scenario.generated.hashed_token = hash;
    expect((await invoke()).statusCode).toBe(502);
    expect(auditCalls()).toHaveLength(1);
  });

  test.each(["", "http://attendance.example.com", "https://user:pass@attendance.example.com", "https://attendance.example.com/?next=evil", "https://attendance.example.com/#evil"])("Given untrusted canonical configuration %s, never calls Supabase", async (appUrl) => {
    process.env.APP_URL = appUrl;
    expect((await invoke()).statusCode).toBe(503);
    expect(calls).toHaveLength(0);
  });

  test("Given missing key or production localhost config, fails closed", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect((await invoke()).statusCode).toBe(503);
    process.env.SUPABASE_SERVICE_ROLE_KEY = "server-only-key";
    process.env.APP_URL = "http://localhost:3000/";
    process.env.VERCEL_ENV = "production";
    expect((await invoke()).statusCode).toBe(503);
    expect(calls).toHaveLength(0);
  });

  test.each([{}, [], null, { employeeNumber: "" }, { employeeNumber: "a".repeat(33) }, { employeeNumber: "SS-001", email: "attacker@example.com" }, "{bad", { employeeNumber: "SS-001,or=active.eq.false" }])("Given malformed body %j, rejects before network access", async (body) => {
    expect((await invoke({ body })).statusCode).toBe(400);
    expect(calls).toHaveLength(0);
  });

  test("Given wrong method, content type or oversized body, rejects before network access", async () => {
    expect((await invoke({ method: "GET" })).statusCode).toBe(405);
    expect((await invoke({ headers: { authorization: "Bearer valid-session", "content-type": "text/plain" } })).statusCode).toBe(415);
    expect((await invoke({ body: "x".repeat(1025) })).statusCode).toBe(413);
    expect(calls).toHaveLength(0);
  });

  test("Given JSON text or buffer input, handles the Vercel body variants", async () => {
    expect((await invoke({ body: JSON.stringify({ employeeNumber: "SS-001" }) })).statusCode).toBe(200);
    expect((await invoke({ body: Buffer.from('{"employeeNumber":"SS-001"}') })).statusCode).toBe(200);
  });

  test("Given streamed JSON, accepts bounded bodies and rejects oversized streams", async () => {
    expect((await invoke({ body: undefined, [Symbol.asyncIterator]: async function* () { yield '{"employeeNumber":'; yield '"SS-001"}'; } })).statusCode).toBe(200);
    calls = [];
    expect((await invoke({ body: undefined, [Symbol.asyncIterator]: async function* () { yield "x".repeat(1025); } })).statusCode).toBe(413);
    expect(calls).toHaveLength(0);
  });

  test.each([["1025", 413], ["invalid", 400], ["-1", 400]])("Given invalid content length %s, rejects before reading body", async (length, status) => {
    expect((await invoke({ headers: { authorization: "Bearer valid-session", "content-type": "application/json", "content-length": length } })).statusCode).toBe(status);
    expect(calls).toHaveLength(0);
  });

  test("Given a transport exception containing secrets, returns only a generic error", async () => {
    globalThis.fetch = async () => { throw new Error(`secret: ${token}`); };
    const response = await invoke();
    expect(response.statusCode).toBe(502);
    expect(JSON.stringify(response.body)).not.toContain(token);
  });
});
