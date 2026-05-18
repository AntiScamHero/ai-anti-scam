document.addEventListener("DOMContentLoaded", function () {
    const SAFE_START_URL = "https://www.google.com.tw";
    const TOTAL_SECONDS = 10;
    let remaining = TOTAL_SECONDS;
    let redirectTimer = null;
    let sloganTimer = null;
    let paused = false;

    const statusText = document.getElementById("status-text");
    const startBtn = document.getElementById("start-now-btn");
    const pauseBtn = document.getElementById("pause-auto-btn");
    const sloganText = document.getElementById("slogan-text");
    const familyStatusText = document.getElementById("family-status-text");

    const FAMILY_ID_PRIMARY_KEY = "aiShieldPrimaryFamilyID";
    const FAMILY_ID_UPDATED_AT_KEY = "aiShieldFamilyBindingUpdatedAt";

    const FAMILY_ID_STORAGE_KEYS = [
        FAMILY_ID_PRIMARY_KEY,
        "savedFamilyID",
        "boundFamilyID",
        "currentFamilyID",
        "familyCode",
        "familyID",
        "family_id",
        "aiShieldFamilyID",
        "dashboardFamilyID",
        "familyInviteCode",
        "guardianFamilyID",
        "guardianCode",
        "aiShieldGuardianCode",
        "aiShieldBoundFamilyCode",
        "popupFamilyID",
        "popupSavedFamilyID"
    ];

    const ACCESS_TOKEN_STORAGE_KEYS = Array.from(new Set([
        "accessToken",
        "aiShieldAccessToken",
        window.CONFIG?.ACCESS_TOKEN_STORAGE_KEY || "aiShieldAccessToken"
    ]));

    const INSTALL_ID_STORAGE_KEY = window.CONFIG?.INSTALL_ID_STORAGE_KEY || "aiShieldInstallId";
    const TOKEN_EXPIRES_AT_STORAGE_KEY = window.CONFIG?.TOKEN_EXPIRES_AT_STORAGE_KEY || "aiShieldTokenExpiresAt";

    const slogans = [
        "慢一點，就不容易被騙",
        "看到錢、密碼、驗證碼\n先停三秒",
        "穩賺不賠，通常有問題",
        "不確定，就先查證",
        "165 可以幫忙查證"
    ];
    let sloganIndex = 0;
    let familySetupPromise = null;

    function getApiBaseUrl() {
        return window.CONFIG?.API_BASE_URL || "https://ai-anti-scam.onrender.com";
    }

    function normalizeFamilyCode(value) {
        const code = String(value || "")
            .trim()
            .toUpperCase()
            .replace(/^AISHIELD:/, "")
            .replace(/^FAM-/, "")
            .replace(/[^A-Z0-9]/g, "")
            .slice(0, 6);

        return /^[A-Z0-9]{6}$/.test(code) ? code : "";
    }

    function pickValidFamilyIDFromObject(source = {}) {
        const primary = normalizeFamilyCode(source?.[FAMILY_ID_PRIMARY_KEY]);
        if (primary) return primary;

        // 家庭綁定卡片目前顯示的新邀請碼，常會先存在 savedFamilyID。
        // 若舊 familyID 還殘留，這裡要採用 savedFamilyID，避免戰情室讀到舊代碼。
        const saved = normalizeFamilyCode(source?.savedFamilyID);
        if (saved) return saved;

        for (const key of FAMILY_ID_STORAGE_KEYS) {
            const code = normalizeFamilyCode(source?.[key]);
            if (code) return code;
        }
        return "";
    }

    function createLocalFamilyCode() {
        const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        const bytes = new Uint8Array(6);

        try {
            crypto.getRandomValues(bytes);
        } catch (e) {
            for (let i = 0; i < bytes.length; i += 1) {
                bytes[i] = Math.floor(Math.random() * 256);
            }
        }

        return Array.from(bytes, value => chars[value % chars.length]).join("");
    }

    async function getStorageValues(keys) {
        const result = {};

        try {
            if (typeof chrome !== "undefined" && chrome.storage?.local) {
                return await chrome.storage.local.get(keys);
            }
        } catch (e) {}

        keys.forEach(key => {
            try {
                result[key] = localStorage.getItem(key);
            } catch (e) {
                result[key] = "";
            }
        });

        return result;
    }

    async function setStorageValues(values = {}) {
        try {
            if (typeof chrome !== "undefined" && chrome.storage?.local) {
                await chrome.storage.local.set(values);
            }
        } catch (e) {
            console.warn("chrome.storage 寫入失敗，改用 localStorage 保留：", e);
        }

        Object.entries(values).forEach(([key, value]) => {
            try {
                if (value === undefined || value === null) return;
                localStorage.setItem(key, String(value));
            } catch (e) {}
        });
    }

    function buildFamilyBindingPayload(familyID, options = {}) {
        const normalizedFamilyID = normalizeFamilyCode(familyID);
        if (!normalizedFamilyID) return null;

        const payload = {};
        FAMILY_ID_STORAGE_KEYS.forEach(key => {
            payload[key] = normalizedFamilyID;
        });
        payload[FAMILY_ID_PRIMARY_KEY] = normalizedFamilyID;

        if (options.accessToken) {
            ACCESS_TOKEN_STORAGE_KEYS.forEach(key => {
                payload[key] = options.accessToken;
            });
        }

        if (options.expiresAt) {
            payload[TOKEN_EXPIRES_AT_STORAGE_KEY] = options.expiresAt;
        }

        if (options.installID) {
            payload[INSTALL_ID_STORAGE_KEY] = options.installID;
        }

        if (options.userID) {
            payload.userID = options.userID;
        }

        const now = new Date().toISOString();
        payload.aiShieldFamilyBoundAt = now;
        payload[FAMILY_ID_UPDATED_AT_KEY] = now;
        payload.aiShieldFamilyBindingSource = "welcome";
        return payload;
    }

    async function saveFamilyBinding(familyID, options = {}) {
        const payload = buildFamilyBindingPayload(familyID, options);
        if (!payload) return "";

        await setStorageValues(payload);
        return payload.familyID;
    }

    async function clearFamilyBinding(reason = "") {
        const keysToRemove = Array.from(new Set([
            ...FAMILY_ID_STORAGE_KEYS,
            ...ACCESS_TOKEN_STORAGE_KEYS,
            TOKEN_EXPIRES_AT_STORAGE_KEY,
            "aiShieldFamilyBoundAt",
            "aiShieldFamilyBackendVerifiedAt",
            "aiShieldFamilyBindingSource",
            FAMILY_ID_UPDATED_AT_KEY
        ]));

        try {
            if (typeof chrome !== "undefined" && chrome.storage?.local) {
                await chrome.storage.local.remove(keysToRemove);
                if (reason) {
                    await chrome.storage.local.set({ aiShieldFamilyBindingLastClearReason: reason });
                }
            }
        } catch (e) {
            console.warn("清除舊家庭綁定 chrome.storage 失敗：", e);
        }

        keysToRemove.forEach(key => {
            try { localStorage.removeItem(key); } catch (e) {}
        });

        if (reason) {
            try { localStorage.setItem("aiShieldFamilyBindingLastClearReason", reason); } catch (e) {}
        }
    }

    function isBackendFamilyError(message = "") {
        return /不屬於此家庭|不是此家庭|找不到此家庭|找不到此家庭邀請碼|家庭.*不存在|邀請碼.*不存在|invalid family|not.*family|not.*member|not found/i.test(String(message || ""));
    }

    async function ensureInstallIdentity(preferredFamilyID = "", options = {}) {
        const keys = [
            INSTALL_ID_STORAGE_KEY,
            TOKEN_EXPIRES_AT_STORAGE_KEY,
            "userID",
            ...FAMILY_ID_STORAGE_KEYS,
            ...ACCESS_TOKEN_STORAGE_KEYS
        ];
        const storage = await getStorageValues(keys);

        let installID = String(storage[INSTALL_ID_STORAGE_KEY] || "").trim();
        if (!installID) {
            installID = "ins_" + (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now());
        }

        let userID = String(storage.userID || "").trim();
        if (!userID) {
            userID = "USER_" + Math.random().toString(36).slice(2, 11).toUpperCase();
        }

        const familyID = normalizeFamilyCode(preferredFamilyID) || pickValidFamilyIDFromObject(storage) || "";
        const tokenKey = window.CONFIG?.ACCESS_TOKEN_STORAGE_KEY || "aiShieldAccessToken";
        const storedToken = storage[tokenKey] || storage.accessToken || storage.aiShieldAccessToken || "";
        const expiresAt = Number(storage[TOKEN_EXPIRES_AT_STORAGE_KEY] || 0);
        const refreshWindowSec = Math.ceil(Number(window.CONFIG?.TOKEN_REFRESH_WINDOW_MS || 300000) / 1000);

        await setStorageValues({
            [INSTALL_ID_STORAGE_KEY]: installID,
            userID
        });

        if (!options.forceRefresh && storedToken && expiresAt && expiresAt - Math.floor(Date.now() / 1000) > refreshWindowSec) {
            if (familyID) {
                await saveFamilyBinding(familyID, { accessToken: storedToken, expiresAt, installID, userID });
            }
            return { accessToken: storedToken, expiresAt, installID, userID, familyID };
        }

        const requestBody = { installID, userID };
        if (familyID) requestBody.familyID = familyID;

        const response = await fetch(`${getApiBaseUrl()}/api/auth/install`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(requestBody)
        });

        let data = {};
        try { data = await response.json(); } catch (e) {}

        if (!response.ok || !data.accessToken) {
            throw new Error(data.message || data.error || `取得短效 token 失敗 (${response.status})`);
        }

        const finalFamilyID = normalizeFamilyCode(data.familyID || data.familyId || familyID);
        const finalUserID = data.userID || data.userId || userID;
        const finalExpiresAt = data.expiresAt || data.expires_at || expiresAt || 0;

        const payload = {
            [tokenKey]: data.accessToken,
            aiShieldAccessToken: data.accessToken,
            accessToken: data.accessToken,
            [TOKEN_EXPIRES_AT_STORAGE_KEY]: finalExpiresAt,
            [INSTALL_ID_STORAGE_KEY]: installID,
            userID: finalUserID
        };

        if (finalFamilyID) {
            Object.assign(payload, buildFamilyBindingPayload(finalFamilyID, {
                accessToken: data.accessToken,
                expiresAt: finalExpiresAt,
                installID,
                userID: finalUserID
            }) || {});
        }

        await setStorageValues(payload);

        return {
            accessToken: data.accessToken,
            expiresAt: finalExpiresAt,
            installID,
            userID: finalUserID,
            familyID: finalFamilyID
        };
    }

    async function createFamilyViaApi(auth, preferredFamilyID = "") {
        const requestedFamilyID = normalizeFamilyCode(preferredFamilyID || auth?.familyID || createLocalFamilyCode());

        if (!auth?.accessToken) {
            throw new Error("尚未取得短效 token，無法建立家庭群組。");
        }

        const response = await fetch(`${getApiBaseUrl()}/api/create_family`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${auth.accessToken}`
            },
            body: JSON.stringify({
                familyID: requestedFamilyID,
                familyCode: requestedFamilyID,
                userID: auth.userID,
                installID: auth.installID,
                source: "welcome"
            })
        });

        let data = {};
        try { data = await response.json(); } catch (e) {}

        if (!response.ok || (data.status && data.status !== "success")) {
            throw new Error(data.message || data.error || `建立家庭群組失敗 (${response.status})`);
        }

        const returnedFamilyID = normalizeFamilyCode(
            data.familyID ||
            data.familyId ||
            data.familyCode ||
            data.inviteCode ||
            data.invite_code ||
            requestedFamilyID
        );

        if (!returnedFamilyID) {
            throw new Error("後端未回傳有效家庭代碼。");
        }

        return returnedFamilyID;
    }

    async function verifyFamilyBinding(familyID, auth) {
        const normalizedFamilyID = normalizeFamilyCode(familyID);
        if (!normalizedFamilyID) {
            throw new Error("家庭代碼格式不正確。");
        }

        if (!auth?.accessToken) {
            throw new Error("尚未取得短效 token，無法驗證家庭綁定。");
        }

        const response = await fetch(`${getApiBaseUrl()}/api/get_alerts`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${auth.accessToken}`
            },
            body: JSON.stringify({ familyID: normalizedFamilyID })
        });

        let data = {};
        try { data = await response.json(); } catch (e) {}

        if (response.ok && (!data.status || data.status === "success")) {
            await saveFamilyBinding(normalizedFamilyID, {
                accessToken: auth.accessToken,
                expiresAt: auth.expiresAt || 0,
                installID: auth.installID || "",
                userID: auth.userID || ""
            });
            await setStorageValues({ aiShieldFamilyBackendVerifiedAt: new Date().toISOString() });
            return true;
        }

        const message = data.message || data.error || `家庭綁定驗證失敗 (${response.status})`;
        throw new Error(message);
    }

    function setMultilineText(element, text) {
        if (!element) return;
        element.replaceChildren();

        String(text || "").split("\n").forEach((line, index) => {
            if (index > 0) {
                element.appendChild(document.createElement("br"));
            }
            element.appendChild(document.createTextNode(line));
        });
    }

    function rotateSlogan() {
        if (!sloganText || paused) return;

        sloganText.style.opacity = 0;

        setTimeout(() => {
            sloganIndex = (sloganIndex + 1) % slogans.length;
            setMultilineText(sloganText, slogans[sloganIndex]);
            sloganText.style.opacity = 1;
        }, 500);
    }

    async function autoSetupFamilyGroup() {
        try {
            updateFamilyUI("正在建立家庭守護連線，請稍候...", false);

            const storageData = await getStorageValues([
                ...FAMILY_ID_STORAGE_KEYS,
                ...ACCESS_TOKEN_STORAGE_KEYS,
                INSTALL_ID_STORAGE_KEY,
                TOKEN_EXPIRES_AT_STORAGE_KEY,
                "userID"
            ]);

            const existingFamilyID = pickValidFamilyIDFromObject(storageData);

            if (existingFamilyID) {
                try {
                    const auth = await ensureInstallIdentity(existingFamilyID, { forceRefresh: true });
                    await verifyFamilyBinding(existingFamilyID, auth);
                    updateFamilyUI(`✅ 家庭守護已準備完成：${existingFamilyID}`, true);
                    return existingFamilyID;
                } catch (error) {
                    console.warn("既有家庭代碼無法被後端驗證，清除後重新建立：", error);
                    if (isBackendFamilyError(error.message)) {
                        await clearFamilyBinding(error.message);
                    } else {
                        throw error;
                    }
                }
            }

            const preferredFamilyID = createLocalFamilyCode();
            const auth = await ensureInstallIdentity(preferredFamilyID, { forceRefresh: true });
            const familyID = await createFamilyViaApi(auth, preferredFamilyID);
            const refreshedAuth = await ensureInstallIdentity(familyID, { forceRefresh: true });

            await verifyFamilyBinding(familyID, refreshedAuth);
            await saveFamilyBinding(familyID, {
                accessToken: refreshedAuth.accessToken || auth.accessToken || "",
                expiresAt: refreshedAuth.expiresAt || auth.expiresAt || 0,
                installID: refreshedAuth.installID || auth.installID || "",
                userID: refreshedAuth.userID || auth.userID || ""
            });

            updateFamilyUI(`✅ 家庭守護已準備完成：${familyID}`, true);
            return familyID;
        } catch (error) {
            console.error("家庭群組自動建立失敗:", error);
            await clearFamilyBinding(error.message || "家庭群組自動建立失敗");
            updateFamilyUI(`⚠️ 家庭守護建立失敗：${error.message || "請確認後端 API 是否啟動"}`, false);
            throw error;
        }
    }

    function updateFamilyUI(message, isSuccess) {
        if (!familyStatusText) return;
        familyStatusText.textContent = message;
        familyStatusText.classList.toggle("success", Boolean(isSuccess));
    }

    function setStorageFlag() {
        const payload = {
            aiShieldWelcomeCompleted: true,
            aiShieldElderFriendlyMode: true,
            aiShieldProtectionMode: "active",
            aiShieldProtectionModeStartedAt: new Date().toISOString()
        };

        setStorageValues(payload).catch(() => {
            try {
                localStorage.setItem("aiShieldWelcomeCompleted", "true");
                localStorage.setItem("aiShieldProtectionMode", "active");
            } catch (e) {}
        });
    }

    async function enterProtectionMode() {
        if (redirectTimer) clearInterval(redirectTimer);
        if (sloganTimer) clearInterval(sloganTimer);

        try {
            if (familySetupPromise) {
                await familySetupPromise;
            }
        } catch (e) {}

        setStorageFlag();
        window.location.replace(SAFE_START_URL);
    }

    function renderCountdown() {
        if (statusText) {
            statusText.textContent = `${remaining} 秒後會自動進入安全上網模式`;
        }
    }

    function startTimers() {
        setMultilineText(sloganText, slogans[sloganIndex]);
        renderCountdown();

        sloganTimer = setInterval(rotateSlogan, 3500);

        redirectTimer = setInterval(() => {
            if (paused) return;

            remaining -= 1;
            renderCountdown();

            if (remaining <= 0) {
                enterProtectionMode();
            }
        }, 1000);
    }

    if (startBtn) {
        startBtn.addEventListener("click", enterProtectionMode);
    }

    if (pauseBtn) {
        pauseBtn.addEventListener("click", () => {
            paused = true;
            if (redirectTimer) clearInterval(redirectTimer);
            if (sloganTimer) clearInterval(sloganTimer);

            if (statusText) {
                statusText.textContent = "自動進入已暫停，您可以隨時點擊開始";
                statusText.style.background = "rgba(16, 42, 67, 0.08)";
                statusText.style.borderColor = "transparent";
                statusText.style.color = "var(--ink)";
            }
            pauseBtn.textContent = "已暫停自動進入";
            pauseBtn.disabled = true;
            pauseBtn.style.opacity = "0.5";
            pauseBtn.style.cursor = "not-allowed";
        });
    }

    startTimers();
    familySetupPromise = autoSetupFamilyGroup();
});
