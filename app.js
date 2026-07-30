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
  activationToken: '',
  activationMessage: '',
  inviteModalOpen: false,
  inviteFor: '',
  invite: null,
  /* The signed-in user's own `profiles` row. Every name, employee number and
     position on screen comes from here — nothing is hard-coded. */
  profile: null,
  /* The signed-in employee's `work_schedules` row; null when none exists. */
  schedule: null,
  /* Admin reads (today, month, roster, policy); null until loaded. */
  admin: null,
  adminError: '',
  /* Derived from today's attendance_records row by lib/punch-state.js.
     null means "not loaded yet" — the punch button stays disabled until then. */
  punchState: null,
  punchError: '',
  /* Live attendance_records for the current month; null until loaded. */
  history: null,
  historyError: '',
};
window.c4tState = c4t;           // live-auth.js reads this to switch views
window.c4tRender = render;       // live-auth.js calls this after auth

/* ── Session reset ─────────────────────────────────────────── */
/* Everything derived from the signed-in account. live-auth.js owns the real
   sign-out and stops propagation before the local click handler runs, so both
   paths call this one function — otherwise the next person to sign in inherits
   the previous account's roster, profile and records. */
function resetSession() {
  c4t.view = 'login';
  c4t.employeeTab = 'home';
  c4t.adminTab = 'overview';
  c4t.punchState = null;
  c4t.punchError = '';
  c4t.history = null;
  c4t.historyError = '';
  c4t.profile = null;
  c4t.schedule = null;
  c4t.admin = null;
  c4t.adminError = '';
  c4t.inviteModalOpen = false;
  c4t.inviteFor = '';
  c4t.invite = null;
  c4t._loginError = null;
}
window.c4tResetSession = resetSession;

/* ── Shortcuts ─────────────────────────────────────────────── */
const A  = window.C4T_ADMIN_DASHBOARD;
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

/* ── Today, as the attendance day the database uses ────────── */
function hkToday() {
  return window.C4T_PUNCH_STATE.hongKongAttendanceDay();
}

function hkLongDate(day) {
  const parsed = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return day;
  return parsed.toLocaleDateString('zh-HK', {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Hong_Kong',
  });
}

/* "09:30:00" -> "09:30" */
const clockLabel = (time) => (time ? String(time).slice(0, 5) : null);

/* ── Recorded clock-in time ────────────────────────────────── */
function clockDisplay() {
  const clockInAt = c4t.punchState?.clockInAt;
  return clockInAt ? hkTime(new Date(clockInAt)) : '--:--';
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
  /* Today's attendance row is the authority — never a local toggle. Until it
     has loaded, punchState is null and the button stays disabled so a punch
     cannot be fired against an unknown state. */
  const punch = c4t.punchState;
  const loading = !punch;
  const action = loading
    ? '載入中…'
    : punch.action === 'clock_out'
      ? '下班打卡'
      : punch.action === 'done'
        ? '今日已完成'
        : '上班打卡';
  const status = loading
    ? '讀取今日記錄…'
    : punch.action === 'done'
      ? `已於 ${clockDisplay()} 上班，並已下班打卡`
      : punch.clockedIn
        ? `已於 ${clockDisplay()} 上班`
        : '尚未打卡';
  const disabled = loading || !punch.canPunch ? ' disabled' : '';
  const verificationNote = c4t.punchError
    ? `<p class="punch-note" role="alert">${escapeHtml(c4t.punchError)}</p>`
    : punch?.verification === 'pending'
      ? '<p class="punch-note" role="status">此筆打卡未經核實，需要管理員審批。</p>'
      : punch?.verification === 'blocked'
        ? '<p class="punch-note" role="alert">打卡位置超出公司範圍，已標記為不通過。</p>'
        : '';
  const today = hkToday();
  const start = clockLabel(c4t.schedule?.work_start);
  const end = clockLabel(c4t.schedule?.work_end);
  /* The signed-in employee's own name and shift — never a sample staff member. */
  const givenName = c4t.profile ? A.initials(c4t.profile.full_name) : '';

  return `
    <section class="mobile-main">
      <div class="welcome">
        <div>
          <div class="eyebrow">${A.weekday(today)} · ${escapeHtml(hkLongDate(today))}</div>
          <h1>${givenName ? `早晨，${escapeHtml(givenName)}` : '早晨'}</h1>
        </div>
        <span class="today">${start && end ? `${escapeHtml(start)} — ${escapeHtml(end)}` : '未設定班次'}</span>
      </div>

      <article class="punch-card">
        <h2>今日出勤</h2>
        <div class="clock">${clockDisplay()}</div>
        <span class="punch-state">${status}</span>
        <button class="punch-button" data-action="punch"${disabled}>${action}</button>
        <p class="punch-note">打卡時會提交位置及網絡驗證資料供系統審核。</p>
        ${verificationNote}
      </article>

      <div class="section-title"><span>快捷功能</span></div>
      <div class="quick-grid">
        <button class="action-tile" data-action="punch"${disabled}>
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
            ${/* Reflects today's actual record, not a standing claim that the
                 phone is in range — the browser cannot know that on its own. */
              !punch?.clockedIn ? pill('warning', '尚未打卡')
                : punch.verification === 'verified' ? pill('success', '今日打卡位置已驗證')
                : punch.verification === 'blocked' ? pill('warning', '今日打卡超出範圍')
                : pill('warning', '今日打卡待管理員審批')}
          </div>
        </div>
      </article>

      <article class="info-card">
        <div class="info-row">
          <div class="info-mark">網</div>
          <div>
            <b>公司 Wi-Fi</b>
            <p>未設定受信任 gateway，目前以 GPS 位置驗證打卡。</p>
            ${pill('warning', '未啟用')}
          </div>
        </div>
      </article>
    </section>`;
}

