// dashboard.js - AI 防詐盾牌戰情室邏輯（保留原功能優化版）
// 功能：
// 1. WebSocket 即時家庭戰情室
// 2. 短效 Bearer token 驗證
// 3. 即時統計與 Chart.js 圖表
// 4. 詳細掃描紀錄
// 5. 高風險緊急警報
// 6. 安全 DOM 建立，不用 innerHTML 塞使用者資料
// 7. 證據快照 Modal
// 8. 清除本裝置暫存畫面，不直接刪除雲端家庭戰情紀錄
// 9. Socket.IO shim 自動降級輪詢，避免假 client 觸發錯誤

window.CONFIG = window.CONFIG || {
    API_BASE_URL: "https://ai-anti-scam.onrender.com",
    RISK_THRESHOLD_HIGH: 70,
    RISK_THRESHOLD_MEDIUM: 40,
    ACCESS_TOKEN_STORAGE_KEY: "aiShieldAccessToken",
    INSTALL_ID_STORAGE_KEY: "aiShieldInstallId",
    TOKEN_EXPIRES_AT_STORAGE_KEY: "aiShieldTokenExpiresAt",
    TOKEN_REFRESH_WINDOW_MS: 5 * 60 * 1000,
    REQUEST_TIMEOUT_MS: 60000,
    POLLING_INTERVAL_MS: 5000
};

let socket = null;
let ratioChartInstance = null;
let trendChartInstance = null;
let isFetching = false;
let currentRecords = [];
let fallbackPollingTimer = null;
let socketFallbackToastShown = false;

// 正式產品邏輯：一般使用者只能清除本裝置暫存畫面。
// 雲端家庭戰情紀錄應由家庭守護者或授權管理者完成身分驗證後刪除。
// 本機清除會用時間戳隱藏舊紀錄，不會刪除後端資料。
const DASHBOARD_LOCAL_CLEAR_AFTER_KEY = "aiShieldDashboardLocalClearAfterByFamily";
const DASHBOARD_LINE_PUSH_TEST_MODE_KEY = "aiShieldDemoLinePushEnabledByFamily";

// v41 決賽展示資料固定化：避免後端無資料、Socket.IO 降級或本機開檔時 Dashboard 空白。
const DASHBOARD_DEMO_FAMILY_ID = "F7K2Q9";
const DASHBOARD_DEMO_MODE_KEY = "aiShieldDashboardDemoMode";
const DASHBOARD_CLEAN_INSTALL_VERSION_KEY = "aiShieldDashboardCleanInstallVersion";
const DASHBOARD_CLEAN_INSTALL_VERSION = "2026-05-29-clean-local-state-v1";
let dashboardDemoDataActive = false;

// 家庭代碼只能有一個正式來源：歡迎頁 / 家庭綁定卡片建立的代碼。
// Dashboard 不再自己產生新代碼，也不再讓後端回傳代碼覆蓋目前綁定。
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

const FAMILY_ID_WRITE_KEYS = [
    FAMILY_ID_PRIMARY_KEY,
    "familyID",
    "currentFamilyID",
    "boundFamilyID",
    "familyCode",
    "family_id",
    "aiShieldFamilyID",
    "dashboardFamilyID",
    "savedFamilyID",
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

let dashboardCurrentFamilyID = "";
let dashboardAutoConnectRequested = true;
let dashboardLastSyncedAt = 0;

// ==========================================
// 共用工具
// ==========================================
function getApiBaseUrl() {
    return window.CONFIG?.API_BASE_URL || "https://ai-anti-scam.onrender.com";
}

function getAccessTokenStorageKey() {
    return window.CONFIG?.ACCESS_TOKEN_STORAGE_KEY || "aiShieldAccessToken";
}

function getInstallIdStorageKey() {
    return window.CONFIG?.INSTALL_ID_STORAGE_KEY || "aiShieldInstallId";
}

function getTokenExpiresAtStorageKey() {
    return window.CONFIG?.TOKEN_EXPIRES_AT_STORAGE_KEY || "aiShieldTokenExpiresAt";
}

function isAuthRequired() {
    return Boolean(window.CONFIG?.REQUIRE_AUTH_TOKEN ?? true);
}

function getRiskThresholdHigh() {
    return Number(window.CONFIG?.RISK_THRESHOLD_HIGH) || 70;
}

function getRiskThresholdMedium() {
    return Number(window.CONFIG?.RISK_THRESHOLD_MEDIUM) || 40;
}

function getCurrentFamilyID() {
    const input = document.getElementById("family-id-input");
    const inputValue = input ? normalizeDashboardFamilyID(input.value) : "";

    if (isValidFamilyID(inputValue)) return inputValue;
    if (isValidFamilyID(dashboardCurrentFamilyID)) return dashboardCurrentFamilyID;

    const localFamilyID = readFamilyIDFromLocalStorageOnly();
    return localFamilyID || "none";
}

function isValidFamilyID(familyID) {
    return /^[A-Z0-9]{6}$/.test(String(familyID || "").trim().toUpperCase());
}

function getRequestTimeoutMs() {
    // 【重要修正】強制回傳 60000 (60秒)，徹底無視 config.js 裡面的設定
    // 這樣才能給予 Render 免費伺服器足夠的喚醒時間，不會動不動就跳出 abort 錯誤
    return 60000;
}

function getPollingIntervalMs() {
    return Number(window.CONFIG?.POLLING_INTERVAL_MS || 5000) || 5000;
}

function normalizeDashboardFamilyID(value) {
    return String(value || "")
        .trim()
        .toUpperCase()
        .replace(/^AISHIELD:/, "")
        .replace(/^FAM-/, "")
        .replace(/[^A-Z0-9]/g, "")
        .slice(0, 6);
}

function pickValidFamilyIDFromObject(source = {}, keys = FAMILY_ID_STORAGE_KEYS) {
    const primary = normalizeDashboardFamilyID(source?.[FAMILY_ID_PRIMARY_KEY]);
    if (isValidFamilyID(primary)) return primary;

    const saved = normalizeDashboardFamilyID(source?.savedFamilyID);
    if (isValidFamilyID(saved)) return saved;

    for (const key of keys) {
        const normalized = normalizeDashboardFamilyID(source?.[key]);
        if (isValidFamilyID(normalized)) return normalized;
    }

    return "";
}

function readFamilyIDFromLocalStorageOnly() {
    try {
        const localValues = {};
        FAMILY_ID_STORAGE_KEYS.forEach(key => {
            localValues[key] = localStorage.getItem(key);
        });

        return pickValidFamilyIDFromObject(localValues);
    } catch (e) {
        return "";
    }
}

async function readSharedFamilyIDFromStorage() {
    let chromeFamilyID = "";

    try {
        const chromeValues = await getStorageValues(FAMILY_ID_STORAGE_KEYS);
        chromeFamilyID = pickValidFamilyIDFromObject(chromeValues);
    } catch (e) {
        chromeFamilyID = "";
    }

    if (chromeFamilyID) return chromeFamilyID;

    return readFamilyIDFromLocalStorageOnly();
}

async function saveSharedFamilyID(familyID) {
    const normalized = normalizeDashboardFamilyID(familyID);
    if (!isValidFamilyID(normalized)) return "";

    dashboardCurrentFamilyID = normalized;

    try {
        FAMILY_ID_WRITE_KEYS.forEach(key => {
            localStorage.setItem(key, normalized);
        });
        localStorage.setItem(FAMILY_ID_UPDATED_AT_KEY, new Date().toISOString());
        localStorage.setItem("aiShieldFamilyBindingSource", "dashboard-sync");
    } catch (e) {
        console.warn("家庭代碼寫入 localStorage 失敗：", e);
    }

    try {
        const payload = {
            [FAMILY_ID_UPDATED_AT_KEY]: new Date().toISOString(),
            aiShieldFamilyBindingSource: "dashboard-sync"
        };
        FAMILY_ID_WRITE_KEYS.forEach(key => {
            payload[key] = normalized;
        });
        await setStorageValues(payload);
    } catch (e) {
        console.warn("家庭代碼寫入 chrome.storage 失敗：", e);
    }

    return normalized;
}

async function clearSharedFamilyBinding(reason = "") {
    dashboardCurrentFamilyID = "";
    dashboardMembershipCache = { familyID: "", checkedAt: 0 };

    const keysToRemove = Array.from(new Set([
        ...FAMILY_ID_WRITE_KEYS,
        ...FAMILY_ID_STORAGE_KEYS,
        ...ACCESS_TOKEN_STORAGE_KEYS,
        getAccessTokenStorageKey(),
        getTokenExpiresAtStorageKey(),
        "accessToken",
        "aiShieldAccessToken",
        "aiShieldTokenExpiresAt",
        "aiShieldFamilyBindingSource",
        FAMILY_ID_UPDATED_AT_KEY
    ]));

    try {
        keysToRemove.forEach(key => localStorage.removeItem(key));
        if (reason) localStorage.setItem("aiShieldFamilyBindingLastClearReason", reason);
    } catch (e) {}

    try {
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
            await chrome.storage.local.remove(keysToRemove);
            if (reason) {
                await chrome.storage.local.set({ aiShieldFamilyBindingLastClearReason: reason });
            }
        }
    } catch (e) {
        console.warn("清除舊家庭綁定資料失敗：", e);
    }

    const input = document.getElementById("family-id-input");
    if (input) input.value = "";

    renderDashboard([]);
}

function shouldClearInvalidFamilyBinding(message) {
    return /不屬於此家庭|不是此家庭|not.*member|not.*family|invalid family|找不到此家庭|家庭.*不存在|邀請碼.*不存在/i.test(String(message || ""));
}

function setupFamilyIDStorageListener() {
    try {
        if (typeof chrome === "undefined" || !chrome.storage?.onChanged) return;

        chrome.storage.onChanged.addListener((changes, areaName) => {
            if (areaName !== "local") return;

            const touchedFamilyKey = FAMILY_ID_STORAGE_KEYS.some(key => Boolean(changes[key]));
            if (!touchedFamilyKey) return;

            readSharedFamilyIDFromStorage().then(nextFamilyID => {
                if (!isValidFamilyID(nextFamilyID)) return;
                if (nextFamilyID === dashboardCurrentFamilyID) return;

                applyFamilyIDToDashboard(nextFamilyID);
                stopSocket();
                setConnectionStatus(`待連線：${nextFamilyID}`, false);

                if (dashboardAutoConnectRequested) {
                    startSocket().catch(error => {
                        showToast(`戰情室自動連線失敗：${error.message}`, "error");
                    });
                } else {
                    fetchAlerts().catch(() => {});
                }
            }).catch(() => {});
        });
    } catch (e) {}
}

function getDashboardUrlOptions() {
    try {
        const params = new URLSearchParams(window.location.search || "");
        const familyID = normalizeDashboardFamilyID(params.get("familyID") || params.get("familyId") || params.get("fid") || "");
        const autoStartValue = String(params.get("autoStart") || params.get("autostart") || "").toLowerCase();

        const demoValue = String(params.get("demo") || params.get("dashboardDemo") || "").toLowerCase();
        const noDemoValue = String(params.get("noDemo") || params.get("disableDemo") || "").toLowerCase();

        return {
            familyID,
            autoStart: autoStartValue === "1" || autoStartValue === "true" || autoStartValue === "yes",
            demo: demoValue === "1" || demoValue === "true" || demoValue === "yes",
            noDemo: noDemoValue === "1" || noDemoValue === "true" || noDemoValue === "yes"
        };
    } catch (e) {
        return { familyID: "", autoStart: false, demo: false, noDemo: false };
    }
}

function shouldUseDashboardDemoFallback(urlOptions = getDashboardUrlOptions()) {
    if (urlOptions.noDemo) return false;
    if (urlOptions.demo) return true;

    try {
        if (localStorage.getItem(DASHBOARD_DEMO_MODE_KEY) === "1") return true;
    } catch (e) {}

    // 正式版預設不自動載入 Demo，避免重新安裝後一打開戰情室就看到舊測試資料。
    // 需要展示資料時，請手動按「載入 Demo 資料」，或網址加 ?demo=1。
    return false;
}

function getDemoFamilyID(urlOptions = getDashboardUrlOptions()) {
    const fromUrl = normalizeDashboardFamilyID(urlOptions.familyID || "");
    if (isValidFamilyID(fromUrl)) return fromUrl;

    const fromStorage = readFamilyIDFromLocalStorageOnly();
    if (isValidFamilyID(fromStorage)) return fromStorage;

    if (isValidFamilyID(dashboardCurrentFamilyID)) return dashboardCurrentFamilyID;

    return DASHBOARD_DEMO_FAMILY_ID;
}

function setDemoBannerVisible(visible, message = "") {
    const banner = document.getElementById("demo-data-banner");
    if (!banner) return;

    banner.style.display = visible ? "block" : "none";
    if (message) {
        banner.innerHTML = `🎬 <strong>決賽展示資料模式：</strong>${message}`;
    }
}

function createDemoDashboardRecords(familyID = getDemoFamilyID()) {
    const now = Date.now();

    const items = [
        {
            minutesAgo: 2,
            url: "https://parcel-pay.example.com/recheck",
            domain: "parcel-pay.example.com",
            riskScore: 92,
            riskLevel: "高風險",
            reason: "偵測到物流補繳、立即付款、信用卡資料輸入等高風險組合。",
            scamDNA: ["物流補繳", "立即付款", "信用卡資料", "釣魚連結"],
            advice: "請勿輸入信用卡或驗證碼，先回官方 App 或客服查證。"
        },
        {
            minutesAgo: 12,
            url: "https://line-invest-safe.example.net/join",
            domain: "line-invest-safe.example.net",
            riskScore: 78,
            riskLevel: "高風險",
            reason: "訊息引導加入投資群組，並出現老師帶單、保證獲利等詐騙話術。",
            scamDNA: ["投資群組", "老師帶單", "保證獲利", "高壓引導"],
            advice: "不要加入陌生投資群組，也不要依照對方指示轉帳或安裝 App。"
        },
        {
            minutesAgo: 25,
            url: "https://gov-check.example.org/account",
            domain: "gov-check.example.org",
            riskScore: 71,
            riskLevel: "高風險",
            reason: "偵測到假檢警常見語意：帳戶異常、洗錢調查、要求保密與監管帳戶。",
            scamDNA: ["假檢警", "帳戶凍結", "要求保密", "監管帳戶"],
            advice: "真正的警政或司法單位不會用通訊軟體要求匯款或交付帳戶資料。"
        },
        {
            minutesAgo: 44,
            url: "https://stock-info.example.com/lesson",
            domain: "stock-info.example.com",
            riskScore: 45,
            riskLevel: "中風險",
            reason: "內容涉及投資教學與群組引導，但尚未直接要求匯款，因此列為中風險觀察。",
            scamDNA: ["投資訊息", "加入群組", "風險待確認"],
            advice: "請先查證來源，不要提供個資，也不要下載陌生投資軟體。"
        },
        {
            minutesAgo: 63,
            url: "https://165.npa.gov.tw",
            domain: "165.npa.gov.tw",
            riskScore: 0,
            riskLevel: "低風險",
            reason: "官方防詐宣導與 165 反詐騙提醒，屬於可信安全資訊。",
            scamDNA: ["官方提醒", "防詐宣導", "白名單語境"],
            advice: "可作為查證參考來源。"
        },
        {
            minutesAgo: 81,
            url: "family-message://daily-chat",
            domain: "家人一般訊息",
            riskScore: 0,
            riskLevel: "低風險",
            reason: "一般生活對話未命中高風險詐騙組合，系統維持低風險判斷。",
            scamDNA: ["生活對話", "低風險"],
            advice: "維持正常溝通即可。"
        }
    ];

    return items.map((item, index) => {
        const timestamp = new Date(now - item.minutesAgo * 60 * 1000).toISOString();
        const report = {
            riskScore: item.riskScore,
            riskLevel: item.riskLevel,
            reason: item.reason,
            scamDNA: item.scamDNA,
            advice: item.advice,
            source: "dashboard-demo-fixed-dataset",
            familyID
        };

        return {
            timestamp,
            url: item.url,
            url_preview: item.url,
            domain: item.domain,
            familyID,
            evidenceID: "",
            report: JSON.stringify(report),
            demoRecord: true,
            id: `demo-dashboard-${index + 1}`
        };
    });
}

function renderDemoDashboard(reason = "後端目前沒有可顯示資料，已載入固定 Demo 掃描紀錄。") {
    const familyID = getDemoFamilyID();
    applyFamilyIDToDashboard(familyID, { persist: false });
    dashboardDemoDataActive = true;

    setDemoBannerVisible(true, `${reason} 目前家庭代碼：${familyID}`);
    setConnectionStatus(`🟡 Demo 展示資料｜${familyID}`, false);
    setDisplay("btn-start", "inline-flex");
    setDisplay("btn-stop", "none");

    dashboardLastSyncedAt = Date.now();
    renderDashboard(createDemoDashboardRecords(familyID));
}

function clearDemoDashboardState() {
    dashboardDemoDataActive = false;
    setDemoBannerVisible(false);
}


function isOpenedAsLocalFile() {
    return String(window.location?.protocol || "").toLowerCase() === "file:";
}

function shouldIgnoreStoredFamilyIDOnStartup(urlOptions = {}) {
    // 直接用檔案開啟 dashboard.html 時，不自動讀取之前存在 localStorage/chrome.storage 的家庭代碼。
    // 這樣測試檔案時欄位會保持空白；只有從 welcome/popup 帶 familyID 進來，或在擴充功能正式頁面開啟時，才自動沿用綁定代碼。
    return isOpenedAsLocalFile() && !isValidFamilyID(urlOptions.familyID);
}

