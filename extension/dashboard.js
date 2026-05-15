// dashboard.js - AI 防詐盾牌戰情室邏輯（保留原功能優化版）
// 功能：
// 1. WebSocket 即時家庭戰情室
// 2. 短效 Bearer token 驗證
// 3. 即時統計與 Chart.js 圖表
// 4. 詳細掃描紀錄
// 5. 高風險緊急警報
// 6. 安全 DOM 建立，不用 innerHTML 塞使用者資料
// 7. 證據快照 Modal
// 8. 清空家庭紀錄
// 9. Socket.IO shim 自動降級輪詢，避免假 client 觸發錯誤

window.CONFIG = window.CONFIG || {
    API_BASE_URL: "https://ai-anti-scam.onrender.com",
    RISK_THRESHOLD_HIGH: 70,
    RISK_THRESHOLD_MEDIUM: 40,
    ACCESS_TOKEN_STORAGE_KEY: "aiShieldAccessToken",
    INSTALL_ID_STORAGE_KEY: "aiShieldInstallId",
    TOKEN_EXPIRES_AT_STORAGE_KEY: "aiShieldTokenExpiresAt",
    TOKEN_REFRESH_WINDOW_MS: 5 * 60 * 1000,
    REQUEST_TIMEOUT_MS: 12000,
    POLLING_INTERVAL_MS: 5000
};

let socket = null;
let ratioChartInstance = null;
let trendChartInstance = null;
let isFetching = false;
let currentRecords = [];
let fallbackPollingTimer = null;
let socketFallbackToastShown = false;

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
    const inputValue = input ? input.value.trim().toUpperCase() : "";
    const saved = String(localStorage.getItem("savedFamilyID") || "").trim().toUpperCase();
    return inputValue || saved || "none";
}

function isValidFamilyID(familyID) {
    return /^[A-Z0-9]{6}$/.test(String(familyID || "").trim().toUpperCase());
}

function getRequestTimeoutMs() {
    return Number(window.CONFIG?.REQUEST_TIMEOUT_MS || 12000) || 12000;
}

function getPollingIntervalMs() {
    return Number(window.CONFIG?.POLLING_INTERVAL_MS || 5000) || 5000;
}

function normalizeDashboardFamilyID(value) {
    return String(value || "")
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")
        .slice(0, 6);
}

function getDashboardUrlOptions() {
    try {
        const params = new URLSearchParams(window.location.search || "");
        const familyID = normalizeDashboardFamilyID(params.get("familyID") || params.get("familyId") || params.get("fid") || "");
        const autoStartValue = String(params.get("autoStart") || params.get("autostart") || "").toLowerCase();

        return {
            familyID,
            autoStart: autoStartValue === "1" || autoStartValue === "true" || autoStartValue === "yes"
        };
    } catch (e) {
        return { familyID: "", autoStart: false };
    }
}

function applyFamilyIDToDashboard(familyID) {
    const normalized = normalizeDashboardFamilyID(familyID);
    if (!isValidFamilyID(normalized)) return "";

    localStorage.setItem("savedFamilyID", normalized);

    const input = document.getElementById("family-id-input");
    if (input) input.value = normalized;

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

function showToast(message, type = "info") {
    const oldToast = document.getElementById("dashboard-toast");
    if (oldToast) oldToast.remove();

    const toast = document.createElement("div");
    toast.id = "dashboard-toast";
    toast.textContent = String(message || "");

    const bgColor =
        type === "success"
            ? "rgba(0, 200, 81, 0.96)"
            : type === "error"
                ? "rgba(255, 68, 68, 0.96)"
                : "rgba(51, 181, 229, 0.96)";

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
    }, 3000);
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