/* ── Employee: Records ─────────────────────────────────────── */
function employeeRecords() {
  /* Live attendance_records for the signed-in employee, loaded by live-auth.js.
     null means "not loaded yet" — never fall back to mock rows, which is what
     made the employee and admin views disagree with the database. */
  const history = c4t.history;
  const monthLabel = new Intl.DateTimeFormat('zh-HK', {
    year: 'numeric', month: 'long', timeZone: 'Asia/Hong_Kong',
  }).format(new Date());

  const summaryBody = c4t.historyError
    ? `<p role="alert">${escapeHtml(c4t.historyError)}</p>`
    : !history
      ? '<p>讀取中…</p>'
      : `<p>出勤 ${history.summary.daysWorked} 日 ·
           準時 ${history.summary.onTime} 日 ·
           遲到 ${history.summary.lateDays} 日${
             history.summary.awaitingReview
               ? ` · <b>待審批 ${history.summary.awaitingReview} 日</b>`
               : ''
           }</p>`;

  const rows = !history || c4t.historyError
    ? ''
    : history.rows.length === 0
      ? '<div class="record-row"><div><b>本月未有出勤記錄</b></div></div>'
      : history.rows.map(r => `
          <div class="record-row">
            <div><b>${escapeHtml(r.day)}</b><span>${A.weekday(r.day)}</span></div>
            <div><span>上班</span><b>${escapeHtml(r.clockIn)}</b></div>
            <div><span>下班</span><b>${escapeHtml(r.clockOut)}</b></div>
            ${r.verification === 'pending' ? pill('warning', '待審批')
              : r.verification === 'blocked' ? pill('warning', '不通過')
              : r.late ? pill('warning', '遲到')
              : pill('success', '正常')}
          </div>`).join('');

  return `
    <section class="mobile-main">
      <div class="welcome">
        <div>
          <div class="eyebrow">${escapeHtml(monthLabel)}</div>
          <h1>出勤紀錄</h1>
        </div>
      </div>

      <article class="info-card">
        <div class="info-row">
          <div class="info-mark">月</div>
          <div>
            <b>本月摘要</b>
            ${summaryBody}
          </div>
        </div>
      </article>

      <div class="section-title">
        <span>最近紀錄</span>
      </div>

      <div class="record-card">${rows}</div>
    </section>`;
}