function resetDashboardToBlankFamilyInput(message = "🔴 尚未綁定家庭代碼") {
    dashboardCurrentFamilyID = "";
    dashboardAutoConnectRequested = false;

    const input = document.getElementById("family-id-input");
    if (input) input.value = "";

    stopFallbackPolling();
    if (socket) {
        try { socket.disconnect(); } catch (e) {}
        socket = null;
    }

    setDisplay("btn-start", "inline-flex");
    setDisplay("btn-stop", "none");
    setConnectionStatus(message, false);
    renderDashboard([]);
    refreshLinePushTestToggle();
}

function chooseInitialFamilyID(storedFamilyID, urlFamilyID) {
    const stored = normalizeDashboardFamilyID(storedFamilyID);
    const fromUrl = normalizeDashboardFamilyID(urlFamilyID);

    if (isValidFamilyID(fromUrl)) return fromUrl;
    if (isValidFamilyID(stored)) return stored;
    return "";
}

function removeFamilyIDFromCurrentUrlIfNeeded(initialFamilyID, urlFamilyID) {
    const initial = normalizeDashboardFamilyID(initialFamilyID);
    const fromUrl = normalizeDashboardFamilyID(urlFamilyID);
    if (!initial || !fromUrl || initial === fromUrl) return;

    try {
        const url = new URL(window.location.href);
        ["familyID", "familyId", "fid"].forEach(key => url.searchParams.delete(key));
        window.history.replaceState({}, document.title, url.toString());
    } catch (e) {}
}

function applyFamilyIDToDashboard(familyID, options = {}) {
    const normalized = normalizeDashboardFamilyID(familyID);
    if (!isValidFamilyID(normalized)) return "";

    dashboardCurrentFamilyID = normalized;

    const input = document.getElementById("family-id-input");
    if (input && input.value !== normalized) input.value = normalized;

    if (options.persist !== false) {
        saveSharedFamilyID(normalized).catch(error => {
            console.warn("家庭代碼同步儲存失敗：", error);
        });
    }

    return normalized;
}

function hasRealSocketIOClient() {
    if (typeof io !== "function") return false;

    let source = "";
    try {
        source = Function.prototype.toString.call(io).toLowerCase();
    } catch (e) {}

    if (
        source.includes("client shim") ||
        source.includes("socket.io client shim") ||
        source.includes("handlers.connect_error") ||
        source.includes("即時通道未載入") ||
        source.includes("fallback")
    ) {
        return false;
    }

    if (typeof io.Manager === "function" || typeof io.Socket === "function" || io.protocol !== undefined) {
        return true;
    }

    return source.includes("manager") && source.includes("socket") && !source.includes("shim");
}

async function fetchWithTimeout(url, options = {}, timeoutMs = getRequestTimeoutMs()) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        return await fetch(url, {
            ...options,
            signal: options.signal || controller.signal
        });
    } finally {
        clearTimeout(timer);
    }
}

function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = String(text ?? "");
}

function setDisplay(id, display) {
    const el = document.getElementById(id);
    if (el) el.style.display = display;
}

function safeParseReport(rawReport) {
    try {
        if (typeof rawReport === "string") {
            return JSON.parse(rawReport);
        }

        if (rawReport && typeof rawReport === "object") {
            return rawReport;
        }
    } catch (e) {}

    return {
        riskScore: 0,
        reason: "解析失敗",
        scamDNA: [],
        riskLevel: "未知"
    };
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

function normalizeEvidenceImage(rawImage) {
    if (!rawImage) return "";

    if (rawImage.startsWith("http") || rawImage.startsWith("data:image")) {
        return rawImage;
    }

    return "data:image/jpeg;base64," + rawImage;
}

function truncateMiddle(text, maxLength = 64) {
    const value = String(text || "");

    if (value.length <= maxLength) return value;

    const head = Math.floor(maxLength * 0.58);
    const tail = maxLength - head - 3;

    return value.slice(0, head) + "..." + value.slice(-tail);
}

function formatTimestamp(value) {
    if (!value) return "--";

    try {
        const date = new Date(value);
        if (!Number.isNaN(date.getTime())) {
            return date.toLocaleString("zh-TW", {
                hour12: false
            });
        }
    } catch (e) {}

    return String(value);
}

function parseRecordTimestampMs(value) {
    if (!value) return 0;

    if (typeof value === "number") {
        return value > 1000000000000 ? value : value * 1000;
    }

    const raw = String(value || "").trim();
    if (!raw) return 0;

    const candidates = [
        raw,
        raw.replace(" ", "T"),
        raw.replace(/\//g, "-").replace(" ", "T")
    ];

    for (const candidate of candidates) {
        const parsed = Date.parse(candidate);
        if (!Number.isNaN(parsed)) return parsed;
    }

    return 0;
}

function getLocalClearMap() {
    try {
        const raw = localStorage.getItem(DASHBOARD_LOCAL_CLEAR_AFTER_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch (e) {
        return {};
    }
}

function getLocalClearAfter(familyID = getCurrentFamilyID()) {
    const fid = normalizeDashboardFamilyID(familyID);
    if (!fid) return 0;

    const map = getLocalClearMap();
    return Number(map[fid] || 0) || 0;
}

function setLocalClearAfter(familyID = getCurrentFamilyID(), timestamp = Date.now()) {
    const fid = normalizeDashboardFamilyID(familyID);
    if (!fid) return;

    const map = getLocalClearMap();
    map[fid] = Number(timestamp || Date.now());

    try {
        localStorage.setItem(DASHBOARD_LOCAL_CLEAR_AFTER_KEY, JSON.stringify(map));
    } catch (e) {
        console.warn("本機清除標記寫入失敗：", e);
    }
}

function clearLocalClearAfter(familyID = getCurrentFamilyID()) {
    const fid = normalizeDashboardFamilyID(familyID);
    if (!fid) return;

    const map = getLocalClearMap();
    delete map[fid];

    try {
        localStorage.setItem(DASHBOARD_LOCAL_CLEAR_AFTER_KEY, JSON.stringify(map));
    } catch (e) {
        console.warn("本機清除標記移除失敗：", e);
    }
}

function getLinePushTestModeMap() {
    try {
        const raw = localStorage.getItem(DASHBOARD_LINE_PUSH_TEST_MODE_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch (e) {
        return {};
    }
}

function isLinePushTestModeEnabled(familyID = getCurrentFamilyID()) {
    const fid = normalizeDashboardFamilyID(familyID);
    if (!fid) return false;
    return Boolean(getLinePushTestModeMap()[fid]);
}

function saveLinePushTestModeLocal(familyID = getCurrentFamilyID(), enabled = false) {
    const fid = normalizeDashboardFamilyID(familyID);
    if (!fid) return;

    const map = getLinePushTestModeMap();
    map[fid] = Boolean(enabled);

    try {
        localStorage.setItem(DASHBOARD_LINE_PUSH_TEST_MODE_KEY, JSON.stringify(map));
    } catch (e) {}

    try {
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
            chrome.storage.local.set({
                allowDemoLinePush: Boolean(enabled),
                allowLinePush: Boolean(enabled),
                aiShieldDemoLinePushEnabled: Boolean(enabled),
                aiShieldLinePushTestEnabled: Boolean(enabled),
                aiShieldAllowDemoLinePush: Boolean(enabled),
                aiShieldDashboardLinePushTestEnabled: Boolean(enabled),
                [DASHBOARD_LINE_PUSH_TEST_MODE_KEY]: map
            });
        }
    } catch (e) {}
}

function refreshLinePushTestToggle() {
    const checkbox = document.getElementById("line-push-test-toggle");
    const status = document.getElementById("line-push-test-status");
    if (!checkbox) return;

    const familyID = getCurrentFamilyID();
    const valid = isValidFamilyID(familyID);
    const enabled = valid && isLinePushTestModeEnabled(familyID);

    checkbox.checked = enabled;
    checkbox.disabled = !valid;

    if (status) {
        status.textContent = !valid
            ? "請先輸入家庭代碼"
            : enabled
                ? "已開啟：Demo 測試會真的傳 LINE"
                : "已關閉：Demo 測試只進戰情室，不傳 LINE";
    }
}

async function syncLinePushTestMode(enabled) {
    const familyID = getCurrentFamilyID();

    if (!isValidFamilyID(familyID)) {
        refreshLinePushTestToggle();
        showToast("請先輸入 6 碼家庭代碼。", "error");
        return;
    }

    // 這個開關只需要存在本機 chrome.storage，讓 background.js 掃描時帶 allowLinePush 給後端。
    // 不呼叫後端 /api/family/line_push_test_mode，避免該 API 不存在時 404 並把開關回滾。
    saveLinePushTestModeLocal(familyID, enabled);
    refreshLinePushTestToggle();

    showToast(Boolean(enabled) ? "展示時 LINE 推播已開啟。" : "展示時 LINE 推播已關閉。", "success");
}

function filterRecordsAfterLocalClear(records = [], familyID = getCurrentFamilyID()) {
    const clearAfter = getLocalClearAfter(familyID);
    if (!clearAfter) return Array.isArray(records) ? records : [];

    return (Array.isArray(records) ? records : []).filter(record => {
        const recordTime = parseRecordTimestampMs(record?.timestamp);
        if (!recordTime) return false;
        return recordTime > clearAfter;
    });
}

function isGuardianPermissionError(error) {
    const message = String(error?.message || error || "");
    return /權限|守護者|guardian|owner|403|401|Forbidden|Unauthorized/i.test(message);
}

function showToast(message, type = "info") {
    const oldToast = document.getElementById("dashboard-toast");
    if (oldToast) oldToast.remove();

    const toast = document.createElement("div");
    toast.id = "dashboard-toast";
    toast.textContent = String(message || "");

    const bgColor =
        type === "success"
            ? "linear-gradient(135deg, rgba(24,184,117,.96), rgba(65,216,141,.96))"
            : type === "error"
                ? "linear-gradient(135deg, rgba(255,90,112,.96), rgba(255,159,110,.96))"
                : "linear-gradient(135deg, rgba(37,158,232,.96), rgba(139,124,246,.96))";

    toast.style.cssText = `
        position: fixed;
        left: 50%;
        bottom: 28px;
        transform: translateX(-50%);
        max-width: 90vw;
        padding: 14px 20px;
        background: ${bgColor};
        color: #fff;
        font-size: 16px;
        font-weight: 800;
        line-height: 1.5;
        border-radius: 999px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.45);
        z-index: 2147483647;
        text-align: center;
    `;

    document.body.appendChild(toast);

    setTimeout(() => {
        toast.remove();
    }, 4000); // 顯示稍微久一點讓使用者看清楚
}


// ==========================================
// 親情關懷訊息：Caregiver Empathy
// ==========================================
function getWarmRiskType(record = {}) {
    const report = record?.report && typeof record.report === "object" ? record.report : safeParseReport(record?.report || {});
    const text = [report?.reason, report?.advice, Array.isArray(report?.scamDNA) ? report.scamDNA.join(" ") : "", getRecordDomain(record, report)].join(" ");

    if (/包裹|物流|宅配|海關|運費|通關/i.test(text)) return "假包裹或物流簡訊";
    if (/投資|股票|飆股|老師|VIP|USDT|虛擬貨幣|保證獲利/i.test(text)) return "假投資或投資群組";
    if (/檢察官|法院|警察|洗錢|監管|偵查/i.test(text)) return "假檢警或恐嚇話術";
    if (/客服|分期|ATM|扣款|訂單異常|退款/i.test(text)) return "假客服或解除分期";
    if (/中獎|獎金|領取|禮物|補助|津貼/i.test(text)) return "假中獎或補助領取";
    if (/親友|借錢|車禍|手術|換手機/i.test(text)) return "假親友急用錢";
    return "可疑網頁";
}

function getCaregiverTargetName() {
    try {
        const value = localStorage.getItem("aiShieldCaregiverTargetName") || "";
        if (value.trim()) return value.trim();
    } catch (e) {}
    // 不預設「媽」，避免爸爸、阿公阿嬤或其他家人收到時不自然。
    return "";
}

function buildCareGreeting(name = "") {
    const clean = String(name || "").trim();
    return clean ? `${clean}，` : "";
}

function buildCareMessageDraft(variantOffset = 0) {
    const records = Array.isArray(currentRecords) ? currentRecords : [];
    const high = getRiskThresholdHigh();
    const medium = getRiskThresholdMedium();
    const riskyRecords = records.filter(record => Number(record?.riskScore || 0) >= medium);
    const top = riskyRecords.find(record => Number(record?.riskScore || 0) >= high) || riskyRecords[0] || records[0] || null;
    const name = getCaregiverTargetName();
    const greeting = buildCareGreeting(name);

    const safeTemplates = [
        `${greeting}目前防詐盾牌沒有看到新的危險提醒，你可以放心。\n\n如果等一下收到不確定的連結或訊息，先不要急著按，傳給我看就好。`,
        `${greeting}目前看起來都正常，你安心使用。\n\n之後如果有人叫你點連結、輸入驗證碼或匯款，先停一下，直接問我就好。`,
        `${greeting}目前沒有新的高風險提醒，放心。\n\n有任何奇怪訊息不用自己判斷，傳給我，我幫你一起看。`
    ];

    if (!top) {
        const index = Math.abs(Number(variantOffset || 0)) % safeTemplates.length;
        return safeTemplates[index];
    }

    const report = top?.report && typeof top.report === "object" ? top.report : safeParseReport(top?.report || {});
    const riskType = getWarmRiskType(top);
    const score = Number(top?.riskScore || normalizeRiskScore(report) || 0);
    const isHighRisk = score >= high;

    const riskWord = isHighRisk ? "比較可疑" : "需要留意";

    const templates = [
        `${greeting}剛剛防詐盾牌提醒有一個${riskWord}的訊息，已經先幫你擋下來了。\n\n你不用緊張，也不是你做錯。之後看到要點連結、輸入驗證碼或匯款的訊息，先傳給我看就好。`,
        `${greeting}剛剛系統有提醒一個${riskType}，先不用擔心。\n\n你現在不用自己處理，也不要急著按任何連結。把畫面傳給我，我幫你確認就好。`,
        `${greeting}防詐盾牌剛剛有幫你注意到一個可疑狀況，幸好已經先提醒了。\n\n你只要記得：不急、不點、不給驗證碼；不確定就問我。`
    ];

    const index = Math.abs(Number(variantOffset || 0)) % templates.length;
    return templates[index];
}


async function copyDashboardText(text) {
    const value = String(text || "");
    if (!value) return false;
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(value);
            return true;
        }
    } catch (e) {}
    try {
        const textarea = document.createElement("textarea");
        textarea.value = value;
        textarea.setAttribute("readonly", "readonly");
        textarea.style.cssText = "position:fixed;left:-9999px;top:-9999px;opacity:0;";
        document.body.appendChild(textarea);
        textarea.select();
        const ok = document.execCommand("copy");
        textarea.remove();
        return ok;
    } catch (e) {
        return false;
    }
}

let careVariantIndex = 0;

function showCareMessageModal() {
    let draft = buildCareMessageDraft(careVariantIndex);
    const old = document.getElementById("care-message-modal");
    if (old) old.remove();

    const modal = document.createElement("div");
    modal.id = "care-message-modal";
    modal.style.cssText = "position:fixed;inset:0;background:rgba(15,23,42,.54);z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:18px;";

    const panel = document.createElement("div");
    panel.style.cssText = "width:min(760px,96vw);max-height:90vh;overflow:auto;background:#fff;border-radius:28px;padding:26px;box-shadow:0 24px 70px rgba(0,0,0,.28);border:2px solid rgba(219,39,119,.22);font-family:'Microsoft JhengHei',system-ui,sans-serif;color:#0f172a;";

    const title = document.createElement("h2");
    title.textContent = "💌 安心提醒訊息";
    title.style.cssText = "margin:0 0 10px;font-size:28px;font-weight:1000;color:#be185d;";

    const note = document.createElement("div");
    note.textContent = "這段話會盡量短一點，重點是讓家人安心，不製造恐慌。";
    note.style.cssText = "font-size:17px;line-height:1.7;color:#475569;font-weight:900;margin-bottom:14px;";

    const recipientRow = document.createElement("div");
    recipientRow.style.cssText = "display:flex;gap:10px;align-items:center;margin-bottom:12px;flex-wrap:wrap;";

    const recipientLabel = document.createElement("label");
    recipientLabel.textContent = "稱呼";
    recipientLabel.setAttribute("for", "care-recipient-input");
    recipientLabel.style.cssText = "font-size:16px;font-weight:1000;color:#475569;";

    const recipientInput = document.createElement("input");
    recipientInput.id = "care-recipient-input";
    recipientInput.type = "text";
    recipientInput.placeholder = "可填：爸、媽、阿嬤、家人";
    recipientInput.value = getCaregiverTargetName();
    recipientInput.style.cssText = "flex:1;min-width:180px;border:2px solid rgba(219,39,119,.22);border-radius:999px;padding:10px 14px;font-size:16px;font-weight:900;color:#0f172a;";

    recipientInput.addEventListener("input", () => {
        try {
            localStorage.setItem("aiShieldCaregiverTargetName", recipientInput.value.trim());
        } catch (e) {}

        draft = buildCareMessageDraft(careVariantIndex);
        textarea.value = draft;
    });

    recipientRow.append(recipientLabel, recipientInput);

    const textarea = document.createElement("textarea");
    textarea.value = draft;
    textarea.style.cssText = "width:100%;min-height:260px;border:2px solid rgba(219,39,119,.22);border-radius:18px;padding:16px;font-size:18px;line-height:1.7;color:#0f172a;background:#fff7fb;resize:vertical;box-sizing:border-box;";

    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:10px;flex-wrap:wrap;margin-top:14px;";

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.textContent = "分享給家人";
    copyBtn.style.cssText = "flex:1;min-width:190px;border:0;border-radius:999px;padding:14px 20px;background:#db2777;color:white;font-size:18px;font-weight:1000;cursor:pointer;";
    copyBtn.addEventListener("click", async () => {
        if (navigator.share) {
            try {
                await navigator.share({
                    title: "AI 防詐盾牌安心提醒",
                    text: textarea.value
                });
                showToast("已開啟分享功能。", "success");
                return;
            } catch (error) {
                // 使用者取消分享時，改走複製，不視為錯誤。
            }
        }

        const ok = await copyDashboardText(textarea.value);
        showToast(ok ? "已複製安心提醒，可貼到 LINE。" : "無法自動複製，請手動選取文字。", ok ? "success" : "error");
    });

    const regenerateBtn = document.createElement("button");
    regenerateBtn.type = "button";
    regenerateBtn.textContent = "換一句";
    regenerateBtn.style.cssText = "border:0;border-radius:999px;padding:14px 20px;background:#fce7f3;color:#9d174d;font-size:18px;font-weight:1000;cursor:pointer;";
    regenerateBtn.addEventListener("click", () => {
        careVariantIndex = (careVariantIndex + 1) % 3;
        textarea.value = buildCareMessageDraft(careVariantIndex);
    });

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.textContent = "關閉";
    closeBtn.style.cssText = "border:0;border-radius:999px;padding:14px 20px;background:#e2e8f0;color:#334155;font-size:18px;font-weight:1000;cursor:pointer;";
    closeBtn.addEventListener("click", () => modal.remove());

    row.appendChild(copyBtn);
    row.appendChild(regenerateBtn);
    row.appendChild(closeBtn);
    panel.appendChild(title);
    panel.appendChild(note);
    panel.appendChild(recipientRow);
    panel.appendChild(textarea);
    panel.appendChild(row);
    modal.appendChild(panel);
    modal.addEventListener("click", event => { if (event.target === modal) modal.remove(); });
    document.body.appendChild(modal);
}

// ==========================================
// 短效 Token
// ==========================================
async function getStorageValues(keys) {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
        return await chrome.storage.local.get(keys);
    }

    const result = {};
    keys.forEach(key => {
        result[key] = localStorage.getItem(key);
    });
    return result;
}

async function setStorageValues(values) {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
        await chrome.storage.local.set(values);
        return;
    }

    Object.entries(values).forEach(([key, value]) => {
        localStorage.setItem(key, String(value));
    });
}


async function resetDashboardLocalStateForFreshPackage() {
    // Chrome 載入「未封裝擴充功能」時，只要資料夾路徑相同，extension ID 通常相同，
    // chrome.storage.local / localStorage 不會因為重新覆蓋檔案而自動清空。
    // 這裡做一次正式版資料版本清理，避免新系統一打開仍看到 Yahoo、Demo、舊快照等測試資料。
    try {
        const currentLocalVersion = localStorage.getItem(DASHBOARD_CLEAN_INSTALL_VERSION_KEY);
        let currentChromeVersion = "";

        if (typeof chrome !== "undefined" && chrome.storage?.local) {
            const storage = await chrome.storage.local.get([DASHBOARD_CLEAN_INSTALL_VERSION_KEY]);
            currentChromeVersion = storage[DASHBOARD_CLEAN_INSTALL_VERSION_KEY] || "";
        }

        if (currentLocalVersion === DASHBOARD_CLEAN_INSTALL_VERSION && currentChromeVersion === DASHBOARD_CLEAN_INSTALL_VERSION) {
            return;
        }

        const keysToRemove = Array.from(new Set([
            DASHBOARD_DEMO_MODE_KEY,
            DASHBOARD_LOCAL_CLEAR_AFTER_KEY,
            "aiShieldUserReports",
            "aiShieldUserReportedDomains",
            "aiShieldFalsePositiveReviews",
            "userWhitelistDomains",
            "temporaryWhitelistDomains",
            "aiShieldEvidenceSnapshots",
            "aiShieldAutoScanRecords",
            "aiShieldDashboardRecords",
            "aiShieldDashboardDemoMode",
            "aiShieldPendingReports",
            "aiShieldLocalReports",
            "aiShieldInterceptLogs"
        ]));

        keysToRemove.forEach(key => {
            try { localStorage.removeItem(key); } catch (e) {}
        });

        localStorage.setItem(DASHBOARD_CLEAN_INSTALL_VERSION_KEY, DASHBOARD_CLEAN_INSTALL_VERSION);

        if (typeof chrome !== "undefined" && chrome.storage?.local) {
            await chrome.storage.local.remove(keysToRemove);
            await chrome.storage.local.set({
                [DASHBOARD_CLEAN_INSTALL_VERSION_KEY]: DASHBOARD_CLEAN_INSTALL_VERSION
            });
        }
    } catch (error) {
        console.warn("戰情室本機舊資料清理失敗：", error);
    }
}

async function ensureInstallIdentity(options = {}) {
    const tokenKey = getAccessTokenStorageKey();
    const installKey = getInstallIdStorageKey();
    const expiresKey = getTokenExpiresAtStorageKey();

    const storage = await getStorageValues([
        tokenKey,
        installKey,
        expiresKey,
        "userID",
        ...FAMILY_ID_STORAGE_KEYS,
        ...ACCESS_TOKEN_STORAGE_KEYS
    ]);

    let installID = storage[installKey];
    if (!installID) {
        installID = "ins_" + (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now());
        await setStorageValues({ [installKey]: installID });
    }

    let userID = storage.userID;
    if (!userID) {
        userID = "USER_" + Math.random().toString(36).slice(2, 11).toUpperCase();
        await setStorageValues({ userID });
    }

    const requestedFamilyID = normalizeDashboardFamilyID(options.familyID || getCurrentFamilyID());
    const familyID = isValidFamilyID(requestedFamilyID) ? requestedFamilyID : "";
    const storedFamilyID = pickValidFamilyIDFromObject(storage);

    const token = storage[tokenKey] || storage.aiShieldAccessToken || storage.accessToken || "";
    const expiresAt = Number(storage[expiresKey] || 0) * 1000;
    const refreshWindow = Number(window.CONFIG?.TOKEN_REFRESH_WINDOW_MS || 300000);
    const tokenStillValid = Boolean(token && expiresAt && expiresAt - Date.now() > refreshWindow);
    const familyMatchesTokenStorage = !familyID || !storedFamilyID || storedFamilyID === familyID;

    // 關鍵修正：如果家庭代碼改了，不能沿用舊 token；要重新向後端登錄 install 身分。
    if (!options.forceRefresh && tokenStillValid && familyMatchesTokenStorage) {
        const syncPayload = {
            [tokenKey]: token,
            aiShieldAccessToken: token,
            accessToken: token,
            userID,
            [FAMILY_ID_UPDATED_AT_KEY]: new Date().toISOString(),
            aiShieldFamilyBindingSource: "dashboard-token-sync"
        };

        if (familyID) {
            FAMILY_ID_WRITE_KEYS.forEach(key => {
                syncPayload[key] = familyID;
            });
        }

        await setStorageValues(syncPayload);
        return { accessToken: token, userID, installID, familyID: familyID || storedFamilyID || "" };
    }

    try {
        const requestBody = { installID, userID };
        if (familyID) requestBody.familyID = familyID;

        const response = await fetchWithTimeout(`${getApiBaseUrl()}/api/auth/install`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(requestBody)
        });

        let data = {};
        try { data = await response.json(); } catch (e) {}

        if (response.ok && data.accessToken) {
            const returnedFamilyID = normalizeDashboardFamilyID(data.familyID || data.familyId || familyID);
            const finalFamilyID = isValidFamilyID(returnedFamilyID) ? returnedFamilyID : familyID;

            const payload = {
                [tokenKey]: data.accessToken,
                aiShieldAccessToken: data.accessToken,
                accessToken: data.accessToken,
                [expiresKey]: data.expiresAt || data.expires_at || 0,
                userID: data.userID || data.userId || userID,
                [FAMILY_ID_UPDATED_AT_KEY]: new Date().toISOString(),
                aiShieldFamilyBindingSource: "dashboard-auth-token"
            };

            if (finalFamilyID) {
                FAMILY_ID_WRITE_KEYS.forEach(key => {
                    payload[key] = finalFamilyID;
                });
                dashboardCurrentFamilyID = finalFamilyID;
            }

            await setStorageValues(payload);

            return {
                accessToken: data.accessToken,
                userID: data.userID || data.userId || userID,
                installID,
                familyID: finalFamilyID
            };
        }

        console.warn("戰情室取得短效 token 失敗：", data.message || response.status);
    } catch (e) {
        console.warn("戰情室取得短效 token 失敗，請確認 API 是否可用。", e);
    }

    return { accessToken: token, userID, installID, familyID: familyID || storedFamilyID || "" };
}

