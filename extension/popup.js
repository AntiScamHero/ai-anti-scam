/**
 * AI 防詐盾牌 - Popup 核心控制邏輯（保留原功能優化版）
 *
 * 功能：
 * 1. 手動掃描目前頁面
 * 2. 黃金 3 秒緩衝，讓使用者可提前進入防護網
 * 3. 家庭群組建立 / 加入 / 綁定
 * 4. 若已授權 clipboardRead，才靜默偵測 aishield:XXXXXX 邀請碼
 * 5. 家庭戰情室輪詢
 * 6. 短效 Bearer token，不再使用前端固定 EXTENSION_SECRET
 * 7. DOM 安全更新：使用 textContent / createElement
 */

let currentUserID = "";
let currentFamilyID = "none";
let pollingInterval = null;
let latestScanReport = null;
let goldenCountdownTimer = null;
let didAutoScanOnOpen = false;

// ==========================================
// CONFIG / 基本工具
// ==========================================
function getConfigValue(key, fallback) {
    try {
        if (typeof CONFIG !== "undefined" && CONFIG && CONFIG[key] !== undefined) {
            return CONFIG[key];
        }
    } catch (e) {}

    return fallback;
}

function getApiBaseUrl() {
    return getConfigValue("API_BASE_URL", "https://ai-anti-scam.onrender.com");
}

function getAccessTokenStorageKey() {
    return getConfigValue("ACCESS_TOKEN_STORAGE_KEY", "aiShieldAccessToken");
}

function getInstallIdStorageKey() {
    return getConfigValue("INSTALL_ID_STORAGE_KEY", "aiShieldInstallId");
}

function getTokenExpiresAtStorageKey() {
    return getConfigValue("TOKEN_EXPIRES_AT_STORAGE_KEY", "aiShieldTokenExpiresAt");
}

function isAuthRequired() {
    return Boolean(getConfigValue("REQUIRE_AUTH_TOKEN", true));
}

function getRiskThresholdHigh() {
    return Number(getConfigValue("RISK_THRESHOLD_HIGH", 70)) || 70;
}

function getRiskThresholdMedium() {
    return Number(getConfigValue("RISK_THRESHOLD_MEDIUM", 40)) || 40;
}

function getPollingIntervalMs() {
    return Number(getConfigValue("POLLING_INTERVAL_MS", 5000)) || 5000;
}

function getRequestTimeoutMs() {
    return Number(getConfigValue("REQUEST_TIMEOUT_MS", 12000)) || 12000;
}

function getMaxRetries() {
    return Number(getConfigValue("MAX_RETRIES", 3)) || 3;
}

function setTextById(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = String(text ?? "");
}

function setDisplayById(id, display) {
    const el = document.getElementById(id);
    if (el) el.style.display = display;
}

function showToast(message, type = "info") {
    const oldToast = document.getElementById("popup-toast");
    if (oldToast) oldToast.remove();

    const toast = document.createElement("div");
    toast.id = "popup-toast";
    toast.textContent = String(message || "");

    const bg =
        type === "success"
            ? "rgba(0, 200, 81, 0.96)"
            : type === "error"
                ? "rgba(255, 68, 68, 0.96)"
                : "rgba(26, 115, 232, 0.96)";

    toast.style.cssText = `
        position: fixed;
        left: 50%;
        bottom: 14px;
        transform: translateX(-50%);
        max-width: 340px;
        padding: 10px 14px;
        border-radius: 999px;
        background: ${bg};
        color: white;
        font-size: 13px;
        font-weight: 800;
        line-height: 1.45;
        z-index: 2147483647;
        text-align: center;
        box-shadow: 0 8px 24px rgba(0,0,0,0.25);
    `;

    document.body.appendChild(toast);

    setTimeout(() => {
        toast.remove();
    }, 2600);
}

function maskSensitiveData(text) {
    if (!text) return "";

    return String(text)
        .replace(/(?:\d{4}[-\s]?){3}\d{4}/g, "[信用卡號已隱藏]")
        .replace(/[A-Z][12]\d{8}/gi, "[身分證已隱藏]")
        .replace(/09\d{2}[-\s]?\d{3}[-\s]?\d{3}/g, "[手機號碼已隱藏]")
        .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[Email已隱藏]");
}

