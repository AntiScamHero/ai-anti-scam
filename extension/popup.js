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
 * 8. AI 平台誤判保護：DeepSeek / ChatGPT / Claude 手動掃描降權
 */

let currentUserID = "";
let currentFamilyID = "none";
let pollingInterval = null;
let latestScanReport = null;
let goldenCountdownTimer = null;
let didAutoScanOnOpen = false;


const SHARED_FAMILY_ID_KEY = "AI_SHIELD_FAMILY_ID";
const FAMILY_ID_SYNC_KEYS = [
    "savedFamilyID",
    "aiShieldPrimaryFamilyID",
    SHARED_FAMILY_ID_KEY,
    "currentFamilyID",
    "boundFamilyID",
    "familyCode",
    "dashboardFamilyID",
    "popupFamilyID",
    "aiShieldFamilyID",
    "familyID"
];

function pickBestFamilyIDFromStorage(storage = {}) {
    for (const key of FAMILY_ID_SYNC_KEYS) {
        const normalized = normalizeFamilyCode(storage?.[key]);
        if (normalized) return normalized;
    }
    return "";
}

function buildSharedFamilyPayload(familyID, extra = {}) {
    const normalized = normalizeFamilyCode(familyID);
    const payload = {
        ...extra,
        aiShieldFamilyBindingUpdatedAt: new Date().toISOString(),
        aiShieldFamilyBindingSource: "popup-sync"
    };
    FAMILY_ID_SYNC_KEYS.forEach(key => {
        payload[key] = normalized;
    });
    return payload;
}

async function persistSharedFamilyID(familyID, extra = {}) {
    const normalized = normalizeFamilyCode(familyID);
    if (!normalized) return "";

    try {
        FAMILY_ID_SYNC_KEYS.forEach(key => localStorage.setItem(key, normalized));
        localStorage.setItem("aiShieldFamilyBindingUpdatedAt", new Date().toISOString());
        localStorage.setItem("aiShieldFamilyBindingSource", "popup-sync");
    } catch (e) {}

    try {
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
            await chrome.storage.local.set(buildSharedFamilyPayload(normalized, extra));
        }
    } catch (e) {}

    return normalized;
}

function setupPopupFamilyStorageListener() {
    try {
        if (typeof chrome === "undefined" || !chrome.storage?.onChanged) return;

        chrome.storage.onChanged.addListener((changes, areaName) => {
            if (areaName !== "local") return;

            const touched = FAMILY_ID_SYNC_KEYS.some(key => Boolean(changes[key]));
            if (!touched) return;

            chrome.storage.local.get(FAMILY_ID_SYNC_KEYS).then(storage => {
                const nextFamilyID = pickBestFamilyIDFromStorage(storage);
                if (!nextFamilyID || nextFamilyID === currentFamilyID) return;

                currentFamilyID = nextFamilyID;
                updateUIAsBound(currentFamilyID);
                startFamilyAlertsPolling(currentFamilyID);
                showToast(`家庭代碼已同步：${currentFamilyID}`, "success");
            }).catch(() => {});
        });
    } catch (e) {}
}



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

function uniqueUrls(urls) {
    return [...new Set(urls.filter(Boolean))];
}

function getScanEndpointCandidates() {
    const baseUrl = String(getApiBaseUrl() || "").replace(/\/+$/, "");
    const configuredPath = String(getConfigValue("SCAN_API_PATH", "/scan") || "/scan");
    const normalizedConfiguredPath = configuredPath.startsWith("/")
        ? configuredPath
        : `/${configuredPath}`;

    return uniqueUrls([
        `${baseUrl}${normalizedConfiguredPath}`,
        `${baseUrl}/scan`,
        `${baseUrl}/api/scan`
    ]);
}

async function postScanRequest(payload) {
    const headers = await getApiHeaders();
    const body = JSON.stringify(payload);
    const endpoints = getScanEndpointCandidates();

    let lastError = null;

    for (const endpoint of endpoints) {
        try {
            return await fetchWithRetry(endpoint, {
                method: "POST",
                headers,
                body
            });
        } catch (error) {
            lastError = error;
            const message = String(error?.message || error || "");

            // 只有掃描端點 404 時，才嘗試下一個相容路徑；401 / 403 / timeout 等錯誤不亂換路徑。
            if (!message.includes("404")) {
                break;
            }

            console.info(`Popup 掃描端點不存在，改試下一個相容路徑：${endpoint}`);
        }
    }

    throw lastError || new Error("掃描 API 連線失敗。");
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
        ...FAMILY_ID_SYNC_KEYS
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

    const familyID = pickBestFamilyIDFromStorage(storage) || "none";
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

    if (auth.accessToken) {
        headers.Authorization = `Bearer ${auth.accessToken}`;
    }

    // 雲端優先，但 token 暫時取不到時不要丟錯誤到前台。
    // /scan 會先嘗試送出；若後端拒絕或連線失敗，再由 scanCurrentPage 靜默改用本機 AI 備援。
    return headers;
}