/* ── Employee: Profile ─────────────────────────────────────── */
function employeeProfile() {
  const profile = c4t.profile;
  const start = clockLabel(c4t.schedule?.work_start);
  const end = clockLabel(c4t.schedule?.work_end);

  const card = !profile
    ? '<article class="profile-card"><div class="profile-list"><div><span>讀取中…</span></div></div></article>'
    : `
      <article class="profile-card">
        <div class="profile-hero">
          <div class="avatar">${escapeHtml(A.initials(profile.full_name))}</div>
          <div>
            <h2>${escapeHtml(profile.full_name)}</h2>
            <p>${escapeHtml(profile.phone || '未登記電話')}</p>
          </div>
        </div>
        <div class="profile-list">
          <div><span>職位</span><b>${escapeHtml(profile.position || '未設定')}</b></div>
          <div><span>部門</span><b>${escapeHtml(profile.department || '未分配')}</b></div>
          <div><span>員工編號</span><b>${escapeHtml(profile.employee_number || '未設定')}</b></div>
          <div><span>上班時間</span><b>${start && end ? `${escapeHtml(start)} — ${escapeHtml(end)}` : '未設定班次'}</b></div>
        </div>
      </article>`;

  return `
    <section class="mobile-main">
      <div class="welcome">
        <div>
          <div class="eyebrow">帳戶</div>
          <h1>個人資料</h1>
        </div>
      </div>

      ${card}

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

      <button class="sign-out" data-action="logout">登出</button>
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
        <div class="avatar">${escapeHtml(c4t.profile ? A.initials(c4t.profile.full_name) : '—')}</div>
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

/* ── Admin: shared states ──────────────────────────────────── */
function adminNotice(message) {
  return `<section class="panel"><div class="approval"><b>${escapeHtml(message)}</b></div></section>`;
}

/* Every admin screen renders from c4t.admin. Until it loads there is nothing
   truthful to show, so say so rather than filling the screen with samples. */
function adminGate() {
  if (c4t.adminError) return adminNotice(c4t.adminError);
  if (!c4t.admin) return adminNotice('讀取中…');
  return null;
}

/* One row of 今日即時出勤 / 待審批. */
function attendanceStatusPill(row) {
  if (row.verification === 'pending') return pill('warning', '待審批');
  if (row.verification === 'blocked') return pill('warning', '不通過');
  if (row.late) return pill('warning', '遲到');
  return pill('success', '已驗證');
}

function liveRow(row) {
  return `
    <div class="live-row">
      <div class="person">
        <div class="avatar">${escapeHtml(A.initials(row.name))}</div>
        <div>
          <b>${escapeHtml(row.name)}</b>
          <span>${escapeHtml(row.employeeNumber)} · ${escapeHtml(row.position)}</span>
        </div>
      </div>
      <time>${escapeHtml(row.clockIn)}</time>
      ${attendanceStatusPill(row)}
    </div>`;
}

/* ── Admin: Overview ───────────────────────────────────────── */
function overview() {
  const gate = adminGate();
  if (gate) return gate;

  const { today, roster, summary } = c4t.admin;
  /* Named, so the admin can chase the people who have not punched instead of
     inferring them from a count. */
  const punched = new Set(today.map(row => row.employeeNumber));
  const missing = roster
    .filter(entry => entry.role === 'employee' && entry.active && entry.activated)
    .filter(entry => !punched.has(entry.employeeNumber));
  const awaitingReview = today.filter(row => row.verification === 'pending');

  return `
    <div class="stat-grid">
      <article class="stat">
        <span>已打卡</span>
        <strong>${summary.punched} <small>/ ${summary.expected} 人</small></strong>
      </article>
      <article class="stat">
        <span>已驗證</span>
        <strong style="color:var(--success)">${summary.verified} <small>人</small></strong>
      </article>
      <article class="stat">
        <span>待審批</span>
        <strong style="color:var(--warning)">${summary.pending} <small>項</small></strong>
      </article>
      <article class="stat">
        <span>遲到</span>
        <strong style="color:var(--danger)">${summary.late} <small>人</small></strong>
      </article>
    </div>

    <div class="admin-grid">
      <section class="panel">
        <div class="panel-heading">
          <h2>今日即時出勤</h2>
          <button data-admin-tab="records">查看全部</button>
        </div>
        ${today.length
          ? today.map(liveRow).join('')
          : '<div class="approval"><b>今日暫時未有人打卡</b></div>'}
        ${missing.length
          ? `<div class="approval">
               <b>尚未打卡 · ${missing.length} 人</b>
               <p>${missing.map(entry => escapeHtml(entry.name)).join('、')}</p>
             </div>`
          : ''}
      </section>

      <section class="panel">
        <div class="panel-heading">
          <h2>待審批</h2>
          <button data-admin-tab="approvals">審批中心</button>
        </div>
        ${awaitingReview.length
          ? awaitingReview.map(row => `
              <div class="approval">
                <b>${escapeHtml(row.name)} · ${escapeHtml(row.clockIn)} 上班打卡</b>
                <p>GPS ${escapeHtml(row.gps)}；Wi-Fi ${escapeHtml(row.wifi)}。</p>
              </div>`).join('')
          : `<div class="approval">
               <b>沒有待處理的打卡</b>
               <p>今日未有需要人手審批的記錄。</p>
             </div>`}
      </section>
    </div>`;
}

/* ── Admin: Records ────────────────────────────────────────── */
function recordsAdmin() {
  const gate = adminGate();
  if (gate) return gate;

  const rows = c4t.admin.month;
  const monthLabel = new Intl.DateTimeFormat('zh-HK', {
    year: 'numeric', month: 'long', timeZone: 'Asia/Hong_Kong',
  }).format(new Date());

  return `
    <div class="toolbar">
      <span class="screen-note">${escapeHtml(monthLabel)} · 共 ${rows.length} 筆</span>
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
          ${rows.length ? rows.map(r => `
            <tr>
              <td>${escapeHtml(r.day)}</td>
              <td>${escapeHtml(r.name)}<br><small>${escapeHtml(r.employeeNumber)}</small></td>
              <td>${escapeHtml(r.clockIn)}</td>
              <td>${escapeHtml(r.clockOut)}</td>
              <td>${escapeHtml(r.gps)}</td>
              <td>${escapeHtml(r.wifi)}</td>
              <td>${attendanceStatusPill(r)}</td>
            </tr>`).join('')
            : '<tr><td colspan="7">本月未有出勤記錄</td></tr>'}
        </tbody>
      </table>
    </div>`;
}

/* ── Admin: Approvals ──────────────────────────────────────── */
function approvalsAdmin() {
  const gate = adminGate();
  if (gate) return gate;

  const pending = c4t.admin.month.filter(row => row.verification === 'pending');

  return `
    <section class="panel">
      <div class="panel-heading">
        <h2>待處理項目</h2>
        <span>${pending.length} 項</span>
      </div>
      ${pending.length
        ? pending.map(row => `
            <div class="approval">
              <b>${escapeHtml(row.name)} · ${escapeHtml(row.employeeNumber)}</b>
              <p>${escapeHtml(row.day)} ${escapeHtml(row.clockIn)} 上班打卡 ·
                 GPS ${escapeHtml(row.gps)} · Wi-Fi ${escapeHtml(row.wifi)}</p>
              <div class="button-row">
                <button class="approve" data-action="review-attendance"
                        data-record-id="${escapeHtml(row.id)}" data-decision="verified">批准紀錄</button>
                <button class="reject" data-action="review-attendance"
                        data-record-id="${escapeHtml(row.id)}" data-decision="blocked">退回補充資料</button>
              </div>
            </div>`).join('')
        : `<div class="approval">
             <b>沒有待處理的打卡</b>
             <p>本月所有打卡都已自動驗證。</p>
           </div>`}
    </section>`;
}

/* ── Admin: Employees ──────────────────────────────────────── */
function employeesAdmin() {
  const gate = adminGate();
  if (gate) return gate;

  const roster = c4t.admin.roster;
  const awaiting = roster.filter(entry => entry.canInvite).length;

  return `
    <div class="toolbar">
      <span class="screen-note">共 ${roster.length} 人 · 待啟用 ${awaiting} 人</span>
      <button class="primary" data-action="open-invite">建立啟用 QR</button>
    </div>
    <div class="employee-list">
      ${roster.map(entry => `
        <article class="employee-row">
          <div class="person">
            <div class="avatar">${escapeHtml(A.initials(entry.name))}</div>
            <div>
              <b>${escapeHtml(entry.name)}</b>
              <small>${escapeHtml(entry.employeeNumber)} · ${escapeHtml(entry.position)}</small>
            </div>
          </div>
          <span>${escapeHtml(entry.shift)}<br><small>${entry.role === 'admin' ? '管理員' : '員工'}</small></span>
          <div class="employee-status">
            ${entry.active ? '' : pill('warning', '停用')}
            ${pill(entry.activated ? 'success' : 'warning', entry.accountLabel)}
          </div>
          ${entry.canInvite
            ? `<button class="approve" data-action="invite-employee"
                       data-employee-number="${escapeHtml(entry.employeeNumber)}">建立 QR</button>`
            : '<button class="approve" disabled>建立 QR</button>'}
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
          <input class="field" id="invite-employee-number" placeholder="例如 SS-002"
                 value="${escapeHtml(c4t.inviteFor)}"
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
  const gate = adminGate();
  if (gate) return gate;

  const policy = c4t.admin.policy;
  if (!policy) return adminNotice('無法讀取出勤設定。');

  const coordinates = policy.office_latitude && policy.office_longitude
    ? `${policy.office_latitude}, ${policy.office_longitude}`
    : '未設定';

  /* Read-only: these are the values punch_attendance() actually enforces.
     Editing them from the browser needs an audited write path that does not
     exist yet, and a settings form that silently saves nothing is worse than
     one that admits it. */
  return `
    <div>
      <div class="setting-grid">
        <label class="full">
          <span>辦公室位置</span>
          <input class="field" value="${escapeHtml(policy.office_address || policy.office_name)}" readonly>
        </label>
        <label>
          <span>GPS 座標</span>
          <input class="field" value="${escapeHtml(coordinates)}" readonly>
        </label>
        <label>
          <span>地理圍欄半徑</span>
          <input class="field" value="${policy.geofence_radius_m} 米" readonly>
        </label>
        <label>
          <span>GPS 精確度上限</span>
          <input class="field" value="${policy.maximum_gps_accuracy_m} 米" readonly>
        </label>
        <label>
          <span>預設上班時間</span>
          <input class="field" value="${escapeHtml(clockLabel(policy.default_work_start) || '')}" readonly>
        </label>
        <label>
          <span>預設下班時間</span>
          <input class="field" value="${escapeHtml(clockLabel(policy.default_work_end) || '')}" readonly>
        </label>
        <label>
          <span>遲到寬限</span>
          <input class="field" value="${policy.late_tolerance_minutes} 分鐘" readonly>
        </label>
        <label>
          <span>公司 Wi-Fi</span>
          <input class="field" value="${escapeHtml(policy.gateway_name || '未設定受信任 gateway')}" readonly>
        </label>
      </div>
      <p class="screen-note">
        以上為資料庫 <code>attendance_policy</code> 的實際設定，唯讀。
        「預設上／下班時間」只適用於未設定班次的新帳戶；
        每位員工各自的上班時間喺「員工管理」，遲到亦以各自的時間計算。
        ${policy.allow_single_signal
          ? '目前允許單一訊號（GPS）自動驗證。'
          : '目前需要 GPS 及 Wi-Fi 雙重訊號才自動驗證。'}
        修改設定需要具審計記錄的後端寫入路徑，尚未建立。
      </p>
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
            <div class="avatar">${escapeHtml(c4t.profile ? A.initials(c4t.profile.full_name) : '—')}</div>
            <div>
              <b>${escapeHtml(c4t.profile?.full_name || '讀取中…')}</b>
              <span>${escapeHtml(c4t.profile?.position || '管理員')}</span>
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
          resetSession();
          break;
        case 'back-to-login':
          c4t.view = 'login';
          c4t.activationMessage = '';
          break;
        case 'open-invite':
          c4t.inviteModalOpen = true;
          c4t.inviteFor = '';
          c4t.invite = null;
          break;
        case 'invite-employee':
          /* Straight from the roster row, so the admin never retypes a number
             the RPC would then reject. */
          c4t.inviteModalOpen = true;
          c4t.inviteFor = el.dataset.employeeNumber || '';
          c4t.invite = null;
          break;
        case 'close-invite':
          c4t.inviteModalOpen = false;
          c4t.inviteFor = '';
          c4t.invite = null;
          break;
        case 'punch':
          /* live-auth.js owns the punch: it calls punch_attendance() and then
             re-reads today's row. Toggling state here would desync the UI from
             the database, which is exactly the bug this replaced. */
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
