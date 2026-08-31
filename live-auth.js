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
	const RECOVERY_TOKEN = /^[0-9a-f]{40,128}$/i;
	let recoveryToken = "";
	let recoveryClient = null;
	let recoveryVerified = false;
	let recoveryBusy = false;
	let authGeneration = 0;

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
		if (!button || button.disabled) return false;
		button.disabled = true;
		button.textContent = label;
		return true;
	}

	async function routeAuthenticatedUser(user, messageSelector) {
		if (window.c4tState.view === "recover") return false;
		const generation = authGeneration;
		/* The whole signed-in identity comes from this row. Every screen that used
		   to hard-code a name, employee number or position now renders from it. */
		const { data: profile, error } = await client
			.from("profiles")
			.select("user_id, full_name, role, active, department, position, employee_number, phone")
			.eq("user_id", user.id)
			.single();
		if (generation !== authGeneration || window.c4tState.view === "recover") return false;

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

	function showRecoveryFromHash() {
		const params = new URLSearchParams(location.hash.slice(1));
		if (!params.has("recovery")) return false;
		authGeneration++;
		recoveryToken = params.get("recovery") || "";
		recoveryVerified = false;
		recoveryClient = null;
		window.c4tResetSession();
		window.c4tState.view = "recover";
		window.c4tState.recoveryMessage = RECOVERY_TOKEN.test(recoveryToken)
			? "" : "重設連結無效，請向管理員索取新連結。";
		history.replaceState(null, "", `${location.pathname}${location.search}`);
		window.c4tRender();
		return true;
	}

	async function saveRecoveredPassword(form) {
		if (recoveryBusy) return;
		const password = document.querySelector("#recovery-password")?.value || "";
		const confirmation = document.querySelector("#recovery-password-confirm")?.value || "";
		if (password.length < 12 || password.length > 128 || password !== confirmation) {
			showMessage("#recovery-message", "請輸入 12 至 128 個字元的新密碼，並確認兩次輸入一致。");
			return;
		}
		if (!RECOVERY_TOKEN.test(recoveryToken) && !recoveryVerified) {
			showMessage("#recovery-message", "重設連結無效，請向管理員索取新連結。");
			return;
		}
		if (!setBusy(form, "更新中…")) return;
		recoveryBusy = true;
		let saved = false;
		try {
			/* Keep recovery credentials out of the main client's persisted session.
			   Verify on submit, so merely opening a link never consumes it. */
			recoveryClient ??= window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey, {
				auth: { storageKey: "c4t-password-recovery", persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
			});
			if (!recoveryVerified) {
				const { data, error } = await recoveryClient.auth.verifyOtp({ token_hash: recoveryToken, type: "recovery" });
				if (error || !data.session) {
					showMessage("#recovery-message", "連結已失效，請向管理員索取新連結。");
					return;
				}
				recoveryVerified = true;
				recoveryToken = "";
			}
			const { error } = await recoveryClient.auth.updateUser({ password });
			if (error) {
				showMessage("#recovery-message", "未能更新密碼。請使用未曾使用過、較強的新密碼再試；如仍失敗，請重新索取連結。");
				return;
			}
			saved = true;
			const { error: signOutError } = await recoveryClient.auth.signOut({ scope: "global" });
			await client.auth.signOut({ scope: "local" });
			window.c4tResetSession();
			window.c4tState._loginError = signOutError
				? "密碼已更新，但未能確認所有舊登入已登出，請聯絡管理員。"
				: "密碼已更新。請重新登入；舊權杖到期後失效。";
			window.c4tRender();
		} catch {
			showMessage("#recovery-message", saved
				? "密碼已更新，但登出未完成。請返回登入，並聯絡管理員確認舊登入狀態。"
				: "連線失敗，請稍後再試。如連結已失效，請向管理員重新索取。");
		} finally {
			if (saved) { recoveryToken = ""; recoveryVerified = false; recoveryClient = null; }
			recoveryBusy = false;
			restoreButton(form, "更新密碼");
		}
	}

	async function issuePasswordReset(form) {
		const target = window.c4tState.resetTarget;
		if (!target || !document.querySelector("#reset-identity-confirmed")?.checked || !setBusy(form, "建立中…")) return;
		try {
			const { data } = await client.auth.getSession();
			if (!data.session) {
				showMessage("#reset-message", "登入已失效，請重新登入。");
				return;
			}
			const response = await fetch("/api/admin/reset-password", {
				method: "POST",
				headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` },
				body: JSON.stringify({ employeeNumber: target.employeeNumber }),
			});
			if (!response.ok) {
				showMessage("#reset-message", response.status === 403 ? "只有在職管理員可以重設密碼。"
					: response.status === 429 ? "剛剛已建立連結，請稍候一分鐘再試。"
					: "未能建立連結。請確認帳戶已啟用，以及伺服器已設定重設服務。");
				return;
			}
			const result = await response.json();
			const url = new URL(result.url);
			if (url.origin !== new URL(config.appUrl || location.origin).origin || !RECOVERY_TOKEN.test(new URLSearchParams(url.hash.slice(1)).get("recovery") || "")) throw new Error("Invalid recovery response");
			if (window.c4tState.resetTarget !== target) return;
			window.c4tState.resetUrl = url.href;
			window.c4tRender();
		} catch {
			showMessage("#reset-message", "連線失敗，未能取得重設連結。請稍後再試。");
		} finally {
			restoreButton(form, "建立重設連結");
		}
	}

	/* Today's attendance row decides what the punch button may do. Re-read it
	   on sign-in and after every punch instead of tracking state client-side. */
	async function refreshPunchState() {
		const generation = authGeneration;
		const { derivePunchState, hongKongAttendanceDay } = window.C4T_PUNCH_STATE;
		const { data, error } = await client
			.from("attendance_records")
			.select("clock_in_at, clock_out_at, verification_status")
			.eq("attendance_day", hongKongAttendanceDay())
			.maybeSingle();
		if (generation !== authGeneration) return;

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
		const generation = authGeneration;
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
		if (generation !== authGeneration) return;

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
		const generation = authGeneration;
		const { adminAttendanceRow, todaySummary, rosterEntry } = window.C4T_ADMIN_DASHBOARD;
		const { hongKongAttendanceDay } = window.C4T_PUNCH_STATE;
		const today = hongKongAttendanceDay();
		const monthStart = `${today.slice(0, 7)}-01`;

		const [records, schedules, roster, policy] = await Promise.all([
			client
				.from("attendance_records")
				.select(
					"id, employee_id, attendance_day, clock_in_at, clock_out_at, verification_status," +
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
		if (generation !== authGeneration) return;

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
		if (typeof QRious !== "function") {
			console.error("QR encoder unavailable — qrious CDN library did not load.");
			showMessage("#invite-qr-error", "QR 編碼器未載入，請改用下方的啟用連結。");
			return;
		}
		try {
			new QRious({
				element: canvas,
				value: url,
				size: 220,
				level: "M",
			});
		} catch (err) {
			console.error("QR render failed", err);
			showMessage("#invite-qr-error", "QR 產生失敗，請改用下方的啟用連結。");
		}
	};

	document.addEventListener(
		"submit",
		async (event) => {
			const loginForm = event.target.closest("#login-form");
			const activationForm = event.target.closest("#activation-form");
			const inviteForm = event.target.closest("#invite-form");
			const recoveryForm = event.target.closest("#recovery-form");
			const resetForm = event.target.closest("#admin-reset-form");
			if (!loginForm && !activationForm && !inviteForm && !recoveryForm && !resetForm) return;

			event.preventDefault();
			event.stopImmediatePropagation();
			if (recoveryForm) return saveRecoveredPassword(recoveryForm);
			if (resetForm) return issuePasswordReset(resetForm);

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
				const generation = ++authGeneration;
				const { data, error } = await client.auth.signInWithPassword({ email, password });
				if (generation !== authGeneration) return;
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
				expiresAt: invite.expires_at,
				url: activationUrl(invite.token),
			};
			window.c4tRender();
		},
		true,
	);

	document.addEventListener(
		"click",
		async (event) => {
			const backButton = event.target.closest('[data-action="back-to-login"]');
			const copyReset = event.target.closest('[data-action="copy-reset"]');
			if (backButton && window.c4tState.view === "recover") {
				event.stopImmediatePropagation();
				if (recoveryBusy) return;
				try { await recoveryClient?.auth.signOut({ scope: "local" }); } catch { /* Memory-only session is discarded below. */ }
				recoveryClient = null;
				recoveryToken = "";
				recoveryVerified = false;
				window.c4tResetSession();
				window.c4tRender();
				return;
			}
			if (copyReset) {
				event.stopImmediatePropagation();
				try {
					await navigator.clipboard.writeText(window.c4tState.resetUrl);
					copyReset.textContent = "已複製";
				} catch { showMessage("#reset-message", "未能自動複製，請選取上方連結手動複製。"); }
				return;
			}
			const logoutButton = event.target.closest('[data-action="logout"]');
			const copyButton = event.target.closest('[data-action="copy-invite"]');
			const reviewButton = event.target.closest('[data-action="review-attendance"]');
			const punchButton = event.target.closest('[data-action="punch"]');

			if (logoutButton) {
				/* This capture-phase handler stops propagation, so app.js's own
				   logout branch never runs — clear the whole session here. */
				event.stopImmediatePropagation();
				authGeneration++;
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

			if (reviewButton) {
				event.stopImmediatePropagation();
				const decision = reviewButton.dataset.decision;
				if (!reviewButton.dataset.recordId || !["verified", "blocked"].includes(decision)) return;

				/* Overturning a block reverses an accusation that someone was not
				   where they claimed, so the server demands a reason. Collect it
				   here rather than letting the RPC reject an empty note. */
				let note = "";
				if (reviewButton.dataset.override) {
					note = (window.prompt("推翻這條被拒絕的打卡，請填寫原因：") || "").trim();
					if (!note) return;
				}

				reviewButton.disabled = true;
				const { error } = await client.rpc("review_attendance_record", {
					p_record_id: reviewButton.dataset.recordId,
					p_decision: decision,
					p_note: note,
				});
				if (error) {
					reviewButton.disabled = false;
					window.alert(error.message);
					return;
				}
				await refreshAdminDashboard();
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

	window.addEventListener("hashchange", () => {
		if (recoveryBusy) {
			history.replaceState(null, "", `${location.pathname}${location.search}`);
			return;
		}
		if (!showRecoveryFromHash()) showActivationFromHash();
	});
	if (!showRecoveryFromHash() && !showActivationFromHash()) {
		const generation = authGeneration;
		void client.auth.getSession().then(({ data }) => {
			if (generation === authGeneration && data.session) void routeAuthenticatedUser(data.session.user, "#login-error");
		});
	}
})();