async function getApiHeaders(options = {}) {
    const headers = { "Content-Type": "application/json" };
    const auth = await ensureInstallIdentity(options);

    if (auth.accessToken) headers.Authorization = `Bearer ${auth.accessToken}`;

    if (!auth.accessToken && isAuthRequired()) {
        throw new Error("尚未取得短效 accessToken，請先確認後端 API 可用，或重新綁定家庭群組。");
    }

    return headers;
}

let dashboardMembershipCache = {
    familyID: "",
    checkedAt: 0
};
let dashboardMembershipPromise = null;

function isFamilyMembershipMessage(message) {
    return /不屬於此家庭|不是此家庭|not.*family|not.*member|member|membership|403|401/i.test(String(message || ""));
}

async function ensureDashboardFamilyMembership(familyID, options = {}) {
    const normalizedFamilyID = normalizeDashboardFamilyID(familyID || getCurrentFamilyID());

    if (!isValidFamilyID(normalizedFamilyID)) {
        throw new Error("請先輸入 6 碼家庭邀請碼。");
    }

    const cacheAlive = dashboardMembershipCache.familyID === normalizedFamilyID &&
        Date.now() - dashboardMembershipCache.checkedAt < 60 * 1000;

    if (!options.force && cacheAlive) {
        return true;
    }

    if (dashboardMembershipPromise && !options.force) {
        return dashboardMembershipPromise;
    }

    dashboardMembershipPromise = (async () => {
        applyFamilyIDToDashboard(normalizedFamilyID, { persist: false });

        // 先重新簽發 token，避免「畫面有代碼，但 token 還屬於舊家庭」造成後端拒絕。
        const auth = await ensureInstallIdentity({
            familyID: normalizedFamilyID,
            forceRefresh: Boolean(options.force)
        });

        if (!auth.accessToken && isAuthRequired()) {
            throw new Error("尚未取得短效 accessToken，請重新開啟 welcome.html 完成家庭綁定。");
        }

        // 再要求後端把此 install/user 加入目前家庭。
        // 如果後端已經在 /api/auth/install 完成綁定，這支 API 回傳「已加入」或 404/405 都不阻斷戰情室。
        try {
            const response = await fetchWithTimeout(`${getApiBaseUrl()}/api/join_family`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(auth.accessToken ? { Authorization: `Bearer ${auth.accessToken}` } : {})
                },
                body: JSON.stringify({
                    familyID: normalizedFamilyID,
                    userID: auth.userID,
                    installID: auth.installID
                })
            });

            let data = {};
            try { data = await response.json(); } catch (e) {}

            const message = String(data.message || data.error || "");
            const returnedFamilyID = normalizeDashboardFamilyID(data.familyID || data.familyId || normalizedFamilyID);

            if (response.ok && (data.status === "success" || returnedFamilyID === normalizedFamilyID || !data.status)) {
                if (data.accessToken) {
                    const tokenKey = getAccessTokenStorageKey();
                    await setStorageValues({
                        [tokenKey]: data.accessToken,
                        aiShieldAccessToken: data.accessToken,
                        accessToken: data.accessToken,
                        [getTokenExpiresAtStorageKey()]: data.expiresAt || data.expires_at || 0,
                        userID: data.userID || data.userId || auth.userID
                    });
                }

                await saveSharedFamilyID(normalizedFamilyID);
                dashboardMembershipCache = { familyID: normalizedFamilyID, checkedAt: Date.now() };
                return true;
            }

            // 重要：如果 API 明確回「找不到家庭 / 邀請碼不存在」，不能當成 join_family 未啟用。
            // 這代表目前畫面上的代碼只是舊暫存或前端假代碼，必須清掉，回 welcome.html 重新建立正式家庭。
            if (/不存在|找不到|not found|invalid family|邀請碼/i.test(message)) {
                throw new Error(`這組家庭代碼 ${normalizedFamilyID} 沒有在後端建立，請回 welcome.html 重新建立家庭群組。`);
            }

            if (/已加入|already|member|屬於/.test(message)) {
                await saveSharedFamilyID(normalizedFamilyID);
                dashboardMembershipCache = { familyID: normalizedFamilyID, checkedAt: Date.now() };
                return true;
            }

            // 只有在後端沒有實作 /api/join_family（通常沒有 JSON message）時，才允許退回 /api/auth/install 的結果。
            if (response.status === 404 || response.status === 405) {
                console.warn("/api/join_family 端點未啟用，改以 /api/auth/install 綁定結果繼續。", response.status, message);
                dashboardMembershipCache = { familyID: normalizedFamilyID, checkedAt: Date.now() };
                return true;
            }

            throw new Error(message || `家庭綁定失敗 (${response.status})`);
        } catch (error) {
            if (/Failed to fetch|NetworkError|Load failed/i.test(String(error?.message || error))) {
                throw new Error("無法連到後端家庭綁定 API，請確認 Render 後端已啟動。");
            }
            throw error;
        }
    })();

    try {
        return await dashboardMembershipPromise;
    } finally {
        dashboardMembershipPromise = null;
    }
}

async function requestAlertsForFamily(familyID) {
    const response = await fetchWithTimeout(`${getApiBaseUrl()}/api/get_alerts`, {
        method: "POST",
        headers: await getApiHeaders({ familyID }),
        body: JSON.stringify({
            familyID
        })
    });

    let data = {};
    try { data = await response.json(); } catch (e) {}

    if (!response.ok || data.status !== "success") {
        throw new Error(data.message || `讀取戰情紀錄失敗 (${response.status})`);
    }

    return data;
}

// ==========================================
// 時鐘
// ==========================================
function startClock() {
    const updateClock = () => {
        const clock = document.getElementById("clock");

        if (clock) {
            clock.textContent = new Date().toLocaleTimeString("zh-TW", {
                hour12: false
            });
        }
    };

    updateClock();
    setInterval(updateClock, 1000);
}

// ==========================================
// 攔截事件詳情 Modal
// ==========================================
function getRecordReport(record) {
    return safeParseReport(record?.report || {});
}

function getRecordUrl(record, report = null) {
    const data = report || getRecordReport(record);
    return String(
        record?.url ||
        record?.url_preview ||
        data?.originalUrl ||
        data?.original_url ||
        data?.targetUrl ||
        data?.target_url ||
        data?.pageUrl ||
        data?.page_url ||
        data?.url ||
        record?.domain ||
        "未知網址"
    );
}

function getRecordDomain(record, report = null) {
    const data = report || getRecordReport(record);
    const explicitDomain = record?.domain || data?.domain || "";
    if (explicitDomain) return String(explicitDomain);

    try {
        return new URL(getRecordUrl(record, data)).hostname.replace(/^www\./, "");
    } catch (e) {
        return "無法解析";
    }
}

function createModalPill(text, kind = "neutral") {
    const pill = document.createElement("span");
    pill.textContent = String(text || "");
    const bg = kind === "danger"
        ? "rgba(255,77,79,.18)"
        : kind === "warn"
            ? "rgba(255,187,51,.16)"
            : kind === "safe"
                ? "rgba(0,200,81,.16)"
                : "rgba(139,148,158,.18)";
    const color = kind === "danger"
        ? "#ff7875"
        : kind === "warn"
            ? "#ffd666"
            : kind === "safe"
                ? "#73d13d"
                : "#c9d1d9";
    pill.style.cssText = `
        display:inline-flex;
        align-items:center;
        padding:6px 10px;
        border-radius:999px;
        background:${bg};
        color:${color};
        font-size:13px;
        font-weight:800;
        line-height:1.35;
        margin:3px 5px 3px 0;
    `;
    return pill;
}

function createModalInfoRow(label, value, options = {}) {
    const row = document.createElement("div");
    row.style.cssText = `
        display:grid;
        grid-template-columns:120px minmax(0, 1fr);
        gap:12px;
        padding:11px 0;
        border-bottom:1px solid rgba(139,148,158,.18);
        align-items:start;
    `;

    const labelEl = document.createElement("div");
    labelEl.textContent = String(label || "");
    labelEl.style.cssText = "color:#64748b;font-size:14px;font-weight:900;";

    const valueEl = document.createElement("div");
    valueEl.textContent = String(value || "--");
    valueEl.style.cssText = `
        color:${options.color || "#ffffff"};
        font-size:${options.large ? "18px" : "15px"};
        font-weight:${options.bold ? "900" : "700"};
        line-height:1.55;
        word-break:break-word;
        white-space:pre-wrap;
    `;

    row.appendChild(labelEl);
    row.appendChild(valueEl);
    return row;
}

function buildEvidenceStatus(record, evidenceData = {}, loadError = "") {
    if (loadError) return `證據讀取失敗：${loadError}`;
    if (evidenceData?.screenshot_base64 || evidenceData?.evidence_image_url) return "已保存完整證據截圖";
    if (record?.evidenceID || evidenceData?.evidenceID) return `已建立證據摘要（ID：${record?.evidenceID || evidenceData?.evidenceID}）`;
    return "已保存攔截摘要，未保存完整截圖";
}


function normalizeCommunityStatusLabel(status) {
    const value = String(status || "none").toLowerCase();
    const map = {
        none: "尚無回報",
        pending: "已收件｜待累積",
        watching: "觀察名單",
        community_flagged: "社群高風險觀察",
        approved: "社群確認高風險",
        rejected: "已駁回",
    };
    return map[value] || status || "未知";
}

function normalizeCommunityActionLabel(action) {
    const value = String(action || "none").toLowerCase();
    const map = {
        none: "無動作",
        collecting: "收集中",
        watchlist: "提高關注",
        raise_risk: "提高風險權重",
        confirmed: "可直接高風險攔截",
        manual_review_only: "高信任網域｜僅人工審核",
    };
    return map[value] || action || "未知";
}

