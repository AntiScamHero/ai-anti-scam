/**
 * AI 防詐盾牌 - 背景服務
 * 注意：這是 Manifest V3 Service Worker。
 * 不能使用 document、window、MutationObserver、IntersectionObserver、querySelector 等 DOM API。
 */

importScripts('config.js');

// ==========================================
// 基本設定
// ==========================================
const KEEP_ALIVE_ALARM = "keep-alive-alarm";
const TOKEN_EXPIRES_FALLBACK_KEY = 'aiShieldTokenExpiresAt';

const SYSTEM_PAGES = [
    'chrome://',
    'edge://',
    'about:',
    'extensions',
    'chrome-extension://',
    'blocked.html',
    'dashboard.html',
    'simulator.html',
    'welcome.html',
    'popup.html',
    'mobile_demo.html',
    'render.com',
    'github.com',
    'localhost',
    '127.0.0.1'
];

const DEFAULT_TRUSTED_DOMAINS = Array.isArray(getConfigValue('TRUSTED_DOMAINS', null))
    ? getConfigValue('TRUSTED_DOMAINS', [])
    : [
        'wikipedia.org',
        'ccsh.tn.edu.tw',
        'gov.tw',
        'fsc.gov.tw',
        'moneywise.fsc.gov.tw',
        '165.npa.gov.tw',
        'npa.gov.tw',
        'mohw.gov.tw',
        'nhia.gov.tw',
        'edu.tw'
    ];

const USER_WHITELIST_KEY = 'userWhitelistDomains';
const TEMP_WHITELIST_KEY = 'temporaryWhitelistDomains';

const backgroundScanCooldownMap = new Map();

// ==========================================
// 安裝 / 啟動 / 心跳
// ==========================================
chrome.runtime.onInstalled.addListener((details) => {
    ensureInstallIdentity().catch(() => {});
    if (details.reason === "install") {
        chrome.tabs.create({ url: "welcome.html" }).catch(() => {});
    }

    if (getConfigValue('ENABLE_SERVICE_WORKER_HEARTBEAT', false)) {
        chrome.alarms.create(KEEP_ALIVE_ALARM, { periodInMinutes: 1 });
    }

    chrome.contextMenus.removeAll(() => {
        chrome.contextMenus.create({
            id: "scan-text",
            title: "🛡️ 掃描這段可疑話術",
            contexts: ["selection"]
        });

        chrome.contextMenus.create({
            id: "scan-link",
            title: "🛡️ 掃描此危險連結",
            contexts: ["link"]
        });

        chrome.contextMenus.create({
            id: "scan-image",
            title: "🛡️ 掃描這張可疑圖片",
            contexts: ["image"]
        });
    });
});

chrome.runtime.onStartup.addListener(() => {
    if (!getConfigValue('ENABLE_SERVICE_WORKER_HEARTBEAT', false)) return;

    chrome.alarms.get(KEEP_ALIVE_ALARM, (alarm) => {
        if (!alarm) chrome.alarms.create(KEEP_ALIVE_ALARM, { periodInMinutes: 1 });
    });
});

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === KEEP_ALIVE_ALARM && getConfigValue('HEARTBEAT_LOG_ENABLED', false)) {
        console.log("💓 [心跳機制] 防詐盾牌 Service Worker 事件喚醒", new Date().toLocaleTimeString());
    }
});

// ==========================================
// 共用工具
// ==========================================
function getConfigValue(key, fallback) {
    try {
        if (typeof CONFIG !== 'undefined' && CONFIG && CONFIG[key] !== undefined) {
            return CONFIG[key];
        }
    } catch (e) {}
    return fallback;
}

function getApiBaseUrl() {
    return getConfigValue('API_BASE_URL', 'https://ai-anti-scam.onrender.com');
}

function safeRandomId() {
    try {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) {
            return crypto.randomUUID();
        }
    } catch (e) {}

    return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function getRequestTimeoutMs() {
    return Number(getConfigValue('REQUEST_TIMEOUT_MS', 12000)) || 12000;
}

function getBackgroundScanCooldownMs() {
    return Number(getConfigValue('BACKGROUND_SCAN_COOLDOWN_MS', 30000)) || 30000;
}

function getCaptureQuality() {
    return Number(getConfigValue('CAPTURE_JPEG_QUALITY', 30)) || 30;
}