async function ensureInstallIdentity() {
    const tokenKey = getAccessTokenStorageKey();
    const installKey = getInstallIdStorageKey();
    const expiresKey = getTokenExpiresAtStorageKey();

    const storage = await getStorageValues([tokenKey, installKey, expiresKey, "userID", "familyID"]);

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

    const familyID = getCurrentFamilyID();
    const token = storage[tokenKey] || "";
    const expiresAt = Number(storage[expiresKey] || 0) * 1000;
    const refreshWindow = Number(window.CONFIG?.TOKEN_REFRESH_WINDOW_MS || 300000);

    if (token && expiresAt - Date.now() > refreshWindow) {
        return { accessToken: token, userID, installID, familyID };
    }

    try {
        const response = await fetchWithTimeout(`${getApiBaseUrl()}/api/auth/install`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ installID, userID, familyID })
        });

        let data = {};
        try { data = await response.json(); } catch (e) {}

        if (response.ok && data.accessToken) {
            await setStorageValues({
                [tokenKey]: data.accessToken,
                [expiresKey]: data.expiresAt || 0,
                userID: data.userID || userID,
                familyID: data.familyID || familyID
            });

            return { accessToken: data.accessToken, userID: data.userID || userID, installID, familyID: data.familyID || familyID };
        }

        console.warn("戰情室取得短效 token 失敗：", data.message || response.status);
    } catch (e) {
        console.warn("戰情室取得短效 token 失敗，請確認 API 是否可用。", e);
    }

    return { accessToken: token, userID, installID, familyID };
}

