# Password recovery and attendance clock verification

## Implemented locally, not deployed

- Login → 忘記密碼 explains phone-account recovery through a verified company contact.
- Active administrator → 員工管理 → 重設密碼 → identity confirmation → private one-use link. Existing identity, schedules and attendance are preserved.
- Native Supabase recovery proof → separate memory-only client → password validation/update → global refresh-session revocation → login. Existing access JWTs expire normally.
- API checks the current active admin profile and active target roster/profile/Auth linkage, records issuance intent and generation, returns no token if auditing fails. No database migration or dependency added.
- The host must configure the three server-only/environment values described in BACKEND-CONTRACT.md. No production environment, Auth user, database or deployment was changed.

## Clock fact check

Public `https://c4t-attendance.vercel.app` served `punch-times-1` assets with HTTP 200. Retrieved app SHA256: `40e6ddc5577d9292b0325a3838f50c67e4f6766352ed720dc94893fb50977c73`; helper SHA256: `2d8a2ae757aec56219fd93f8e3d075f3f80d6b3df715687aa702b85322d90d0e`. HTTP Last-Modified: 2026-08-31 02:12:13 GMT.

The public version already retains `clock_out_at`, displays checkout as the latest punch, and labels both recorded times. The local checkout was behind and would have regressed this fix if deployed unchanged; the same behavior is now restored locally with a regression test.

The older local completed-day display reused clock-in for the prominent clock, rather than hardcoding 09:07. This reproduces a matching display symptom but does not establish the cause on the reporter's device or prove every real account's stored data is correct. Scheduling and actual punches remain distinct: individual work schedules determine lateness; each attendance row supplies the actual in/out timestamps.

Actual downloaded public code evaluated with synthetic records displayed `09:07 → 18:11` and `10:23 → 19:41` correctly. Real browser local account switching displayed employee A `09:07 → 18:42` and B `10:11 → 16:25`. No authenticated production record or reporter's device was inspected.

## Local verification evidence and limits

- `bun run check`: 130 tests pass on the publish branch based on `eddce02`, syntax and lint pass; `git diff --check` passes. The original dirty workspace had 131 tests; its two pre-existing uncommitted auth-boundary tests are deliberately excluded, while the upstream completed-day test is included. No separate build/typecheck script exists for this plain JavaScript app.
- Failing-first tests reproduced the old completed-day clock, invalid recovery route, expired/reused token rejection, and two async races. The fixes prevent switching recovery clients mid-submit and stale pre-recovery profile responses from restoring an old account after logout.
- Browser QA used the actual HTML/JS, downloaded existing Supabase SDK, and actual new API handler against a local synthetic Auth/PostgREST server. It exercised admin issuance, copy, password mismatch, successful update/return to login, expired-link error, and different employee times. This does not verify hosted Supabase mutation, real replay/expiry policy, or Vercel routing.
- Final QA artifacts are outside the repository at `/tmp/c4t-recovery-qa/final-reviewed`: 25 JPEGs and `manifest.json`, all from the publish branch. Measured viewports and image dimensions are 374×812 (phone) and 1422×1000 (desktop). Browser zoom required capturing the viewport with explicit clip bounds; the final frames are fully composed with matching dimensions. Earlier captures outside this directory are invalid or superseded.
- After explicit user approval, authenticated local recapture completed. Covered login, forgotten-password help, recovery form/mismatch/expired/success states, admin list/confirmation/result, two different employees' completed-day clocks, and account-security copy at both sizes; an additional desktop capture shows duplicate-request cooldown. Identity confirmation, Escape/cancel dismissal, copy, successful update/return to login, and replay rejection were exercised through the UI. The mobile employee list keeps every field in two rows without squeezing Chinese names.
- Independent code-integrity review passed with no blockers and independently reran all 130 tests. The final visual reviewer inspected all 25 screenshots and passed with no blockers after two orphaned CJK text tails were shortened and the affected screens recaptured at both sizes. These approvals cover local implementation and the requested commit/push, not hosted recovery or deployment.
- The real SDK emits a non-fatal multiple-client warning on repeated recovery visits in the same page; recovery credentials remain memory-only under a separate storage key. No application exception was observed. Native modal keyboard routing was not independently certified: Escape/cancel works, but reverse-tab can move focus to browser chrome.
- Native recovery link expiry/replay, SMTP-free delivery behavior, hosted Auth audit events, and a staff-operated real recovery remain deployment/UAT checks. Do not report fully verified production recovery until those checks are done.

## Approval boundary

The user approved isolated fake-account QA and commit/push. The change is based on latest upstream `main`, on `codex/admin-password-recovery`; only that branch's automatic Vercel deployments are disabled through `git.deploymentEnabled`. Production `main`, hosted configuration and real accounts remain unchanged. The original workspace's uncommitted index, canonical-origin and auth-boundary edits are not included in this feature commit. Production deployment and environment configuration require separate approval; all real credentials remain user-operated.