function pruneCooldownMap() {
    const now = Date.now();
    const maxAge = Math.max(getBackgroundScanCooldownMs() * 3, 60000);

    for (const [key, value] of backgroundScanCooldownMap.entries()) {
        if (now - value > maxAge) {
            backgroundScanCooldownMap.delete(key);
        }
    }
}

function shouldThrottleBackgroundScan(tabId, url) {
    const key = `${tabId}:${normalizeHost(url) || url}`;
    const now = Date.now();
    const last = backgroundScanCooldownMap.get(key) || 0;

    pruneCooldownMap();

    if (now - last < getBackgroundScanCooldownMs()) {
        return true;
    }

    backgroundScanCooldownMap.set(key, now);
    return false;
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


function normalizeExplainList(rawExplain, reason = '') {
    let items = [];

    if (Array.isArray(rawExplain)) {
        items = rawExplain.map(item => String(item || '').trim()).filter(Boolean);
    } else if (typeof rawExplain === 'string' && rawExplain.trim()) {
        items = rawExplain.split(/[；;。\n]+/).map(item => item.trim()).filter(Boolean);
    }

    if (items.length === 0 && reason) {
        items = String(reason).split(/[；;。\n]+/).map(item => item.trim()).filter(Boolean);
    }

    if (items.length === 0) {
        items = [
            '頁面出現高風險詐騙特徵',
            '可能誘導輸入個資、驗證碼、信用卡或匯款資料',
            '建議先離開頁面，並請家人或 165 協助確認'
        ];
    }

    return Array.from(new Set(items)).slice(0, 5);
}

function buildBlockedPageUrl(originalUrl, reportData = {}, fallbackReason = '') {
    const safeOriginalUrl = String(
        originalUrl ||
        reportData.originalUrl ||
        reportData.original_url ||
        reportData.targetUrl ||
        reportData.target_url ||
        reportData.pageUrl ||
        reportData.page_url ||
        reportData.url ||
        ''
    ).trim();

    const reason = reportData.reason || fallbackReason || '系統偵測到高風險異常行為。';
    const rawScore = Number(reportData.riskScore || reportData.RiskScore || reportData.risk_score || getHighRiskThreshold());
    const score = Math.max(0, Math.min(100, rawScore || getHighRiskThreshold()));
    const explain = normalizeExplainList(reportData.explain || reportData.explanation || reportData.evidence, reason);

    const payload = {
        riskScore: score,
        riskLevel: reportData.riskLevel || (score >= getHighRiskThreshold() ? '高風險' : '中高風險'),
        scamDNA: Array.isArray(reportData.scamDNA) ? reportData.scamDNA : [],
        reason,
        advice: reportData.advice || '請勿輸入個資、信用卡、驗證碼，也不要依照對方指示匯款。',
        explain,
        references: Array.isArray(reportData.references) ? reportData.references : (Array.isArray(reportData.officialReferences) ? reportData.officialReferences : []),
        componentScores: reportData.componentScores || {},
        winningEngine: reportData.winningEngine || reportData.engine || 'background-scan',
        originalUrl: safeOriginalUrl,
        original_url: safeOriginalUrl,
        targetUrl: safeOriginalUrl,
        target_url: safeOriginalUrl,
        pageUrl: safeOriginalUrl,
        page_url: safeOriginalUrl,
        url: safeOriginalUrl,
        source: reportData.source || 'background-scan',
        timestamp: Date.now()
    };

    return chrome.runtime.getURL('blocked.html') +
        '?data=' + encodeURIComponent(JSON.stringify(payload)) +
        '&original_url=' + encodeURIComponent(safeOriginalUrl) +
        '&url=' + encodeURIComponent(safeOriginalUrl);
}

async function ensureInstallIdentity() {
    const installKey = getConfigValue('INSTALL_ID_STORAGE_KEY', 'aiShieldInstallId');
    const tokenKey = getConfigValue('ACCESS_TOKEN_STORAGE_KEY', 'aiShieldAccessToken');
    const expiresKey = getConfigValue('TOKEN_EXPIRES_AT_STORAGE_KEY', TOKEN_EXPIRES_FALLBACK_KEY);
    const storage = await chrome.storage.local.get([installKey, tokenKey, expiresKey, 'userID', 'familyID']);

    let installID = storage[installKey];
    if (!installID) {
        installID = 'ins_' + safeRandomId();
        await chrome.storage.local.set({ [installKey]: installID });
    }

    let userID = storage.userID;
    if (!userID) {
        userID = 'USER_' + Math.random().toString(36).slice(2, 11).toUpperCase();
        await chrome.storage.local.set({ userID });
    }

    const familyID = storage.familyID || 'none';
    const token = storage[tokenKey] || '';
    const expiresAt = Number(storage[expiresKey] || 0) * 1000;
    const refreshWindow = Number(getConfigValue('TOKEN_REFRESH_WINDOW_MS', 300000));

    if (token && expiresAt - Date.now() > refreshWindow) {
        return { accessToken: token, userID, installID, familyID };
    }

    try {
        const response = await fetchWithTimeout(`${getApiBaseUrl()}/api/auth/install`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ installID, userID, familyID })
        });

        let data = {};
        try { data = await response.json(); } catch (e) {}

        if (response.ok && data.accessToken) {
            await chrome.storage.local.set({
                [tokenKey]: data.accessToken,
                [expiresKey]: data.expiresAt || 0,
                userID: data.userID || userID,
                familyID: data.familyID || familyID
            });
            return { accessToken: data.accessToken, userID: data.userID || userID, installID, familyID: data.familyID || familyID };
        }

        console.warn('短效 token 取得失敗：', data.message || response.status);
    } catch (e) {
        console.warn('短效 token 取得失敗，請確認後端 API 是否可用。', e);
    }

    return { accessToken: token, userID, installID, familyID };
}