function createCommunityStatusBox() {
    const box = document.createElement("div");
    box.id = "modal-community-status";
    box.style.cssText = "background:#fbfdff;border:1px solid rgba(91,120,150,.18);border-radius:18px;padding:16px;margin-bottom:16px;";

    const title = document.createElement("div");
    title.textContent = "社群防詐資料庫狀態";
    title.style.cssText = "color:#475467;font-size:15px;font-weight:1000;margin-bottom:10px;";

    const body = document.createElement("div");
    body.id = "modal-community-status-body";
    body.textContent = "正在查詢社群回報狀態...";
    body.style.cssText = "color:#64748b;font-size:14px;line-height:1.7;font-weight:800;";

    box.appendChild(title);
    box.appendChild(body);
    return { box, body };
}

function renderCommunityStatusBody(body, data, fallbackDomain = "") {
    if (!body) return;
    body.replaceChildren();

    const domain = data?.domain || fallbackDomain || "未知網域";
    const isReported = Boolean(data?.isReported || Number(data?.reportCount || 0) > 0);
    const reportCount = Number(data?.reportCount || 0);
    const reviewStatus = data?.reviewStatus || "none";
    const autoAction = data?.autoAction || "none";
    const highTrust = Boolean(data?.highTrustDomain);

    const summary = document.createElement("div");
    summary.style.cssText = "display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px;";
    summary.appendChild(createModalPill(`網域：${domain}`, "neutral"));
    summary.appendChild(createModalPill(`累積回報：${reportCount} 次`, reportCount >= 5 ? "danger" : reportCount >= 2 ? "warn" : "neutral"));
    summary.appendChild(createModalPill(normalizeCommunityStatusLabel(reviewStatus), reviewStatus === "approved" || reviewStatus === "community_flagged" ? "danger" : reviewStatus === "watching" ? "warn" : "neutral"));
    if (highTrust) summary.appendChild(createModalPill("高信任網域：需人工審核", "warn"));

    const note = document.createElement("div");
    note.style.cssText = "color:#475467;font-size:14px;line-height:1.7;";
    if (!isReported) {
        note.textContent = "目前社群資料庫尚未累積此網域的回報。若你確認這是詐騙，可送出回報；系統不會因單一回報直接封鎖全平台。";
    } else {
        note.textContent = `目前狀態：${normalizeCommunityStatusLabel(reviewStatus)}；系統動作：${normalizeCommunityActionLabel(autoAction)}。多人回報與高風險分數達門檻後，才會提高全域風險判斷。`;
    }

    body.appendChild(summary);
    body.appendChild(note);
}

async function fetchCommunityStatusForDomain(domainOrUrl) {
    const domain = String(domainOrUrl || "").trim();
    if (!domain || domain === "未知網址" || domain === "無法解析") {
        return { status: "fail", message: "無法解析網域" };
    }

    const response = await fetchWithTimeout(`${getApiBaseUrl()}/api/community/domain_status`, {
        method: "POST",
        headers: await getApiHeaders(),
        body: JSON.stringify({ domain })
    });

    let data = {};
    try { data = await response.json(); } catch (e) {}

    if (!response.ok || data.status !== "success") {
        throw new Error(data.message || `社群狀態查詢失敗 (${response.status})`);
    }

    return data;
}

async function reportCommunityScamFromRecord(record = {}, button = null) {
    const report = getRecordReport(record);
    const url = getRecordUrl(record, report);
    const domain = getRecordDomain(record, report);
    const familyID = getCurrentFamilyID();

    if (!url || url === "未知網址") {
        showToast("找不到可回報的網址。", "error");
        return null;
    }

    if (button) {
        button.disabled = true;
        button.textContent = "正在送出社群回報...";
        button.style.opacity = "0.68";
    }

    try {
        const response = await fetchWithTimeout(`${getApiBaseUrl()}/api/report_scam`, {
            method: "POST",
            headers: await getApiHeaders(),
            body: JSON.stringify({
                url,
                domain,
                familyID,
                riskScore: normalizeRiskScore(report || record),
                riskLevel: report.riskLevel || record.riskLevel || "",
                ai_reason: report.reason || record.reason || "",
                reason: report.reason || record.reason || "",
                reported_reason: "戰情室使用者確認此紀錄疑似詐騙，送入社群防詐回報池",
                scamDNA: Array.isArray(report.scamDNA) ? report.scamDNA : [],
                action_type: "dashboard_confirmed_scam"
            })
        });

        let data = {};
        try { data = await response.json(); } catch (e) {}

        if (!response.ok || data.status !== "success") {
            throw new Error(data.message || `社群回報失敗 (${response.status})`);
        }

        showToast(`已送入社群防詐資料庫：${data.domain || domain}`, "success");

        if (button) {
            button.textContent = `已回報｜累積 ${data.reportCount || 1} 次`;
            button.disabled = true;
            button.style.opacity = "0.8";
        }

        return data;
    } catch (error) {
        showToast(`社群回報失敗：${error.message}`, "error");

        if (button) {
            button.disabled = false;
            button.textContent = "回報到社群防詐資料庫";
            button.style.opacity = "1";
        }

        return null;
    }
}

function createModalActionButton(label, variant = "neutral") {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;

    const danger = variant === "danger";
    button.style.cssText = `
        padding:11px 14px;
        border-radius:12px;
        border:1px solid ${danger ? "rgba(255,90,112,.28)" : "rgba(37,158,232,.24)"};
        background:${danger ? "#fff3f5" : "#e7f6ff"};
        color:${danger ? "#d64058" : "#1677b8"};
        font-size:14px;
        font-weight:900;
        cursor:pointer;
    `;

    return button;
}

function showInterceptDetailModal(record = {}, evidenceData = {}, loadError = "") {
    const oldModal = document.getElementById("ai-evidence-modal");
    if (oldModal) oldModal.remove();

    const report = getRecordReport(record);
    const score = normalizeRiskScore(report || record);
    const url = getRecordUrl(record, report);
    const domain = getRecordDomain(record, report);
    const reason = report.reason || record.reason || evidenceData?.reason || "未提供攔截原因";
    const advice = report.advice || "請勿輸入個資、驗證碼、信用卡，也不要依照頁面指示匯款。";
    const scamDNA = Array.isArray(report.scamDNA) ? report.scamDNA : [];
    const riskLevel = report.riskLevel || record.riskLevel || (score >= getRiskThresholdHigh() ? "高風險" : score >= getRiskThresholdMedium() ? "中風險" : "低風險");
    const familyID = record.familyID || report.familyID || getCurrentFamilyID();
    const source = report.source || report.winningEngine || report.engine || record.source || "dashboard-record";
    const timestamp = record.timestamp || report.timestamp || evidenceData?.timestamp || "";
    const imageUrl = normalizeEvidenceImage(evidenceData?.evidence_image_url || evidenceData?.screenshot_base64 || "");
    const evidenceStatus = buildEvidenceStatus(record, evidenceData, loadError);

    const modal = document.createElement("div");
    modal.id = "ai-evidence-modal";
    modal.style.cssText = `
        position:fixed;
        inset:0;
        background:rgba(52,64,84,0.34);
        color:#233044;
        display:flex;
        align-items:center;
        justify-content:center;
        z-index:2147483647;
        font-family:'Microsoft JhengHei', system-ui, sans-serif;
        backdrop-filter:blur(10px);
        padding:24px;
        box-sizing:border-box;
    `;

    const panel = document.createElement("div");
    panel.style.cssText = `
        position:relative;
        width:min(1080px, 96vw);
        max-height:92vh;
        overflow:auto;
        background:#ffffff;
        border:1px solid rgba(91,120,150,.18);
        border-radius:24px;
        box-shadow:0 24px 80px rgba(69,93,122,.24);
        padding:26px;
    `;

    const closeBtn = document.createElement("button");
    closeBtn.id = "close-evidence-modal";
    closeBtn.type = "button";
    closeBtn.textContent = "×";
    closeBtn.style.cssText = `
        position:sticky;
        top:0;
        float:right;
        width:42px;
        height:42px;
        border-radius:50%;
        border:0;
        background:#fff0f5;
        color:#d64058;
        font-size:28px;
        font-weight:900;
        cursor:pointer;
        z-index:2;
    `;

    const title = document.createElement("div");
    title.textContent = "【AI 防詐盾牌｜攔截事件詳情】";
    title.style.cssText = "color:#d64058;font-size:24px;font-weight:1000;margin:4px 52px 8px 0;";

    const subtitle = document.createElement("div");
    subtitle.textContent = "這裡會說明攔截了哪個網址、為什麼攔截、是否已同步家庭戰情室，以及目前保存了哪些證據。";
    subtitle.style.cssText = "color:#475467;font-size:15px;line-height:1.7;margin-bottom:18px;";

    const topGrid = document.createElement("div");
    topGrid.style.cssText = "display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:16px;";

    const scoreCard = document.createElement("div");
    scoreCard.style.cssText = "background:#fff3f5;border:1px solid rgba(255,90,112,.20);border-radius:18px;padding:16px;";
    const scoreLabel = document.createElement("div");
    scoreLabel.textContent = "風險分數";
    scoreLabel.style.cssText = "color:#b4233a;font-size:13px;font-weight:900;";
    const scoreValue = document.createElement("div");
    scoreValue.textContent = `${score} / 100`;
    scoreValue.style.cssText = "color:#ff5a70;font-size:30px;font-weight:1000;margin-top:4px;";
    scoreCard.appendChild(scoreLabel);
    scoreCard.appendChild(scoreValue);

    const levelCard = document.createElement("div");
    levelCard.style.cssText = "background:#fff7df;border:1px solid rgba(246,166,35,.24);border-radius:18px;padding:16px;";
    const levelLabel = document.createElement("div");
    levelLabel.textContent = "風險等級";
    levelLabel.style.cssText = "color:#946200;font-size:13px;font-weight:900;";
    const levelValue = document.createElement("div");
    levelValue.textContent = riskLevel;
    levelValue.style.cssText = "color:#c47c00;font-size:24px;font-weight:1000;margin-top:7px;";
    levelCard.appendChild(levelLabel);
    levelCard.appendChild(levelValue);

    const syncCard = document.createElement("div");
    syncCard.style.cssText = "background:#e7f6ff;border:1px solid rgba(37,158,232,.24);border-radius:18px;padding:16px;";
    const syncLabel = document.createElement("div");
    syncLabel.textContent = "家庭同步";
    syncLabel.style.cssText = "color:#1677b8;font-size:13px;font-weight:900;";
    const syncValue = document.createElement("div");
    syncValue.textContent = familyID && familyID !== "none" ? `已綁定 ${familyID}` : "未綁定家庭";
    syncValue.style.cssText = "color:#259ee8;font-size:20px;font-weight:1000;margin-top:8px;";
    syncCard.appendChild(syncLabel);
    syncCard.appendChild(syncValue);

    topGrid.appendChild(scoreCard);
    topGrid.appendChild(levelCard);
    topGrid.appendChild(syncCard);

    const infoBox = document.createElement("div");
    infoBox.style.cssText = "background:#fbfdff;border:1px solid rgba(91,120,150,.18);border-radius:18px;padding:16px;margin-bottom:16px;";
    infoBox.appendChild(createModalInfoRow("攔截網址", url, { bold: true }));
    infoBox.appendChild(createModalInfoRow("網域", domain));
    infoBox.appendChild(createModalInfoRow("攔截原因", reason, { color: "#ffd8d8", bold: true, large: true }));
    infoBox.appendChild(createModalInfoRow("建議動作", advice, { color: "#d2f8d2" }));
    infoBox.appendChild(createModalInfoRow("判定來源", source));
    infoBox.appendChild(createModalInfoRow("發生時間", formatTimestamp(timestamp)));
    infoBox.appendChild(createModalInfoRow("證據狀態", evidenceStatus, { color: imageUrl ? "#73d13d" : "#ffd666", bold: true }));

    const dnaBox = document.createElement("div");
    dnaBox.style.cssText = "background:#fbfdff;border:1px solid rgba(91,120,150,.18);border-radius:18px;padding:16px;margin-bottom:16px;";
    const dnaTitle = document.createElement("div");
    dnaTitle.textContent = "命中詐騙特徵";
    dnaTitle.style.cssText = "color:#475467;font-size:15px;font-weight:1000;margin-bottom:10px;";
    dnaBox.appendChild(dnaTitle);
    if (scamDNA.length) {
        scamDNA.forEach(tag => dnaBox.appendChild(createModalPill(tag, score >= getRiskThresholdHigh() ? "danger" : "warn")));
    } else {
        dnaBox.appendChild(createModalPill("未提供明確標籤", "neutral"));
    }

    const { box: communityStatusBox, body: communityStatusBody } = createCommunityStatusBox();
    fetchCommunityStatusForDomain(domain)
        .then(data => renderCommunityStatusBody(communityStatusBody, data, domain))
        .catch(error => {
            if (communityStatusBody) {
                communityStatusBody.textContent = `社群狀態查詢失敗：${error.message}`;
                communityStatusBody.style.color = "#ffd666";
            }
        });

    const actionBox = document.createElement("div");
    actionBox.style.cssText = "background:#fbfdff;border:1px solid rgba(91,120,150,.18);border-radius:18px;padding:16px;margin-bottom:16px;";

    const actionTitle = document.createElement("div");
    actionTitle.textContent = "後續處理";
    actionTitle.style.cssText = "color:#475467;font-size:15px;font-weight:1000;margin-bottom:10px;";

    const actionNote = document.createElement("div");
    actionNote.textContent = "確認這是詐騙時，可送入社群防詐回報池。系統會累積多方回報，達門檻才提高全域風險，不會因單一回報直接封鎖全平台。";
    actionNote.style.cssText = "color:#64748b;font-size:13px;line-height:1.65;margin-bottom:12px;";

    const communityReportBtn = createModalActionButton("回報到社群防詐資料庫", "danger");
    communityReportBtn.addEventListener("click", async () => {
        const data = await reportCommunityScamFromRecord(record, communityReportBtn);
        if (data) {
            renderCommunityStatusBody(communityStatusBody, {
                status: "success",
                domain: data.domain || domain,
                isReported: true,
                reportCount: data.reportCount || 1,
                reviewStatus: data.reviewStatus || "pending",
                autoAction: data.autoAction || "collecting",
                highTrustDomain: Boolean(data.highTrustDomain)
            }, domain);
        }
    });

    actionBox.appendChild(actionTitle);
    actionBox.appendChild(actionNote);
    actionBox.appendChild(communityReportBtn);

    const evidenceBox = document.createElement("div");
    evidenceBox.style.cssText = "background:#fbfdff;border:1px solid rgba(91,120,150,.18);border-radius:18px;padding:16px;";
    const evidenceTitle = document.createElement("div");
    evidenceTitle.textContent = "證據快照";
    evidenceTitle.style.cssText = "color:#475467;font-size:15px;font-weight:1000;margin-bottom:10px;";
    evidenceBox.appendChild(evidenceTitle);

    if (imageUrl) {
        const img = document.createElement("img");
        img.src = imageUrl;
        img.alt = "詐騙網頁證據快照";
        img.style.cssText = "width:100%;max-height:58vh;object-fit:contain;border:3px solid #ffb3c1;border-radius:14px;background:#fff;";
        evidenceBox.appendChild(img);

        if (evidenceData?.source === "local_snapshot" || evidenceData?.screenshot_base64) {
            const exportRow = document.createElement("div");
            exportRow.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px;";

            const exportFull = createModalActionButton("匯出報案版", "primary");
            exportFull.addEventListener("click", () => {
                const snapshot = {
                    imageData: evidenceData.screenshot_base64 || evidenceData.evidence_image_url,
                    url: evidenceData.url || getRecordUrl(record, report),
                    capturedAt: evidenceData.timestamp || record.timestamp,
                    riskScore: record.riskScore || report.riskScore || 0,
                    riskLevel: record.riskLevel || "",
                    reason: evidenceData.reason || reason
                };
                exportLocalEvidenceSnapshot(snapshot, false);
            });

            const exportMasked = createModalActionButton("匯出遮罩版", "secondary");
            exportMasked.addEventListener("click", () => {
                const snapshot = {
                    imageData: evidenceData.screenshot_base64 || evidenceData.evidence_image_url,
                    url: evidenceData.url || getRecordUrl(record, report),
                    capturedAt: evidenceData.timestamp || record.timestamp,
                    riskScore: record.riskScore || report.riskScore || 0,
                    riskLevel: record.riskLevel || "",
                    reason: evidenceData.reason || reason
                };
                exportLocalEvidenceSnapshot(snapshot, true);
            });

            exportRow.appendChild(exportFull);
            exportRow.appendChild(exportMasked);
            evidenceBox.appendChild(exportRow);
        }
    } else {
        const empty = document.createElement("div");
        empty.textContent = loadError
            ? `目前無法讀取完整截圖，但攔截摘要仍保留在戰情室。${loadError}`
            : "此筆紀錄目前只保存摘要，未保存完整截圖。這是正式版較安全的隱私預設；仍可從上方確認網址、原因、分數與詐騙特徵。";
        empty.style.cssText = "padding:28px;border:2px dashed rgba(139,148,158,.35);border-radius:14px;color:#475467;text-align:center;line-height:1.7;background:#ffffff;";
        evidenceBox.appendChild(empty);
    }

    const footer = document.createElement("div");
    footer.textContent = familyID && familyID !== "none"
        ? `同步說明：此家庭代碼為 ${familyID}。若後端連線正常，掃描紀錄會出現在家庭戰情室。`
        : "同步說明：目前未綁定家庭代碼，因此只會顯示本機攔截資訊。";
    footer.style.cssText = "color:#64748b;font-size:13px;line-height:1.7;margin-top:14px;text-align:center;";

    panel.appendChild(closeBtn);
    panel.appendChild(title);
    panel.appendChild(subtitle);
    panel.appendChild(topGrid);
    panel.appendChild(infoBox);
    panel.appendChild(dnaBox);
    panel.appendChild(communityStatusBox);
    panel.appendChild(actionBox);

    const bottomCloseBtn = createModalActionButton("返回上一頁", "secondary");
    bottomCloseBtn.style.cssText += "width:100%;min-height:58px;margin-top:16px;font-size:20px;border-radius:18px;";
    bottomCloseBtn.addEventListener("click", () => modal.remove());

    panel.appendChild(evidenceBox);
    panel.appendChild(bottomCloseBtn);
    panel.appendChild(footer);
    modal.appendChild(panel);
    document.body.appendChild(modal);

    closeBtn.addEventListener("click", () => modal.remove());
    modal.addEventListener("click", event => {
        if (event.target === modal) modal.remove();
    });
    document.addEventListener("keydown", event => {
        if (event.key === "Escape") modal.remove();
    }, { once: true });
}

