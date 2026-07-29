/**
 * C4T 出勤 — Application Logic
 *
 * = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =
 * State management  —  Render helpers  —  View builders  —  Bind
 * = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =
 */

/* ── Application state ─────────────────────────────────────── */
const c4t = {
  view: 'login',
  employeeTab: 'home',
  adminTab: 'overview',
  clockedIn: false,
  approved: 0,
  saveMessage: '',
  activationToken: '',
  activationMessage: '',
  inviteModalOpen: false,
  invite: null,
  /* Pin the "current" time so the clock display is stable until a punch. */
  _clockTime: null,
};
window.c4tState = c4t;           // live-auth.js reads this to switch views
window.c4tRender = render;       // live-auth.js calls this after auth

/* ── Shortcuts ─────────────────────────────────────────────── */
const D  = window.C4T_MOCK_DATA;
const $$ = (sel, ctx) => [...(ctx || document).querySelectorAll(sel)];
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));

/* ── Tiny icon / pill builders ─────────────────────────────── */
const icon = (text) => `<span class="tile-mark" aria-hidden="true">${text}</span>`;
const pill = (type, text) => `<span class="pill ${type}">${text}</span>`;
const brand = () => `
  <div class="brand">
    <img src="uploads/c4t-logo.jpg" alt="C4T 標誌">
    <b>C4T 出勤</b>
  </div>`;

/* ── Formatted HK time helper ──────────────────────────────── */
function hkTime(date) {
  return date.toLocaleString('zh-HK', {
    hour: '2-digit', minute: '2-digit', hour12: false,
    timeZone: 'Asia/Hong_Kong',
  });
}

function hkDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-HK', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Hong_Kong',
  });
}

/* ── Dynamic clock value ───────────────────────────────────── */
function clockDisplay() {
  if (!c4t.clockedIn) return '--:--';
  if (!c4t._clockTime) c4t._clockTime = hkTime(new Date());
  return c4t._clockTime;
}

/* =============================================================
   VIEW BUILDERS
   ============================================================= */

/* ── Login ─────────────────────────────────────────────────── */
function renderLogin() {
  return `
    <main class="login">
      <section class="login-card">
        ${brand()}
        <h1>出勤，清晰一點。</h1>
        <p>以公司帳戶登入 C4T 出勤系統。</p>
        <form id="login-form" data-form="login">
          <label class="form-label" for="login-id">電話號碼</label>
          <input class="field" id="login-id" type="tel"
                 placeholder="8 位數字電話號碼"
                 autocomplete="username" inputmode="numeric"
                 maxlength="8" required>

          <label class="form-label" for="password">密碼</label>
          <input class="field" id="password" type="password"
                 placeholder="輸入密碼"
                 autocomplete="current-password" required>

          <button class="primary" type="submit">登入</button>
        </form>

        <p class="hint">以公司登記的電話號碼登入。忘記密碼請聯絡管理員重設。</p>
        <p id="login-error" class="hint hidden" style="color:var(--danger)"></p>
      </section>
    </main>`;
}

function activationView() {
  const hasToken = Boolean(c4t.activationToken);
  return `
    <main class="login">
      <section class="login-card">
        ${brand()}
        <h1>啟用出勤帳戶</h1>
        <p>${hasToken ? '請確認電話號碼，然後設定你的登入密碼。' : '請使用 Lisa 分享的一次性啟用 QR code。'}</p>
        ${hasToken ? `
          <form id="activation-form">
            <label class="form-label" for="activation-phone">電話號碼</label>
            <input class="field" id="activation-phone" type="tel"
                   placeholder="8 位數字電話號碼" autocomplete="tel" inputmode="numeric"
                   maxlength="8" required>
            <label class="form-label" for="activation-password">設定密碼</label>
            <input class="field" id="activation-password" type="password"
                   placeholder="至少 12 個字元" autocomplete="new-password" required>
            <label class="form-label" for="activation-password-confirm">確認密碼</label>
            <input class="field" id="activation-password-confirm" type="password"
                   placeholder="再次輸入密碼" autocomplete="new-password" required>
            <button class="primary" type="submit">啟用帳戶</button>
          </form>` : ''}
        <p id="activation-message" class="hint ${c4t.activationMessage ? '' : 'hidden'}">${escapeHtml(c4t.activationMessage)}</p>
        <button class="text-button" data-action="back-to-login">返回登入</button>
      </section>
    </main>`;
}