async function getApiHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    const auth = await ensureInstallIdentity();
    if (auth.accessToken) headers.Authorization = `Bearer ${auth.accessToken}`;

    if (!auth.accessToken && getConfigValue('REQUIRE_AUTH_TOKEN', true)) {
        throw new Error('尚未取得短效 accessToken，請確認後端 /api/auth/install 可連線。');
    }

    return headers;
}

function getHighRiskThreshold() {
    return Number(getConfigValue('RISK_THRESHOLD_HIGH', 80)) || 80;
}

function getMaxRetries() {
    return Number(getConfigValue('MAX_RETRIES', 2)) || 2;
}

async function fetchWithRetry(url, options, maxRetries = getMaxRetries()) {
    let lastError = null;

    for (let i = 0; i < maxRetries; i++) {
        try {
            const response = await fetchWithTimeout(url, options);
            if (response.ok) return response;
            throw new Error(`HTTP error: ${response.status}`);
        } catch (err) {
            lastError = err;
            if (i === maxRetries - 1) break;
            await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
        }
    }

    throw lastError || new Error("fetchWithRetry failed");
}

function toAbsoluteHttpUrl(rawUrl) {
    if (!rawUrl) return '';

    const trimmed = String(rawUrl).trim();

    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    if (/^(chrome|chrome-extension|edge|about|file):/i.test(trimmed)) return trimmed;

    return 'https://' + trimmed.replace(/^\/+/, '');
}

function normalizeHost(rawUrl) {
    try {
        const host = new URL(toAbsoluteHttpUrl(rawUrl)).hostname.toLowerCase();
        return host.replace(/^www\./, '');
    } catch (e) {
        return '';
    }
}

function domainMatchesHost(host, domain) {
    if (!host || !domain) return false;

    const cleanDomain = String(domain).toLowerCase().replace(/^www\./, '');
    return host === cleanDomain || host.endsWith('.' + cleanDomain);
}

function isSystemPage(rawUrl) {
    if (!rawUrl) return true;
    return SYSTEM_PAGES.some(keyword => rawUrl.includes(keyword));
}

async function getCleanTemporaryWhitelist() {
    const now = Date.now();
    const storage = await chrome.storage.local.get([TEMP_WHITELIST_KEY]);
    const rawMap = storage[TEMP_WHITELIST_KEY] || {};
    const cleanMap = {};
    let changed = false;

    for (const [domain, expiresAt] of Object.entries(rawMap)) {
        const expires = Number(expiresAt);

        if (domain && expires > now) {
            cleanMap[domain] = expires;
        } else {
            changed = true;
        }
    }

    if (changed) {
        await chrome.storage.local.set({
            [TEMP_WHITELIST_KEY]: cleanMap
        });
    }

    return cleanMap;
}