// ==========================================
// 家庭邀請 QR Code / LINE 分享
// ==========================================
function normalizeFamilyCode(code) {
    const value = String(code || "").trim().toUpperCase().replace(/^AISHIELD:/, "").replace(/^FAM-/, "");
    return /^[A-Z0-9]{6}$/.test(value) ? value : "";
}

function buildInviteText(familyID = currentFamilyID) {
    const code = normalizeFamilyCode(familyID);
    return code ? `aishield:${code}` : "";
}

function drawFinder(matrix, x, y) {
    for (let dy = -1; dy <= 7; dy++) {
        for (let dx = -1; dx <= 7; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= 21 || yy >= 21) continue;
            const inOuter = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6;
            const inInner = dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4;
            const onBorder = dx === 0 || dx === 6 || dy === 0 || dy === 6;
            matrix[yy][xx] = inOuter && (onBorder || inInner);
        }
    }
}

function gfMul(a, b) {
    let result = 0;
    while (b > 0) {
        if (b & 1) result ^= a;
        a <<= 1;
        if (a & 0x100) a ^= 0x11D;
        b >>= 1;
    }
    return result & 0xFF;
}

function gfPow2(exp) {
    let value = 1;
    for (let i = 0; i < exp; i++) value = gfMul(value, 2);
    return value;
}

function rsGenerator(degree) {
    let poly = [1];
    for (let i = 0; i < degree; i++) {
        const next = new Array(poly.length + 1).fill(0);
        const root = gfPow2(i);
        for (let j = 0; j < poly.length; j++) {
            next[j] ^= gfMul(poly[j], root);
            next[j + 1] ^= poly[j];
        }
        poly = next;
    }
    return poly;
}

function rsRemainder(data, degree) {
    const gen = rsGenerator(degree);
    const result = new Array(degree).fill(0);
    data.forEach(byte => {
        const factor = byte ^ result[0];
        result.shift();
        result.push(0);
        for (let i = 0; i < degree; i++) {
            result[i] ^= gfMul(gen[i + 1], factor);
        }
    });
    return result;
}

function appendBits(bits, value, length) {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
}

function makeQrMatrixV1L(text) {
    const bytes = Array.from(new TextEncoder().encode(String(text || "")));
    if (bytes.length > 17) throw new Error("QR 資料過長");

    const dataBits = [];
    appendBits(dataBits, 0b0100, 4); // byte mode
    appendBits(dataBits, bytes.length, 8);
    bytes.forEach(byte => appendBits(dataBits, byte, 8));
    appendBits(dataBits, 0, Math.min(4, 152 - dataBits.length));
    while (dataBits.length % 8 !== 0) dataBits.push(0);

    const dataCodewords = [];
    for (let i = 0; i < dataBits.length; i += 8) {
        let value = 0;
        for (let j = 0; j < 8; j++) value = (value << 1) | dataBits[i + j];
        dataCodewords.push(value);
    }
    for (let pad = 0; dataCodewords.length < 19; pad++) {
        dataCodewords.push(pad % 2 === 0 ? 0xEC : 0x11);
    }

    const ecc = rsRemainder(dataCodewords, 7);
    const codewords = dataCodewords.concat(ecc);
    const bits = [];
    codewords.forEach(byte => appendBits(bits, byte, 8));

    const size = 21;
    const matrix = Array.from({ length: size }, () => Array(size).fill(null));

    drawFinder(matrix, 0, 0);
    drawFinder(matrix, 14, 0);
    drawFinder(matrix, 0, 14);

    for (let i = 8; i < 13; i++) {
        matrix[6][i] = i % 2 === 0;
        matrix[i][6] = i % 2 === 0;
    }

    matrix[13][8] = true; // dark module

    // Reserve format information cells.
    const reserve = [[8,0],[8,1],[8,2],[8,3],[8,4],[8,5],[8,7],[8,8],[7,8],[5,8],[4,8],[3,8],[2,8],[1,8],[0,8]];
    for (let i = 0; i < 8; i++) reserve.push([20 - i, 8]);
    for (let i = 8; i < 15; i++) reserve.push([8, 6 + i]);
    reserve.forEach(([x, y]) => { if (matrix[y] && matrix[y][x] === null) matrix[y][x] = false; });

    let bitIndex = 0;
    let upward = true;
    for (let right = size - 1; right >= 1; right -= 2) {
        if (right === 6) right--;
        for (let vert = 0; vert < size; vert++) {
            const y = upward ? size - 1 - vert : vert;
            for (let x = right; x >= right - 1; x--) {
                if (matrix[y][x] !== null) continue;
                let bit = bitIndex < bits.length ? bits[bitIndex] === 1 : false;
                bitIndex += 1;
                if ((x + y) % 2 === 0) bit = !bit; // mask 0
                matrix[y][x] = bit;
            }
        }
        upward = !upward;
    }

    const format = 0b111011111000100; // ECC L, mask 0
    function fbit(i) { return ((format >>> i) & 1) === 1; }

    for (let i = 0; i <= 5; i++) matrix[8][i] = fbit(i);
    matrix[8][7] = fbit(6);
    matrix[8][8] = fbit(7);
    matrix[7][8] = fbit(8);
    for (let i = 9; i < 15; i++) matrix[14 - i][8] = fbit(i);

    for (let i = 0; i < 8; i++) matrix[size - 1 - i][8] = fbit(i);
    for (let i = 8; i < 15; i++) matrix[8][size - 15 + i] = fbit(i);

    return matrix;
}

