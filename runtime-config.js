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
  };
})();
