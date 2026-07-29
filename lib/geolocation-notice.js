/**
 * C4T Attendance — geolocation failure messaging
 *
 * A punch with no GPS can never auto-verify: punch_attendance() parks it at
 * 'pending' for manual review. The old handler swallowed every geolocation
 * failure and submitted null coordinates anyway, so employees had no idea
 * their punch needed approval. These messages name the actual cause and
 * always state the consequence.
 *
 * Classic browser script (no build step) — also loaded by tests via a stub
 * window, so keep it dependency-free and side-effect-free.
 */

window.C4T_GEO_NOTICE = (() => {
  const NEEDS_REVIEW = "呢次打卡會記錄低，但需要管理員審批。";

  /* GeolocationPositionError codes. */
  const PERMISSION_DENIED = 1;
  const POSITION_UNAVAILABLE = 2;
  const TIMEOUT = 3;

  /**
   * @param {{code: number} | null} error
   * @param {{secureContext: boolean, supported: boolean}} context
   * @returns {string}
   */
  const geolocationFailureReason = (error, context) => {
    /* Checked before the error code: on an http:// origin the browser reports
       PERMISSION_DENIED, which would otherwise send the employee hunting
       through their phone settings for a permission that was never the cause. */
    if (!context.secureContext) {
      return `此網站並非以 HTTPS 提供，瀏覽器不允許讀取位置。請聯絡管理員改用 HTTPS 網址。${NEEDS_REVIEW}`;
    }

    if (!context.supported) {
      return `此瀏覽器不支援定位功能。${NEEDS_REVIEW}`;
    }

    switch (error?.code) {
      case PERMISSION_DENIED:
        return `定位權限被拒絕。請在瀏覽器設定允許此網站讀取位置。${NEEDS_REVIEW}`;
      case POSITION_UNAVAILABLE:
        return `暫時取得不到位置訊號，室內或會影響接收。${NEEDS_REVIEW}`;
      case TIMEOUT:
        return `取得位置逾時，可以行近窗邊再試一次。${NEEDS_REVIEW}`;
      default:
        return `取得不到位置。${NEEDS_REVIEW}`;
    }
  };

  return { geolocationFailureReason };
})();