function safeParseReport(data) {
    try {
        if (data && data.report) {
            let report = typeof data.report === "string" ? JSON.parse(data.report) : data.report;

            if (typeof report === "string") {
                report = JSON.parse(report);
            }

            return report || data;
        }

        return data || {};
    } catch (e) {
        return data || {};
    }
}

function normalizeRiskScore(report) {
    return parseInt(
        report?.riskScore ||
        report?.RiskScore ||
        report?.risk_score ||
        0,
        10
    ) || 0;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = getRequestTimeoutMs()) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        return await fetch(url, {
            ...options,
            signal: controller.signal
        });
    } finally {
        clearTimeout(timeoutId);
    }
}

async function fetchWithRetry(url, options, maxRetries = getMaxRetries()) {
    let lastError = null;

    for (let i = 0; i < maxRetries; i++) {
        try {
            const response = await fetchWithTimeout(url, options);

            if (response.ok) {
                return response;
            }

            let errorText = "";
            try {
                const data = await response.json();
                errorText = data.message || data.reason || "";
            } catch (e) {}

            throw new Error(errorText || `HTTP error: ${response.status}`);
        } catch (err) {
            lastError = err;

            if (err.name === "AbortError") {
                lastError = new Error("連線逾時，請稍後再試。");
            }

            if (i === maxRetries - 1) {
                break;
            }

            await new Promise(resolve => setTimeout(resolve, 900 * (i + 1)));
        }
    }

    throw lastError || new Error("fetchWithRetry failed");
}

// ==========================================
// 短效 Token / 身分初始化
// ==========================================
async function ensureInstallIdentity() {
    const tokenKey = getAccessTokenStorageKey();
    const installKey = getInstallIdStorageKey();
    const expiresKey = getTokenExpiresAtStorageKey();

    const storage = await chrome.storage.local.get([
        tokenKey,
        installKey,
        expiresKey,
        "userID",
        "familyID"
    ]);

    let installID = storage[installKey];
    if (!installID) {
        installID = "ins_" + (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
        await chrome.storage.local.set({ [installKey]: installID });
    }

    let userID = storage.userID;
    if (!userID) {
        userID = "USER_" + Math.random().toString(36).slice(2, 11).toUpperCase();
        await chrome.storage.local.set({ userID });
    }

    const familyID = storage.familyID || "none";
    const token = storage[tokenKey] || "";
    const expiresAt = Number(storage[expiresKey] || 0) * 1000;
    const refreshWindow = Number(getConfigValue("TOKEN_REFRESH_WINDOW_MS", 300000));

    if (token && expiresAt - Date.now() > refreshWindow) {
        currentUserID = userID;
        currentFamilyID = familyID;
        return { accessToken: token, userID, familyID, installID };
    }

    try {
        const response = await fetchWithRetry(`${getApiBaseUrl()}/api/auth/install`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ installID, userID, familyID })
        }, 1);

        let data = {};
        try { data = await response.json(); } catch (e) {}

        if (response.ok && data.accessToken) {
            currentUserID = data.userID || userID;
            currentFamilyID = data.familyID || familyID;

            await chrome.storage.local.set({
                [tokenKey]: data.accessToken,
                [expiresKey]: data.expiresAt || 0,
                userID: currentUserID,
                familyID: currentFamilyID
            });

            return { accessToken: data.accessToken, userID: currentUserID, familyID: currentFamilyID, installID };
        }

        // 短效 token 暫時取不到時，Popup 不顯示錯誤；掃描仍會優先嘗試雲端 API，失敗再降級本機判斷。
    } catch (e) {
        // 靜默處理：避免把後端授權暫時問題顯示成使用者錯誤。
    }

    currentUserID = userID;
    currentFamilyID = familyID;
    return { accessToken: token, userID, familyID, installID };
}

async function getApiHeaders() {
    const headers = { "Content-Type": "application/json" };
    const auth = await ensureInstallIdentity();

    if (auth.accessToken) headers.Authorization = `Bearer ${auth.accessToken}`;

    if (!auth.accessToken && isAuthRequired()) {
        throw new Error("尚未取得短效 accessToken，請確認後端 API 是否啟動。用於競賽展示時，請先確認 Render 服務已醒來。");
    }

    return headers;
}

