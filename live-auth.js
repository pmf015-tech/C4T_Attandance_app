(() => {
	const config = window.C4T_RUNTIME_CONFIG;
	if (
		!config?.supabaseUrl ||
		!config?.supabasePublishableKey ||
		!window.supabase
	)
		return;

	const client = window.supabase.createClient(
		config.supabaseUrl,
		config.supabasePublishableKey,
	);
	const HK_PHONE_DIGITS = 8;
	const ONBOARDING_TOKEN = /^[0-9a-f]{64}$/;

	function toAuthEmail(identifier) {
		if (identifier.includes("@")) return identifier.toLowerCase();

		const digits = identifier.replace(/\D/g, "");
		if (digits.length !== HK_PHONE_DIGITS) return null;
		return `${digits}@${config.staffLoginDomain}`;
	}

	function showMessage(selector, message) {
		const element = document.querySelector(selector);
		if (!element) return;
		element.textContent = message;
		element.classList.remove("hidden");
	}

	function restoreButton(form, label) {
		const button = form.querySelector('button[type="submit"]');
		if (!button) return;
		button.disabled = false;
		button.textContent = label;
	}

	function setBusy(form, label) {
		const button = form.querySelector('button[type="submit"]');
		if (!button) return false;
		button.disabled = true;
		button.textContent = label;
		return true;
	}

	async function routeAuthenticatedUser(user, messageSelector) {
		/* The whole signed-in identity comes from this row. Every screen that used
		   to hard-code a name, employee number or position now renders from it. */
		const { data: profile, error } = await client
			.from("profiles")
			.select("user_id, full_name, role, active, department, position, employee_number, phone")
			.eq("user_id", user.id)
			.single();

		if (error || !profile?.active) {
			await client.auth.signOut();
			showMessage(messageSelector, "此帳戶未獲啟用，請聯絡管理員。");
			return false;
		}

		window.c4tState.profile = profile;
		window.c4tState.view = profile.role === "admin" ? "admin" : "employee";
		window.c4tState.activationToken = "";
		window.c4tState.activationMessage = "";
		history.replaceState(null, "", `${location.pathname}${location.search}`);
		window.c4tRender();
		if (profile.role === "admin") {
			void refreshAdminDashboard();
		} else {
			void refreshPunchState();
			void refreshAttendanceHistory();
		}
		return true;
	}

	function activationTokenFromHash() {
		const token = new URLSearchParams(location.hash.slice(1)).get("activate") || "";
		return ONBOARDING_TOKEN.test(token) ? token : "";
	}

	function showActivationFromHash() {
		const token = activationTokenFromHash();
		if (!token) return false;
		window.c4tState.view = "activate";
		window.c4tState.activationToken = token;
		window.c4tState.activationMessage = "";
		window.c4tRender();
		return true;
	}

	/* Today's attendance row decides what the punch button may do. Re-read it
	   on sign-in and after every punch instead of tracking state client-side. */
	async function refreshPunchState() {
		const { derivePunchState, hongKongAttendanceDay } = window.C4T_PUNCH_STATE;
		const { data, error } = await client
			.from("attendance_records")
			.select("clock_in_at, clock_out_at, verification_status")
			.eq("attendance_day", hongKongAttendanceDay())
			.maybeSingle();

		if (error) {
			/* Leave punchState null so the button stays disabled rather than
			   letting the employee punch against an unknown day. #login-error
			   is not on screen here, so carry the message in state instead. */
			console.error("Could not read today's attendance record", error);
			window.c4tState.punchError = "無法讀取今日出勤記錄，請重新整理頁面。";
			window.c4tRender();
			return;
		}

		window.c4tState.punchError = "";
		window.c4tState.punchState = derivePunchState(data);
		window.c4tRender();
		/* A punch changes the month's history too — keep both in step. */
		void refreshAttendanceHistory();
	}

	/* The employee's own month of attendance. RLS scopes both reads to the
	   signed-in user, so neither query filters by employee id. */
	async function refreshAttendanceHistory() {
		const { classifyAttendanceRow, summariseAttendance } = window.C4T_ATTENDANCE_HISTORY;
		const { hongKongAttendanceDay } = window.C4T_PUNCH_STATE;
		const monthStart = `${hongKongAttendanceDay().slice(0, 7)}-01`;

		const [records, schedule] = await Promise.all([
			client
				.from("attendance_records")
				.select("attendance_day, clock_in_at, clock_out_at, verification_status")
				.gte("attendance_day", monthStart)
				.order("attendance_day", { ascending: false }),
			client.from("work_schedules").select("work_start, work_end").maybeSingle(),
		]);

		if (records.error) {
			console.error("Could not read attendance history", records.error);
			window.c4tState.historyError = "無法讀取出勤記錄，請重新整理頁面。";
			window.c4tRender();
			return;
		}

		/* A missing schedule is not an error — lateness simply cannot be judged. */
		window.c4tState.schedule = schedule.data ?? null;
		const rows = records.data.map((row) => classifyAttendanceRow(row, schedule.data?.work_start ?? null));
		window.c4tState.historyError = "";
		window.c4tState.history = { rows, summary: summariseAttendance(rows) };
		window.c4tRender();
	}

	/* Everything the admin screens show. RLS already restricts each of these to
	   administrators, so none of them filters by role on the client. */
	async function refreshAdminDashboard() {
		const { adminAttendanceRow, todaySummary, rosterEntry } = window.C4T_ADMIN_DASHBOARD;
		const { hongKongAttendanceDay } = window.C4T_PUNCH_STATE;
		const today = hongKongAttendanceDay();
		const monthStart = `${today.slice(0, 7)}-01`;

		const [records, schedules, roster, policy] = await Promise.all([
			client
				.from("attendance_records")
				.select(
					"employee_id, attendance_day, clock_in_at, clock_out_at, verification_status," +
						" gps_distance_m, gps_accuracy_m, wifi_assertion_status," +
						" profiles!attendance_records_employee_id_fkey(full_name, position, employee_number)",
				)
				.gte("attendance_day", monthStart)
				.order("attendance_day", { ascending: false })
				.order("clock_in_at", { ascending: false }),
			client.from("work_schedules").select("employee_id, work_start"),
			client
				.from("employee_roster")
				.select(
					"employee_number, full_name_zh, position, role, active, provisioning_status," +
						" auth_user_id, work_start, work_end",
				)
				.order("employee_number"),
			client.from("attendance_policy").select("*").maybeSingle(),
		]);

		if (records.error || roster.error) {
			console.error("Could not read the admin dashboard", records.error || roster.error);
			window.c4tState.adminError = "無法讀取出勤資料，請重新整理頁面。";
			window.c4tRender();
			return;
		}

		/* Lateness is judged per employee against their own start time — the six
		   staff do not share one. A missing schedule leaves `late` false. */
		const workStart = new Map((schedules.data ?? []).map((row) => [row.employee_id, row.work_start]));
		const month = records.data.map((row) => adminAttendanceRow(row, workStart.get(row.employee_id) ?? null));
		const entries = roster.data.map(rosterEntry);
		const expected = entries.filter((entry) => entry.role === "employee" && entry.active).length;
		const todayRows = month.filter((row) => row.day === today);

		window.c4tState.adminError = "";
		window.c4tState.admin = {
			today: todayRows,
			month,
			roster: entries,
			policy: policy.data ?? null,
			summary: todaySummary(todayRows, expected),
		};
		window.c4tRender();
	}
	window.c4tRefreshAdminDashboard = refreshAdminDashboard;

	function activationUrl(token) {
		const baseUrl = (config.appUrl || location.origin).replace(/\/$/, "");
		return `${baseUrl}/#activate=${encodeURIComponent(token)}`;
	}

	window.c4tDrawInviteQr = (url) => {
		const canvas = document.querySelector("#invite-qr");
		if (!canvas) return;
		/* A missing encoder used to leave a blank canvas with no explanation.
		   The activation link is still shown beside it, so say so rather than
		   letting the admin think the QR silently failed to generate. */
		if (!window.QRCode?.toCanvas) {
			console.error("QR encoder unavailable — uploads/vendor/qrcode.min.js did not load.");
			showMessage("#invite-qr-error", "QR 編碼器未載入，請改用下方的啟用連結。");
			return;
		}
		window.QRCode.toCanvas(canvas, url, { width: 220, margin: 2, errorCorrectionLevel: "M" }, (error) => {
			if (error) {
				console.error("QR render failed", error);
				showMessage("#invite-qr-error", "QR 產生失敗，請改用下方的啟用連結。");
			}
		});
	};

	document.addEventListener(
		"submit",
		async (event) => {
			const loginForm = event.target.closest("#login-form");
			const activationForm = event.target.closest("#activation-form");
			const inviteForm = event.target.closest("#invite-form");
			if (!loginForm && !activationForm && !inviteForm) return;

			event.preventDefault();
			event.stopImmediatePropagation();

			if (loginForm) {
				const identifier = document.querySelector("#login-id")?.value.trim();
				const password = document.querySelector("#password")?.value;
				if (!identifier || !password) {
					showMessage("#login-error", "請輸入電話號碼及密碼。");
					return;
				}

				const email = toAuthEmail(identifier);
				if (!email) {
					showMessage("#login-error", "請輸入 8 位數字的電話號碼。");
					return;
				}

				if (!setBusy(loginForm, "登入中…")) return;
				const { data, error } = await client.auth.signInWithPassword({ email, password });
				if (error || !data.user) {
					restoreButton(loginForm, "登入");
					showMessage("#login-error", "電話號碼或密碼不正確。");
					return;
				}

				if (!(await routeAuthenticatedUser(data.user, "#login-error"))) {
					restoreButton(loginForm, "登入");
				}
				return;
			}

			if (activationForm) {
				const phone = document.querySelector("#activation-phone")?.value.trim() || "";
				const password = document.querySelector("#activation-password")?.value || "";
				const confirmation = document.querySelector("#activation-password-confirm")?.value || "";
				const email = toAuthEmail(phone);
				const token = window.c4tState.activationToken;

				if (!email || !ONBOARDING_TOKEN.test(token)) {
					showMessage("#activation-message", "啟用連結無效，請向 Lisa 索取新的 QR code。");
					return;
				}
				if (password.length < 12) {
					showMessage("#activation-message", "密碼最少需要 12 個字元。");
					return;
				}
				if (password !== confirmation) {
					showMessage("#activation-message", "兩次輸入的密碼不一致。");
					return;
				}

				if (!setBusy(activationForm, "啟用中…")) return;
				const { data, error } = await client.auth.signUp({
					email,
					password,
					options: { data: { onboarding_token: token } },
				});
				if (error || !data.user) {
					restoreButton(activationForm, "啟用帳戶");
					showMessage("#activation-message", "啟用失敗。QR code 可能已失效或已被使用，請向 Lisa 索取新的 QR code。");
					return;
				}
				if (!data.session) {
					restoreButton(activationForm, "啟用帳戶");
					showMessage("#activation-message", "帳戶已建立，但此部署尚未自動確認帳戶。請聯絡 Lisa 完成 Supabase Auth 設定。");
					return;
				}

				await routeAuthenticatedUser(data.user, "#activation-message");
				return;
			}

			const employeeNumber = document.querySelector("#invite-employee-number")?.value.trim();
			if (!employeeNumber || !setBusy(inviteForm, "建立中…")) return;
			const { data, error } = await client.rpc("create_onboarding_invite", {
				p_employee_number: employeeNumber,
			});
			const invite = Array.isArray(data) ? data[0] : data;
			if (error || !invite?.token) {
				restoreButton(inviteForm, "建立 QR");
				/* Surface the real reason. Collapsing every failure into "check the
				   employee number" sent admins hunting through the roster when the
				   actual cause was an expired session or a non-admin account. */
				const reason = error?.message?.includes("Administrator access")
					? "只有管理員可以建立啟用 QR。請以管理員帳戶重新登入。"
					: error?.message?.includes("not found")
						? `搵唔到員工編號「${employeeNumber}」，或該帳戶已經啟用。`
						: error?.message || "未知錯誤。";
				window.alert(`無法建立啟用 QR：${reason}`);
				return;
			}

			window.c4tState.invite = {
				employeeNumber: invite.employee_number,
				fullName: invite.full_name_zh,
				expiresAt: new Date(invite.expires_at).toLocaleString("zh-HK", { timeZone: "Asia/Hong_Kong" }),
				url: activationUrl(invite.token),
			};
			window.c4tRender();
		},
		true,
	);

	document.addEventListener(
		"click",
		async (event) => {
			const logoutButton = event.target.closest('[data-action="logout"]');
			const copyButton = event.target.closest('[data-action="copy-invite"]');
			const punchButton = event.target.closest('[data-action="punch"]');

			if (logoutButton) {
				/* This capture-phase handler stops propagation, so app.js's own
				   logout branch never runs — clear the whole session here. */
				event.stopImmediatePropagation();
				await client.auth.signOut();
				window.c4tResetSession();
				window.c4tRender();
				return;
			}

			if (copyButton) {
				event.stopImmediatePropagation();
				const url = window.c4tState.invite?.url;
				if (!url || !navigator.clipboard) return;
				await navigator.clipboard.writeText(url);
				copyButton.textContent = "已複製";
				return;
			}

			if (!punchButton || window.c4tState.view !== "employee") return;
			event.stopImmediatePropagation();
			const { data: sessionData } = await client.auth.getSession();
			if (!sessionData.session) {
				window.alert("請先登入。");
				return;
			}

			punchButton.disabled = true;
			const submitPunch = async (position) => {
				const { error } = await client.rpc("punch_attendance", {
					p_gps_latitude: position?.coords.latitude ?? null,
					p_gps_longitude: position?.coords.longitude ?? null,
					p_gps_accuracy_m: position?.coords.accuracy ?? null,
				});
				punchButton.disabled = false;
				if (error) {
					window.alert(error.message);
					return;
				}
				await refreshPunchState();
			};

			/* A punch with no GPS can never auto-verify. Say why, and let the
			   employee decide — never submit blind coordinates on their behalf. */
			const punchWithoutLocation = async (error) => {
				const reason = window.C4T_GEO_NOTICE.geolocationFailureReason(error, {
					secureContext: window.isSecureContext,
					supported: Boolean(navigator.geolocation),
				});
				if (!window.confirm(`${reason}\n\n要繼續打卡嗎？`)) {
					punchButton.disabled = false;
					return;
				}
				await submitPunch(null);
			};

			if (!navigator.geolocation || !window.isSecureContext) {
				await punchWithoutLocation(null);
				return;
			}
			navigator.geolocation.getCurrentPosition(
				submitPunch,
				punchWithoutLocation,
				{ enableHighAccuracy: true, maximumAge: 0, timeout: 10000 },
			);
		},
		true,
	);

	window.addEventListener("hashchange", showActivationFromHash);
	if (!showActivationFromHash()) {
		void client.auth.getSession().then(({ data }) => {
			if (data.session) void routeAuthenticatedUser(data.session.user, "#login-error");
		});
	}
})();