function renderFamilyQRCode(familyID = currentFamilyID) {
    const code = normalizeFamilyCode(familyID);
    const box = document.getElementById("family_qr_box");
    const canvas = document.getElementById("family_qr_canvas");
    const textEl = document.getElementById("family_qr_text");

    if (!box || !canvas || !textEl) return;

    if (!code) {
        box.style.display = "none";
        textEl.textContent = "";
        return;
    }

    const inviteText = buildInviteText(code);
    const size = 21;
    const scale = Math.floor(canvas.width / (size + 8));
    const offset = Math.floor((canvas.width - size * scale) / 2);

    try {
        const matrix = makeQrMatrixV1L(inviteText);
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#111827";

        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                if (matrix[y][x]) {
                    ctx.fillRect(offset + x * scale, offset + y * scale, scale, scale);
                }
            }
        }

        box.style.display = "block";
        textEl.textContent = `掃描內容：${inviteText}`;
    } catch (error) {
        console.warn("家庭邀請 QR Code 產生失敗：", error);
        box.style.display = "block";
        textEl.textContent = `QR Code 暫時無法產生，請改用邀請碼：${inviteText}`;
    }
}

function resetFamilyQRCodeUI() {
    const box = document.getElementById("family_qr_box");
    const textEl = document.getElementById("family_qr_text");
    const btnToggleQR = document.getElementById("btn_toggle_qr");

    if (box) box.style.display = "none";
    if (textEl) textEl.textContent = "";
    if (btnToggleQR) btnToggleQR.textContent = "顯示 QR Code 給家人掃";
}

function updateFamilyQRCodeToggleVisibility() {
    const btnToggleQR = document.getElementById("btn_toggle_qr");
    if (!btnToggleQR) return;

    const hasFamily = normalizeFamilyCode(currentFamilyID) !== "";
    btnToggleQR.style.display = hasFamily ? "block" : "none";

    if (!hasFamily) {
        resetFamilyQRCodeUI();
    }
}

function toggleFamilyQRCode() {
    const code = normalizeFamilyCode(currentFamilyID);
    const box = document.getElementById("family_qr_box");
    const btnToggleQR = document.getElementById("btn_toggle_qr");

    if (!code) {
        showToast("目前尚未建立或綁定家庭群組。", "error");
        return;
    }

    if (!box) return;

    const isOpen = box.style.display !== "none" && box.style.display !== "";

    if (isOpen) {
        resetFamilyQRCodeUI();
        return;
    }

    renderFamilyQRCode(code);

    if (btnToggleQR) {
        btnToggleQR.textContent = "收起 QR Code";
    }
}

async function shareInviteToLine() {
    const inviteText = buildInviteText(currentFamilyID);
    if (!inviteText) {
        showToast("目前尚未建立或綁定家庭群組。", "error");
        return;
    }

    const message = `AI防詐盾牌家庭守護邀請碼：${inviteText}\n請打開 AI 防詐盾牌，貼上或掃描這組代碼加入家庭守護。`;

    try {
        await navigator.clipboard.writeText(inviteText);
    } catch (e) {
        console.warn("邀請碼複製失敗，仍嘗試開啟 LINE 分享。", e);
    }

    const lineUrl = `https://line.me/R/msg/text/?${encodeURIComponent(message)}`;
    try {
        await chrome.tabs.create({ url: lineUrl });
        showToast("已開啟 LINE 分享；QR Code 也已顯示在 Popup。", "success");
    } catch (e) {
        window.open(lineUrl, "_blank");
        showToast("已複製邀請碼，請貼到 LINE 傳給家人。", "success");
    }
}