async function isUrlTrustedOrWhitelisted(rawUrl) {
    const host = normalizeHost(rawUrl);
    if (!host) return false;

    if (DEFAULT_TRUSTED_DOMAINS.some(domain => domainMatchesHost(host, domain))) {
        return true;
    }

    const storage = await chrome.storage.local.get([USER_WHITELIST_KEY]);
    const userWhitelist = Array.isArray(storage[USER_WHITELIST_KEY])
        ? storage[USER_WHITELIST_KEY]
        : [];

    if (userWhitelist.some(domain => domainMatchesHost(host, domain))) {
        return true;
    }

    const temporaryWhitelist = await getCleanTemporaryWhitelist();

    if (Object.keys(temporaryWhitelist).some(domain => domainMatchesHost(host, domain))) {
        return true;
    }

    return false;
}

function localHeuristicScore(text, url = '') {
    const combined = `${url || ''} ${text || ''}`.toLowerCase();
    const patterns = [
        [/保證獲利|穩賺不賠|飆股|內線|殺豬盤|usdt|btc|加密貨幣/i, 45],
        [/中獎|領取|bonus|claim|lottery|prize/i, 30],
        [/輸入.*(身分證|信用卡|密碼|驗證碼)|cvv|otp/i, 50],
        [/法院|檢察官|警察|偵查不公開|監管帳戶/i, 55],
        [/斷電|停水|欠費|包裹|補繳|運費不足/i, 35],
        [/bit\.ly|tinyurl|reurl|shorturl|\.xyz|\.top|\.claim/i, 35],
        [/google\.com\.|yahoo\.com\.|gov\.tw\.|line\.me\./i, 60]
    ];
    let score = 0;
    for (const [regex, value] of patterns) {
        if (regex.test(combined)) score += value;
    }
    return Math.min(100, score);
}

function parseAiReport(data) {
    let reportData = data || {};

    try {
        if (data && data.report) {
            reportData = typeof data.report === 'string'
                ? JSON.parse(data.report)
                : data.report;

            if (typeof reportData === 'string') {
                reportData = JSON.parse(reportData);
            }
        }
    } catch (err) {
        console.warn("[背景巡邏] AI 報告解析失敗，改用原始資料", err);
        reportData = data || {};
    }

    const score = parseInt(
        reportData.riskScore ||
        reportData.RiskScore ||
        reportData.risk_score ||
        data?.riskScore ||
        0
    ) || 0;

    return {
        reportData,
        score
    };
}

async function getTabPageText(tabId) {
    try {
        const inject = await chrome.scripting.executeScript({
            target: { tabId },
            func: () => {
                const title = document.title || '';
                const text = (
                    document.documentElement.innerText ||
                    document.documentElement.textContent ||
                    ''
                ).replace(/\s+/g, ' ').substring(0, 1200);

                return `[標題]: ${title} [內文]: ${text}`;
            }
        });

        return inject[0]?.result || "";
    } catch (err) {
        return "";
    }
}

async function captureTabScreenshot(tab) {
    try {
        if (tab && tab.active && tab.windowId) {
            await new Promise(resolve => setTimeout(resolve, 500));
            return await chrome.tabs.captureVisibleTab(tab.windowId, {
                format: 'jpeg',
                quality: getCaptureQuality()
            });
        }
    } catch (err) {
        console.log("背景自動截圖受限:", err);
    }

    return null;
}

async function submitEvidence(payload) {
    try {
        return await fetchWithRetry(`${getApiBaseUrl()}/api/submit_evidence`, {
            method: 'POST',
            headers: await getApiHeaders(),
            body: JSON.stringify(payload)
        });
    } catch (err) {
        console.warn("submit_evidence 失敗:", err);
        return null;
    }
}

async function sendScanLog(payload) {
    try {
        return await fetchWithRetry(`${getApiBaseUrl()}/scan`, {
            method: 'POST',
            headers: await getApiHeaders(),
            body: JSON.stringify(payload)
        });
    } catch (err) {
        console.warn("scan log 失敗:", err);
        return null;
    }
}