/* ── Employee nav ──────────────────────────────────────────── */
function employeeNav() {
  return `
    <nav class="mobile-nav" aria-label="員工導航">
      <button class="${c4t.employeeTab === 'home' ? 'active' : ''}"
              data-employee-tab="home">
        <span class="nav-mark">主</span>主頁
      </button>
      <button class="${c4t.employeeTab === 'records' ? 'active' : ''}"
              data-employee-tab="records">
        <span class="nav-mark">記</span>出勤
      </button>
      <button class="${c4t.employeeTab === 'profile' ? 'active' : ''}"
              data-employee-tab="profile">
        <span class="nav-mark">我</span>我
      </button>
    </nav>`;
}

/* ── Employee: Home ────────────────────────────────────────── */
function employeeHome() {
  const action = c4t.clockedIn ? '下班打卡' : '上班打卡';
  const status = c4t.clockedIn
    ? `已於 ${clockDisplay()} 上班`
    : '尚未打卡';
  const weekday = D.getCurrentWeekday();

  return `
    <section class="mobile-main">
      <div class="welcome">
        <div>
          <div class="eyebrow">${weekday} · 2026年7月16日</div>
          <h1>早晨，嘉怡</h1>
        </div>
        <span class="today">09:00 — 18:00</span>
      </div>

      <article class="punch-card">
        <h2>今日出勤</h2>
        <div class="clock">${clockDisplay()}</div>
        <span class="punch-state">${status}</span>
        <button class="punch-button" data-action="punch">${action}</button>
        <p class="punch-note">打卡時會提交位置及網絡驗證資料供系統審核。</p>
      </article>

      <div class="section-title"><span>快捷功能</span></div>
      <div class="quick-grid">
        <button class="action-tile" data-action="punch">
          ${icon('打')}<b>${action}</b><span>記錄今天時間</span>
        </button>
        <button class="action-tile" data-employee-tab="records">
          ${icon('記')}<b>出勤紀錄</b><span>查看每日紀錄</span>
        </button>
        <button class="action-tile" data-employee-tab="profile">
          ${icon('我')}<b>個人資料</b><span>查看帳戶資料</span>
        </button>
      </div>

      <div class="section-title">
        <span>打卡驗證</span>
        <button data-employee-tab="records">查看紀錄</button>
      </div>

      <article class="info-card">
        <div class="info-row">
          <div class="info-mark">位</div>
          <div>
            <b>辦公室位置</b>
            <p>火炭工業中心 9 樓 901 室</p>
            ${pill('success', '位置在設定範圍內')}
          </div>
        </div>
      </article>

      <article class="info-card">
        <div class="info-row">
          <div class="info-mark">網</div>
          <div>
            <b>公司 Wi-Fi</b>
            <p>等候受信任 gateway 的驗證結果。</p>
            ${pill('warning', '需要系統確認')}
          </div>
        </div>
      </article>
    </section>`;
}