// ==========================================
// UI 狀態
// ==========================================
function updateUIAsBound(familyID) {
    const normalizedFamilyID = normalizeFamilyCode(familyID);
    currentFamilyID = normalizedFamilyID || "none";

    const statusText = currentFamilyID !== "none"
        ? `狀態：已綁定家庭群組 ${currentFamilyID}`
        : "狀態：尚未綁定";

    setTextById("family-status", statusText);
    setTextById("bind-status", statusText);

    const familyCodeDisplay = document.getElementById("family-code-display");
    if (familyCodeDisplay) {
        familyCodeDisplay.style.display = currentFamilyID !== "none" ? "block" : "none";
    }

    const displayCode = document.getElementById("display_code");
    if (displayCode) {
        displayCode.textContent = currentFamilyID !== "none" ? currentFamilyID : "------";
    }

    const inviteInput = document.getElementById("invite_input");
    if (inviteInput && currentFamilyID !== "none") {
        inviteInput.value = currentFamilyID;
    }

    try {
        if (currentFamilyID !== "none") {
            FAMILY_ID_SYNC_KEYS.forEach(key => localStorage.setItem(key, currentFamilyID));

            if (typeof chrome !== "undefined" && chrome.storage?.local) {
                chrome.storage.local.set(buildSharedFamilyPayload(currentFamilyID));
            }
        }
    } catch (e) {}

    resetFamilyQRCodeUI();
    updateFamilyQRCodeToggleVisibility();
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


function localPopupRiskAnalysis(url, text, cloudErrorMessage = "") {
    const source = `${url || ""}\n${text || ""}`.toLowerCase();
    const matchedTags = [];
    const reasons = [];
    let score = 8;

    const rules = [
        {
            label: "要求輸入驗證碼或一次性密碼",
            score: 26,
            patterns: ["驗證碼", "otp", "one-time password", "一次性密碼", "簡訊碼"]
        },
        {
            label: "要求匯款或轉帳",
            score: 28,
            patterns: ["匯款", "轉帳", "atm", "網銀", "帳戶", "保證金", "手續費"]
        },
        {
            label: "投資一般關鍵字",
            score: 10,
            patterns: ["投資", "股票", "飆股", "理財", "基金", "ETF", "etf"]
        },
        {
            label: "投資高報酬話術",
            score: 30,
            patterns: ["穩賺", "保證獲利", "高報酬", "低風險高收益", "內線", "老師帶單", "投資群組"]
        },
        {
            label: "假冒官方或客服",
            score: 24,
            patterns: ["客服", "官方", "帳號異常", "安全驗證", "重新認證", "解除分期", "解除設定"]
        },
        {
            label: "製造緊急壓力",
            score: 22,
            patterns: ["立即", "馬上", "最後通知", "限時", "逾期", "凍結", "停權", "警告"]
        },
        {
            label: "索取個資或金融資料",
            score: 25,
            patterns: ["身分證", "信用卡", "卡號", "cvv", "出生年月日", "個人資料", "金融卡", "銀行帳號"]
        },
        {
            label: "可疑短網址或跳轉連結",
            score: 18,
            patterns: ["bit.ly", "tinyurl", "reurl.cc", "lihi", "shorturl", "ppt.cc"]
        }
    ];

    rules.forEach(rule => {
        const hit = rule.patterns.some(pattern => source.includes(pattern));
        if (hit) {
            score += rule.score;
            matchedTags.push(rule.label);
            reasons.push(rule.label);
        }
    });

    try {
        const parsedUrl = new URL(url || "");
        const hostname = parsedUrl.hostname.toLowerCase();

        if (/xn--|[0-9]{1,3}(\.[0-9]{1,3}){3}/.test(hostname)) {
            score += 18;
            matchedTags.push("可疑網域格式");
            reasons.push("網址格式異常，可能不是正式網站。");
        }

        if (hostname.split(".").length >= 4) {
            score += 10;
            matchedTags.push("多層子網域");
        }
    } catch (e) {
        // 無法解析網址時不讓本機備援失敗。
    }

    score = Math.max(0, Math.min(score, 96));

    const high = getRiskThresholdHigh();
    const medium = getRiskThresholdMedium();

    const riskLevel =
        score >= high
            ? "極度危險"
            : score >= medium
                ? "中高風險"
                : "低風險";

    const reason =
        reasons.length > 0
            ? `雲端掃描暫時不可用，已由本機防護依頁面文字與網址判斷：${reasons.slice(0, 3).join("、")}。`
            : "雲端掃描暫時不可用，本機防護未發現明顯高風險詐騙話術，但仍建議保持警覺。";

    const advice =
        score >= medium
            ? "請先不要輸入個資、驗證碼、信用卡資料或進行匯款；若涉及金錢或帳號安全，請改用官方 App 或自行輸入官方網址確認。"
            : "目前未偵測到明顯高風險特徵，但請勿點擊不明連結或提供敏感資料。";

    return {
        riskScore: score,
        riskLevel,
        scamDNA: matchedTags.length ? [...new Set(matchedTags)] : ["本機基礎檢查"],
        reason,
        advice,
        references: [],
        fallback: true,
        cloudError: String(cloudErrorMessage || "").slice(0, 160)
    };
}



// ------------------------------------------------------------
// 誤判修正：可信搜尋結果頁硬放行
// 例：google.com.tw/search?q=飆股 只是搜尋資料，不應直接高風險攔截。
// 真正要攔的是點進去後出現「老師帶單 / LINE 群 / 保證獲利 / 入金匯款」的頁面。
// ------------------------------------------------------------
function normalizeDomainHost(host) {
    return String(host || "").replace(/^www\./, "").toLowerCase();
}

function isGoogleDomain(host) {
    const cleanHost = normalizeDomainHost(host);
    return cleanHost === "google.com" || /^google\.[a-z.]+$/i.test(cleanHost);
}

function isBingDomain(host) {
    const cleanHost = normalizeDomainHost(host);
    return cleanHost === "bing.com" || cleanHost.endsWith(".bing.com");
}

function isYahooDomain(host) {
    const cleanHost = normalizeDomainHost(host);
    return cleanHost === "yahoo.com" || cleanHost.endsWith(".yahoo.com") || cleanHost.endsWith(".yahoo.com.tw");
}

function isTrustedSearchResultPage(urlString = "") {
    try {
        const url = new URL(urlString || "");
        const host = normalizeDomainHost(url.hostname);
        const path = url.pathname.toLowerCase();
        return (
            isGoogleDomain(host) && path === "/search"
        ) || (
            isBingDomain(host) && path === "/search"
        ) || (
            isYahooDomain(host) && path.includes("search")
        );
    } catch (e) {
        return false;
    }
}

function getSearchQueryText(urlString = "") {
    try {
        const url = new URL(urlString || "");
        return decodeURIComponent(url.searchParams.get("q") || url.searchParams.get("p") || "").toLowerCase();
    } catch (e) {
        return "";
    }
}

function isRestrictedBrowserOrExtensionPage(urlString = "") {
    const value = String(urlString || "").trim().toLowerCase();

    if (!value) return true;

    return (
        value.startsWith("chrome://") ||
        value.startsWith("chrome-extension://") ||
        value.startsWith("edge://") ||
        value.startsWith("about:") ||
        value.startsWith("devtools://") ||
        value.startsWith("view-source:chrome://") ||
        value.startsWith("view-source:chrome-extension://")
    );
}

function buildRestrictedPageReport(urlString = "") {
    const value = String(urlString || "").toLowerCase();
    const pageType = value.startsWith("chrome-extension://")
        ? "AI 防詐盾牌擴充功能內部頁面"
        : "瀏覽器內部頁面";

    return {
        riskScore: 0,
        score: 0,
        riskLevel: "安全無虞",
        scamDNA: ["內部系統頁面放行"],
        reason: `${pageType} 受到 Chrome 安全機制保護，擴充功能不能也不需要讀取此頁文字，因此已直接放行。`,
        advice: "這不是一般網頁，不會進行防詐掃描；請切到外部網站後再按掃描目前頁面。",
        restrictedPageHardPass: true,
        references: []
    };
}

function isInvestmentSearchQuery(urlString = "") {
    const query = getSearchQueryText(urlString);
    return /投資|股票|飆股|理財|基金|etf|虛擬貨幣|usdt|btc|crypto|加密貨幣/i.test(query);
}

function buildTrustedSearchPageReport(urlString = "") {
    const query = getSearchQueryText(urlString);
    const isInvestment = isInvestmentSearchQuery(urlString);
    return {
        riskScore: isInvestment ? 20 : 10,
        score: isInvestment ? 20 : 10,
        riskLevel: "低風險",
        scamDNA: [isInvestment ? "可信搜尋頁投資查詢放行" : "可信搜尋結果頁放行"],
        reason: isInvestment
            ? `目前是可信搜尋引擎的搜尋結果頁${query ? `（搜尋：${query}）` : ""}，搜尋投資、股票或飆股等關鍵字本身不等於詐騙，系統不會攔截。`
            : "目前是可信搜尋引擎的搜尋結果頁，尚未偵測到直接要求付款或輸入個資的高風險操作。",
        advice: "可以繼續查資料；若點入外部頁面後出現加入 LINE 群、保證獲利、入金匯款、輸入信用卡或驗證碼，請立即停止並重新掃描。",
        searchPageHardPass: true,
        references: []
    };
}


// ==========================================
// AI 平台誤判保護：DeepSeek / ChatGPT / Claude
// ==========================================
function isAiPlatformUrl(urlString = "") {
    try {
        const host = new URL(urlString || "").hostname.toLowerCase().replace(/^www\./, "");

        return (
            host === "chat.deepseek.com" ||
            host === "deepseek.com" ||
            host.endsWith(".deepseek.com") ||
            host === "chatgpt.com" ||
            host === "openai.com" ||
            host.endsWith(".openai.com") ||
            host === "claude.ai" ||
            host.endsWith(".claude.ai")
        );
    } catch (e) {
        return false;
    }
}

function hasDangerousActionText(text = "") {
    const value = String(text || "").toLowerCase();

    return /(?:請|立即|馬上|現在|立刻).{0,12}(點擊|輸入|匯款|轉帳|付款|掃描|掃qr|下載|安裝|加入|加line|加 line)|輸入.{0,8}(驗證碼|信用卡|提款卡密碼|銀行帳號|身分證)|下載apk|掃.{0,8}qr.{0,8}(付款|領獎|補助|驗證)|匯款到|轉帳到/i.test(value);
}

function isLikelyDiscussionContext(text = "") {
    const value = String(text || "").toLowerCase();

    return /防詐|詐騙|說明|分析|案例|教學|範例|測試|競賽|專案|報告|修改程式碼|為什麼|如何|怎麼|不要|避免|提醒|查證|165|false positive|誤判/i.test(value);
}

function applyAiPlatformPopupGuard(tabUrl = "", pageText = "", reportData = {}) {
    if (!isAiPlatformUrl(tabUrl)) {
        return reportData;
    }

    const scamDNA = Array.isArray(reportData.scamDNA) ? reportData.scamDNA : [];
    const combinedText = [
        pageText,
        reportData.reason,
        reportData.advice,
        reportData.riskLevel,
        scamDNA.join(" ")
    ].join("\n");

    const hasDangerousAction = hasDangerousActionText(combinedText);
    const isDiscussion = isLikelyDiscussionContext(combinedText);

    // AI 平台上如果只是討論詐騙、投資、QR Code、NFT、防詐案例，不應直接攔截。
    // 只有出現明確要求使用者執行付款、匯款、輸入驗證碼、下載 APK、掃 QR 付款等操作，才保留高風險。
    if (hasDangerousAction && !isDiscussion) {
        return {
            ...reportData,
            aiPlatformGuard: "dangerous_action_detected"
        };
    }

    const originalScore = normalizeRiskScore(reportData);
    const safeScore = Math.min(originalScore || 25, 35);

    return {
        ...reportData,
        riskScore: safeScore,
        score: safeScore,
        riskLevel: "AI 平台內容討論",
        reason: "目前是在 AI 對話平台上討論可能的風險內容，未偵測到直接要求付款、匯款、輸入驗證碼、下載 APK 或掃 QR 付款等操作，因此不直接攔截。",
        advice: "可以繼續查資料；如果對方要求你離開平台、加入 LINE、匯款、輸入驗證碼或下載不明 App，請立即停止。",
        scamDNA: [
            "AI 平台討論降權",
            ...scamDNA.filter(Boolean).slice(0, 4)
        ],
        aiPlatformAdjusted: true,
        originalRiskScore: originalScore
    };
}

async function scanCurrentPage() {
    const scanBtn = document.getElementById("scan-btn");

    if (scanBtn?.dataset.isEscape === "true") {
        await redirectActiveTabToBlocked(scanBtn.dataset.blockReason || "系統深層掃描發現高度危險特徵！");
        return;
    }

    let tab = null;
    let maskedText = "";

    try {
        setLoading(true);

        tab = await getActiveTab();

        if (!tab || !tab.id || !tab.url) {
            throw new Error("無法取得目前分頁。");
        }

        // Chrome / Edge / 擴充功能內部頁面不能注入腳本讀文字。
        // 先直接放行，避免 chrome.scripting.executeScript 觸發開發者錯誤：
        // Cannot access contents of url "chrome-extension://..."。
        if (isRestrictedBrowserOrExtensionPage(tab.url)) {
            renderScanResult(buildRestrictedPageReport(tab.url));
            return;
        }

        // 搜尋結果頁硬放行：不送雲端、不啟動高風險倒數，避免查資料被攔截。
        if (isTrustedSearchResultPage(tab.url)) {
            renderScanResult(buildTrustedSearchPageReport(tab.url));
            return;
        }

        const rawText = await getCurrentPageText(tab.id);
        maskedText = maskSensitiveData(rawText);

        const isAiPlatform = isAiPlatformUrl(tab.url);

        const response = await postScanRequest({
            url: tab.url,
            text: maskedText,
            userID: currentUserID || "anonymous",
            familyID: currentFamilyID || "none",
            source: "popup_demo",
            requestSource: "popup_demo",
            scan_source: "popup_demo",
            demoMode: true,
            suppressLine: true,
            suppressLineAlert: true,
            allowLinePush: false,
            page_category: isAiPlatform ? "ai_platform" : "normal_page",
            ai_platform_guard: isAiPlatform
        });

        let data = {};

        try {
            data = await response.json();
        } catch (e) {
            data = {
                riskScore: 0,
                riskLevel: "低風險",
                reason: "伺服器回傳格式異常，但未偵測到明確風險。",
                advice: "請保持一般警覺。"
            };
        }

        let reportData = safeParseReport(data);
        reportData = applyAiPlatformPopupGuard(tab.url, maskedText, reportData);
        renderScanResult(reportData);
    } catch (error) {
        // 正式展示時不要把 token / 後端暫時問題顯示成紅色錯誤。
        // 雲端 API 失敗時，直接改用本機 AI 備援並正常渲染結果。
        console.info("Popup 雲端掃描失敗，改用本機 AI 備援：", error?.message || error);

        try {
            if (!tab) tab = await getActiveTab();

            if (isRestrictedBrowserOrExtensionPage(tab?.url || "")) {
                renderScanResult(buildRestrictedPageReport(tab?.url || ""));
                return;
            }

            if (!maskedText && tab?.id) {
                const rawText = await getCurrentPageText(tab.id);
                maskedText = maskSensitiveData(rawText);
            }

            let fallbackReport = localPopupRiskAnalysis(
                tab?.url || "",
                maskedText,
                error?.message || "雲端 API 暫時不可用"
            );

            fallbackReport = applyAiPlatformPopupGuard(tab?.url || "", maskedText, fallbackReport);
            renderScanResult(fallbackReport);
        } catch (fallbackError) {
            console.warn("Popup 本機 AI 備援失敗：", fallbackError?.message || fallbackError);
            renderScanResult({
                riskScore: 40,
                riskLevel: "中風險",
                scamDNA: ["系統保守防護"],
                explain: ["目前無法完整檢查此頁，系統採取保守提醒。"],
                reason: "目前無法完整檢查此頁，請先不要輸入個資、驗證碼、信用卡或匯款資料。",
                advice: "請先離開頁面，或等網路穩定後重新檢查。",
                references: []
            });
        }
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

        currentFamilyID = normalizeFamilyCode(data.inviteCode || data.familyID) || "none";

        const tokenKey = getAccessTokenStorageKey();

        await persistSharedFamilyID(currentFamilyID, {
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

        currentFamilyID = normalizeFamilyCode(code) || "none";

        const tokenKey = getAccessTokenStorageKey();

        await persistSharedFamilyID(currentFamilyID, {
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
        const localRecord = {
            url: tab.url,
            title: tab.title || "",
            reportedAt: new Date().toISOString(),
            userID: currentUserID || "anonymous",
            familyID: currentFamilyID || "none",
            riskScore: normalizeRiskScore(report),
            riskLevel: report.riskLevel || "",
            ai_reason: report.reason || "",
            status: "local_saved",
            action_type: "popup_local_first_report"
        };

        // 1) 永遠先本機成功：使用者按下回報後不能因後端 404 / token / Render 狀態而顯示失敗。
        try {
            const storage = await chrome.storage.local.get(["aiShieldUserReports"]);
            const reports = Array.isArray(storage.aiShieldUserReports) ? storage.aiShieldUserReports : [];
            reports.unshift(localRecord);
            await chrome.storage.local.set({ aiShieldUserReports: reports.slice(0, 100) });
        } catch (storageError) {
            console.warn("本機回報紀錄寫入失敗：", storageError);
        }

        showToast("AI 已記錄這個可疑頁，會納入後續判斷。", "success");

        // 2) 後端同步只當加分項：沒有 token、API 404、後端未部署都不能影響使用者。
        try {
            const auth = await ensureInstallIdentity();
            if (!auth.accessToken) return;

            const response = await fetchWithTimeout(`${getApiBaseUrl()}/api/report_false_positive`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${auth.accessToken}`
                },
                body: JSON.stringify({
                    url: tab.url,
                    userID: auth.userID || currentUserID || "anonymous",
                    familyID: auth.familyID || currentFamilyID || "none",
                    riskScore: normalizeRiskScore(report),
                    riskLevel: report.riskLevel || "",
                    ai_reason: report.reason || "",
                    reported_reason: "使用者從 Popup 回報此頁需要 AI 後續判斷",
                    scope: "personal",
                    action_type: "popup_local_first_report"
                })
            }, 5000);

            if (!response.ok) {
                console.log("AI 防詐盾牌：回報已本機保存，後端同步略過：", response.status);
            }
        } catch (syncError) {
            console.log("AI 防詐盾牌：回報已本機保存，後端稍後再同步。", syncError?.message || syncError);
        }
    } catch (error) {
        showToast(`目前無法取得頁面資訊：${error.message}`, "error");
    }
}

function openDashboard() {
    const familyID = normalizeFamilyCode(currentFamilyID) || pickBestFamilyIDFromStorage({ familyID: currentFamilyID }) || "";
    const dashboardUrl = familyID
        ? chrome.runtime.getURL(`dashboard.html?familyID=${encodeURIComponent(familyID)}&autoStart=1`)
        : chrome.runtime.getURL("dashboard.html");

    chrome.tabs.create({ url: dashboardUrl });
}

function openDemoConsole() {
    const familyID = normalizeFamilyCode(currentFamilyID) || pickBestFamilyIDFromStorage({ familyID: currentFamilyID }) || "";
    const consoleUrl = familyID
        ? chrome.runtime.getURL(`demo_console.html?familyID=${encodeURIComponent(familyID)}`)
        : chrome.runtime.getURL("demo_console.html");

    chrome.tabs.create({ url: consoleUrl });
}

function copyInviteCode() {
    const text = buildInviteText(currentFamilyID);

    if (!text) {
        showToast("目前尚未建立或綁定家庭群組。", "error");
        return;
    }

    navigator.clipboard.writeText(text)
        .then(() => {
            showToast(`已複製邀請碼：${text}，可貼到 LINE 傳給家人。`, "success");
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
    const btnOpenConsole = document.getElementById("btn_open_console");
    const btnSafeExit = document.getElementById("btn_safe_exit");
    const btnReportPage = document.getElementById("btn_report_page");
    const inviteInput = document.getElementById("invite_input");
    const codeBox = document.getElementById("code_box");
    const displayCode = document.getElementById("display_code");
    const btnCopyInvite = document.getElementById("btn_copy_invite");
    const btnShareLine = document.getElementById("btn_share_line");
    const btnToggleQR = document.getElementById("btn_toggle_qr");

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

    if (btnOpenConsole) {
        btnOpenConsole.addEventListener("click", openDemoConsole);
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

    if (displayCode) {
        displayCode.addEventListener("click", copyInviteCode);
    }

    if (btnCopyInvite) {
        btnCopyInvite.addEventListener("click", copyInviteCode);
    }

    if (btnShareLine) {
        btnShareLine.addEventListener("click", shareInviteToLine);
    }

    if (btnToggleQR) {
        btnToggleQR.addEventListener("click", toggleFamilyQRCode);
    }
}

document.addEventListener("DOMContentLoaded", async () => {
    bindEvents();

    try {
        await ensureInstallIdentity();
    } catch (e) {
        console.debug("Popup 身分初始化暫時不可用，稍後掃描會自動降級處理。", e);
    }

    const storage = await chrome.storage.local.get(["userID", ...FAMILY_ID_SYNC_KEYS]);

    currentUserID = storage.userID || currentUserID || "anonymous";
    currentFamilyID = pickBestFamilyIDFromStorage(storage) || normalizeFamilyCode(currentFamilyID) || "none";

    updateUIAsBound(currentFamilyID);
    setupPopupFamilyStorageListener();

    if (currentFamilyID && currentFamilyID !== "none") {
        startFamilyAlertsPolling(currentFamilyID);
    }

    await detectInviteCodeFromClipboard();

    console.log("🛡️ Popup 已啟動", {
        currentUserID,
        currentFamilyID
    });

    // v9：競賽展示預設不在 Popup 開啟時自動掃描，避免一開 Demo 就送出家庭/LINE 通知。
    // 需要自動掃描時，可在 config.js 將 POPUP_AUTO_SCAN_ON_OPEN 設為 true。
    if (getConfigValue("POPUP_AUTO_SCAN_ON_OPEN", false) && !didAutoScanOnOpen) {
        didAutoScanOnOpen = true;
        setTimeout(() => {
            scanCurrentPage().catch(error => {
                console.debug("Popup 自動掃描已靜默處理：", error);
            });
        }, 250);
    }
});