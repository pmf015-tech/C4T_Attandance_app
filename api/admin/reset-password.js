import { randomUUID } from "node:crypto";

const MAX_BODY_BYTES = 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(status) {
  throw Object.assign(new Error("Password recovery unavailable"), { status });
}

function configuredUrl(value) {
  let url;
  try { url = new URL(value); } catch { fail(503); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  const production = process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
  if (url.username || url.password || url.search || url.hash ||
      (local && production) || (url.protocol !== "https:" && !(local && !production && url.protocol === "http:"))) fail(503);
  return url;
}

async function employeeNumberFrom(req) {
  const length = req.headers["content-length"];
  if (length !== undefined && (typeof length !== "string" || !/^\d+$/.test(length))) fail(400);
  if (Number(length) > MAX_BODY_BYTES) fail(413);
  let body = req.body;
  if (body === undefined) {
    const chunks = [];
    let bytes = 0;
    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > MAX_BODY_BYTES) fail(413);
      chunks.push(buffer);
    }
    body = Buffer.concat(chunks).toString("utf8");
  }
  if (Buffer.isBuffer(body)) body = body.toString("utf8");
  const serialized = typeof body === "string" ? body : JSON.stringify(body);
  if (Buffer.byteLength(serialized || "", "utf8") > MAX_BODY_BYTES) fail(413);
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { fail(400); }
  }
  if (!body || Array.isArray(body) || typeof body !== "object" || Object.keys(body).length !== 1 ||
      typeof body.employeeNumber !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/.test(body.employeeNumber)) fail(400);
  return body.employeeNumber;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      fail(405);
    }
    if (typeof req.headers["content-type"] !== "string" ||
        req.headers["content-type"].split(";")[0].trim().toLowerCase() !== "application/json") fail(415);
    const authorization = req.headers.authorization;
    if (typeof authorization !== "string" || authorization.length > 8192 || !/^Bearer [A-Za-z0-9._~-]+$/i.test(authorization)) fail(401);
    const employeeNumber = await employeeNumberFrom(req);
    const base = configuredUrl(process.env.SUPABASE_URL);
    const app = configuredUrl(process.env.APP_URL);
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (base.pathname !== "/" || !key || key.trim() !== key) fail(503);
    const signal = AbortSignal.timeout(15000);

    async function request(path, { body, user = false, empty = false } = {}) {
      const response = await fetch(new URL(path, base), {
        method: body === undefined ? "GET" : "POST",
        headers: { apikey: key, Authorization: user ? authorization : `Bearer ${key}`, "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal,
        redirect: "error",
        cache: "no-store",
      });
      if (!response.ok) fail(user && [401, 403].includes(response.status) ? 401 : 502);
      return empty ? null : response.json();
    }

    async function rows(table, params) {
      const result = await request(`/rest/v1/${table}?${new URLSearchParams(params)}`);
      if (!Array.isArray(result)) fail(502);
      return result;
    }

    const actor = await request("/auth/v1/user", { user: true });
    if (!UUID.test(actor?.id)) fail(401);
    const admins = await rows("profiles", { select: "user_id,role,active", user_id: `eq.${actor.id}`, limit: "2" });
    if (admins.length !== 1 || admins[0]?.user_id !== actor.id || admins[0].role !== "admin" || admins[0].active !== true) fail(403);

    const roster = await rows("employee_roster", {
      select: "id,auth_user_id,employee_number,active,provisioning_status",
      employee_number: `eq.${employeeNumber}`, limit: "2",
    });
    const target = roster[0];
    if (roster.length !== 1 || target?.employee_number !== employeeNumber || target.active !== true ||
        target.provisioning_status !== "provisioned" || !UUID.test(target.auth_user_id)) fail(404);
    const profiles = await rows("profiles", {
      select: "user_id,employee_number,active", user_id: `eq.${target.auth_user_id}`, limit: "2",
    });
    if (profiles.length !== 1 || profiles[0]?.user_id !== target.auth_user_id || profiles[0].active !== true ||
        profiles[0].employee_number !== employeeNumber) fail(404);
    const user = await request(`/auth/v1/admin/users/${target.auth_user_id}`);
    if (user?.id !== target.auth_user_id || typeof user.email !== "string" ||
        !/^[^\s@]+@[^\s@]+$/.test(user.email) || user.email.length > 320) fail(404);

    // ponytail: audit cooldown stops sequential repeats; use an atomic DB gate if concurrent abuse matters.
    const recent = await rows("attendance_audit_events", {
      select: "id", resource_type: "eq.profiles", resource_key: `eq.${target.auth_user_id}`,
      action: "eq.password_recovery_requested", created_at: `gte.${new Date(Date.now() - 60000).toISOString()}`, limit: "1",
    });
    if (recent.length) {
      res.setHeader("Retry-After", "60");
      fail(429);
    }

    const audit = {
      actor_id: actor.id, resource_type: "profiles", resource_key: target.auth_user_id,
      next_value: { request_id: randomUUID() },
    };
    await request("/rest/v1/attendance_audit_events", { body: { ...audit, action: "password_recovery_requested" }, empty: true });
    const recovery = await request("/auth/v1/admin/generate_link", { body: { type: "recovery", email: user.email } });
    if (recovery?.id !== target.auth_user_id || recovery.verification_type !== "recovery" ||
        typeof recovery.hashed_token !== "string" || !/^[0-9a-f]{40,128}$/i.test(recovery.hashed_token)) fail(502);
    await request("/rest/v1/attendance_audit_events", { body: { ...audit, action: "password_recovery_generated" }, empty: true });
    app.hash = new URLSearchParams({ recovery: recovery.hashed_token }).toString();
    res.statusCode = 200;
    res.end(JSON.stringify({ url: app.href }));
  } catch (error) {
    res.statusCode = [400, 401, 403, 404, 405, 413, 415, 429, 502, 503].includes(error?.status) ? error.status : 502;
    res.end(JSON.stringify({ error: "無法產生重設密碼連結，請稍後再試。" }));
  }
}
