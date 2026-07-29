# 員工版 ↔ 管理版 連通性分析 — 2026-07-29

UAT 期間兩個帳號（`SS-ADM-001` admin、`SS-001` employee）都已透過 QR 流程正式啟用並登入。
本文記錄「兩邊系統有冇真正連埋一齊」嘅結論同要改嘅嘢。

## 結論

**目前兩邊系統基本上冇連通。** 員工打卡確實寫入咗真實資料庫，但**冇任何畫面讀返出嚟** ——
所有列表、統計、審批項目全部嚟自 `data/mock-data.js` 嘅硬編碼假數據。

全個 codebase 只有 **3 個** Supabase 資料呼叫：

| 位置 | 呼叫 | 用途 |
|---|---|---|
| [live-auth.js:49](../live-auth.js:49) | `.from("profiles").select("role, active")` | 角色路由 |
| [live-auth.js:189](../live-auth.js:189) | `.rpc("create_onboarding_invite")` | 建立啟用 QR |
| [live-auth.js:253](../live-auth.js:253) | `.rpc("punch_attendance")` | 打卡 |

而 [app.js:28](../app.js:28) 係 `const D = window.C4T_MOCK_DATA;` —— 之後每個畫面都由 `D` 渲染。

### 實測對照

| | 真實資料庫 | 畫面顯示 |
|---|---|---|
| 打卡記錄數 | 1 筆（今日 2026-07-29，`pending`） | 「出勤 12 日 · 準時 11 日 · 遲到 1 日」 |
| 最新記錄日期 | 2026-07-29 | 2026/07/16 |
| 今日狀態 | 已打上班 **及** 下班 | 「尚未打卡」 |

即係話：**員工打完卡，管理員嗰邊永遠見唔到。**

## 必須改嘅嘢

### A-1 · 阻塞 · `clockedIn` 係純前端開關，從不讀 DB
[live-auth.js:262](../live-auth.js:262)：

```js
window.c4tState.clockedIn = !window.c4tState.clockedIn;
```

只係反轉一個 boolean。登入或重新整理時冇查詢 `attendance_records`，所以已經打齊上落班之後，畫面照樣顯示「尚未打卡」（實測確認）。再撳一次會被 RPC 以
`Today's attendance already has a clock-out time` 拒絕，用戶只見到一個生硬嘅英文錯誤。

**改法**：`routeAuthenticatedUser` 之後查詢當日記錄，由 `clock_in_at` / `clock_out_at` 推導按鈕狀態。

### A-2 · 阻塞 · 所有列表畫面要改讀真實資料
需要新增查詢並取代 `D` 嘅使用：

| 畫面 | 應讀 |
|---|---|
| 員工 · 出勤記錄 | `attendance_records`（RLS 自動限制為本人） |
| 員工 · 本月摘要 | 由同一批記錄計算，唔好另存 |
| 管理 · 總覽 / 今日即時出勤 | `attendance_records` + `profiles` |
| 管理 · 出勤記錄 | `attendance_records` 全體 |
| 管理 · 審批中心 | `attendance_records` where `verification_status = 'pending'`、`leave_requests`、`correction_requests` |
| 管理 · 員工管理 | `profiles`（+ `employee_roster`，見 A-5） |

RLS 已經驗證正確（員工只見自己、管理員見全部），所以前端**唔需要**自己加過濾條件。

### A-3 · 阻塞 · 審批打卡冇後端
管理版「審批中心」嘅批准／拒絕掣冇對應 RPC。資料庫目前只有
`review_leave_request` 同 `review_correction_request`，**冇任何函數可以審核
`attendance_records.verification_status`**。

而 `CLAUDE.md` 規則 4 要求每次管理員審核都要寫入 `attendance_audit_events`。
需要新增一個 `review_attendance_record(p_record_id, p_decision, p_note)`，
security-definer、admin-only、同時寫審計事件 —— 即係照跟另外兩個 review RPC 嘅現成寫法。

⚠️ 呢個係新 migration，跟規則 1 要你喺對話批准先可以落 remote。

### A-4 · 高 · GPS 拎唔到會靜靜噉照打卡
[live-auth.js:270](../live-auth.js:270)：

```js
navigator.geolocation.getCurrentPosition(submitPunch, () => submitPunch(null), {...});
```

定位被拒或逾時，就以 `null` 座標照樣送出。今日 UAT 嗰筆記錄正正係咁 ——
`gps_distance_m` 同 `gps_accuracy_m` 都係 null，理由寫住
`No GPS evidence supplied; awaiting admin review.`，永遠自動核實唔到。

員工完全冇收到任何提示，仲以為打卡成功。呢個直接令 `allow_single_signal`
自動核實機制失效，人手審核量會返晒轉頭。

**改法**：定位失敗要明確話俾員工知「打卡已記錄但未核實，需要管理員審批」，
或者提供重試。唔好靜雞雞當冇事。

### A-5 · 中 · `employee_roster` 冇 grant 俾 `authenticated`
連管理員都 `permission denied for table employee_roster`。A-2 嘅「員工管理」畫面一接真數據就會即時掛。
需要一個 migration 加 `grant select` + admin-only RLS policy（同樣受規則 1 約束）。

## 已經正常運作嘅部分

唔好重寫呢啲：

- QR 啟用流程端到端正確：token 一次性、綁定 `auth_user_id`、`provisioning_status → provisioned`
- 角色由 `profiles.role` 決定，冇經 email 推斷（規則 2）
- 員工啟用會自動建立 `work_schedules`，管理員唔會（正確）
- RLS 隔離：員工只見自己 1 筆 profile，管理員見全部
- 權限守衛：非管理員呼叫三個 admin RPC 全部正確 raise
- 匿名存取全面封鎖
- `punch_attendance` 寫入路徑正常 —— 資料真係入到 DB

## 建議次序

1. **A-1**（純前端，最快見效，即刻解決「打咗卡仍顯示尚未打卡」）
2. **A-4**（純前端，防止繼續產生無法核實嘅記錄）
3. **A-2**（前端改讀真實資料 —— 呢步做完兩邊系統就真正連通）
4. **A-3 + A-5**（需要新 migration，要先取得批准）