// ==========================================
// 自動背景掃描
// ==========================================
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'complete') return;
    if (!tab || !tab.url) return;
    if (isSystemPage(tab.url)) return;

    if (shouldThrottleBackgroundScan(tabId, tab.url)) {
        console.log('⏳ [背景掃描冷卻] 暫時略過重複掃描：', tab.url);
        return;
    }

    if (await isUrlTrustedOrWhitelisted(tab.url)) {
        console.log("✅ [背景白名單放行] 略過 AI 掃描：", tab.url);
        return;
    }

    try {
        const storage = await chrome.storage.local.get(['userID', 'familyID']);
        const currentUserID = storage.userID || "anonymous";
        const currentFamilyID = storage.familyID || "none";

        const pageText = await getTabPageText(tabId);
        const heuristicScore = localHeuristicScore(pageText, tab.url);
        const minBackgroundRisk = Number(getConfigValue('BACKGROUND_LOCAL_RISK_MIN', 40));

        if (heuristicScore < minBackgroundRisk) {
            console.log("🟢 [背景分層掃描] 本地分數低，略過後端 AI：", heuristicScore, tab.url);
            return;
        }

        let response;

        try {
            response = await fetchWithRetry(`${getApiBaseUrl()}/scan`, {
                method: 'POST',
                headers: await getApiHeaders(),
                body: JSON.stringify({
                    url: tab.url,
                    text: pageText,
                    scan_stage: "background_text_only",
                    localRiskScore: heuristicScore,
                    userID: currentUserID,
                    familyID: currentFamilyID
                })
            });
        } catch (fetchErr) {
            console.warn(`[背景巡邏] 伺服器未連線 (${getApiBaseUrl()})，啟動 Edge AI 離線防護。`, fetchErr);

            // Edge AI 離線攔截：後端暫時不可用時，仍使用本機啟發式分數保護使用者。
            if (heuristicScore >= getHighRiskThreshold()) {
                chrome.tabs.get(tabId, (currentTab) => {
                    if (chrome.runtime.lastError || !currentTab) {
                        console.log('[Edge AI] 目標分頁已關閉，取消離線攔截。');
                        return;
                    }

                    chrome.tabs.update(tabId, {
                        url: buildBlockedPageUrl(tab.url, {
                            riskScore: heuristicScore,
                            riskLevel: '極度危險',
                            reason: 'Edge AI 離線防護：後端暫時無法連線，但本機防護引擎偵測到高風險詐騙特徵，已先替你攔截。',
                            advice: '請勿輸入任何個資、信用卡、驗證碼，也不要依照頁面指示匯款。',
                            scamDNA: ['Edge AI 離線防護', '本機特徵攔截'],
                            explain: [
                                `本機詐騙特徵分數達 ${heuristicScore} 分，已超過高風險門檻 ${getHighRiskThreshold()} 分`,
                                '即使後端 AI 暫時無法連線，瀏覽器端仍可先執行基本風險判斷',
                                '頁面文字或網址命中高風險組合，系統優先採取保護性攔截'
                            ],
                            references: [],
                            winningEngine: 'edge-ai-offline',
                            source: 'edge-ai-offline'
                        }, 'Edge AI 離線攔截')
                    }).catch(e => console.log('Edge AI 攔截跳轉失敗:', e));
                });
                return;
            }

            console.log('🟢 [Edge AI] 離線狀態下本機分數未達高風險門檻，略過：', heuristicScore);
            return;
        }

        if (!response || !response.ok) return;

        const data = await response.json();
        const { reportData, score } = parseAiReport(data);

        if (score >= getHighRiskThreshold()) {
            if (await isUrlTrustedOrWhitelisted(tab.url)) {
                console.log("✅ [背景白名單放行] AI 雖判高風險，但此網域已被信任：", tab.url);
                return;
            }

            const reasonText = reportData?.reason || "系統深層掃描發現高度危險特徵！";
            try {
                const screenshotBase64 = await captureTabScreenshot(tab);
                if (screenshotBase64) {
                    await submitEvidence({
                        url: tab.url,
                        timestamp: new Date().toISOString(),
                        familyID: currentFamilyID,
                        screenshot_base64: screenshotBase64,
                        reported_reason: reasonText,
                        allow_screenshot_save: Boolean(getConfigValue('SAVE_FULL_SCREENSHOT_BY_DEFAULT', false))
                    });
                }
            } catch (e) {
                console.warn('高風險截圖摘要送出失敗:', e);
            }

            chrome.tabs.get(tabId, (currentTab) => {
                if (chrome.runtime.lastError || !currentTab) {
                    console.log("[背景巡邏] 目標分頁已關閉，取消攔截。");
                    return;
                }

                chrome.tabs.update(tabId, {
                    url: buildBlockedPageUrl(tab.url, reportData, reasonText)
                }).catch(e => console.log("跳轉攔截頁面失敗:", e));
            });
        }
    } catch (error) {
        console.error("背景自動掃描發生未預期錯誤:", error);
    }
});

