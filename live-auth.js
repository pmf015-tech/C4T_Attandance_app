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

	document.addEventListener(
		"click",
		async (event) => {
			const loginButton = event.target.closest('[data-action="login"]');
			if (!loginButton) return;

			event.stopImmediatePropagation();
			const email = document.querySelector("#email")?.value.trim();
			const password = document.querySelector("#password")?.value;
			if (!email || !password) {
				window.alert("請輸入電郵地址及密碼。");
				return;
			}

			loginButton.disabled = true;
			loginButton.textContent = "登入中…";
			const { data, error } = await client.auth.signInWithPassword({
				email,
				password,
			});
			if (error || !data.user) {
				loginButton.disabled = false;
				loginButton.textContent = "登入";
				window.alert(error?.message || "登入失敗。");
				return;
			}

			const { data: profile, error: profileError } = await client
				.from("profiles")
				.select("role, active")
				.eq("user_id", data.user.id)
				.single();
			if (profileError || !profile?.active) {
				await client.auth.signOut();
				window.alert("此帳戶未獲啟用。");
				return;
			}

			window.c4tState.view = profile.role === "admin" ? "admin" : "employee";
			window.c4tRender();
		},
		true,
	);

	document.addEventListener(
		"click",
		async (event) => {
			const punchButton = event.target.closest('[data-action="punch"]');
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
})();
