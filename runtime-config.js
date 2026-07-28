/**
 * C4T Attendance — Runtime Configuration
 *
 * = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =
 * In production these values are injected by the deployment
 * pipeline via `window.__C4T_ENV`.  Local development falls back
 * to the hard-coded defaults below.
 *
 * NEVER commit real service-role keys here — only a publishable
 * (anon) key is safe for browser-side use.
 * = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =
 */

window.C4T_RUNTIME_CONFIG = (() => {
  /* Injected by deploy script / Docker entrypoint */
  const env = window.__C4T_ENV || {};

  return {
    supabaseUrl:
      env.SUPABASE_URL ||
      "https://kkeqssqmrjvarwhsxcoq.supabase.co",

    supabasePublishableKey:
      env.SUPABASE_PUBLISHABLE_KEY ||
      "sb_publishable_SdNsH-vmDNdPZcclbavlRQ_NJf1Sc6_",

    appUrl: env.APP_URL || window.location.origin,

    /* Staff sign in with their phone number. Supabase Auth keys users
       by email, so the phone is mapped onto a non-routable address in
       the RFC 2606 reserved `.invalid` TLD — nothing can ever be
       delivered there, which is deliberate: these accounts have no
       email recovery, the admin resets passwords. */
    staffLoginDomain: env.STAFF_LOGIN_DOMAIN || "staff.sunspeed.invalid",
  };
})();