async function openEvidence(record) {
    const familyID = getCurrentFamilyID();
    const evidenceID = record?.evidenceID;
    const localSnapshot = findLocalEvidenceSnapshotForRecord(record);

    if (!evidenceID) {
        if (localSnapshot) {
            showInterceptDetailModal(record, buildEvidenceDataFromLocalSnapshot(localSnapshot), "");
            return;
        }

        showInterceptDetailModal(record, {}, "");
        return;
    }

    try {
        const response = await fetchWithTimeout(`${getApiBaseUrl()}/api/get_evidence`, {
            method: "POST",
            headers: await getApiHeaders(),
            body: JSON.stringify({
                familyID,
                evidenceID
            })
        });

        let data = {};
        try { data = await response.json(); } catch (e) {}

        if (!response.ok || data.status !== "success") {
            if (localSnapshot) {
                showInterceptDetailModal(record, buildEvidenceDataFromLocalSnapshot(localSnapshot), "");
                return;
            }

            showInterceptDetailModal(record, { evidenceID }, data.message || "找不到對應的證據快照。仍顯示攔截摘要。");
            return;
        }

        showInterceptDetailModal(record, {
            ...data,
            evidenceID
        });
    } catch (error) {
        if (localSnapshot) {
            showInterceptDetailModal(record, buildEvidenceDataFromLocalSnapshot(localSnapshot), "");
            return;
        }

        showInterceptDetailModal(record, { evidenceID }, error.message || "讀取證據失敗");
    }
}

// ==========================================
// 圖表 fallback：Chart.js 未載入時也不能讓戰情室空白
// ==========================================
function removeChartFallbacks() {
    document.querySelectorAll(".chart-fallback").forEach(el => el.remove());
    document.querySelectorAll("canvas").forEach(canvas => {
        canvas.style.display = "";
    });
}

function renderFallbackChart(container, rows = []) {
    if (!container) return;

    const old = container.querySelector(".chart-fallback");
    if (old) old.remove();

    const wrapper = document.createElement("div");
    wrapper.className = "chart-fallback";

    rows.forEach(row => {
        const line = document.createElement("div");
        line.className = "chart-fallback-row";

        const label = document.createElement("div");
        label.textContent = row.label;

        const track = document.createElement("div");
        track.className = "chart-fallback-track";

        const fill = document.createElement("div");
        fill.className = "chart-fallback-fill";
        fill.style.width = `${Math.max(0, Math.min(100, row.percent || 0))}%`;
        fill.style.background = row.color || "#1976d2";

        const value = document.createElement("div");
        value.textContent = String(row.value ?? "");

        track.appendChild(fill);
        line.appendChild(label);
        line.appendChild(track);
        line.appendChild(value);
        wrapper.appendChild(line);
    });

    container.appendChild(wrapper);
}

function renderChartsFallback(records) {
    const high = getRiskThresholdHigh();
    const medium = getRiskThresholdMedium();

    const safeCount = records.filter(record => record.riskScore < medium).length;
    const mediumCount = records.filter(record => record.riskScore >= medium && record.riskScore < high).length;
    const dangerCount = records.filter(record => record.riskScore >= high).length;
    const total = Math.max(records.length, 1);

    const ratioCanvas = document.getElementById("ratioChart");
    const trendCanvas = document.getElementById("trendChart");

    if (ratioCanvas) ratioCanvas.style.display = "none";
    if (trendCanvas) trendCanvas.style.display = "none";

    renderFallbackChart(ratioCanvas?.closest(".chart-container"), [
        { label: "安全", value: safeCount, percent: safeCount / total * 100, color: "#16a34a" },
        { label: "中風險", value: mediumCount, percent: mediumCount / total * 100, color: "#d99a2b" },
        { label: "高風險", value: dangerCount, percent: dangerCount / total * 100, color: "#dc2626" }
    ]);

    const lastRecords = records.slice().reverse().slice(-6);
    renderFallbackChart(trendCanvas?.closest(".chart-container"), lastRecords.map((record, index) => ({
        label: `#${index + 1}`,
        value: record.riskScore,
        percent: record.riskScore,
        color: record.riskScore >= high ? "#dc2626" : record.riskScore >= medium ? "#d99a2b" : "#16a34a"
    })));
}

// ==========================================
// 圖表
// ==========================================
function destroyCharts() {
    if (ratioChartInstance) {
        ratioChartInstance.destroy();
        ratioChartInstance = null;
    }

    if (trendChartInstance) {
        trendChartInstance.destroy();
        trendChartInstance = null;
    }
}

function renderCharts(records) {
    const ratioCanvas = document.getElementById("ratioChart");
    const trendCanvas = document.getElementById("trendChart");

    if (!ratioCanvas || !trendCanvas) {
        return;
    }

    if (typeof Chart === "undefined") {
        renderChartsFallback(records);
        return;
    }

    removeChartFallbacks();

    const high = getRiskThresholdHigh();
    const medium = getRiskThresholdMedium();

    const safeCount = records.filter(record => record.riskScore < medium).length;
    const mediumCount = records.filter(
        record => record.riskScore >= medium && record.riskScore < high
    ).length;
    const dangerCount = records.filter(record => record.riskScore >= high).length;

    const trendLabels = records
        .slice()
        .reverse()
        .slice(-12)
        .map(record => {
            const raw = record.timestamp || "";
            return raw ? String(raw).slice(11, 19) : "--";
        });

    const trendValues = records
        .slice()
        .reverse()
        .slice(-12)
        .map(record => record.riskScore);

    destroyCharts();

    ratioChartInstance = new Chart(ratioCanvas, {
        type: "doughnut",
        data: {
            labels: ["安全放行", "中度警示", "危險攔截"],
            datasets: [
                {
                    data: [safeCount, mediumCount, dangerCount]
                }
            ]
        },
        options: {
            responsive: true,
            plugins: {
                legend: {
                    labels: {
                        color: "#334155",
                        font: {
                            size: 14,
                            weight: "bold"
                        }
                    }
                }
            }
        }
    });

    trendChartInstance = new Chart(trendCanvas, {
        type: "line",
        data: {
            labels: trendLabels,
            datasets: [
                {
                    label: "危險指數",
                    data: trendValues,
                    tension: 0.35,
                    fill: false
                }
            ]
        },
        options: {
            responsive: true,
            scales: {
                x: {
                    ticks: {
                        color: "#64748b"
                    },
                    grid: {
                        color: "rgba(100,116,139,0.16)"
                    }
                },
                y: {
                    min: 0,
                    max: 100,
                    ticks: {
                        color: "#64748b"
                    },
                    grid: {
                        color: "rgba(100,116,139,0.16)"
                    }
                }
            },
            plugins: {
                legend: {
                    labels: {
                        color: "#334155",
                        font: {
                            size: 14,
                            weight: "bold"
                        }
                    }
                }
            }
        }
    });
}


// ==========================================
// v43：本機證據快照整合到「詳細掃描紀錄」
// 說明：不新增獨立版面；快照只出現在每筆掃描紀錄的「查看詳情 / 證據」裡。
// ==========================================
const LOCAL_EVIDENCE_SNAPSHOT_KEY = "aiShieldEvidenceSnapshots";
let localEvidenceSnapshotsCache = [];

function normalizeEvidenceUrl(value = "") {
    return String(value || "")
        .trim()
        .replace(/^https?:\/\//i, "")
        .replace(/^www\./i, "")
        .replace(/[?#].*$/, "")
        .replace(/\/+$/, "")
        .toLowerCase();
}

function getEvidenceUrlHost(value = "") {
    try {
        const raw = String(value || "").trim();
        if (!raw) return "";

        const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
        return new URL(withScheme).hostname.replace(/^www\./i, "").toLowerCase();
    } catch (e) {
        const normalized = normalizeEvidenceUrl(value);
        return normalized.split("/")[0] || "";
    }
}

function getEvidenceRecordID(record = {}) {
    return String(
        record.id ||
        record.recordID ||
        record.recordId ||
        record.scanRecordID ||
        record.scan_id ||
        ""
    );
}

function getEvidenceSnapshotRecordID(snapshot = {}) {
    return String(
        snapshot.recordID ||
        snapshot.recordId ||
        snapshot.scanRecordID ||
        snapshot.scan_id ||
        snapshot.relatedRecordID ||
        ""
    );
}

function isSameEvidenceUrl(recordUrl = "", snapshotUrl = "") {
    const a = normalizeEvidenceUrl(recordUrl);
    const b = normalizeEvidenceUrl(snapshotUrl);

    if (!a || !b) return false;
    if (a === b) return true;

    // 允許只差首頁斜線、query、hash；不允許不同網域只靠時間配對。
    const aHost = getEvidenceUrlHost(recordUrl);
    const bHost = getEvidenceUrlHost(snapshotUrl);
    if (!aHost || !bHost || aHost !== bHost) return false;

    const aPath = a.replace(aHost, "").replace(/^\/+/, "").replace(/\/+$/, "");
    const bPath = b.replace(bHost, "").replace(/^\/+/, "").replace(/\/+$/, "");

    // 若其中一方只有網域，另一方是同網域首頁，視為同一頁；其他不同路徑不可混配。
    if (!aPath && !bPath) return true;
    if (!aPath && ["", "index.html", "index.htm"].includes(bPath)) return true;
    if (!bPath && ["", "index.html", "index.htm"].includes(aPath)) return true;

    return aPath === bPath;
}

function isSameEvidenceHost(recordUrl = "", snapshotUrl = "") {
    const aHost = getEvidenceUrlHost(recordUrl);
    const bHost = getEvidenceUrlHost(snapshotUrl);
    return Boolean(aHost && bHost && aHost === bHost);
}


function getLocalEvidenceRecordUrl(record = {}) {
    const report = safeParseReport(record.report);
    return String(
        record.url ||
        record.url_preview ||
        record.targetUrl ||
        record.pageUrl ||
        record.domain ||
        report.originalUrl ||
        report.original_url ||
        report.url ||
        ""
    );
}

function getLocalEvidenceTimestampMs(value = "") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeLocalEvidenceSnapshot(raw = {}) {
    const score = Number(raw.riskScore ?? raw.score ?? raw.risk_score ?? 0);

    const id = raw.id || raw.evidenceID || `local_ev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    return {
        id,
        evidenceID: raw.evidenceID || id,
        recordID: raw.recordID || raw.recordId || raw.scanRecordID || raw.scan_id || raw.relatedRecordID || "",
        imageData: raw.imageData || raw.screenshot_base64 || raw.evidence_image_url || "",
        url: raw.url || raw.pageUrl || raw.targetUrl || "",
        title: raw.title || "",
        capturedAt: raw.capturedAt || raw.timestamp || raw.createdAt || "",
        riskScore: Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 0,
        riskLevel: raw.riskLevel || raw.level || "",
        reason: raw.reason || raw.ai_reason || raw.message || "",
        source: raw.source || "local_snapshot"
    };
}

async function loadLocalEvidenceSnapshots() {
    try {
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
            const storage = await chrome.storage.local.get([LOCAL_EVIDENCE_SNAPSHOT_KEY]);
            const records = Array.isArray(storage[LOCAL_EVIDENCE_SNAPSHOT_KEY])
                ? storage[LOCAL_EVIDENCE_SNAPSHOT_KEY]
                : [];

            localEvidenceSnapshotsCache = records.map(normalizeLocalEvidenceSnapshot);
            return localEvidenceSnapshotsCache;
        }
    } catch (e) {
        console.warn("讀取本機證據快照失敗：", e);
    }

    try {
        const parsed = JSON.parse(localStorage.getItem(LOCAL_EVIDENCE_SNAPSHOT_KEY) || "[]");
        localEvidenceSnapshotsCache = Array.isArray(parsed)
            ? parsed.map(normalizeLocalEvidenceSnapshot)
            : [];
    } catch (e) {
        localEvidenceSnapshotsCache = [];
    }

    return localEvidenceSnapshotsCache;
}

function findLocalEvidenceSnapshotForRecord(record = {}) {
    if (!Array.isArray(localEvidenceSnapshotsCache) || !localEvidenceSnapshotsCache.length) {
        return null;
    }

    const recordUrlRaw = getLocalEvidenceRecordUrl(record);
    const recordUrl = normalizeEvidenceUrl(recordUrlRaw);
    const recordHost = getEvidenceUrlHost(recordUrlRaw);
    const recordTime = getLocalEvidenceTimestampMs(record.timestamp || record.createdAt || record.time || "");
    const recordID = getEvidenceRecordID(record);
    const evidenceID = String(record.evidenceID || record.evidenceId || "");

    // 沒有網址、沒有 recordID、沒有 evidenceID 時，不能拿任何舊快照硬配。
    if (!recordUrl && !recordID && !evidenceID) {
        return null;
    }

    let best = null;
    let bestScore = -1;

    for (const snapshot of localEvidenceSnapshotsCache) {
        if (!snapshot?.imageData) continue;

        const snapshotUrlRaw = snapshot.url || "";
        const snapshotUrl = normalizeEvidenceUrl(snapshotUrlRaw);
        const snapshotHost = getEvidenceUrlHost(snapshotUrlRaw);
        const snapshotTime = getLocalEvidenceTimestampMs(snapshot.capturedAt);
        const snapshotRecordID = getEvidenceSnapshotRecordID(snapshot);
        const snapshotEvidenceID = String(snapshot.evidenceID || snapshot.id || "");

        let matchScore = -1;

        // 最高優先：直接的證據 ID / 掃描紀錄 ID。
        if (evidenceID && snapshotEvidenceID && evidenceID === snapshotEvidenceID) {
            matchScore = 300;
        } else if (recordID && snapshotRecordID && recordID === snapshotRecordID) {
            matchScore = 260;
        } else if (recordUrl && snapshotUrl && isSameEvidenceUrl(recordUrlRaw, snapshotUrlRaw)) {
            matchScore = 220;
        } else if (recordHost && snapshotHost && recordHost === snapshotHost && recordTime && snapshotTime) {
            // 只允許「同網域 + 時間非常接近」作為備援。
            // 不再允許只靠時間把假物流圖配到學校官網。
            const diffMinutes = Math.abs(recordTime - snapshotTime) / 60000;
            if (diffMinutes <= 2) {
                matchScore = 120;
            }
        }

        if (matchScore > bestScore) {
            best = snapshot;
            bestScore = matchScore;
        }
    }

    return bestScore >= 120 ? best : null;
}

function buildEvidenceDataFromLocalSnapshot(snapshot = null) {
    if (!snapshot?.imageData) return {};

    return {
        evidenceID: snapshot.evidenceID || snapshot.id,
        recordID: snapshot.recordID || "",
        screenshot_base64: snapshot.imageData,
        evidence_image_url: snapshot.imageData,
        reason: snapshot.reason || "",
        timestamp: snapshot.capturedAt || "",
        url: snapshot.url || "",
        riskScore: snapshot.riskScore || 0,
        riskLevel: snapshot.riskLevel || "",
        source: snapshot.source || "local_snapshot"
    };
}

function safeEvidenceFileName(text = "evidence") {
    return String(text || "evidence")
        .replace(/^https?:\/\//i, "")
        .replace(/[\\/:*?"<>|#%&{}$!'@+`=]/g, "_")
        .replace(/\s+/g, "_")
        .slice(0, 80) || "evidence";
}

function loadEvidenceImageElement(dataUrl) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("快照圖片讀取失敗"));
        img.src = dataUrl;
    });
}

function drawEvidenceWrappedText(ctx, text, x, y, maxWidth, lineHeight, maxLines = 3) {
    const chars = String(text || "").split("");
    let line = "";
    let lines = 0;

    for (const ch of chars) {
        const testLine = line + ch;

        if (ctx.measureText(testLine).width > maxWidth && line) {
            ctx.fillText(line, x, y);
            line = ch;
            y += lineHeight;
            lines += 1;

            if (lines >= maxLines) {
                ctx.fillText(`${line.slice(0, 24)}...`, x, y);
                return y + lineHeight;
            }
        } else {
            line = testLine;
        }
    }

    if (line) {
        ctx.fillText(line, x, y);
        y += lineHeight;
    }

    return y;
}