/* ── Employee: Records ─────────────────────────────────────── */
function employeeRecords() {
  const summary = D.getMonthlySummary();
  const records = D.getAttendanceRecords();

  return `
    <section class="mobile-main">
      <div class="welcome">
        <div>
          <div class="eyebrow">2026年7月</div>
          <h1>出勤紀錄</h1>
        </div>
      </div>

      <article class="info-card">
        <div class="info-row">
          <div class="info-mark">月</div>
          <div>
            <b>本月摘要</b>
            <p>出勤 ${summary.daysWorked} 日 ·
               準時 ${summary.onTime} 日 ·
               遲到 ${summary.lateDays} 日</p>
          </div>
        </div>
      </article>

      <div class="section-title">
        <span>最近紀錄</span>
        <button>篩選</button>
      </div>

      <div class="record-card">
        ${records.map(r => `
          <div class="record-row">
            <div><b>${r[0]}</b><span>${D.dayOfWeek(r[0])}</span></div>
            <div><span>上班</span><b>${r[1]}</b></div>
            <div><span>下班</span><b>${r[2]}</b></div>
            ${pill(r[3] === 'late' ? 'warning' : 'success',
                   r[3] === 'late' ? '遲到' : '正常')}
          </div>`).join('')}
      </div>
    </section>`;
}

/* ── Employee: Profile ─────────────────────────────────────── */
function employeeProfile() {
  return `
    <section class="mobile-main">
      <div class="welcome">
        <div>
          <div class="eyebrow">帳戶</div>
          <h1>個人資料</h1>
        </div>
      </div>

      <article class="profile-card">
        <div class="profile-hero">
          <div class="avatar">WH</div>
          <div>
            <h2>黃嘉怡</h2>
            <p>ka.yee@c4t.example</p>
          </div>
        </div>
        <div class="profile-list">
          <div><span>職位</span><b>營運助理</b></div>
          <div><span>部門</span><b>未分配</b></div>
          <div><span>員工編號</span><b>C4T-001</b></div>
          <div><span>到職日期</span><b>2026年7月1日</b></div>
        </div>
      </article>

      <div class="section-title"><span>帳戶安全</span></div>
      <article class="info-card">
        <div class="info-row">
          <div class="info-mark">密</div>
          <div>
            <b>更改密碼</b>
            <p>正式版將透過 Supabase Auth 安全更新密碼。</p>
          </div>
        </div>
      </article>
    </section>`;
}

/* ── Employee shell ────────────────────────────────────────── */
function employeeView() {
  const tab = c4t.employeeTab;
  const content = tab === 'home'    ? employeeHome()    :
                  tab === 'records' ? employeeRecords() :
                  employeeProfile();

  return `
    <div class="employee-shell">
      <header class="mobile-top">
        ${brand()}
        <div class="avatar">WH</div>
      </header>
      ${content}
      ${employeeNav()}
    </div>`;
}

/* ══════════════════════════════════════════════════════════════
   ADMIN VIEWS
   ══════════════════════════════════════════════════════════════ */

const adminItems = [
  ['overview',   '總覽',     '總'],
  ['records',    '出勤紀錄', '記'],
  ['approvals',  '審批中心', '審'],
  ['employees',  '員工管理', '員'],
  ['settings',   '系統設定', '設'],
];

/* ── Admin nav ─────────────────────────────────────────────── */
function adminNav() {
  return `
    <aside class="side">
      ${brand()}
      <nav class="side-nav">
        ${adminItems.map(([id, label, mark]) => `
          <button class="${c4t.adminTab === id ? 'active' : ''}"
                  data-admin-tab="${id}">
            <span class="side-mark">${mark}</span>
            <span>${label}</span>
          </button>`).join('')}
      </nav>
      <div class="side-bottom">
        <button data-action="logout">登出</button>
      </div>
    </aside>`;
}