// ==========================================
// 右鍵選單掃描
// ==========================================
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    let targetData = "";
    let scanType = "";
    let imageUrl = "";

    if (info.menuItemId === "scan-text" && info.selectionText) {
        targetData = info.selectionText;
        scanType = "文字";
    } else if (info.menuItemId === "scan-link" && info.linkUrl) {
        targetData = info.linkUrl;
        scanType = "連結";
    } else if (info.menuItemId === "scan-image" && info.srcUrl) {
        targetData = "圖片分析中...";
        imageUrl = info.srcUrl;
        scanType = "圖片";
    }

    if (!targetData && !imageUrl) return;

    chrome.notifications.create("scanning", {
        type: "basic",
        iconUrl: "icon.png",
        title: `🛡️ AI 正在掃描可疑${scanType}`,
        message: "防詐大腦運算中..."
    });

    try {
        const storage = await chrome.storage.local.get(['userID', 'familyID']);
        const targetUrl = info.linkUrl || info.srcUrl || tab?.url || "";

        if (await isUrlTrustedOrWhitelisted(targetUrl)) {
            chrome.notifications.clear("scanning");
            chrome.notifications.create({
                type: "basic",
                iconUrl: "icon.png",
                title: "✅ 已在白名單",
                message: "此網域已被標記為可信，系統不執行強制攔截。"
            });
            return;
        }

        const response = await fetchWithRetry(`${getApiBaseUrl()}/scan`, {
            method: 'POST',
            headers: await getApiHeaders(),
            body: JSON.stringify({
                url: tab?.url || targetUrl,
                text: targetData,
                image_url: imageUrl,
                userID: storage.userID || "anonymous",
                familyID: storage.familyID || "none"
            })
        });

        const data = await response.json();
        const { reportData, score } = parseAiReport(data);

        chrome.notifications.clear("scanning");

        if (score >= getHighRiskThreshold()) {
            if (tab && tab.id) {
                chrome.tabs.update(tab.id, {
                    url: buildBlockedPageUrl(targetUrl || tab.url, reportData, reportData.reason || '手動掃描發現高風險')
                });

                chrome.tts.speak(
                    "警告！警告！這個網站可能是騙人的，請不要輸入資料。",
                    {
                        lang: 'zh-TW',
                        rate: 1.0,
                        pitch: 1.0
                    }
                );
            }
        } else if (score >= 60) {
            if (tab && tab.id) {
                chrome.tabs.sendMessage(tab.id, {
                    action: "show_alert",
                    data: reportData
                }).catch(() => {});
            }
        } else {
            chrome.notifications.create({
                type: "basic",
                iconUrl: "icon.png",
                title: "✅ 掃描完成",
                message: `【風險指數: ${score}%】\n${reportData.advice || "請保持警覺"}`
            });
        }
    } catch (err) {
        chrome.notifications.clear("scanning");
        chrome.notifications.create({
            type: "basic",
            iconUrl: "icon.png",
            title: "❌ 分析失敗",
            message: "網路連線異常，請稍後再試。"
        });
    }
});

