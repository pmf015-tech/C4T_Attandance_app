import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("attendance review contract", () => {
  const app = read("app.js");
  const auth = read("live-auth.js");
  const migration = read("supabase/migrations/20260730130000_review_attendance_record.sql");

  test("renders actionable approval buttons with record identifiers", () => {
    expect(app).toContain('data-action="review-attendance"');
    expect(app).toContain(`data-record-id="\${escapeHtml(row.id)}"`);
  });

  test("uses the server-side review RPC rather than mutating records in the browser", () => {
    expect(auth).toContain('client.rpc("review_attendance_record"');
    expect(auth).toContain("p_record_id: reviewButton.dataset.recordId");
  });

  test("limits review to admins, pending records, and writes an audit event", () => {
    expect(migration).toContain("private.is_attendance_admin()");
    expect(migration).toContain("v_record.verification_status <> 'pending'");
    expect(migration).toContain("attendance_audit_events");
    expect(migration).toContain("revoke all on function public.review_attendance_record(uuid, text, text)");
  });
});
