-- ══════════════════════════════════════════════════════════════
-- trusted_office_networks: the office network signal
--
-- "Wi-Fi verification" cannot mean what it sounds like. A browser
-- cannot read the SSID or BSSID — there is no web API for it on
-- any browser or OS — and BACKEND-CONTRACT.md rule 5 forbids
-- accepting either from the client as evidence. What a web app
-- can prove is the public IP the request arrived from, because
-- that is observed at the edge rather than sent by the page.
--
-- Verified live on this project (2026-08-04) before building:
--   x-forwarded-for   forgeable — a client-supplied value is
--                     PREPENDED, so its leftmost entry is
--                     attacker-controlled. Never read it.
--   cf-connecting-ip  set by Cloudflare; a forged copy is
--                     rejected with 403 at the edge.
--   sb-forwarded-for  likewise unchanged under forgery.
--
-- Native `cidr` + the `>>=` containment operator does the matching,
-- so a single row covers one address (/32) or a whole range, and
-- there is no hand-rolled IP parsing to get wrong.
-- ══════════════════════════════════════════════════════════════

create table if not exists public.trusted_office_networks (
  id uuid primary key default gen_random_uuid(),
  label text not null unique check (char_length(label) between 1 and 80),
  network cidr not null unique,
  active boolean not null default true,
  note text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.trusted_office_networks enable row level security;

revoke all on table public.trusted_office_networks from anon, authenticated;

-- Employees never read this table; punch_attendance is security definer and
-- consults it on their behalf. Admins can read it to see what is allowlisted.
drop policy if exists "Admins can read trusted office networks"
on public.trusted_office_networks;

create policy "Admins can read trusted office networks"
on public.trusted_office_networks for select to authenticated
using ((select private.is_attendance_admin()));

drop trigger if exists trusted_office_networks_touch_updated_at
on public.trusted_office_networks;

create trigger trusted_office_networks_touch_updated_at
before update on public.trusted_office_networks
for each row execute procedure private.touch_updated_at();

-- Sunspeed's office line, reported from a staff iPhone on the office Wi-Fi
-- (2026-08-04). api64.ipify.org returned the same IPv4, so this connection has
-- no IPv6 egress and a v4 row alone is sufficient.
insert into public.trusted_office_networks (label, network, note)
values (
  '火炭工業中心 901 室',
  '42.3.11.196/32',
  'Office broadband public IPv4. If the ISP lease is dynamic this will change; '
  'punches then fall back to GPS and need review until the row is updated.'
)
on conflict (network) do nothing;
