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
		const { data: profile, error } = await client
			.from("profiles")
			.select("role, active")
			.eq("user_id", user.id)
			.single();

		if (error || !profile?.active) {
			await client.auth.signOut();
			showMessage(messageSelector, "此帳戶未獲啟用，請聯絡管理員。");
			return false;
		}

		window.c4tState.view = profile.role === "admin" ? "admin" : "employee";
		window.c4tState.activationToken = "";
		window.c4tState.activationMessage = "";
		history.replaceState(null, "", `${location.pathname}${location.search}`);
		window.c4tRender();
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

	function activationUrl(token) {
		const baseUrl = (config.appUrl || location.origin).replace(/\/$/, "");
		return `${baseUrl}/#activate=${encodeURIComponent(token)}`;
	}

	window.c4tDrawInviteQr = (url) => {
		const canvas = document.querySelector("#invite-qr");
		if (!canvas || !window.QRCode?.toCanvas) return;
		window.QRCode.toCanvas(canvas, url, {
			width: 220,
			margin: 2,
			errorCorrectionLevel: "M",
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
				window.alert("無法建立啟用 QR。請確認員工編號仍未啟用，並再試一次。");
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
				event.stopImmediatePropagation();
				await client.auth.signOut();
				window.c4tState.view = "login";
				window.c4tState.clockedIn = false;
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
				window.c4tState.clockedIn = !window.c4tState.clockedIn;
				window.c4tRender();
			};

			if (!navigator.geolocation) {
				await submitPunch(null);
				return;
			}
			navigator.geolocation.getCurrentPosition(
				submitPunch,
				() => submitPunch(null),
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