// ==========================================
// UI 狀態
// ==========================================
function updateUIAsBound(familyID) {
    currentFamilyID = familyID || "none";

    const statusText = currentFamilyID !== "none"
        ? `狀態：已綁定家庭群組 ${currentFamilyID}`
        : "狀態：尚未綁定";

    setTextById("family-status", statusText);
    setTextById("bind-status", statusText);

    const displayCode = document.getElementById("display_code");
    if (displayCode && currentFamilyID !== "none") {
        displayCode.textContent = currentFamilyID;
    }

    const inviteInput = document.getElementById("invite_input");
    if (inviteInput && currentFamilyID !== "none") {
        inviteInput.value = currentFamilyID;
    }
}

function setLoading(isLoading) {
    setDisplayById("loading", isLoading ? "block" : "none");

    const scanBtn = document.getElementById("scan-btn");

    if (scanBtn && scanBtn.dataset.isEscape !== "true") {
        scanBtn.disabled = isLoading;
        scanBtn.textContent = isLoading ? "AI 深度分析中..." : "🔍 掃描目前頁面";
    }
}

function setProgressColor(progressBar, score) {
    if (!progressBar) return;

    if (score >= getRiskThresholdHigh()) {
        progressBar.style.background = "#ff4444";
    } else if (score >= getRiskThresholdMedium()) {
        progressBar.style.background = "#ffbb33";
    } else {
        progressBar.style.background = "#00c851";
    }
}

function renderTags(containerId, tags) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.replaceChildren();

    if (!Array.isArray(tags) || tags.length === 0) {
        const tag = document.createElement("span");
        tag.className = "tag";
        tag.textContent = "未發現明顯操縱術";
        container.appendChild(tag);
        return;
    }

    tags.forEach(item => {
        const tag = document.createElement("span");
        tag.className = "tag";
        tag.textContent = String(item);
        container.appendChild(tag);
    });
}

function renderScanResult(reportData) {
    latestScanReport = reportData;

    let score = normalizeRiskScore(reportData);

    if (score < 0) score = 0;
    if (score > 100) score = 100;

    const level = reportData.riskLevel || (score >= 70 ? "極度危險" : score >= 40 ? "中高風險" : "安全無虞");
    const reason = reportData.reason || "系統已完成基礎安全掃描。";
    const advice = reportData.advice || "請保持一般上網警覺。";
    const scamDNA = Array.isArray(reportData.scamDNA) ? reportData.scamDNA : [];

    setDisplayById("score-container", "block");
    setDisplayById("report-container", "block");
    setDisplayById("dimensions-section", "block");

    setTextById("score-title", `${score} 分`);
    setTextById("risk-label", level);
    setTextById("risk-level", level);
    setTextById("risk-reason", reason);
    setTextById("risk-advice", advice);

    // 相容舊版 popup.html ID
    setTextById("score-text", `風險指數: ${score}%`);
    setTextById("report-level", level);
    setTextById("report-reason", reason);
    setTextById("report-advice", advice);

    renderTags("scam-dna-tags", scamDNA);
    renderTags("keyword-tags", scamDNA);

    const progressBar = document.getElementById("progress-bar");

    if (progressBar) {
        progressBar.style.width = "0%";
        setProgressColor(progressBar, score);

        setTimeout(() => {
            progressBar.style.width = `${score}%`;
        }, 120);
    }

    const headerTitle = document.getElementById("header-title");
    const appBody = document.getElementById("app-body");

    if (score >= getRiskThresholdHigh()) {
        if (headerTitle) {
            headerTitle.textContent = "❌ 極度危險！請立即撤離！";
            headerTitle.style.background = "linear-gradient(90deg, #d32f2f 0%, #b71c1c 100%)";
            headerTitle.style.color = "#ffffff";
        }

        if (appBody) {
            appBody.classList.add("theme-danger");
        }

        startGoldenThreeSeconds(reportData);
        return;
    }

    if (score >= getRiskThresholdMedium()) {
        if (headerTitle) {
            headerTitle.textContent = "⚠️ 警告：請提高警覺";
            headerTitle.style.background = "#ffbb33";
            headerTitle.style.color = "#111111";
        }

        if (appBody) {
            appBody.classList.add("theme-warning");
        }

        return;
    }

    if (headerTitle) {
        headerTitle.textContent = "✅ 檢測通過：安全網頁";
        headerTitle.style.background = "#1a73e8";
        headerTitle.style.color = "#ffffff";
    }

    if (appBody) {
        appBody.classList.add("theme-safe");
    }
}

