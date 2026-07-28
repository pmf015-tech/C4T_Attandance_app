import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("QR onboarding boundary", () => {
  const auth = read("live-auth.js");
  const migration = read(
    "supabase/migrations/20260728130000_qr_phone_onboarding.sql",
  );

  test("keeps the invitation token server-side as a hash", () => {
    expect(migration).toContain("token_hash");
    expect(migration).toContain("extensions.digest");
    expect(migration).toContain("redeemed_at");
    expect(migration).toContain("expires_at");
  });

  test("allows only an authenticated admin to issue invitations", () => {
    expect(migration).toContain("private.is_attendance_admin()");
    expect(migration).toContain("revoke all on function public.create_onboarding_invite");
    expect(migration).toContain("grant execute on function public.create_onboarding_invite");
  });

  test("binds signup to the QR token without trusting a browser role", () => {
    expect(auth).toContain("onboarding_token");
    expect(auth).toContain("client.auth.signUp");
    expect(auth).not.toContain("role: \"admin\"");
  expect(auth).toContain("create_onboarding_invite");
  });
});