// ==========================================
// Content Script 訊息
// ==========================================
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "showEmergencyNotification") {
        chrome.notifications.create({
            type: "basic",
            iconUrl: "icon.png",
            title: request.title || "家人遇到可疑網頁",
            message: request.message || "AI 防詐盾牌偵測到高風險事件。",
            priority: 2
        }, () => {
            sendResponse({ status: "shown" });
        });
        return true;
    }

    if (request.action === "captureScamTabWithEvidence") {
        const tabId = sender.tab ? sender.tab.id : null;
        const windowId = sender.tab ? sender.tab.windowId : null;

        if (!tabId || !windowId) {
            sendResponse({
                status: "fail",
                message: "No tabId or windowId"
            });
            return true;
        }

        (async () => {
            try {
                const dataUrl = await chrome.tabs.captureVisibleTab(windowId, {
                    format: 'jpeg',
                    quality: getCaptureQuality()
                });

                const response = await submitEvidence({
                    url: request.url,
                    timestamp: request.timestamp,
                    familyID: request.familyID || "none",
                    screenshot_base64: dataUrl,
                    reported_reason: request.reason,
                    allow_screenshot_save: Boolean(getConfigValue('SAVE_FULL_SCREENSHOT_BY_DEFAULT', false))
                });

                let backendResponse = null;

                try {
                    backendResponse = response ? await response.json() : null;
                } catch (e) {}

                sendResponse({
                    status: "success",
                    backendResponse
                });
            } catch (error) {
                console.error("❌ 截圖權限受限:", error);
                sendResponse({
                    status: "error",
                    details: "截圖受限於 Chrome 本機安全機制"
                });
            }
        })();

        return true;
    }

    if (request.action === "triggerBlock") {
        const originalUrl = sender.tab ? sender.tab.url : request.url || "";
        const windowId = sender.tab ? sender.tab.windowId : null;
        const tabId = sender.tab ? sender.tab.id : null;

        (async () => {
            const storage = await chrome.storage.local.get(['userID', 'familyID']);

            if (await isUrlTrustedOrWhitelisted(originalUrl)) {
                console.log("✅ [triggerBlock 白名單放行] 取消跳轉：", originalUrl);
                sendResponse({
                    status: "trusted"
                });
                return;
            }

            let screenshotBase64 = null;

            try {
                if (windowId) {
                    screenshotBase64 = await chrome.tabs.captureVisibleTab(windowId, {
                        format: 'jpeg',
                        quality: getCaptureQuality()
                    });
                }
            } catch (e) {
                console.log("緊急快門失敗:", e);
            }

            if (tabId) {
                chrome.tabs.update(tabId, {
                    url: buildBlockedPageUrl(originalUrl, request.reportData || {}, request.reason || '系統偵測到高風險異常行為')
                });

                chrome.tts.speak(
                    "警告！警告！這個網站可能是騙人的，請不要輸入資料。",
                    {
                        lang: 'zh-TW',
                        rate: 1.0,
                        pitch: 1.0
                    }
                );
            }

            if (screenshotBase64) {
                await submitEvidence({
                    url: originalUrl,
                    timestamp: new Date().toLocaleTimeString('zh-TW', { hour12: false }),
                    familyID: storage.familyID || "none",
                    screenshot_base64: screenshotBase64,
                    reported_reason: request.reason,
                    allow_screenshot_save: Boolean(getConfigValue('SAVE_FULL_SCREENSHOT_BY_DEFAULT', false))
                });
            } else {
                await sendScanLog({
                    url: originalUrl,
                    text: `【緊急攔截】${request.reason || ""}`,
                    image_url: "",
                    userID: storage.userID || "anonymous",
                    familyID: storage.familyID || "none",
                    is_urgent: false
                });
            }

            sendResponse({
                status: "blocked"
            });
        })();

        return true;
    }

    if (request.action === "scanImageInBackground") {
        (async () => {
            try {
                if (await isUrlTrustedOrWhitelisted(request.pageUrl)) {
                    console.log("✅ [白名單放行] 圖片背景掃描略過：", request.pageUrl);
                    sendResponse({ status: "trusted" });
                    return;
                }

                const storage = await chrome.storage.local.get(['userID', 'familyID']);

                const response = await fetchWithRetry(`${getApiBaseUrl()}/scan`, {
                    method: 'POST',
                    headers: await getApiHeaders(),
                    body: JSON.stringify({
                        url: request.pageUrl,
                        text: "背景圖片自動分析",
                        image_url: request.imageUrl,
                        userID: storage.userID || "anonymous",
                        familyID: storage.familyID || "none",
                        is_urgent: false
                    })
                });

                const data = await response.json();
                const { reportData, score } = parseAiReport(data);

                if (score >= 60 && sender.tab && sender.tab.id) {
                    chrome.tabs.sendMessage(sender.tab.id, {
                        action: "show_alert",
                        data: reportData
                    }).catch(() => {});
                }

                sendResponse({
                    status: "done",
                    score
                });
            } catch (e) {
                sendResponse({
                    status: "error"
                });
            }
        })();

        return true;
    }
});