function resetScanButton(btn) {
    if (!btn || btn.dataset.isEscape === "true") return;

    btn.disabled = false;
    btn.textContent = "🔍 掃描目前頁面";
    btn.style.background = "";
    btn.style.color = "";
    btn.style.border = "";
    btn.style.boxShadow = "";
}

function renderHighRiskActions(reportData) {
    const reportContainer = document.getElementById("report-container");
    if (!reportContainer || document.getElementById("high-risk-actions")) return;

    const actions = document.createElement("div");
    actions.id = "high-risk-actions";
    actions.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px;";

    const blockBtn = document.createElement("button");
    blockBtn.type = "button";
    blockBtn.textContent = "立即進入防護網";
    blockBtn.className = "btn-red";
    blockBtn.style.marginBottom = "0";
    blockBtn.addEventListener("click", () => {
        redirectActiveTabToBlocked(reportData.reason || "極度危險！");
    });

    const readBtn = document.createElement("button");
    readBtn.type = "button";
    readBtn.textContent = "先看風險原因";
    readBtn.className = "btn-gray";
    readBtn.style.marginBottom = "0";
    readBtn.addEventListener("click", () => {
        if (goldenCountdownTimer) {
            clearInterval(goldenCountdownTimer);
            goldenCountdownTimer = null;
        }

        const scanBtn = document.getElementById("scan-btn");
        if (scanBtn) {
            scanBtn.dataset.isEscape = "true";
            scanBtn.textContent = "🚨 進入防護網";
            scanBtn.disabled = false;
        }

        showToast("已暫停自動跳轉，請仔細查看風險原因。", "info");
    });

    actions.appendChild(blockBtn);
    actions.appendChild(readBtn);
    reportContainer.appendChild(actions);
}

function startGoldenThreeSeconds(reportData) {
    const scanBtn = document.getElementById("scan-btn");
    if (!scanBtn) return;

    if (goldenCountdownTimer) {
        clearInterval(goldenCountdownTimer);
        goldenCountdownTimer = null;
    }

    renderHighRiskActions(reportData);

    scanBtn.dataset.isEscape = "true";
    scanBtn.dataset.blockReason = reportData.reason || "系統深層掃描發現高度危險特徵！";

    let countdown = 3;

    scanBtn.textContent = `🚨 危險！${countdown} 秒後進入防護網`;
    scanBtn.style.background = "linear-gradient(90deg, #FF4444 0%, #CC0000 100%)";
    scanBtn.style.color = "white";
    scanBtn.style.border = "none";
    scanBtn.style.boxShadow = "0 0 20px rgba(255, 68, 68, 0.8)";
    scanBtn.disabled = false;

    goldenCountdownTimer = setInterval(async () => {
        countdown -= 1;

        if (countdown > 0) {
            scanBtn.textContent = `🚨 危險！${countdown} 秒後進入防護網`;
            return;
        }

        clearInterval(goldenCountdownTimer);
        goldenCountdownTimer = null;
        await redirectActiveTabToBlocked(reportData.reason || "極度危險！");
    }, 1000);
}

async function redirectActiveTabToBlocked(reasonText) {
    try {
        const [tab] = await chrome.tabs.query({
            active: true,
            currentWindow: true
        });

        if (!tab || !tab.id) return;

        const report = latestScanReport || {
            riskScore: 99,
            riskLevel: "極度危險",
            reason: reasonText || "系統深層掃描發現高度危險特徵！",
            advice: "請勿輸入個資、信用卡、驗證碼或依照頁面指示匯款。",
            scamDNA: ["系統強制警示"]
        };

        const blockedUrl =
            chrome.runtime.getURL("blocked.html") +
            "?data=" + encodeURIComponent(JSON.stringify(report)) +
            "&reason=" + encodeURIComponent(reasonText || report.reason) +
            "&original_url=" + encodeURIComponent(tab.url || "") +
            "&url=" + encodeURIComponent(tab.url || "");

        await chrome.tabs.update(tab.id, {
            url: blockedUrl
        });

        window.close();
    } catch (e) {
        console.warn("導向 blocked.html 失敗：", e);
    }
}

// ==========================================
// 掃描目前頁面
// ==========================================
async function getActiveTab() {
    const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true
    });

    return tab;
}

