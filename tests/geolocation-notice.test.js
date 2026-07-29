import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const loadNotice = () => {
  const source = readFileSync(new URL("../lib/geolocation-notice.js", import.meta.url), "utf8");
  const stubWindow = {};
  new Function("window", source)(stubWindow);
  return stubWindow.C4T_GEO_NOTICE;
};

/* Mirrors the browser's GeolocationPositionError codes. */
const DENIED = { code: 1 };
const UNAVAILABLE = { code: 2 };
const TIMEOUT = { code: 3 };

describe("geolocationFailureReason", () => {
  const { geolocationFailureReason } = loadNotice();

  test("blames the insecure origin first — that is the deployment trap", () => {
    const reason = geolocationFailureReason(DENIED, { secureContext: false, supported: true });

    expect(reason).toContain("HTTPS");
  });

  test("distinguishes a denied permission from an unavailable fix", () => {
    const denied = geolocationFailureReason(DENIED, { secureContext: true, supported: true });
    const unavailable = geolocationFailureReason(UNAVAILABLE, { secureContext: true, supported: true });

    expect(denied).not.toBe(unavailable);
    expect(denied).toContain("權限");
  });

  test("names a timeout so the employee knows retrying may help", () => {
    const reason = geolocationFailureReason(TIMEOUT, { secureContext: true, supported: true });

    expect(reason).toContain("逾時");
  });

  test("reports an unsupported browser without mentioning permissions", () => {
    const reason = geolocationFailureReason(null, { secureContext: true, supported: false });

    expect(reason).toContain("不支援");
    expect(reason).not.toContain("權限");
  });

  test("always states the consequence: the punch will need admin review", () => {
    const cases = [
      geolocationFailureReason(DENIED, { secureContext: true, supported: true }),
      geolocationFailureReason(UNAVAILABLE, { secureContext: true, supported: true }),
      geolocationFailureReason(TIMEOUT, { secureContext: true, supported: true }),
      geolocationFailureReason(null, { secureContext: false, supported: true }),
      geolocationFailureReason(null, { secureContext: true, supported: false }),
    ];

    for (const reason of cases) {
      expect(reason).toContain("管理員審批");
    }
  });
});

describe("punch handler geolocation boundary", () => {
  const auth = read("live-auth.js");

  test("never submits a location-less punch without asking first", () => {
    /* The regression this locks: getCurrentPosition's error callback used to be
       `() => submitPunch(null)`, silently recording an unverifiable punch. */
    expect(auth).not.toContain("() => submitPunch(null)");
    expect(auth).toContain("punchWithoutLocation");
    expect(auth).toContain("window.confirm");
  });

  test("treats an insecure origin as a geolocation failure, not a silent punch", () => {
    expect(auth).toContain("!window.isSecureContext");
    expect(auth).toContain("secureContext: window.isSecureContext");
  });

  test("re-enables the punch button when the employee declines", () => {
    const declineBranch = auth.slice(auth.indexOf("punchWithoutLocation = async"));
    expect(declineBranch).toContain("punchButton.disabled = false");
  });
});