/* ── Admin: Overview ───────────────────────────────────────── */
function overview() {
  const staff = D.getStaffRoster();
  const pending = Math.max(0, 1 - c4t.approved);

  return `
    <div class="stat-grid">
      <article class="stat">
        <span>已打卡</span>
        <strong>3 <small>/ 3 人</small></strong>
      </article>
      <article class="stat">
        <span>已驗證</span>
        <strong style="color:var(--success)">2 <small>人</small></strong>
      </article>
      <article class="stat">
        <span>待審批</span>
        <strong style="color:var(--warning)">${pending} <small>項</small></strong>
      </article>
      <article class="stat">
        <span>遲到</span>
        <strong style="color:var(--danger)">1 <small>人</small></strong>
      </article>
    </div>

    <div class="admin-grid">
      <section class="panel">
        <div class="panel-heading">
          <h2>今日即時出勤</h2>
          <button data-admin-tab="records">查看全部</button>
        </div>
        ${staff.map((s, i) => `
          <div class="live-row">
            <div class="person">
              <div class="avatar">${s.initials}</div>
              <div>
                <b>${s.name}</b>
                <span>${s.role}</span>
              </div>
            </div>
            <time>${i === 2 ? '09:17' : `09:0${i + 1}`}</time>
            ${pill(i === 2 ? 'warning' : 'success',
                   i === 2 ? '遲到' : '已驗證')}
          </div>`).join('')}
      </section>

      <section class="panel">
        <div class="panel-heading">
          <h2>待審批</h2>
          <button data-admin-tab="approvals">審批中心</button>
        </div>
        ${c4t.approved
          ? `<div class="approval">
               <b>全部處理完成</b>
               <p>今天沒有待處理的出勤更正。</p>
             </div>`
          : `<div class="approval">
               <b>潘家明 · 上班打卡</b>
               <p>GPS 在範圍內；尚未收到受信任 Wi-Fi gateway 確認。</p>
               <div class="button-row">
                 <button class="approve" data-action="approve">批准</button>
                 <button class="reject" data-action="reject">退回</button>
               </div>
             </div>`}
      </section>
    </div>`;
}