async function buildLocalEvidenceExportImage(snapshot = {}, masked = false) {
    const img = await loadEvidenceImageElement(snapshot.imageData);
    const maxWidth = 1200;
    const scale = Math.min(1, maxWidth / img.naturalWidth);
    const shotWidth = Math.max(720, Math.round(img.naturalWidth * scale));
    const shotHeight = Math.round(img.naturalHeight * scale);
    const headerHeight = 230;

    const canvas = document.createElement("canvas");
    canvas.width = shotWidth;
    canvas.height = headerHeight + shotHeight;
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = masked ? "#fff7ed" : "#eff6ff";
    ctx.fillRect(0, 0, canvas.width, headerHeight);

    ctx.fillStyle = "#0f172a";
    ctx.font = "bold 34px Microsoft JhengHei, sans-serif";
    ctx.fillText(masked ? "AI 防詐盾牌｜遮罩版證據快照" : "AI 防詐盾牌｜報案版證據快照", 34, 52);

    ctx.font = "bold 22px Microsoft JhengHei, sans-serif";
    ctx.fillStyle = masked ? "#b45309" : "#1d4ed8";
    ctx.fillText(`風險分數：${Number(snapshot.riskScore || 0)}｜風險等級：${snapshot.riskLevel || "未標示"}`, 34, 92);

    ctx.font = "18px Microsoft JhengHei, sans-serif";
    ctx.fillStyle = "#334155";

    let y = 126;
    y = drawEvidenceWrappedText(ctx, `保存時間：${formatTimestamp(snapshot.capturedAt)}`, 34, y, canvas.width - 68, 24, 1);
    y = drawEvidenceWrappedText(ctx, `網址：${snapshot.url || "未取得網址"}`, 34, y, canvas.width - 68, 24, 2);
    y = drawEvidenceWrappedText(ctx, `AI 判斷：${snapshot.reason || "尚無風險原因文字"}`, 34, y, canvas.width - 68, 24, 2);

    if (masked) {
        ctx.save();
        ctx.filter = "blur(8px)";
        ctx.drawImage(img, 0, headerHeight, shotWidth, shotHeight);
        ctx.restore();

        ctx.fillStyle = "rgba(255,255,255,.42)";
        ctx.fillRect(0, headerHeight, shotWidth, shotHeight);

        ctx.fillStyle = "rgba(15,23,42,.76)";
        ctx.fillRect(0, headerHeight + Math.round(shotHeight * 0.38), shotWidth, 96);

        ctx.fillStyle = "#fff";
        ctx.font = "bold 28px Microsoft JhengHei, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("遮罩版：完整畫面已模糊處理，避免個資外流", shotWidth / 2, headerHeight + Math.round(shotHeight * 0.38) + 58);
        ctx.textAlign = "left";
    } else {
        ctx.drawImage(img, 0, headerHeight, shotWidth, shotHeight);
    }

    return canvas.toDataURL("image/jpeg", 0.9);
}

function downloadLocalEvidenceDataUrl(dataUrl, filename) {
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
}

async function exportLocalEvidenceSnapshot(snapshot = {}, masked = false) {
    if (!snapshot?.imageData) {
        alert("這筆紀錄沒有快照圖片。");
        return;
    }

    const dataUrl = await buildLocalEvidenceExportImage(snapshot, masked);
    const prefix = masked ? "AI防詐盾牌_遮罩版快照" : "AI防詐盾牌_報案版快照";
    downloadLocalEvidenceDataUrl(dataUrl, `${prefix}_${safeEvidenceFileName(snapshot.url)}_${Date.now()}.jpg`);
}

// ==========================================
// 統計與紀錄表格
// ==========================================
function animateNumber(el, target) {
    if (!el) return;

    const start = parseInt(el.textContent || "0", 10) || 0;
    const end = Number(target) || 0;
    const duration = 500;
    const startedAt = performance.now();

    function tick(now) {
        const progress = Math.min(1, (now - startedAt) / duration);
        const value = Math.round(start + (end - start) * progress);
        el.textContent = String(value);

        if (progress < 1) {
            requestAnimationFrame(tick);
        }
    }

    requestAnimationFrame(tick);
}


function formatDashboardSyncTime(value = dashboardLastSyncedAt) {
    if (!value) return "";

    try {
        return new Date(value).toLocaleTimeString("zh-TW", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false
        });
    } catch (e) {
        return "";
    }
}

function updatePlainLanguageSummary(total, danger) {
    const stateIcon = document.getElementById("summary-state-icon");
    const stateText = document.getElementById("summary-state-text");
    const blockedCount = document.getElementById("summary-blocked-count");
    const stateNote = document.getElementById("summary-state-note");

    if (blockedCount) {
        blockedCount.textContent = String(danger || 0);
    }

    if (!stateText || !stateNote) return;

    if (!total) {
        if (dashboardLastSyncedAt) {
            if (stateIcon) stateIcon.textContent = "🟢";
            stateText.textContent = "目前安全";
            stateText.style.color = "var(--family-green, #16a34a)";
            stateNote.textContent = `已於 ${formatDashboardSyncTime()} 更新，目前沒有新的高風險紀錄。`;
            return;
        }

        if (stateIcon) stateIcon.textContent = "⚪";
        stateText.textContent = "尚未更新";
        stateText.style.color = "var(--family-sub, #475569)";
        stateNote.textContent = "請按「更新畫面」同步家庭最新防護狀態。";
        return;
    }

    if (danger > 0) {
        if (stateIcon) stateIcon.textContent = "🔴";
        stateText.textContent = "有可疑紀錄待確認";
        stateText.style.color = "var(--family-red, #dc2626)";
        stateNote.textContent = `系統發現 ${danger} 次可疑風險；不用再開詐騙網站，請直接在下方掃描紀錄查看原因與證據。`;
        return;
    }

    if (stateIcon) stateIcon.textContent = "🟢";
    stateText.textContent = "目前安全";
    stateText.style.color = "var(--family-green, #16a34a)";
    stateNote.textContent = `今天已完成 ${total} 次防護檢查，目前沒有需要立即處理的危險訊息。`;
}

function updateStats(records) {
    const high = getRiskThresholdHigh();
    const medium = getRiskThresholdMedium();

    const total = records.length;
    const danger = records.filter(record => record.riskScore >= high).length;
    const safe = records.filter(record => record.riskScore < medium).length;

    animateNumber(document.getElementById("stat-total"), total);
    animateNumber(document.getElementById("stat-safe"), safe);
    animateNumber(document.getElementById("stat-danger"), danger);
    updatePlainLanguageSummary(total, danger);
}

function createRiskCell(score) {
    const td = document.createElement("td");
    td.dataset.label = "危險程度";
    td.textContent = String(score);

    if (score >= getRiskThresholdHigh()) {
        td.className = "risk-high";
    } else if (score >= getRiskThresholdMedium()) {
        td.className = "risk-warn";
    } else {
        td.className = "risk-safe";
    }

    return td;
}

function createStatusCell(record, report) {
    const td = document.createElement("td");
    td.dataset.label = "處理狀態";

    const status = document.createElement("div");
    const score = record.riskScore;
    const localSnapshot = findLocalEvidenceSnapshotForRecord(record);

    if (score >= getRiskThresholdHigh()) {
        status.textContent = "已攔截";
        status.className = "risk-high";
    } else if (score >= getRiskThresholdMedium()) {
        status.textContent = "已警示";
        status.className = "risk-warn";
    } else {
        status.textContent = "已放行";
        status.className = "risk-safe";
    }

    td.appendChild(status);

    const detailBtn = document.createElement("button");
    detailBtn.type = "button";
    detailBtn.textContent = (record.evidenceID || localSnapshot) ? "🔍 看詳細內容 / 證據" : "🔍 看詳細內容";
    detailBtn.className = "record-detail-btn";
    detailBtn.style.cssText = "";
    detailBtn.addEventListener("click", () => openEvidence(record));
    td.appendChild(detailBtn);

    if (score >= getRiskThresholdMedium()) {
        const falsePositiveBtn = document.createElement("button");
        falsePositiveBtn.type = "button";
        falsePositiveBtn.className = "btn-mark-false-positive";
        falsePositiveBtn.textContent = "✅ 這是誤報";
        falsePositiveBtn.addEventListener("click", event => {
            event.stopPropagation();
            markRecordAsFalsePositive(record);
        });
        td.appendChild(falsePositiveBtn);
    }

    if (localSnapshot) {
        const snapshotTag = document.createElement("div");
        snapshotTag.className = "record-evidence-tag";
        snapshotTag.textContent = "📸 已保存快照";
        td.appendChild(snapshotTag);

        const exportFullBtn = document.createElement("button");
        exportFullBtn.type = "button";
        exportFullBtn.className = "record-evidence-btn";
        exportFullBtn.textContent = "📸 截圖存證";
        exportFullBtn.addEventListener("click", event => {
            event.stopPropagation();
            exportLocalEvidenceSnapshot(localSnapshot, false);
        });
        td.appendChild(exportFullBtn);
    }

    if (report?.whitelistScope) {
        const whitelist = document.createElement("div");
        whitelist.textContent = `白名單：${report.whitelistScope}`;
        whitelist.style.cssText = `
            margin-top:6px;
            color:#64748b;
            font-size:13px;
        `;
        td.appendChild(whitelist);
    }

    return td;
}

function createLogRow(record, isNew = false) {
    const report = safeParseReport(record.report);
    const score = normalizeRiskScore(report);

    const normalizedRecord = {
        ...record,
        riskScore: score,
        reason: report.reason || record.reason || "未提供原因"
    };

    const tr = document.createElement("tr");
    if (isNew) tr.classList.add("new-row-highlight");

    const timeTd = document.createElement("td");
    timeTd.dataset.label = "時間";
    timeTd.textContent = formatTimestamp(record.timestamp);

    const urlTd = document.createElement("td");
    urlTd.dataset.label = "可疑網頁";
    const recordReport = safeParseReport(record.report);
    const urlText = record.domain || record.url || record.url_preview || recordReport.originalUrl || recordReport.original_url || recordReport.url || "未知網址";
    urlTd.textContent = truncateMiddle(urlText, 72);
    urlTd.title = String(record.url || record.url_preview || recordReport.originalUrl || recordReport.original_url || recordReport.url || urlText || "");

    const riskTd = createRiskCell(score);

    const reasonTd = document.createElement("td");
    reasonTd.dataset.label = "系統發現原因";

    const reasonMain = document.createElement("div");
    reasonMain.textContent = report.reason || record.reason || "未提供分析";
    reasonMain.style.cssText = "line-height:1.55;";

    reasonTd.appendChild(reasonMain);

    if (Array.isArray(report.scamDNA) && report.scamDNA.length > 0) {
        const dna = document.createElement("div");
        dna.textContent = "心理操縱術：" + report.scamDNA.join("、");
        dna.style.cssText = `
            margin-top:8px;
            color:#64748b;
            font-size:14px;
            line-height:1.5;
        `;
        reasonTd.appendChild(dna);
    }

    if (report.advice) {
        const advice = document.createElement("div");
        advice.textContent = "建議：" + report.advice;
        advice.style.cssText = `
            margin-top:8px;
            color:#475467;
            font-size:14px;
            line-height:1.5;
        `;
        reasonTd.appendChild(advice);
    }

    if (report.communityReportHit || report.communityReportCount || report.communityReviewStatus) {
        const community = document.createElement("div");
        const count = report.communityReportCount || 0;
        const review = normalizeCommunityStatusLabel(report.communityReviewStatus || "pending");
        community.textContent = `社群資料庫：累積 ${count} 次回報｜${review}`;
        community.style.cssText = `
            margin-top:8px;
            color:#c47c00;
            font-size:14px;
            line-height:1.5;
            font-weight:900;
        `;
        reasonTd.appendChild(community);
    }

    const statusTd = createStatusCell(normalizedRecord, report);

    tr.appendChild(timeTd);
    tr.appendChild(urlTd);
    tr.appendChild(riskTd);
    tr.appendChild(reasonTd);
    tr.appendChild(statusTd);

    tr.classList.add("record-card-row");
    tr.tabIndex = 0;
    tr.setAttribute("role", "button");
    tr.setAttribute("aria-label", "查看這筆掃描紀錄的詳細內容");
    tr.addEventListener("click", event => {
        const target = event.target;
        if (target && target.closest && target.closest("button")) return;
        openEvidence(normalizedRecord);
    });
    tr.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openEvidence(normalizedRecord);
        }
    });

    return {
        row: tr,
        normalizedRecord
    };
}



const FALSE_POSITIVE_REVIEWS_STORAGE_KEY = "aiShieldFalsePositiveReviews";
const USER_WHITELIST_DOMAINS_KEY = "userWhitelistDomains";
const USER_REPORTED_DOMAINS_STORAGE_KEY = "aiShieldUserReportedDomains";

let falsePositiveReviewsCache = [];

function getDomainFromAnyUrl(value = "") {
    const raw = String(value || "").trim();
    if (!raw) return "";

    try {
        const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
        return new URL(withScheme).hostname.replace(/^www\./i, "").toLowerCase();
    } catch (e) {
        return raw
            .replace(/^https?:\/\//i, "")
            .replace(/^www\./i, "")
            .split("/")[0]
            .split("?")[0]
            .split("#")[0]
            .toLowerCase();
    }
}

function getRecordPrimaryUrl(record = {}) {
    const report = safeParseReport(record.report);
    return String(
        record.url ||
        record.url_preview ||
        record.pageUrl ||
        record.targetUrl ||
        record.domain ||
        report.originalUrl ||
        report.original_url ||
        report.url ||
        ""
    );
}

function normalizeFalsePositiveReview(raw = {}) {
    const url = String(raw.url || raw.pageUrl || raw.targetUrl || "");
    const domain = getDomainFromAnyUrl(raw.domain || url);

    return {
        id: raw.id || `fp_${domain}_${raw.createdAt || raw.markedAt || ""}`,
        url,
        domain,
        title: raw.title || "",
        familyID: normalizeDashboardFamilyID(raw.familyID || ""),
        reason: raw.reason || "家人確認此頁為正常頁面或誤報。",
        source: raw.source || "manual_review",
        createdAt: raw.createdAt || raw.markedAt || raw.timestamp || "",
        action: raw.action || "mark_as_false_positive"
    };
}

async function loadFalsePositiveReviews() {
    try {
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
            const storage = await chrome.storage.local.get([FALSE_POSITIVE_REVIEWS_STORAGE_KEY]);
            const list = Array.isArray(storage[FALSE_POSITIVE_REVIEWS_STORAGE_KEY])
                ? storage[FALSE_POSITIVE_REVIEWS_STORAGE_KEY]
                : [];

            return list
                .map(normalizeFalsePositiveReview)
                .filter(item => item.domain || item.url);
        }
    } catch (error) {
        console.warn("讀取誤報修正紀錄失敗：", error);
    }

    return [];
}

async function saveFalsePositiveReviews(list = []) {
    const normalized = list
        .map(normalizeFalsePositiveReview)
        .filter(item => item.domain || item.url);

    if (typeof chrome !== "undefined" && chrome.storage?.local) {
        await chrome.storage.local.set({ [FALSE_POSITIVE_REVIEWS_STORAGE_KEY]: normalized.slice(0, 100) });
    }

    falsePositiveReviewsCache = normalized;
    return normalized;
}

async function addDomainToUserWhitelist(domain) {
    const clean = getDomainFromAnyUrl(domain);
    if (!clean) return "";

    try {
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
            const storage = await chrome.storage.local.get([USER_WHITELIST_DOMAINS_KEY]);
            const current = Array.isArray(storage[USER_WHITELIST_DOMAINS_KEY])
                ? storage[USER_WHITELIST_DOMAINS_KEY]
                : [];

            const merged = Array.from(new Set([...current.map(getDomainFromAnyUrl), clean].filter(Boolean)));
            await chrome.storage.local.set({ [USER_WHITELIST_DOMAINS_KEY]: merged });
        }
    } catch (error) {
        console.warn("加入安全名單失敗：", error);
    }

    return clean;
}


async function removeDomainFromUserReportedDomains(domain) {
    const clean = getDomainFromAnyUrl(domain);
    if (!clean) return "";

    try {
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
            const storage = await chrome.storage.local.get([USER_REPORTED_DOMAINS_STORAGE_KEY]);
            const current = Array.isArray(storage[USER_REPORTED_DOMAINS_STORAGE_KEY])
                ? storage[USER_REPORTED_DOMAINS_STORAGE_KEY]
                : [];

            const next = current.filter(item => {
                const itemDomain = getDomainFromAnyUrl(item?.domain || item?.url || item);
                return itemDomain && itemDomain !== clean;
            });

            await chrome.storage.local.set({ [USER_REPORTED_DOMAINS_STORAGE_KEY]: next });
        }
    } catch (error) {
        console.warn("移出可疑觀察名單失敗：", error);
    }

    return clean;
}

async function removeDomainFromUserWhitelist(domain) {
    const clean = getDomainFromAnyUrl(domain);
    if (!clean) return "";

    try {
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
            const storage = await chrome.storage.local.get([USER_WHITELIST_DOMAINS_KEY]);
            const current = Array.isArray(storage[USER_WHITELIST_DOMAINS_KEY])
                ? storage[USER_WHITELIST_DOMAINS_KEY]
                : [];

            const next = current
                .map(getDomainFromAnyUrl)
                .filter(item => item && item !== clean);

            await chrome.storage.local.set({ [USER_WHITELIST_DOMAINS_KEY]: Array.from(new Set(next)) });
        }
    } catch (error) {
        console.warn("移出安全名單失敗：", error);
    }

    return clean;
}

function isUrlInFalsePositiveReviews(url = "", reviews = falsePositiveReviewsCache) {
    const domain = getDomainFromAnyUrl(url);
    if (!domain) return false;

    return reviews.some(item => {
        const review = normalizeFalsePositiveReview(item);
        return review.domain && (domain === review.domain || domain.endsWith("." + review.domain));
    });
}

function filterFalsePositiveRecords(records = []) {
    return records.filter(record => {
        const url = getRecordPrimaryUrl(record);
        return !isUrlInFalsePositiveReviews(url, falsePositiveReviewsCache);
    });
}