async function getApiHeaders() {
    const headers = { "Content-Type": "application/json" };
    const auth = await ensureInstallIdentity();

    if (auth.accessToken) headers.Authorization = `Bearer ${auth.accessToken}`;

    if (!auth.accessToken && isAuthRequired()) {
        throw new Error("尚未取得短效 accessToken，請先確認後端 API 可用，或重新綁定家庭群組。");
    }

    return headers;
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
    labelEl.style.cssText = "color:#8b949e;font-size:14px;font-weight:900;";

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
    box.style.cssText = "background:#161b22;border:1px solid rgba(139,148,158,.26);border-radius:18px;padding:16px;margin-bottom:16px;";

    const title = document.createElement("div");
    title.textContent = "社群防詐資料庫狀態";
    title.style.cssText = "color:#c9d1d9;font-size:15px;font-weight:1000;margin-bottom:10px;";

    const body = document.createElement("div");
    body.id = "modal-community-status-body";
    body.textContent = "正在查詢社群回報狀態...";
    body.style.cssText = "color:#8b949e;font-size:14px;line-height:1.7;font-weight:800;";

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
    note.style.cssText = "color:#c9d1d9;font-size:14px;line-height:1.7;";
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
        border:1px solid ${danger ? "rgba(255,77,79,.44)" : "rgba(139,148,158,.32)"};
        background:${danger ? "rgba(255,77,79,.16)" : "#21262d"};
        color:${danger ? "#ffaaa5" : "#ffffff"};
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
        background:rgba(0,0,0,0.86);
        color:white;
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
        background:#0d1117;
        border:1px solid rgba(255,255,255,.14);
        border-radius:24px;
        box-shadow:0 24px 80px rgba(0,0,0,.55);
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
        background:#ffffff;
        color:#111;
        font-size:28px;
        font-weight:900;
        cursor:pointer;
        z-index:2;
    `;

    const title = document.createElement("div");
    title.textContent = "【AI 防詐盾牌｜攔截事件詳情】";
    title.style.cssText = "color:#ff7875;font-size:24px;font-weight:1000;margin:4px 52px 8px 0;";

    const subtitle = document.createElement("div");
    subtitle.textContent = "這裡會說明攔截了哪個網址、為什麼攔截、是否已同步家庭戰情室，以及目前保存了哪些證據。";
    subtitle.style.cssText = "color:#c9d1d9;font-size:15px;line-height:1.7;margin-bottom:18px;";

    const topGrid = document.createElement("div");
    topGrid.style.cssText = "display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:16px;";

    const scoreCard = document.createElement("div");
    scoreCard.style.cssText = "background:rgba(255,77,79,.12);border:1px solid rgba(255,77,79,.28);border-radius:18px;padding:16px;";
    const scoreLabel = document.createElement("div");
    scoreLabel.textContent = "風險分數";
    scoreLabel.style.cssText = "color:#ffccc7;font-size:13px;font-weight:900;";
    const scoreValue = document.createElement("div");
    scoreValue.textContent = `${score} / 100`;
    scoreValue.style.cssText = "color:#ff7875;font-size:30px;font-weight:1000;margin-top:4px;";
    scoreCard.appendChild(scoreLabel);
    scoreCard.appendChild(scoreValue);

    const levelCard = document.createElement("div");
    levelCard.style.cssText = "background:rgba(255,187,51,.10);border:1px solid rgba(255,187,51,.24);border-radius:18px;padding:16px;";
    const levelLabel = document.createElement("div");
    levelLabel.textContent = "風險等級";
    levelLabel.style.cssText = "color:#ffe58f;font-size:13px;font-weight:900;";
    const levelValue = document.createElement("div");
    levelValue.textContent = riskLevel;
    levelValue.style.cssText = "color:#ffd666;font-size:24px;font-weight:1000;margin-top:7px;";
    levelCard.appendChild(levelLabel);
    levelCard.appendChild(levelValue);

    const syncCard = document.createElement("div");
    syncCard.style.cssText = "background:rgba(35,136,255,.10);border:1px solid rgba(35,136,255,.24);border-radius:18px;padding:16px;";
    const syncLabel = document.createElement("div");
    syncLabel.textContent = "家庭同步";
    syncLabel.style.cssText = "color:#9ecbff;font-size:13px;font-weight:900;";
    const syncValue = document.createElement("div");
    syncValue.textContent = familyID && familyID !== "none" ? `已綁定 ${familyID}` : "未綁定家庭";
    syncValue.style.cssText = "color:#79c0ff;font-size:20px;font-weight:1000;margin-top:8px;";
    syncCard.appendChild(syncLabel);
    syncCard.appendChild(syncValue);

    topGrid.appendChild(scoreCard);
    topGrid.appendChild(levelCard);
    topGrid.appendChild(syncCard);

    const infoBox = document.createElement("div");
    infoBox.style.cssText = "background:#161b22;border:1px solid rgba(139,148,158,.26);border-radius:18px;padding:16px;margin-bottom:16px;";
    infoBox.appendChild(createModalInfoRow("攔截網址", url, { bold: true }));
    infoBox.appendChild(createModalInfoRow("網域", domain));
    infoBox.appendChild(createModalInfoRow("攔截原因", reason, { color: "#ffd8d8", bold: true, large: true }));
    infoBox.appendChild(createModalInfoRow("建議動作", advice, { color: "#d2f8d2" }));
    infoBox.appendChild(createModalInfoRow("判定來源", source));
    infoBox.appendChild(createModalInfoRow("發生時間", formatTimestamp(timestamp)));
    infoBox.appendChild(createModalInfoRow("證據狀態", evidenceStatus, { color: imageUrl ? "#73d13d" : "#ffd666", bold: true }));

    const dnaBox = document.createElement("div");
    dnaBox.style.cssText = "background:#161b22;border:1px solid rgba(139,148,158,.26);border-radius:18px;padding:16px;margin-bottom:16px;";
    const dnaTitle = document.createElement("div");
    dnaTitle.textContent = "命中詐騙特徵";
    dnaTitle.style.cssText = "color:#c9d1d9;font-size:15px;font-weight:1000;margin-bottom:10px;";
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
    actionBox.style.cssText = "background:#161b22;border:1px solid rgba(139,148,158,.26);border-radius:18px;padding:16px;margin-bottom:16px;";

    const actionTitle = document.createElement("div");
    actionTitle.textContent = "後續處理";
    actionTitle.style.cssText = "color:#c9d1d9;font-size:15px;font-weight:1000;margin-bottom:10px;";

    const actionNote = document.createElement("div");
    actionNote.textContent = "確認這是詐騙時，可送入社群防詐回報池。系統會累積多方回報，達門檻才提高全域風險，不會因單一回報直接封鎖全平台。";
    actionNote.style.cssText = "color:#8b949e;font-size:13px;line-height:1.65;margin-bottom:12px;";

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
    evidenceBox.style.cssText = "background:#161b22;border:1px solid rgba(139,148,158,.26);border-radius:18px;padding:16px;";
    const evidenceTitle = document.createElement("div");
    evidenceTitle.textContent = "證據快照";
    evidenceTitle.style.cssText = "color:#c9d1d9;font-size:15px;font-weight:1000;margin-bottom:10px;";
    evidenceBox.appendChild(evidenceTitle);

    if (imageUrl) {
        const img = document.createElement("img");
        img.src = imageUrl;
        img.alt = "詐騙網頁證據快照";
        img.style.cssText = "width:100%;max-height:58vh;object-fit:contain;border:3px solid #ff7875;border-radius:14px;background:#000;";
        evidenceBox.appendChild(img);
    } else {
        const empty = document.createElement("div");
        empty.textContent = loadError
            ? `目前無法讀取完整截圖，但攔截摘要仍保留在戰情室。${loadError}`
            : "此筆紀錄目前只保存摘要，未保存完整截圖。這是正式版較安全的隱私預設；仍可從上方確認網址、原因、分數與詐騙特徵。";
        empty.style.cssText = "padding:28px;border:2px dashed rgba(139,148,158,.35);border-radius:14px;color:#c9d1d9;text-align:center;line-height:1.7;background:#0d1117;";
        evidenceBox.appendChild(empty);
    }

    const footer = document.createElement("div");
    footer.textContent = familyID && familyID !== "none"
        ? `同步說明：此家庭代碼為 ${familyID}。若後端連線正常，掃描紀錄會出現在家庭戰情室。`
        : "同步說明：目前未綁定家庭代碼，因此只會顯示本機攔截資訊。";
    footer.style.cssText = "color:#8b949e;font-size:13px;line-height:1.7;margin-top:14px;text-align:center;";

    panel.appendChild(closeBtn);
    panel.appendChild(title);
    panel.appendChild(subtitle);
    panel.appendChild(topGrid);
    panel.appendChild(infoBox);
    panel.appendChild(dnaBox);
    panel.appendChild(communityStatusBox);
    panel.appendChild(actionBox);
    panel.appendChild(evidenceBox);
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

    if (!evidenceID) {
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
            showInterceptDetailModal(record, { evidenceID }, data.message || "找不到對應的證據快照。仍顯示攔截摘要。");
            return;
        }

        showInterceptDetailModal(record, {
            ...data,
            evidenceID
        });
    } catch (error) {
        showInterceptDetailModal(record, { evidenceID }, error.message || "讀取證據失敗");
    }
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

    if (!ratioCanvas || !trendCanvas || typeof Chart === "undefined") {
        return;
    }

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
                        color: "#ffffff",
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
                        color: "#8b949e"
                    },
                    grid: {
                        color: "rgba(139,148,158,0.18)"
                    }
                },
                y: {
                    min: 0,
                    max: 100,
                    ticks: {
                        color: "#8b949e"
                    },
                    grid: {
                        color: "rgba(139,148,158,0.18)"
                    }
                }
            },
            plugins: {
                legend: {
                    labels: {
                        color: "#ffffff",
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

function updateStats(records) {
    const high = getRiskThresholdHigh();
    const medium = getRiskThresholdMedium();

    const total = records.length;
    const danger = records.filter(record => record.riskScore >= high).length;
    const safe = records.filter(record => record.riskScore < medium).length;

    animateNumber(document.getElementById("stat-total"), total);
    animateNumber(document.getElementById("stat-safe"), safe);
    animateNumber(document.getElementById("stat-danger"), danger);
}

function createRiskCell(score) {
    const td = document.createElement("td");
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

    const status = document.createElement("div");
    const score = record.riskScore;

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
    detailBtn.textContent = record.evidenceID ? "查看詳情 / 證據" : "查看詳情";
    detailBtn.style.cssText = `
        margin-top:8px;
        padding:6px 10px;
        font-size:13px;
        border-radius:6px;
        background:#30363d;
        color:white;
        border:1px solid #555;
        cursor:pointer;
    `;
    detailBtn.addEventListener("click", () => openEvidence(record));
    td.appendChild(detailBtn);

    if (report?.whitelistScope) {
        const whitelist = document.createElement("div");
        whitelist.textContent = `白名單：${report.whitelistScope}`;
        whitelist.style.cssText = `
            margin-top:6px;
            color:#8b949e;
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
    timeTd.textContent = formatTimestamp(record.timestamp);

    const urlTd = document.createElement("td");
    const recordReport = safeParseReport(record.report);
    const urlText = record.domain || record.url || record.url_preview || recordReport.originalUrl || recordReport.original_url || recordReport.url || "未知網址";
    urlTd.textContent = truncateMiddle(urlText, 72);
    urlTd.title = String(record.url || record.url_preview || recordReport.originalUrl || recordReport.original_url || recordReport.url || urlText || "");

    const riskTd = createRiskCell(score);

    const reasonTd = document.createElement("td");

    const reasonMain = document.createElement("div");
    reasonMain.textContent = report.reason || record.reason || "未提供分析";
    reasonMain.style.cssText = "line-height:1.55;";

    reasonTd.appendChild(reasonMain);

    if (Array.isArray(report.scamDNA) && report.scamDNA.length > 0) {
        const dna = document.createElement("div");
        dna.textContent = "心理操縱術：" + report.scamDNA.join("、");
        dna.style.cssText = `
            margin-top:8px;
            color:#8b949e;
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
            color:#c9d1d9;
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
            color:#ffd666;
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

    return {
        row: tr,
        normalizedRecord
    };
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

function renderDashboard(records) {
    currentRecords = normalizeRecords(records);

    updateStats(currentRecords);
    renderCharts(currentRecords);
    renderTable(currentRecords);
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

    try {
        const response = await fetchWithTimeout(`${getApiBaseUrl()}/api/get_alerts`, {
            method: "POST",
            headers: await getApiHeaders(),
            body: JSON.stringify({
                familyID
            })
        });

        const data = await response.json();

        if (!response.ok || data.status !== "success") {
            throw new Error(data.message || "讀取戰情紀錄失敗");
        }

        renderDashboard(Array.isArray(data.data) ? data.data : []);
    } catch (error) {
        showToast(`更新失敗：${error.message}`, "error");
    } finally {
        isFetching = false;
    }
}

async function clearAlerts() {
    const familyID = getCurrentFamilyID();

    if (!isValidFamilyID(familyID)) {
        showToast("請先輸入 6 碼家庭邀請碼。", "error");
        return;
    }

    const ok = window.confirm(`確定要清空家庭 ${familyID} 的所有戰情紀錄與證據摘要嗎？`);
    if (!ok) return;

    try {
        const response = await fetchWithTimeout(`${getApiBaseUrl()}/api/clear_alerts`, {
            method: "POST",
            headers: await getApiHeaders(),
            body: JSON.stringify({
                familyID
            })
        });

        const data = await response.json();

        if (!response.ok || data.status !== "success") {
            throw new Error(data.message || "清空失敗");
        }

        renderDashboard([]);
        showToast("已清空目前家庭戰情紀錄。", "success");
    } catch (error) {
        showToast(`清空失敗：${error.message}`, "error");
    }
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

    localStorage.setItem("savedFamilyID", familyID);

    const input = document.getElementById("family-id-input");
    if (input) input.value = familyID;

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

    localStorage.setItem("savedFamilyID", familyID);

    const input = document.getElementById("family-id-input");
    if (input) input.value = familyID;

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
            const auth = await ensureInstallIdentity();

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

        socket.on("demo_reset_triggered", payload => {
            renderDashboard([]);
            showToast(payload?.message || "Demo 已重置。", "success");
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

// ==========================================
// 初始化
// ==========================================
function bindEvents() {
    const input = document.getElementById("family-id-input");
    const savedFamilyID = localStorage.getItem("savedFamilyID");

    if (input && savedFamilyID) {
        input.value = savedFamilyID;
    }

    document.getElementById("btn-start")?.addEventListener("click", startSocket);
    document.getElementById("btn-stop")?.addEventListener("click", stopSocket);
    document.getElementById("btn-manual")?.addEventListener("click", fetchAlerts);
    document.getElementById("btn-clear-logs")?.addEventListener("click", clearAlerts);

    input?.addEventListener("input", event => {
        event.target.value = event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
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

    const urlOptions = getDashboardUrlOptions();
    const savedFamilyID = normalizeDashboardFamilyID(localStorage.getItem("savedFamilyID"));
    const initialFamilyID = applyFamilyIDToDashboard(urlOptions.familyID || savedFamilyID);

    if (initialFamilyID) {
        setConnectionStatus(`待連線：${initialFamilyID}`, false);

        if (urlOptions.autoStart) {
            await startSocket();
        } else {
            await fetchAlerts();
        }
    } else {
        setConnectionStatus("🔴 尚未連線 / 閒置中", false);
        renderDashboard([]);
    }
});