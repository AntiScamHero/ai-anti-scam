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
// 安全版證據 Modal
// ==========================================
function showEvidenceModal(imageUrl, reason) {
    const oldModal = document.getElementById("ai-evidence-modal");
    if (oldModal) oldModal.remove();

    const modal = document.createElement("div");
    modal.id = "ai-evidence-modal";
    modal.style.cssText = `
        position:fixed;
        top:0;
        left:0;
        width:100vw;
        height:100vh;
        background:rgba(0,0,0,0.9);
        color:white;
        display:flex;
        flex-direction:column;
        align-items:center;
        justify-content:center;
        z-index:2147483647;
        font-family:sans-serif;
        backdrop-filter:blur(10px);
        padding:24px;
        box-sizing:border-box;
    `;

    const wrapper = document.createElement("div");
    wrapper.style.cssText = `
        position:relative;
        width:90%;
        max-width:1200px;
        display:flex;
        flex-direction:column;
        align-items:center;
    `;

    const closeBtn = document.createElement("button");
    closeBtn.id = "close-evidence-modal";
    closeBtn.textContent = "×";
    closeBtn.style.cssText = `
        position:absolute;
        top:-20px;
        right:-20px;
        background:white;
        color:black;
        border:none;
        border-radius:50%;
        width:44px;
        height:44px;
        font-size:28px;
        cursor:pointer;
        font-weight:bold;
        box-shadow:0 0 10px rgba(255,255,255,0.5);
        z-index:2;
    `;

    const title = document.createElement("div");
    title.textContent = "【AI 防詐盾牌 - 攔截證據保全快照】";
    title.style.cssText = `
        font-size:24px;
        font-weight:bold;
        color:#ff4d4f;
        margin-bottom:15px;
        text-align:center;
    `;

    const reasonEl = document.createElement("div");
    reasonEl.textContent = `證據原因：${reason || "未提供"}`;
    reasonEl.style.cssText = `
        color:#aaa;
        margin-bottom:20px;
        text-align:center;
        max-width:100%;
        line-height:1.6;
        word-break:break-word;
    `;

    if (imageUrl) {
        const img = document.createElement("img");
        img.src = imageUrl;
        img.alt = "詐騙網頁證據";
        img.style.cssText = `
            width:100%;
            max-height:80vh;
            border:4px solid #ff4d4f;
            border-radius:8px;
            box-shadow:0 0 30px rgba(255,0,0,0.5);
            object-fit:contain;
            background:#222;
        `;

        wrapper.appendChild(closeBtn);
        wrapper.appendChild(title);
        wrapper.appendChild(reasonEl);
        wrapper.appendChild(img);
    } else {
        const empty = document.createElement("div");
        empty.textContent = "此筆紀錄只保存摘要，未保存完整截圖。";
        empty.style.cssText = `
            padding:40px;
            border:2px dashed #666;
            border-radius:12px;
            color:#ccc;
            text-align:center;
            font-size:18px;
            width:100%;
            background:#151515;
        `;

        wrapper.appendChild(closeBtn);
        wrapper.appendChild(title);
        wrapper.appendChild(reasonEl);
        wrapper.appendChild(empty);
    }

    const note = document.createElement("div");
    note.textContent = "提醒：正式版建議只保存必要摘要，完整截圖應由使用者明確同意後才保存。";
    note.style.cssText = `
        color:#8b949e;
        font-size:13px;
        line-height:1.6;
        margin-top:14px;
        text-align:center;
    `;

    wrapper.appendChild(note);
    modal.appendChild(wrapper);
    document.body.appendChild(modal);

    closeBtn.addEventListener("click", () => modal.remove());

    modal.addEventListener("click", event => {
        if (event.target === modal) {
            modal.remove();
        }
    });

    document.addEventListener(
        "keydown",
        event => {
            if (event.key === "Escape") modal.remove();
        },
        { once: true }
    );
}

async function openEvidence(record) {
    const familyID = getCurrentFamilyID();
    const evidenceID = record?.evidenceID;

    if (!evidenceID) {
        showEvidenceModal("", "此筆紀錄沒有對應的證據快照。");
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

        const data = await response.json();

        if (!response.ok || data.status !== "success") {
            showEvidenceModal("", data.message || "找不到對應的證據快照。");
            return;
        }

        const imageUrl = normalizeEvidenceImage(
            data.evidence_image_url || data.screenshot_base64 || ""
        );

        showEvidenceModal(imageUrl, record?.reason || "攔截證據");
    } catch (error) {
        showEvidenceModal("", `讀取證據失敗：${error.message}`);
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

    if (record.evidenceID) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = "查看證據";
        btn.style.cssText = `
            margin-top:8px;
            padding:6px 10px;
            font-size:13px;
            border-radius:6px;
            background:#30363d;
            color:white;
            border:1px solid #555;
            cursor:pointer;
        `;
        btn.addEventListener("click", () => openEvidence(record));
        td.appendChild(btn);
    }

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
    const urlText = record.domain || record.url || record.url_preview || "未知網址";
    urlTd.textContent = truncateMiddle(urlText, 72);
    urlTd.title = String(record.url || record.url_preview || urlText || "");

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

async function startSocket() {
    const familyID = getCurrentFamilyID();

    if (!isValidFamilyID(familyID)) {
        showToast("請先輸入 6 碼家庭邀請碼。", "error");
        return;
    }

    localStorage.setItem("savedFamilyID", familyID);

    const input = document.getElementById("family-id-input");
    if (input) input.value = familyID;

    if (typeof io === "undefined") {
        showToast("Socket.IO 尚未載入。", "error");
        return;
    }

    if (socket) {
        socket.disconnect();
        socket = null;
    }

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
            setConnectionStatus("🔴 連線失敗", false);
            console.warn("Socket 連線錯誤:", error);
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

    const savedFamilyID = localStorage.getItem("savedFamilyID");

    if (savedFamilyID) {
        setConnectionStatus(`待連線：${savedFamilyID}`, false);
        await fetchAlerts();
    } else {
        setConnectionStatus("🔴 尚未連線 / 閒置中", false);
        renderDashboard([]);
    }
});