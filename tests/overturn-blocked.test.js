import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("overturning a blocked attendance record", () => {
  const migration = read("supabase/migrations/20260804100000_overturn_blocked_attendance.sql");
  const app = read("app.js");
  const auth = read("live-auth.js");

  /* The bug this fixes: the old function rejected anything that was not
     'pending', so a wrongly blocked punch could only be repaired by hand in
     the database. That is what happened to the first two real punches. */
  test("no longer refuses every record that is not pending", () => {
    expect(migration).not.toContain("v_record.verification_status <> 'pending'");
    expect(migration).toContain("v_previous = 'blocked'");
  });

  test("demands a written reason before reversing a block", () => {
    expect(migration).toContain("A reason is required to overturn a blocked record");
    expect(migration).toContain("v_note text := nullif(trim(coalesce(p_note, '')), '')");
  });

  test("keeps an approved record final", () => {
    expect(migration).toContain("A verified record cannot be changed");
  });

  test("records the real previous status and a distinct audit action", () => {
    expect(migration).toContain("'attendance_record.overturn_block'");
    expect(migration).toContain("jsonb_build_object('verification_status', v_previous)");
    expect(migration).toContain("attendance_audit_events");
  });

  test("still limits the whole operation to admins", () => {
    expect(migration).toContain("private.is_attendance_admin()");
    expect(migration).toContain("revoke all on function public.review_attendance_record(uuid, text, text)");
  });

  test("surfaces blocked punches to the admin with an override button", () => {
    expect(app).toContain("row.verification === 'blocked'");
    expect(app).toContain('data-override="1"');
    expect(app).toContain("推翻並批准");
  });

  test("collects the reason in the browser and refuses to send an empty one", () => {
    expect(auth).toContain("reviewButton.dataset.override");
    expect(auth).toContain("if (!note) return;");
    expect(auth).toContain("p_note: note");
  });
});