/* ── Admin: Records ────────────────────────────────────────── */
function recordsAdmin() {
  const data = D.getAdminTableData();

  return `
    <div class="toolbar">
      <input class="field" placeholder="搜尋員工" autocomplete="off">
      <select class="field">
        <option>全部狀態</option>
        <option>已驗證</option>
        <option>待審批</option>
      </select>
      <button class="primary">匯出 CSV</button>
    </div>

    <p class="table-hint">左右滑動查看完整紀錄</p>
    <div class="table-scroll" role="region" aria-label="出勤紀錄，可左右滑動查看" tabindex="0">
      <table class="data-table">
        <thead>
          <tr>
            <th>日期</th><th>員工</th><th>上班</th>
            <th>下班</th><th>GPS</th><th>Wi-Fi</th><th>狀態</th>
          </tr>
        </thead>
        <tbody>
          ${data.map(r => `
            <tr>
              <td>${r.date}</td>
              <td>${r.name}</td>
              <td>${r.checkIn}</td>
              <td>${r.checkOut}</td>
              <td>${r.gps}</td>
              <td>${r.wifi}</td>
              <td>${pill(r.status === 'verified' ? 'success' : 'warning',
                         r.status === 'verified' ? '已驗證' :
                         r.status === 'late' ? '遲到' : '待審批')}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

/* ── Admin: Approvals ──────────────────────────────────────── */
function approvalsAdmin() {
  return `
    <section class="panel">
      <div class="panel-heading">
        <h2>待處理項目</h2>
        <span>${Math.max(0, 1 - c4t.approved)} 項</span>
      </div>
      ${c4t.approved
        ? `<div class="approval">
             <b>全部處理完成</b>
             <p>沒有待處理的出勤更正。</p>
           </div>`
        : `<div class="approval">
             <b>潘家明 · 2026年7月16日 09:01</b>
             <p>位置確認在地理圍欄內。Wi-Fi assertion 尚未收到，需由管理員決定是否批准。</p>
             <div class="button-row">
               <button class="approve" data-action="approve">批准紀錄</button>
               <button class="reject" data-action="reject">退回補充資料</button>
             </div>
           </div>`}
    </section>`;
}

/* ── Admin: Employees ──────────────────────────────────────── */
function employeesAdmin() {
  const staff = D.getStaffRoster();
  return `
    <div class="toolbar">
      <input class="field" placeholder="搜尋員工" autocomplete="off">
      <button class="primary" data-action="open-invite">建立啟用 QR</button>
    </div>
    <div class="employee-list">
      ${staff.map(s => `
        <article class="employee-row">
          <div class="person">
            <div class="avatar">${s.initials}</div>
            <div>
              <b>${s.name}</b>
              <small>${s.email}</small>
            </div>
          </div>
          <span>${s.role}</span>
          ${pill('success', s.status === 'active' ? '在職' : s.status)}
          <button class="approve">編輯</button>
        </article>`).join('')}
    </div>`;
}

function inviteModal() {
  if (!c4t.inviteModalOpen) return '';

  const result = c4t.invite
    ? `
        <div class="invite-result">
          <canvas id="invite-qr" aria-label="員工帳戶啟用 QR code"></canvas>
          <p class="hint hidden" id="invite-qr-error" role="alert"></p>
          <b>${escapeHtml(c4t.invite.fullName)} · ${escapeHtml(c4t.invite.employeeNumber)}</b>
          <p>此 QR 會在 ${escapeHtml(hkDateTime(c4t.invite.expiresAt))} 失效，掃描後只可使用一次。</p>
          <input class="field" value="${escapeHtml(c4t.invite.url)}" readonly aria-label="啟用連結">
          <div class="button-row">
            <button class="approve" data-action="copy-invite">複製連結</button>
            <button class="reject" data-action="close-invite">關閉</button>
          </div>
        </div>`
    : `
        <form id="invite-form">
          <label class="form-label" for="invite-employee-number">員工編號</label>
          <input class="field" id="invite-employee-number" placeholder="例如 SS-001"
                 autocomplete="off" maxlength="32" required>
          <p class="hint">只限尚未啟用、在職嘅員工。新 QR 會令舊 QR 即時失效。</p>
          <div class="button-row">
            <button class="primary" type="submit">建立 QR</button>
            <button class="reject" type="button" data-action="close-invite">取消</button>
          </div>
        </form>`;

  return `
    <div class="modal-backdrop" role="presentation">
      <section class="modal-card" role="dialog" aria-modal="true" aria-labelledby="invite-title">
        <div class="panel-heading">
          <h2 id="invite-title">員工帳戶啟用 QR</h2>
          <button data-action="close-invite" aria-label="關閉">關閉</button>
        </div>
        ${result}
      </section>
    </div>`;
}

/* ── Admin: Settings ───────────────────────────────────────── */
function settingsAdmin() {
  return `
    <div>
      <div class="setting-grid">
        <label class="full">
          <span>辦公室位置</span>
          <input class="field" value="火炭工業中心 9 樓 901 室">
        </label>
        <label>
          <span>GPS 座標</span>
          <input class="field" value="22.398727, 114.191719">
        </label>
        <label>
          <span>地理圍欄半徑</span>
          <input class="field" value="150 米">
        </label>
        <label>
          <span>上班時間</span>
          <input class="field" value="09:00">
        </label>
        <label>
          <span>下班時間</span>
          <input class="field" value="18:00">
        </label>
        <label>
          <span>遲到寬限</span>
          <input class="field" value="15 分鐘">
        </label>
        <label>
          <span>公司 Wi-Fi</span>
          <input class="field" placeholder="待設定受信任 gateway">
        </label>
      </div>
      <div class="save-row">
        <button class="primary" data-action="save-settings">儲存設定</button>
        <span class="save-message">${c4t.saveMessage}</span>
      </div>
    </div>`;
}

/* ── Admin: content router ─────────────────────────────────── */
function adminContent() {
  switch (c4t.adminTab) {
    case 'overview':   return overview();
    case 'records':    return recordsAdmin();
    case 'approvals':  return approvalsAdmin();
    case 'employees':  return employeesAdmin();
    case 'settings':   return settingsAdmin();
    default:           return overview();
  }
}

/* ── Admin shell ───────────────────────────────────────────── */
function adminView() {
  const title = adminItems.find(i => i[0] === c4t.adminTab)[1];
  return `
    <div class="admin-shell">
      ${adminNav()}
      <main class="admin-main">
        <header class="admin-top">
          <h1>${title}</h1>
          <div class="admin-user">
            <div class="avatar">LH</div>
            <div>
              <b>Lisa Huang</b>
              <span>管理員</span>
            </div>
          </div>
        </header>
        <section class="admin-content">${adminContent()}</section>
      </main>
    </div>
    ${inviteModal()}`;
}

/* ══════════════════════════════════════════════════════════════
   RENDER & BIND
   ══════════════════════════════════════════════════════════════ */

/* ── Root renderer ─────────────────────────────────────────── */
function render() {
  const root = document.getElementById('app');
  if (!root) return;

  if (c4t.view === 'login') {
    root.innerHTML = renderLogin();
  } else if (c4t.view === 'activate') {
    root.innerHTML = activationView();
  } else if (c4t.view === 'employee') {
    root.innerHTML = employeeView();
  } else {
    root.innerHTML = adminView();
  }

  /* Show stored login error if any */
  const errEl = document.getElementById('login-error');
  if (errEl && c4t._loginError) {
    errEl.textContent = c4t._loginError;
    errEl.classList.remove('hidden');
  }

  bindEvents();
  if (c4t.invite?.url) window.c4tDrawInviteQr?.(c4t.invite.url);
}
window.c4tRender = render;

/* ── Event binding ─────────────────────────────────────────── */
function bindEvents() {
  /* ── Form submit (login) ─────────────────────────────── */
  const loginForm = document.getElementById('login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', (e) => {
      e.preventDefault();
      /* live-auth.js intercepts this submit in the capture phase and does
         the real Supabase sign-in. Reaching this handler means the auth
         layer failed to load, and the browser cannot authenticate anyone
         or decide a role on its own (BACKEND-CONTRACT rules 1-2) — so
         this refuses entry rather than guessing. */
      const err = document.getElementById('login-error');
      if (err) {
        err.textContent = '登入服務暫時無法連接，請稍後再試。';
        err.classList.remove('hidden');
      }
    });
  }

  /* ── Generic actions ────────────────────────────────── */
  $$('[data-action]').forEach(el => {
    el.addEventListener('click', () => {
      const a = el.dataset.action;
      switch (a) {
        case 'logout':
          c4t.view = 'login';
          c4t.clockedIn = false;
          c4t.approved = 0;
          c4t.saveMessage = '';
          c4t._clockTime = null;
          c4t._loginError = null;
          break;
        case 'back-to-login':
          c4t.view = 'login';
          c4t.activationMessage = '';
          break;
        case 'open-invite':
          c4t.inviteModalOpen = true;
          c4t.invite = null;
          break;
        case 'close-invite':
          c4t.inviteModalOpen = false;
          c4t.invite = null;
          break;
        case 'punch':
          c4t.clockedIn = !c4t.clockedIn;
          if (c4t.clockedIn) c4t._clockTime = hkTime(new Date());
          else c4t._clockTime = null;
          break;
        case 'approve':
        case 'reject':
          c4t.approved = 1;
          break;
        case 'save-settings':
          c4t.saveMessage = '設定已儲存（原型模式）';
          break;
      }
      render();
    });
  });

  /* ── Employee tab switch ────────────────────────────── */
  $$('[data-employee-tab]').forEach(el => {
    el.addEventListener('click', () => {
      c4t.employeeTab = el.dataset.employeeTab;
      render();
    });
  });

  /* ── Admin tab switch ───────────────────────────────── */
  $$('[data-admin-tab]').forEach(el => {
    el.addEventListener('click', () => {
      c4t.adminTab = el.dataset.adminTab;
      render();
    });
  });
}

/* ── Initial render ────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', render);