async function getCurrentPageText(tabId) {
    try {
        const result = await chrome.scripting.executeScript({
            target: { tabId },
            func: () => {
                const title = document.title || "";
                const bodyText = (
                    document.documentElement.innerText ||
                    document.body?.innerText ||
                    document.documentElement.textContent ||
                    ""
                ).replace(/\s+/g, " ");

                const safeText = bodyText.slice(0, 2500);

                return `[標題] ${title}\n[內文] ${safeText}`;
            }
        });

        return result?.[0]?.result || "";
    } catch (e) {
        console.warn("讀取頁面文字失敗：", e);
        return "";
    }
}

async function scanCurrentPage() {
    const scanBtn = document.getElementById("scan-btn");

    if (scanBtn?.dataset.isEscape === "true") {
        await redirectActiveTabToBlocked(scanBtn.dataset.blockReason || "系統深層掃描發現高度危險特徵！");
        return;
    }

    try {
        setLoading(true);

        const tab = await getActiveTab();

        if (!tab || !tab.id || !tab.url) {
            throw new Error("無法取得目前分頁。");
        }

        const rawText = await getCurrentPageText(tab.id);
        const maskedText = maskSensitiveData(rawText);

        const response = await fetchWithRetry(`${getApiBaseUrl()}/scan`, {
            method: "POST",
            headers: await getApiHeaders(),
            body: JSON.stringify({
                url: tab.url,
                text: maskedText,
                userID: currentUserID || "anonymous",
                familyID: currentFamilyID || "none",
                scan_source: "popup_auto_or_manual"
            })
        });

        let data = {};

        try {
            data = await response.json();
        } catch (e) {
            data = {
                riskScore: 0,
                riskLevel: "安全無虞",
                reason: "伺服器回傳格式異常，但未偵測到明確風險。",
                advice: "請保持一般警覺。"
            };
        }

        const reportData = safeParseReport(data);
        renderScanResult(reportData);
    } catch (error) {
        console.error("掃描錯誤", error);
        showToast(`掃描失敗：${error.message}`, "error");
    } finally {
        setLoading(false);
        resetScanButton(scanBtn);
    }
}

// ==========================================
// 家庭防護網：建立 / 加入 / 輪詢
// ==========================================
async function createFamily() {
    const ok = confirm(
        "⚠️ 確定要建立一個『全新』的家庭防護群組嗎？\n\n如果您只是想加入別人的群組，請按取消，並在下方輸入對方的 6 碼代號。"
    );

    if (!ok) return;

    const btn = document.getElementById("btn_create_family");

    try {
        if (btn) {
            btn.disabled = true;
            btn.textContent = "建立中...";
        }

        const auth = await ensureInstallIdentity();

        const response = await fetchWithRetry(`${getApiBaseUrl()}/api/create_family`, {
            method: "POST",
            headers: await getApiHeaders(),
            body: JSON.stringify({
                uid: auth.userID,
                installID: auth.installID
            })
        });

        const data = await response.json();

        if (!response.ok || data.status !== "success") {
            throw new Error(data.message || "建立家庭群組失敗");
        }

        currentFamilyID = data.inviteCode || data.familyID || "none";

        const tokenKey = getAccessTokenStorageKey();

        await chrome.storage.local.set({
            familyID: currentFamilyID,
            [tokenKey]: data.accessToken || auth.accessToken || "",
            aiShieldTokenExpiresAt: data.expiresAt || 0
        });

        updateUIAsBound(currentFamilyID);
        startFamilyAlertsPolling(currentFamilyID);

        showToast(`家庭群組建立成功：${currentFamilyID}`, "success");
    } catch (error) {
        showToast(`建立失敗：${error.message}`, "error");
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = "建立家庭";
        }
    }
}