async function addFalsePositiveReview(payload = {}) {
    const url = String(payload.url || payload.pageUrl || payload.targetUrl || "");
    const domain = getDomainFromAnyUrl(payload.domain || url);
    if (!domain) {
        showToast("無法取得網址，暫時不能加入安全名單。", "error");
        return null;
    }

    await addDomainToUserWhitelist(domain);
    await removeDomainFromUserReportedDomains(domain);

    const current = await loadFalsePositiveReviews();
    const filtered = current.filter(item => getDomainFromAnyUrl(item.domain || item.url) !== domain);

    const item = normalizeFalsePositiveReview({
        id: `fp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        url,
        domain,
        title: payload.title || "",
        familyID: getCurrentFamilyID(),
        reason: payload.reason || "家人確認此頁為正常頁面或誤報。",
        source: payload.source || "dashboard_manual_review",
        createdAt: new Date().toISOString(),
        action: "mark_as_false_positive"
    });

    filtered.unshift(item);
    await saveFalsePositiveReviews(filtered);

    showToast(`${domain} 已加入安全名單，後續會降低誤報。`, "success");
    return item;
}

async function removeFalsePositiveReview(domain) {
    const clean = getDomainFromAnyUrl(domain);
    if (!clean) return;

    const current = await loadFalsePositiveReviews();
    const next = current.filter(item => getDomainFromAnyUrl(item.domain || item.url) !== clean);

    await saveFalsePositiveReviews(next);
    await removeDomainFromUserWhitelist(clean);
    await renderFalsePositiveReviews();
    await renderUserReports();

    showToast(`${clean} 已恢復一般判斷。`, "success");
}

function createFalsePositiveCard(item) {
    const review = normalizeFalsePositiveReview(item);
    const card = document.createElement("article");
    card.className = "false-positive-card";

    const content = document.createElement("div");

    const title = document.createElement("h3");
    title.className = "false-positive-title";
    title.textContent = "✅ 已標記為正常 / 誤報修正";

    const meta = document.createElement("div");
    meta.className = "false-positive-meta";
    meta.textContent = `網域：${review.domain || "未知網域"}｜時間：${formatUserReportTime(review.createdAt)}`;

    const note = document.createElement("div");
    note.className = "false-positive-note";
    note.textContent = `修正說明：${review.reason}`;

    content.append(title, meta, note);

    const actions = document.createElement("div");
    actions.className = "false-positive-actions";

    const restoreBtn = document.createElement("button");
    restoreBtn.type = "button";
    restoreBtn.className = "btn-restore-domain";
    restoreBtn.textContent = "恢復判斷";
    restoreBtn.addEventListener("click", () => removeFalsePositiveReview(review.domain || review.url));

    actions.appendChild(restoreBtn);
    card.append(content, actions);

    return card;
}

async function renderFalsePositiveReviews() {
    const list = document.getElementById("false-positive-list");
    if (!list) return;

    list.replaceChildren();
    falsePositiveReviewsCache = await loadFalsePositiveReviews();

    if (!falsePositiveReviewsCache.length) {
        const empty = document.createElement("div");
        empty.className = "false-positive-empty";
        empty.textContent = "目前尚無誤報修正紀錄。";
        list.appendChild(empty);
        return;
    }

    falsePositiveReviewsCache.slice(0, 20).forEach(item => {
        list.appendChild(createFalsePositiveCard(item));
    });
}

async function clearFalsePositiveReviews() {
    const ok = window.confirm("確定要清除所有誤報修正與安全名單紀錄嗎？\n\n清除後，這些網站會恢復一般 AI 判斷。");
    if (!ok) return;

    const current = await loadFalsePositiveReviews();
    for (const item of current) {
        await removeDomainFromUserWhitelist(item.domain || item.url);
    }

    await saveFalsePositiveReviews([]);
    await renderFalsePositiveReviews();
    showToast("已清除誤報修正紀錄，網站恢復一般判斷。", "success");
}

async function markRecordAsFalsePositive(record = {}) {
    const url = getRecordPrimaryUrl(record);
    const report = safeParseReport(record.report);

    const item = await addFalsePositiveReview({
        url,
        domain: record.domain || getDomainFromAnyUrl(url),
        title: record.title || "",
        reason: `家人確認此掃描紀錄為誤報。原判斷：${report.reason || record.reason || "未提供原因"}`,
        source: "dashboard_scan_record_false_positive"
    });

    if (!item) return;

    await renderFalsePositiveReviews();
    await renderUserReports();
    await renderDashboard(currentRecords);
}


const USER_REPORTS_STORAGE_KEY = "aiShieldUserReports";

async function loadLocalUserReports() {
    try {
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
            const storage = await chrome.storage.local.get([USER_REPORTS_STORAGE_KEY]);
            return Array.isArray(storage[USER_REPORTS_STORAGE_KEY])
                ? storage[USER_REPORTS_STORAGE_KEY]
                : [];
        }
    } catch (error) {
        console.warn("讀取家人回報紀錄失敗：", error);
    }

    return [];
}

function normalizeUserReport(raw = {}) {
    const reportedAt = raw.reportedAt || raw.timestamp || raw.createdAt || "";
    const url = String(raw.url || raw.pageUrl || raw.targetUrl || "");
    const score = Number(raw.riskScore || raw.score || 0);
    const rawStatus = String(raw.status || raw.reviewStatus || raw.reportStatus || "").trim();
    const statusText = raw.statusText || (
        rawStatus === "confirmed_high_risk" || rawStatus === "confirmed_scam"
            ? "已確認高風險"
            : "待家人確認"
    );

    return {
        id: raw.id || `user_report_${reportedAt}_${url}`,
        url,
        title: raw.title || "",
        reportedAt,
        familyID: normalizeDashboardFamilyID(raw.familyID || ""),
        userID: raw.userID || "",
        riskScore: Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 0,
        riskLevel: raw.riskLevel || "使用者回報",
        reason: raw.reason || raw.ai_reason || raw.reported_reason || "家人從 Popup 主動回報此頁需要後續確認。",
        status: rawStatus || (String(statusText).includes("確認高風險") ? "confirmed_high_risk" : "watchlist"),
        statusText,
        confirmedAt: raw.confirmedAt || "",
        actionType: raw.action_type || raw.actionType || "popup_user_report"
    };
}

function shouldShowUserReport(report, familyID = getCurrentFamilyID()) {
    const current = normalizeDashboardFamilyID(familyID);
    const reportFamily = normalizeDashboardFamilyID(report.familyID || "");

    // 本機回報若沒有家庭代碼，也顯示在目前裝置，避免使用者按了回報卻找不到。
    if (!reportFamily || reportFamily === "NONE" || reportFamily === "LOCAL") return true;
    if (!current || current === "NONE" || current === "LOCAL") return true;

    return reportFamily === current;
}

function getReportedPageDisplayUrl(url = "") {
    try {
        const parsed = new URL(url);
        return parsed.hostname.replace(/^www\./, "") + parsed.pathname.replace(/\/$/, "");
    } catch (e) {
        return String(url || "未知網址");
    }
}

function formatUserReportTime(value = "") {
    if (!value) return "--";

    try {
        const date = new Date(value);
        if (!Number.isFinite(date.getTime())) return "--";

        return new Intl.DateTimeFormat("zh-TW", {
            month: "numeric",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit"
        }).format(date);
    } catch (e) {
        return "--";
    }
}


function isConfirmedHighRiskReport(report = {}) {
    const status = String(report.status || "").toLowerCase();
    const statusText = String(report.statusText || "");
    return status === "confirmed_high_risk" || status === "confirmed_scam" || statusText.includes("已確認高風險");
}

async function upsertUserReportedDomainStatus(payload = {}, status = "watchlist") {
    const url = String(payload.url || payload.pageUrl || payload.targetUrl || "");
    const domain = getDomainFromAnyUrl(payload.domain || url);
    if (!domain) return "";

    try {
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
            const storage = await chrome.storage.local.get([USER_REPORTED_DOMAINS_STORAGE_KEY]);
            const current = Array.isArray(storage[USER_REPORTED_DOMAINS_STORAGE_KEY])
                ? storage[USER_REPORTED_DOMAINS_STORAGE_KEY]
                : [];

            const filtered = current.filter(item => getDomainFromAnyUrl(item?.domain || item?.url || item) !== domain);
            const now = new Date().toISOString();

            filtered.unshift({
                domain,
                url,
                title: payload.title || "",
                familyID: payload.familyID || getCurrentFamilyID(),
                reason: payload.reason || (status === "confirmed_high_risk" ? "家人確認此網站為高風險。" : "家人回報此網站可疑。"),
                reportedAt: payload.reportedAt || now,
                confirmedAt: status === "confirmed_high_risk" ? (payload.confirmedAt || now) : "",
                source: payload.source || "dashboard_review_center",
                status,
                reviewStatus: status
            });

            await chrome.storage.local.set({
                [USER_REPORTED_DOMAINS_STORAGE_KEY]: filtered.slice(0, 100)
            });
        }
    } catch (error) {
        console.warn("更新可疑觀察名單失敗：", error);
    }

    return domain;
}

async function updateLocalUserReportStatus(report = {}, patch = {}) {
    try {
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
            const storage = await chrome.storage.local.get([USER_REPORTS_STORAGE_KEY]);
            const current = Array.isArray(storage[USER_REPORTS_STORAGE_KEY]) ? storage[USER_REPORTS_STORAGE_KEY] : [];
            const normalizedReport = normalizeUserReport(report);
            const now = new Date().toISOString();
            let matched = false;

            const next = current.map(item => {
                const normalized = normalizeUserReport(item);
                const isSame = normalized.id === normalizedReport.id || normalized.url === normalizedReport.url;

                if (!isSame) return item;

                matched = true;
                return {
                    ...item,
                    ...patch,
                    updatedAt: now
                };
            });

            if (!matched && normalizedReport.url) {
                next.unshift({
                    ...normalizedReport,
                    ...patch,
                    updatedAt: now
                });
            }

            await chrome.storage.local.set({ [USER_REPORTS_STORAGE_KEY]: next.slice(0, 100) });
        }
    } catch (error) {
        console.warn("更新回報狀態失敗：", error);
    }
}

async function markUserReportAsConfirmedRisk(report = {}) {
    if (!report?.url) {
        showToast("這筆回報沒有網址，無法確認。", "error");
        return;
    }

    const domain = getDomainFromAnyUrl(report.url);
    if (!domain) {
        showToast("無法取得網域，暫時不能確認。", "error");
        return;
    }

    await removeDomainFromUserWhitelist(domain);

    const confirmedAt = new Date().toISOString();
    const reason = `家人確認此網站為高風險。原回報原因：${report.reason || "未提供原因"}`;

    await upsertUserReportedDomainStatus({
        url: report.url,
        domain,
        title: report.title || "",
        familyID: report.familyID || getCurrentFamilyID(),
        reason,
        reportedAt: report.reportedAt || confirmedAt,
        confirmedAt,
        source: "dashboard_confirmed_high_risk"
    }, "confirmed_high_risk");

    await updateLocalUserReportStatus(report, {
        status: "confirmed_high_risk",
        reviewStatus: "confirmed_high_risk",
        statusText: "已確認高風險",
        riskLevel: "已確認高風險",
        confirmedAt,
        reason
    });

    await renderUserReports();
    showToast(`${domain} 已確認為高風險；下次進入會強化提醒與攔截。`, "success");
}

async function restoreUserReportToPending(report = {}) {
    if (!report?.url) {
        showToast("這筆回報沒有網址，無法恢復。", "error");
        return;
    }

    const domain = getDomainFromAnyUrl(report.url);
    const now = new Date().toISOString();

    await upsertUserReportedDomainStatus({
        url: report.url,
        domain,
        title: report.title || "",
        familyID: report.familyID || getCurrentFamilyID(),
        reason: "家人將此網站恢復為待確認觀察狀態。",
        reportedAt: report.reportedAt || now,
        source: "dashboard_restore_pending"
    }, "watchlist");

    await updateLocalUserReportStatus(report, {
        status: "watchlist",
        reviewStatus: "watchlist",
        statusText: "待家人確認",
        riskLevel: "使用者回報",
        confirmedAt: "",
        reason: report.reason || "家人回報此網站可疑，待後續確認。"
    });

    await renderUserReports();
    showToast(`${domain || "此網站"} 已恢復為待確認。`, "success");
}


function createUserReportCard(report) {
    const isConfirmed = isConfirmedHighRiskReport(report);
    const card = document.createElement("article");
    card.className = isConfirmed ? "user-report-card confirmed-risk" : "user-report-card";

    const content = document.createElement("div");

    const title = document.createElement("h3");
    title.className = "user-report-title";
    title.textContent = isConfirmed ? "🚨 家人已確認高風險網站" : "🚩 家人回報了一個可疑網站";

    const meta = document.createElement("div");
    meta.className = "user-report-meta";
    meta.textContent = `時間：${formatUserReportTime(report.reportedAt)}｜來源：${getReportedPageDisplayUrl(report.url)}｜狀態：${report.statusText}`;

    const reason = document.createElement("div");
    reason.className = "user-report-reason";
    reason.textContent = `說明：${report.reason}`;

    content.append(title, meta, reason);

    if (isConfirmed) {
        const badge = document.createElement("div");
        badge.className = "confirmed-risk-badge";
        badge.textContent = "下次進入此網站會強化提醒與攔截";
        content.appendChild(badge);
    }

    const actions = document.createElement("div");
    actions.className = "user-report-actions";

    const openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.className = "btn-open-reported-page";
    openBtn.textContent = "開啟查看";
    openBtn.addEventListener("click", () => {
        if (!report.url) return;

        try {
            if (typeof chrome !== "undefined" && chrome.tabs?.create) {
                chrome.tabs.create({ url: report.url });
                return;
            }
        } catch (e) {}

        window.open(report.url, "_blank", "noopener,noreferrer");
    });

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "btn-copy-reported-url";
    copyBtn.textContent = "複製網址";
    copyBtn.addEventListener("click", async () => {
        try {
            await navigator.clipboard.writeText(report.url || "");
            showToast("已複製回報網址。", "success");
        } catch (e) {
            showToast(report.url || "沒有可複製的網址。", "info");
        }
    });

    const confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.className = isConfirmed ? "btn-restore-pending" : "btn-confirm-risk";
    confirmBtn.textContent = isConfirmed ? "恢復待確認" : "確認高風險";
    confirmBtn.addEventListener("click", async () => {
        if (isConfirmed) {
            await restoreUserReportToPending(report);
        } else {
            await markUserReportAsConfirmedRisk(report);
        }
    });

    const normalBtn = document.createElement("button");
    normalBtn.type = "button";
    normalBtn.className = "btn-mark-report-normal";
    normalBtn.textContent = "標記為正常";
    normalBtn.addEventListener("click", async () => {
        await markUserReportAsNormal(report);
    });

    actions.append(openBtn, copyBtn, confirmBtn, normalBtn);
    card.append(content, actions);

    return card;
}

async function markUserReportAsNormal(report) {
    if (!report?.url) {
        showToast("這筆回報沒有網址，無法標記。", "error");
        return;
    }

    await addFalsePositiveReview({
        url: report.url,
        title: report.title || "",
        familyID: report.familyID || getCurrentFamilyID(),
        reason: "家人確認此回報為誤報或正常網站。",
        source: "dashboard_user_report_false_positive"
    });

    try {
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
            const storage = await chrome.storage.local.get([USER_REPORTS_STORAGE_KEY]);
            const current = Array.isArray(storage[USER_REPORTS_STORAGE_KEY]) ? storage[USER_REPORTS_STORAGE_KEY] : [];
            const next = current.filter(item => {
                const normalized = normalizeUserReport(item);
                return normalized.id !== report.id && normalized.url !== report.url;
            });
            await chrome.storage.local.set({ [USER_REPORTS_STORAGE_KEY]: next });
        }
    } catch (error) {
        console.warn("移除已修正回報失敗：", error);
    }

    await renderUserReports();
    await renderFalsePositiveReviews();
}

async function renderUserReports() {
    const list = document.getElementById("user-report-list");
    if (!list) return;

    list.replaceChildren();

    const familyID = getCurrentFamilyID();
    const rawReports = await loadLocalUserReports();
    const reports = rawReports
        .map(normalizeUserReport)
        .filter(report => report.url && shouldShowUserReport(report, familyID) && !isUrlInFalsePositiveReviews(report.url))
        .sort((a, b) => String(b.reportedAt || "").localeCompare(String(a.reportedAt || "")))
        .slice(0, 8);

    if (!reports.length) {
        const empty = document.createElement("div");
        empty.className = "user-report-empty";
        empty.textContent = "目前尚無家人回報的可疑網站。";
        list.appendChild(empty);
        return;
    }

    reports.forEach(report => {
        list.appendChild(createUserReportCard(report));
    });
}

async function clearUserReports() {
    const ok = window.confirm("確定要清除本機保存的可疑網站回報紀錄嗎？\n\n這只會清除目前裝置的暫存回報，不會影響雲端資料。");
    if (!ok) return;

    try {
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
            await chrome.storage.local.set({ [USER_REPORTS_STORAGE_KEY]: [] });
        }
    } catch (error) {
        console.warn("清除家人回報紀錄失敗：", error);
    }

    await renderUserReports();
    showToast("已清除本機可疑回報紀錄。", "success");
}


function renderTable(records) {
    const tbody = document.getElementById("log-table-body");
    if (!tbody) return;

    tbody.replaceChildren();

    if (!records.length) {
        const tr = document.createElement("tr");
        const td = document.createElement("td");

        td.colSpan = 5;
        td.className = "empty-row";
        td.textContent = "目前尚無掃描紀錄。";

        tr.appendChild(td);
        tbody.appendChild(tr);
        return;
    }

    records.forEach(record => {
        const { row } = createLogRow(record);
        tbody.appendChild(row);
    });
}

function normalizeRecords(records) {
    return records
        .filter(record => record && typeof record === "object")
        .map(record => {
            const report = safeParseReport(record.report);
            return {
                ...record,
                riskScore: normalizeRiskScore(report),
                reason: report.reason || record.reason || "",
                report
            };
        })
        .sort((a, b) => {
            const at = String(a.timestamp || "");
            const bt = String(b.timestamp || "");
            return bt.localeCompare(at);
        });
}

async function renderDashboard(records) {
    await loadLocalEvidenceSnapshots();
    falsePositiveReviewsCache = await loadFalsePositiveReviews();

    const visibleRecords = filterFalsePositiveRecords(filterRecordsAfterLocalClear(records, getCurrentFamilyID()));
    currentRecords = normalizeRecords(visibleRecords);

    updateStats(currentRecords);
    renderCharts(currentRecords);
    renderTable(currentRecords);
    await renderUserReports();
    await renderFalsePositiveReviews();
}

// ==========================================
// API 資料
// ==========================================
async function fetchAlerts() {
    if (isFetching) return;

    const familyID = getCurrentFamilyID();

    if (!isValidFamilyID(familyID)) {
        showToast("請先輸入 6 碼家庭邀請碼。", "error");
        return;
    }

    isFetching = true;

    const manualBtn = document.getElementById("btn-manual");
    if (manualBtn) {
        manualBtn.disabled = true;
        manualBtn.textContent = "更新中...";
    }

    try {
        await ensureDashboardFamilyMembership(familyID);
        const data = await requestAlertsForFamily(familyID);
        const records = Array.isArray(data.data) ? data.data : [];

        if (!records.length && shouldUseDashboardDemoFallback()) {
            renderDemoDashboard("後端目前沒有掃描紀錄，已自動載入決賽展示資料。");
            return;
        }

        dashboardLastSyncedAt = Date.now();
        clearDemoDashboardState();
        await renderDashboard(records);
        showToast(records.length ? `已更新家庭戰情室，共 ${records.length} 筆紀錄。` : "已更新家庭戰情室，目前沒有新的風險紀錄。", "success");
    } catch (error) {
        // 如果後端明確說「使用者不屬於此家庭」，代表 token / install 尚未完成家庭 membership。
        // 立即強制重新綁定一次，再讀取一次。
        if (isFamilyMembershipMessage(error.message)) {
            try {
                await ensureDashboardFamilyMembership(familyID, { force: true });
                const data = await requestAlertsForFamily(familyID);
                const records = Array.isArray(data.data) ? data.data : [];

                if (!records.length && shouldUseDashboardDemoFallback()) {
                    renderDemoDashboard("家庭已重新同步，但後端目前沒有掃描紀錄，已載入決賽展示資料。");
                    showToast(`已重新同步家庭代碼：${familyID}，目前顯示 Demo 資料。`, "success");
                    return;
                }

                dashboardLastSyncedAt = Date.now();
                clearDemoDashboardState();
                await renderDashboard(records);
                showToast(records.length ? `已重新同步家庭代碼：${familyID}` : `已重新同步家庭代碼：${familyID}，目前沒有新的風險紀錄。`, "success");
                return;
            } catch (retryError) {
                if (shouldClearInvalidFamilyBinding(retryError.message)) {
                    if (shouldUseDashboardDemoFallback()) {
                        renderDemoDashboard("後端不承認目前家庭代碼，決賽展示改用固定 Demo 資料。");
                        showToast("後端家庭代碼未建立；目前顯示 Dashboard Demo 資料，避免戰情室空白。", "info");
                        return;
                    }

                    await clearSharedFamilyBinding(retryError.message);
                    stopFallbackPolling();
                    if (socket) {
                        try { socket.disconnect(); } catch (e) {}
                        socket = null;
                    }
                    setConnectionStatus("🔴 家庭代碼未完成後端綁定，請回 welcome.html 重新建立", false);
                    setDisplay("btn-start", "inline-flex");
                    setDisplay("btn-stop", "none");
                    showToast("這組家庭代碼只是舊暫存或假代碼，後端不承認，已清空。請回 welcome.html 重新建立家庭。", "error");
                    return;
                }

                showToast(`更新失敗：${retryError.message}`, "error");
                return;
            }
        }

        if (shouldClearInvalidFamilyBinding(error.message)) {
            if (shouldUseDashboardDemoFallback()) {
                renderDemoDashboard("後端不承認目前家庭代碼，決賽展示改用固定 Demo 資料。");
                showToast("後端家庭代碼未建立；目前顯示 Dashboard Demo 資料，避免戰情室空白。", "info");
                return;
            }

            await clearSharedFamilyBinding(error.message);
            stopFallbackPolling();
            if (socket) {
                try { socket.disconnect(); } catch (e) {}
                socket = null;
            }
            setConnectionStatus("🔴 家庭代碼未完成後端綁定，請回 welcome.html 重新建立", false);
            setDisplay("btn-start", "inline-flex");
            setDisplay("btn-stop", "none");
            showToast("這組家庭代碼不是後端正式家庭，已清空。請回 welcome.html 重新建立家庭。", "error");
            return;
        }

        if (shouldUseDashboardDemoFallback()) {
            renderDemoDashboard(`後端資料讀取失敗，已切換為固定 Demo 掃描紀錄。原因：${error.message}`);
            return;
        }

        if (error.name === 'AbortError' || String(error.message || "").includes('aborted')) {
            showToast("伺服器正在喚醒中，請等待幾秒後再按一次更新。", "error");
        } else {
            showToast(`更新失敗：${error.message}`, "error");
        }
    } finally {
        isFetching = false;

        const manualBtn = document.getElementById("btn-manual");
        if (manualBtn) {
            manualBtn.disabled = false;
            manualBtn.textContent = "更新畫面";
        }
    }
}

async function clearAlerts() {
    const familyID = getCurrentFamilyID();

    if (!isValidFamilyID(familyID)) {
        showToast("請先輸入 6 碼家庭邀請碼。", "error");
        return;
    }

    const ok = window.confirm(`確定要清除家庭 ${familyID} 在本裝置上的戰情室紀錄畫面嗎？

此操作只會清除目前瀏覽器中的暫存畫面與本機快取，不會刪除雲端家庭戰情紀錄。

為保護家庭成員安全，雲端紀錄僅限家庭守護者或授權管理者於完成身分驗證後刪除。`);
    if (!ok) return;

    setLocalClearAfter(familyID, Date.now());
    dashboardDemoDataActive = false;
    dashboardLastSyncedAt = 0;
    setDemoBannerVisible(false);
    renderDashboard([]);
    showToast("已清除本裝置暫存畫面；雲端家庭戰情紀錄未被刪除。若要恢復展示資料，請按「載入 Demo 資料」。", "success");
}


function notifyFamilyDesktop(title, message) {
    try {
        if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
            chrome.runtime.sendMessage({
                action: "showEmergencyNotification",
                title,
                message
            }).catch(() => {});
        }
    } catch (e) {}
}

// ==========================================
// Socket.IO
// ==========================================
function setConnectionStatus(text, connected = false) {
    const el = document.getElementById("connection-status");
    if (!el) return;

    el.replaceChildren();

    if (connected) {
        const dot = document.createElement("span");
        dot.className = "live-indicator";
        el.appendChild(dot);
    }

    const label = document.createElement("span");
    label.textContent = text;
    el.appendChild(label);

    el.classList.toggle("status-connected", connected);
}

function stopFallbackPolling() {
    if (fallbackPollingTimer) {
        clearInterval(fallbackPollingTimer);
        fallbackPollingTimer = null;
    }
}

async function startFallbackPolling(reason = "Socket.IO client 未載入，已改用資料更新模式。") {
    const familyID = getCurrentFamilyID();

    if (!isValidFamilyID(familyID)) {
        showToast("請先輸入 6 碼家庭邀請碼。", "error");
        return;
    }

    applyFamilyIDToDashboard(familyID);

    if (socket) {
        try { socket.disconnect(); } catch (e) {}
        socket = null;
    }

    stopFallbackPolling();
    setConnectionStatus(`🟡 資料讀取正常｜即時推播未啟用：${familyID}`, false);
    setDisplay("btn-start", "none");
    setDisplay("btn-stop", "inline-flex");

    if (!socketFallbackToastShown) {
        showToast(reason, "info");
        socketFallbackToastShown = true;
    }

    await fetchAlerts();

    fallbackPollingTimer = setInterval(() => {
        fetchAlerts().catch(error => {
            console.info("戰情室輪詢更新失敗：", error?.message || error);
        });
    }, getPollingIntervalMs());
}

async function startSocket() {
    const familyID = getCurrentFamilyID();

    if (!isValidFamilyID(familyID)) {
        showToast("請先輸入 6 碼家庭邀請碼。", "error");
        return;
    }

    applyFamilyIDToDashboard(familyID);

    if (!hasRealSocketIOClient()) {
        await startFallbackPolling("Socket.IO 官方 client 未載入，已自動改用資料更新模式；資料仍會正常顯示。若要即時推播，請換成官方 socket.io.min.js。");
        return;
    }

    if (socket) {
        socket.disconnect();
        socket = null;
    }

    stopFallbackPolling();
    socketFallbackToastShown = false;
    setConnectionStatus("🟡 連線中...", false);

    try {
        socket = io(getApiBaseUrl(), {
            transports: ["websocket", "polling"],
            reconnection: true,
            reconnectionAttempts: 10,
            timeout: 8000
        });

        socket.on("connect", async () => {
            let auth = await ensureInstallIdentity({ familyID });

            try {
                await ensureDashboardFamilyMembership(familyID);
                auth = await ensureInstallIdentity({ familyID });
            } catch (error) {
                setConnectionStatus("🔴 家庭綁定失敗", false);
                showToast(`家庭綁定失敗：${error.message}`, "error");
                socket.disconnect();
                return;
            }

            if (!auth.accessToken && isAuthRequired()) {
                setConnectionStatus("🔴 尚未取得授權 Token", false);
                showToast("請先確認後端 API 可用，或重新綁定家庭群組。", "error");
                socket.disconnect();
                return;
            }

            socket.emit("join_family_room", {
                familyID,
                userID: auth.userID,
                accessToken: auth.accessToken
            });

            setConnectionStatus(`已連線：${familyID}`, true);

            setDisplay("btn-start", "none");
            setDisplay("btn-stop", "inline-flex");

            await fetchAlerts();
        });

        socket.on("connect_error", error => {
            console.info("Socket 即時通道連線失敗，改用資料更新模式：", error?.message || error);
            startFallbackPolling("即時推播暫時無法連線，已自動改用資料更新模式；資料仍會正常顯示。");
        });

        socket.on("disconnect", () => {
            setConnectionStatus("🔴 已斷線", false);
            setDisplay("btn-start", "inline-flex");
            setDisplay("btn-stop", "none");
        });

        socket.on("new_scan_result", payload => {
            handleNewScanResult(payload);
        });

        socket.on("new_evidence_submitted", payload => {
            showToast("收到新的攔截證據摘要。", "info");
            fetchAlerts();
        });

        socket.on("emergency_alert", payload => {
            showEmergencyBanner(payload);
            fetchAlerts();
        });

        socket.on("family_urgent_broadcast", payload => {
            showEmergencyBanner(payload);
        });

        socket.on("community_report_updated", payload => {
            const domain = payload?.domain || "可疑網域";
            const count = payload?.reportCount || 1;
            const status = normalizeCommunityStatusLabel(payload?.reviewStatus || "pending");
            showToast(`社群回報已更新：${domain}｜累積 ${count} 次｜${status}`, "info");
            fetchAlerts();
        });

        socket.on("dashboard_reset_triggered", payload => {
            renderDashboard([]);
            showToast(payload?.message || "戰情室畫面已重置。", "success");
        });
    } catch (error) {
        setConnectionStatus("🔴 連線失敗", false);
        showToast(`連線失敗：${error.message}`, "error");
    }
}

function stopSocket() {
    stopFallbackPolling();
    socketFallbackToastShown = false;

    if (socket) {
        socket.disconnect();
        socket = null;
    }

    setConnectionStatus("🔴 尚未連線 / 閒置中", false);
    setDisplay("btn-start", "inline-flex");
    setDisplay("btn-stop", "none");
}

function showEmergencyBanner(payload) {
    const banner = document.getElementById("emergency-banner");
    const detail = document.getElementById("emergency-detail");

    if (!banner) return;

    banner.style.display = "block";

    if (detail) {
        detail.textContent = payload?.reason || payload?.message || "系統已偵測到高風險行為。";
    }

    setTimeout(() => {
        banner.style.display = "none";
    }, 12000);
}

function handleNewScanResult(payload) {
    const payloadTime = parseRecordTimestampMs(payload?.timestamp || new Date().toISOString());
    const clearAfter = getLocalClearAfter(getCurrentFamilyID());
    if (clearAfter && payloadTime && payloadTime <= clearAfter) {
        console.log("🟡 已略過本機清除時間之前的舊即時紀錄。");
        return;
    }

    const report = {
        riskScore: payload?.riskScore || 0,
        reason: payload?.reason || "即時掃描結果",
        scamDNA: payload?.scamDNA || []
    };

    const record = {
        timestamp: payload?.timestamp || new Date().toISOString(),
        url: payload?.url || payload?.domain || "未知網址",
        domain: payload?.domain || "",
        report: JSON.stringify(report)
    };

    const score = normalizeRiskScore(report);

    if (score >= getRiskThresholdHigh()) {
        showEmergencyBanner(payload);
        showToast("新的高風險攔截紀錄已進入戰情室。", "error");
        notifyFamilyDesktop("家人遇到高風險網頁", payload?.reason || "AI 防詐盾牌已攔截一個可疑頁面。");
    }

    currentRecords = normalizeRecords([record, ...currentRecords]).slice(0, 50);

    updateStats(currentRecords);
    renderCharts(currentRecords);
    renderTable(currentRecords);

    const tbody = document.getElementById("log-table-body");
    if (tbody?.firstElementChild) {
        tbody.firstElementChild.classList.add("new-row-highlight");
    }
}


function openAntiFraudClassroom() {
    const relativePath = "pages/simulator.html";

    try {
        const targetUrl = (typeof chrome !== "undefined" && chrome.runtime?.getURL)
            ? chrome.runtime.getURL(relativePath)
            : "../pages/simulator.html";

        if (typeof chrome !== "undefined" && chrome.tabs?.create) {
            chrome.tabs.create({ url: targetUrl });
            return;
        }

        window.open(targetUrl, "_blank", "noopener,noreferrer");
    } catch (error) {
        console.warn("開啟防詐教室失敗：", error);
        try {
            window.location.href = "../pages/simulator.html";
        } catch (e) {
            alert("無法開啟防詐教室，請確認 pages/simulator.html 和 scripts/simulator.js 已放入 extension 資料夾。");
        }
    }
}



// ==========================================
// 初始化
// ==========================================
function bindEvents() {
    const input = document.getElementById("family-id-input");

    document.getElementById("btn-start")?.addEventListener("click", startSocket);
    document.getElementById("btn-stop")?.addEventListener("click", stopSocket);
    document.getElementById("btn-manual")?.addEventListener("click", fetchAlerts);
    document.getElementById("btn-classroom")?.addEventListener("click", openAntiFraudClassroom);
    document.getElementById("btn-demo-data")?.addEventListener("click", () => {
        try { localStorage.setItem(DASHBOARD_DEMO_MODE_KEY, "1"); } catch (e) {}
        renderDemoDashboard("已手動載入固定 Demo 掃描紀錄。");
    });
    document.getElementById("btn-care-message")?.addEventListener("click", showCareMessageModal);
    document.getElementById("btn-clear-logs")?.addEventListener("click", clearAlerts);
    document.getElementById("btn-clear-user-reports")?.addEventListener("click", clearUserReports);
    document.getElementById("btn-clear-false-positive-reviews")?.addEventListener("click", clearFalsePositiveReviews);
    document.getElementById("line-push-test-toggle")?.addEventListener("change", event => {
        syncLinePushTestMode(Boolean(event.target.checked));
    });

    input?.addEventListener("input", event => {
        const normalized = normalizeDashboardFamilyID(event.target.value);
        event.target.value = normalized;

        if (isValidFamilyID(normalized)) {
            applyFamilyIDToDashboard(normalized, { persist: false });
            setConnectionStatus(`待驗證：${normalized}`, false);
        }

        refreshLinePushTestToggle();
    });

    input?.addEventListener("keydown", event => {
        if (event.key === "Enter") {
            startSocket();
        }
    });
}

document.addEventListener("DOMContentLoaded", async () => {
    startClock();
    bindEvents();
    await resetDashboardLocalStateForFreshPackage();
    await renderUserReports();
    await renderFalsePositiveReviews();

    const urlOptions = getDashboardUrlOptions();

    if (shouldIgnoreStoredFamilyIDOnStartup(urlOptions)) {
        if (shouldUseDashboardDemoFallback(urlOptions)) {
            applyFamilyIDToDashboard(getDemoFamilyID(urlOptions), { persist: false });
            renderDemoDashboard("直接從檔案開啟，已自動載入決賽展示資料。");
            return;
        }

        resetDashboardToBlankFamilyInput("🔴 直接從檔案開啟，請手動輸入家庭邀請碼");
        return;
    }

    const storedFamilyID = await readSharedFamilyIDFromStorage();
    const selectedFamilyID = chooseInitialFamilyID(storedFamilyID, urlOptions.familyID);
    const initialFamilyID = applyFamilyIDToDashboard(selectedFamilyID, { persist: false });
    refreshLinePushTestToggle();

    setupFamilyIDStorageListener();

    if (initialFamilyID) {
        dashboardAutoConnectRequested = true;
        setConnectionStatus(`待驗證：${initialFamilyID}`, false);

        // 修改：移除阻擋邏輯的 showToast，只保留清理網址列殘留參數的功能
        if (urlOptions.familyID && urlOptions.familyID !== initialFamilyID) {
            removeFamilyIDFromCurrentUrlIfNeeded(initialFamilyID, urlOptions.familyID);
        }

        // 家庭代碼已由 welcome.html / popup 建立時，進入戰情室要直接沿用同一組代碼並自動連線。
        await startSocket();
    } else {
        if (shouldUseDashboardDemoFallback(urlOptions)) {
            applyFamilyIDToDashboard(getDemoFamilyID(urlOptions), { persist: false });
            renderDemoDashboard("尚未綁定正式家庭代碼，已載入決賽展示資料。");
            return;
        }

        resetDashboardToBlankFamilyInput("🔴 尚未綁定家庭代碼");
    }
});