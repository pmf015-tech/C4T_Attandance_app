import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("office network signal", () => {
  const table = read("supabase/migrations/20260804090000_trusted_office_networks.sql");
  const punch = read("supabase/migrations/20260804090500_punch_attendance_network_signal.sql");

  test("keeps the allowlist unreadable by employees and readable by admins", () => {
    expect(table).toContain("alter table public.trusted_office_networks enable row level security");
    expect(table).toContain("revoke all on table public.trusted_office_networks from anon, authenticated");
    expect(table).toContain("private.is_attendance_admin()");
  });

  test("matches addresses with the native cidr operator rather than string parsing", () => {
    expect(table).toContain("network cidr not null");
    expect(punch).toContain("n.network >>= v_client_ip");
    expect(punch).toContain("where n.active");
  });

  /* The whole feature's security rests on this one line. A client-supplied
     x-forwarded-for is PREPENDED by the edge, so its leftmost entry is
     attacker-controlled — reading it would let anyone punch in from home by
     adding a single header. Verified live against this project on 2026-08-04. */
  test("never trusts the forgeable forwarding header", () => {
    expect(punch).not.toContain("'x-forwarded-for'");
    expect(punch).toContain("v_headers ->> 'cf-connecting-ip'");
    expect(punch).toContain("v_headers ->> 'sb-forwarded-for'");
  });

  test("degrades to no-signal instead of failing the punch on a bad header", () => {
    expect(punch).toContain("exception when others then");
    expect(punch).toContain("v_client_ip := null;");
  });

  test("a network match cannot rescue a punch made outside the geofence", () => {
    const blocked = punch.indexOf("v_status := 'blocked';");
    const networkVerified = punch.indexOf("elsif v_on_network then");
    expect(blocked).toBeGreaterThan(-1);
    expect(networkVerified).toBeGreaterThan(blocked);
  });

  test("records which signal was available on the attendance row", () => {
    expect(punch).toContain("v_wifi_status := case when v_on_network then 'verified' else 'failed' end");
    expect(punch).toContain("wifi_assertion_status = v_wifi_status");
  });

  test("keeps the RPC signature and grants unchanged so the client needs no change", () => {
    expect(punch).toContain("public.punch_attendance(numeric, numeric, numeric)");
    expect(punch).toContain("grant execute on function public.punch_attendance(numeric, numeric, numeric)\n  to authenticated");
    expect(punch).toContain("from public, anon");
  });
});