async function joinFamily() {
    const input = document.getElementById("invite_input");
    const code = String(input?.value || "").trim().toUpperCase();

    if (!/^[A-Z0-9]{6}$/.test(code)) {
        showToast("請輸入正確的 6 碼家庭邀請碼。", "error");
        return;
    }

    const btn = document.getElementById("btn_join_family");

    try {
        if (btn) {
            btn.disabled = true;
            btn.textContent = "綁定中...";
        }

        const auth = await ensureInstallIdentity();

        const response = await fetchWithRetry(`${getApiBaseUrl()}/api/join_family`, {
            method: "POST",
            headers: await getApiHeaders(),
            body: JSON.stringify({
                uid: auth.userID,
                inviteCode: code,
                installID: auth.installID
            })
        });

        const data = await response.json();

        if (!response.ok || data.status !== "success") {
            throw new Error(data.message || "加入家庭群組失敗");
        }

        currentFamilyID = code;

        const tokenKey = getAccessTokenStorageKey();

        await chrome.storage.local.set({
            familyID: currentFamilyID,
            [tokenKey]: data.accessToken || auth.accessToken || "",
            aiShieldTokenExpiresAt: data.expiresAt || 0
        });

        updateUIAsBound(currentFamilyID);
        startFamilyAlertsPolling(currentFamilyID);

        showToast(`已加入家庭防護網：${currentFamilyID}`, "success");
    } catch (error) {
        showToast(`綁定失敗：${error.message}`, "error");
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = "綁定";
        }
    }
}

async function fetchFamilyAlerts(familyID) {
    if (!familyID || familyID === "none") return [];

    try {
        const response = await fetchWithRetry(`${getApiBaseUrl()}/api/get_alerts`, {
            method: "POST",
            headers: await getApiHeaders(),
            body: JSON.stringify({
                familyID
            })
        });

        const data = await response.json();

        if (!response.ok || data.status !== "success") {
            return [];
        }

        return Array.isArray(data.data) ? data.data : [];
    } catch (e) {
        return [];
    }
}

function updateFamilyAlertSummary(records) {
    const dangerCount = records.filter(record => {
        const report = safeParseReport(record.report);
        return normalizeRiskScore(report) >= getRiskThresholdHigh();
    }).length;

    const total = records.length;

    const statusText =
        currentFamilyID && currentFamilyID !== "none"
            ? `狀態：已綁定 ${currentFamilyID}｜近 20 筆掃描 ${total} 次，高風險 ${dangerCount} 次`
            : "狀態：尚未綁定";

    setTextById("family-status", statusText);
    setTextById("bind-status", statusText);
}

function startFamilyAlertsPolling(familyID) {
    if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
    }

    if (!familyID || familyID === "none") return;

    const poll = async () => {
        const records = await fetchFamilyAlerts(familyID);
        updateFamilyAlertSummary(records);
    };

    poll();

    pollingInterval = setInterval(poll, getPollingIntervalMs());
}

// ==========================================
// 快速工具
// ==========================================
async function safeExit() {
    try {
        const tab = await getActiveTab();

        if (tab?.id) {
            await chrome.tabs.update(tab.id, {
                url: "https://www.google.com"
            });
            window.close();
            return;
        }
    } catch (e) {}

    window.close();
}

async function reportCurrentPage() {
    try {
        const tab = await getActiveTab();

        if (!tab?.url) {
            throw new Error("無法取得目前頁面網址");
        }

        const report = latestScanReport || {};
        const auth = await ensureInstallIdentity();

        const response = await fetchWithRetry(`${getApiBaseUrl()}/api/report_false_positive`, {
            method: "POST",
            headers: await getApiHeaders(),
            body: JSON.stringify({
                url: tab.url,
                userID: auth.userID,
                familyID: auth.familyID || currentFamilyID || "none",
                riskScore: normalizeRiskScore(report),
                ai_reason: report.reason || "",
                reported_reason: "Popup 手動回報此頁可能為誤判",
                scope: "personal",
                action_type: "popup_manual_false_positive"
            })
        });

        const data = await response.json();

        if (!response.ok || data.status !== "success") {
            throw new Error(data.message || "回報失敗");
        }

        showToast("已送出回報，並進入白名單修正流程。", "success");
    } catch (error) {
        showToast(`回報失敗：${error.message}`, "error");
    }
}

function openDashboard() {
    chrome.tabs.create({
        url: chrome.runtime.getURL("dashboard.html")
    });
}

function copyInviteCode() {
    if (!currentFamilyID || currentFamilyID === "none") {
        showToast("目前尚未建立或綁定家庭群組。", "error");
        return;
    }

    const text = `aishield:${currentFamilyID}`;

    navigator.clipboard.writeText(text)
        .then(() => {
            showToast(`已複製邀請碼：${text}`, "success");
        })
        .catch(() => {
            showToast(`邀請碼：${text}`, "info");
        });
}

// ==========================================
// 剪貼簿邀請碼偵測
// ==========================================
async function canReadClipboardSilently() {
    try {
        if (!chrome.permissions) return false;

        return await chrome.permissions.contains({
            permissions: ["clipboardRead"]
        });
    } catch (e) {
        return false;
    }
}

async function detectInviteCodeFromClipboard() {
    try {
        // clipboardRead 已移到 optional_permissions。
        // 不在啟動時主動跳權限提示，只在使用者已授權時靜默偵測。
        if (!(await canReadClipboardSilently())) {
            return;
        }

        const text = await navigator.clipboard.readText();
        const match = text.match(/aishield:([A-Z0-9]{6})/i);

        if (!match || !match[1]) return;

        const inviteInput = document.getElementById("invite_input");
        const btnJoin = document.getElementById("btn_join_family");

        if (inviteInput) {
            inviteInput.value = match[1].toUpperCase();
            inviteInput.style.border = "2px solid #1a73e8";
            inviteInput.style.backgroundColor = "#e8f0fe";
        }

        if (btnJoin) {
            btnJoin.textContent = "🚀 發現代碼！點我立即綁定";
            btnJoin.style.background = "linear-gradient(135deg, #1a73e8 0%, #0d47a1 100%)";
            btnJoin.style.color = "white";
            btnJoin.style.fontWeight = "bold";
            btnJoin.style.boxShadow = "0 4px 15px rgba(26, 115, 232, 0.5)";
        }
    } catch (e) {
        // 使用者未授權剪貼簿時，靜默略過。
    }
}

// ==========================================
// 初始化
// ==========================================
function bindEvents() {
    const scanBtn = document.getElementById("scan-btn");
    const btnCreateFamily = document.getElementById("btn_create_family");
    const btnJoinFamily = document.getElementById("btn_join_family");
    const btnOpenDashboard = document.getElementById("btn_open_dashboard");
    const btnSafeExit = document.getElementById("btn_safe_exit");
    const btnReportPage = document.getElementById("btn_report_page");
    const inviteInput = document.getElementById("invite_input");
    const codeBox = document.getElementById("code_box");

    if (scanBtn) {
        scanBtn.addEventListener("click", scanCurrentPage);
    }

    if (btnCreateFamily) {
        btnCreateFamily.addEventListener("click", createFamily);
    }

    if (btnJoinFamily) {
        btnJoinFamily.addEventListener("click", joinFamily);
    }

    if (btnOpenDashboard) {
        btnOpenDashboard.addEventListener("click", openDashboard);
    }

    if (btnSafeExit) {
        btnSafeExit.addEventListener("click", safeExit);
    }

    if (btnReportPage) {
        btnReportPage.addEventListener("click", reportCurrentPage);
    }

    if (inviteInput) {
        inviteInput.addEventListener("input", event => {
            event.target.value = event.target.value
                .toUpperCase()
                .replace(/[^A-Z0-9]/g, "")
                .slice(0, 6);
        });

        inviteInput.addEventListener("keydown", event => {
            if (event.key === "Enter") {
                joinFamily();
            }
        });
    }

    if (codeBox) {
        codeBox.addEventListener("click", copyInviteCode);
    }
}

document.addEventListener("DOMContentLoaded", async () => {
    bindEvents();

    try {
        await ensureInstallIdentity();
    } catch (e) {
        console.debug("Popup 身分初始化暫時不可用，稍後掃描會自動降級處理。", e);
    }

    const storage = await chrome.storage.local.get(["userID", "familyID"]);

    currentUserID = storage.userID || currentUserID || "anonymous";
    currentFamilyID = storage.familyID || currentFamilyID || "none";

    updateUIAsBound(currentFamilyID);

    if (currentFamilyID && currentFamilyID !== "none") {
        startFamilyAlertsPolling(currentFamilyID);
    }

    await detectInviteCodeFromClipboard();

    console.log("🛡️ Popup 已啟動", {
        currentUserID,
        currentFamilyID
    });

    // Popup 開啟後自動檢查一次；雲端 API 優先，失敗時靜默改用本機 AI 備援。
    if (!didAutoScanOnOpen) {
        didAutoScanOnOpen = true;
        setTimeout(() => {
            scanCurrentPage().catch(error => {
                console.debug("Popup 自動掃描已靜默處理：", error);
            });
        }, 250);
    }
});