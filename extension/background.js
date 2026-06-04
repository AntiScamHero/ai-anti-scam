chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === "install") {
        chrome.tabs.create({ url: chrome.runtime.getURL("pages/welcome.html") });
    }
});


// ==========================================
// AI 防詐盾牌：主動掃描 / 拍照存證 / 導向背景處理
// 直接整合版：content.js 偵測高風險後，background.js 負責拍照與保存。
// ==========================================
const AI_SHIELD_EVIDENCE_KEY = "aiShieldEvidenceSnapshots";
const AI_SHIELD_AUTO_RECORDS_KEY = "aiShieldAutoScanRecords";

const AI_SHIELD_API_BASE_URL = (() => {
    try {
        if (typeof CONFIG !== "undefined" && CONFIG && CONFIG.API_BASE_URL) {
            return String(CONFIG.API_BASE_URL).replace(/\/+$/, "");
        }
    } catch (e) {}

    return "https://ai-anti-scam.onrender.com";
})();

function aiShieldGetConfigValue(key, fallback) {
    try {
        if (typeof CONFIG !== "undefined" && CONFIG && CONFIG[key] !== undefined) {
            return CONFIG[key];
        }
    } catch (e) {}

    return fallback;
}

function aiShieldGetRequestTimeoutMs() {
    return Number(aiShieldGetConfigValue("REQUEST_TIMEOUT_MS", 12000)) || 12000;
}

function aiShieldFetchWithTimeout(url, options = {}, timeoutMs = aiShieldGetRequestTimeoutMs()) {
    return new Promise((resolve, reject) => {
        const controller = new AbortController();
        const timer = setTimeout(() => {
            try { controller.abort(); } catch (e) {}
        }, timeoutMs);

        fetch(url, {
            ...options,
            signal: options.signal || controller.signal
        })
            .then(resolve)
            .catch(reject)
            .finally(() => clearTimeout(timer));
    });
}

async function aiShieldGetApiHeaders() {
    const headers = { "Content-Type": "application/json" };

    try {
        const tokenKey = aiShieldGetConfigValue("ACCESS_TOKEN_STORAGE_KEY", "aiShieldAccessToken");
        const storage = await chrome.storage.local.get([
            tokenKey,
            "aiShieldAccessToken",
            "accessToken"
        ]);

        const token = storage[tokenKey] || storage.aiShieldAccessToken || storage.accessToken || "";

        if (token) {
            headers.Authorization = `Bearer ${token}`;
        }
    } catch (e) {}

    return headers;
}

async function aiShieldSubmitEvidenceToBackend(payload = {}) {
    const body = {
        url: payload.url || "",
        timestamp: payload.timestamp || new Date().toISOString(),
        familyID: payload.familyID || "none",
        screenshot_base64: payload.screenshot_base64 || "",
        reported_reason: payload.reported_reason || payload.reason || "主動掃描偵測到高風險頁面。",
        reason: payload.reason || payload.reported_reason || "主動掃描偵測到高風險頁面。",
        riskScore: aiShieldNormalizeScore(payload.riskScore || payload.score || 95),
        riskLevel: payload.riskLevel || "高風險",
        recordID: payload.recordID || "",
        source: payload.source || "background-auto-submit-evidence",
        allow_screenshot_save: Boolean(aiShieldGetConfigValue("SAVE_FULL_SCREENSHOT_BY_DEFAULT", false))
    };

    try {
        const response = await aiShieldFetchWithTimeout(`${AI_SHIELD_API_BASE_URL}/api/submit_evidence`, {
            method: "POST",
            headers: await aiShieldGetApiHeaders(),
            body: JSON.stringify(body)
        });

        let data = null;
        try { data = await response.json(); } catch (e) {}

        if (!response.ok) {
            console.warn("AI 防詐盾牌：後端 submit_evidence 回應失敗：", response.status, data);
            return {
                ok: false,
                status: response.status,
                data
            };
        }

        console.log("AI 防詐盾牌：已同步高風險事件到後端 / 家庭戰情室。", data);
        return {
            ok: true,
            status: response.status,
            data
        };
    } catch (error) {
        console.warn("AI 防詐盾牌：同步高風險事件到後端失敗：", error?.message || error);
        return {
            ok: false,
            status: 0,
            error: error?.message || String(error)
        };
    }
}


function aiShieldNormalizeScore(value) {
    const score = Number(value || 0);
    return Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 0;
}

function aiShieldNormalizeFamilyCode(value = "") {
    const code = String(value || "")
        .trim()
        .toUpperCase()
        .replace(/^AISHIELD:/, "")
        .replace(/^FAM-/, "")
        .replace(/[^A-Z0-9]/g, "")
        .slice(0, 6);

    return /^[A-Z0-9]{6}$/.test(code) ? code : "";
}

function aiShieldGetHost(url = "") {
    try {
        return new URL(url || "").hostname.replace(/^www\./, "").toLowerCase();
    } catch (e) {
        return "";
    }
}

async function aiShieldGetCurrentFamilyID() {
    try {
        const keys = [
            "AI_SHIELD_FAMILY_ID",
            "aiShieldPrimaryFamilyID",
            "savedFamilyID",
            "currentFamilyID",
            "boundFamilyID",
            "familyID"
        ];

        const storage = await chrome.storage.local.get(keys);

        for (const key of keys) {
            const code = aiShieldNormalizeFamilyCode(storage[key]);
            if (code) return code;
        }
    } catch (e) {}

    return "local";
}

function aiShieldCaptureVisibleTab(windowId) {
    return new Promise((resolve, reject) => {
        if (!chrome?.tabs?.captureVisibleTab) {
            reject(new Error("目前環境不支援 captureVisibleTab。"));
            return;
        }

        chrome.tabs.captureVisibleTab(
            windowId,
            { format: "jpeg", quality: 86 },
            dataUrl => {
                const err = chrome.runtime?.lastError;

                if (err) {
                    reject(new Error(err.message || "擷取目前頁面畫面失敗。"));
                    return;
                }

                if (!dataUrl) {
                    reject(new Error("沒有取得截圖資料。"));
                    return;
                }

                resolve(dataUrl);
            }
        );
    });
}

async function aiShieldSaveEvidenceSnapshot(record) {
    const storage = await chrome.storage.local.get([AI_SHIELD_EVIDENCE_KEY]);
    const records = Array.isArray(storage[AI_SHIELD_EVIDENCE_KEY])
        ? storage[AI_SHIELD_EVIDENCE_KEY]
        : [];

    const sameUrlIndex = records.findIndex(item => String(item.url || "") === String(record.url || ""));
    if (sameUrlIndex >= 0) records.splice(sameUrlIndex, 1);

    records.unshift(record);

    await chrome.storage.local.set({
        [AI_SHIELD_EVIDENCE_KEY]: records.slice(0, 8)
    });
}

async function aiShieldSaveAutoScanRecord(record) {
    const storage = await chrome.storage.local.get([AI_SHIELD_AUTO_RECORDS_KEY]);
    const records = Array.isArray(storage[AI_SHIELD_AUTO_RECORDS_KEY])
        ? storage[AI_SHIELD_AUTO_RECORDS_KEY]
        : [];

    const sameUrlIndex = records.findIndex(item => String(item.url || "") === String(record.url || ""));
    if (sameUrlIndex >= 0) records.splice(sameUrlIndex, 1);

    records.unshift(record);

    await chrome.storage.local.set({
        [AI_SHIELD_AUTO_RECORDS_KEY]: records.slice(0, 50)
    });
}

function aiShieldBuildAutoDashboardRecord(payload = {}, report = {}, familyID = "local") {
    const targetUrl = payload.url || payload.pageUrl || payload.originalUrl || "";
    const score = aiShieldNormalizeScore(report.riskScore || report.score || payload.riskScore || 95);
    const reason = report.reason || payload.reason || "主動掃描偵測到高風險頁面。";

    return {
        id: `auto_scan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        timestamp: payload.timestamp || payload.detectedAt || new Date().toISOString(),
        url: targetUrl,
        url_preview: targetUrl,
        domain: aiShieldGetHost(targetUrl) || targetUrl,
        familyID,
        evidenceID: "",
        report: JSON.stringify({
            riskScore: score,
            score,
            riskLevel: report.riskLevel || payload.riskLevel || (score >= 70 ? "高風險" : "中風險"),
            reason,
            scamDNA: Array.isArray(report.scamDNA) ? report.scamDNA : ["主動掃描"],
            advice: report.advice || payload.advice || "請先不要點擊連結、不要輸入信用卡、驗證碼或匯款資料，建議家人一起確認。",
            source: payload.source || report.source || "content-script-auto-scan"
        }),
        autoScanRecord: true
    };
}

async function aiShieldHandleCaptureWithEvidence(message = {}, sender = {}) {
    const tab = sender?.tab || {};
    const report = message.report || message.reportData || {};
    const targetUrl = message.url || tab.url || "";
    const familyID = aiShieldNormalizeFamilyCode(message.familyID) || await aiShieldGetCurrentFamilyID();
    const score = aiShieldNormalizeScore(report.riskScore || report.score || message.riskScore || 95);
    const reason = message.reason || report.reason || "主動掃描偵測到高風險頁面。";

    const dashboardRecord = aiShieldBuildAutoDashboardRecord(
        {
            ...message,
            url: targetUrl,
            reason,
            timestamp: message.timestamp || message.detectedAt || new Date().toISOString(),
            source: message.action || message.type || "captureScamTabWithEvidence"
        },
        {
            ...report,
            riskScore: score,
            reason
        },
        familyID
    );

    await aiShieldSaveAutoScanRecord(dashboardRecord);

    let imageData = "";
    let captureError = "";

    try {
        if (tab.windowId === undefined || tab.windowId === null) {
            throw new Error("無法取得分頁視窗 ID。");
        }

        imageData = await aiShieldCaptureVisibleTab(tab.windowId);
    } catch (error) {
        captureError = error?.message || String(error);
        console.warn("AI 防詐盾牌：拍照失敗，但已保存掃描紀錄：", captureError);
    }

    if (imageData) {
        await aiShieldSaveEvidenceSnapshot({
            id: `ev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            imageData,
            url: targetUrl,
            title: message.title || tab.title || "",
            capturedAt: message.timestamp || message.detectedAt || new Date().toISOString(),
            userID: "content-script",
            familyID,
            riskScore: score,
            riskLevel: report.riskLevel || message.riskLevel || (score >= 70 ? "高風險" : "中風險"),
            reason,
            advice: report.advice || message.advice || "",
            source: message.action || message.type || "captureScamTabWithEvidence",
            privacyMode: "local_first_full_snapshot"
        });
    }

    const backendSyncResult = await aiShieldSubmitEvidenceToBackend({
        url: targetUrl,
        timestamp: message.timestamp || message.detectedAt || new Date().toISOString(),
        familyID,
        screenshot_base64: imageData,
        reported_reason: reason,
        reason,
        riskScore: score,
        riskLevel: report.riskLevel || message.riskLevel || (score >= 70 ? "高風險" : "中風險"),
        recordID: dashboardRecord.id,
        source: message.action || message.type || "captureScamTabWithEvidence"
    });

    try {
        if (chrome.notifications?.create) {
            chrome.notifications.create({
                type: "basic",
                iconUrl: "assets/images/warning-new.png",
                title: imageData ? "AI 防詐盾牌已保存證據" : "AI 防詐盾牌已保存紀錄",
                message: imageData
                    ? "偵測到高風險頁面，已拍照並保存到家庭戰情室。"
                    : "偵測到高風險頁面，但本頁暫時無法拍照，已保存掃描紀錄。"
            });
        }
    } catch (e) {}

    return {
        status: "success",
        ok: true,
        captured: Boolean(imageData),
        captureError,
        backendSynced: Boolean(backendSyncResult?.ok),
        backendSyncResult,
        recordID: dashboardRecord.id
    };
}

async function aiShieldRedirectToBlocked(message = {}, sender = {}) {
    const tabId = sender?.tab?.id;

    if (!tabId) {
        return { status: "error", message: "找不到目前分頁，無法導向攔截頁。" };
    }

    const url = message.url || message.blockedUrl || "";

    if (!url) {
        return { status: "error", message: "缺少 blocked.html 目標網址。" };
    }

    await chrome.tabs.update(tabId, { url });
    return { status: "success" };
}

function aiShieldOpenDashboard(message = {}) {
    const familyID = aiShieldNormalizeFamilyCode(message.familyID || "");
    const dashboardUrl = familyID
        ? chrome.runtime.getURL(`pages/dashboard.html?familyID=${encodeURIComponent(familyID)}&autoStart=1`)
        : chrome.runtime.getURL("pages/dashboard.html?autoStart=1");

    chrome.tabs.create({ url: dashboardUrl });
    return { status: "success", ok: true };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== "object") return false;

    const action = message.action || message.type || "";

    if (action === "PLAY_WELCOME_AUDIO") {
        playWelcomeAudioSafely()
            .then(result => {
                sendResponse({
                    status: "success",
                    ok: true,
                    result
                });
            })
            .catch(error => {
                console.warn("歡迎音訊啟動失敗：", error);
                sendResponse({
                    status: "error",
                    ok: false,
                    message: error?.message || String(error)
                });
            });
        return true;
    }

    if (action === "STOP_WELCOME_AUDIO") {
        stopWelcomeAudioSafely()
            .then(() => {
                sendResponse({
                    status: "success",
                    ok: true
                });
            })
            .catch(error => {
                console.warn("歡迎音訊停止失敗：", error);
                sendResponse({
                    status: "success",
                    ok: true,
                    ignored: true
                });
            });
        return true;
    }

    if (action === "WELCOME_OFFSCREEN_READY" || action === "WELCOME_AUDIO_STARTED" || action === "WELCOME_AUDIO_FAILED") {
        console.log("AI 防詐盾牌音訊狀態：", message);
        sendResponse({
            status: "received",
            ok: true
        });
        return true;
    }




    if (action === "captureScamTabWithEvidence" || action === "AI_SHIELD_AUTO_HIGH_RISK") {
        aiShieldHandleCaptureWithEvidence(message, sender)
            .then(sendResponse)
            .catch(error => sendResponse({
                status: "error",
                ok: false,
                message: error?.message || String(error)
            }));
        return true;
    }

    if (action === "redirect_to_blocked") {
        aiShieldRedirectToBlocked(message, sender)
            .then(sendResponse)
            .catch(error => sendResponse({
                status: "error",
                ok: false,
                message: error?.message || String(error)
            }));
        return true;
    }

    if (action === "AI_SHIELD_OPEN_DASHBOARD") {
        sendResponse(aiShieldOpenDashboard(message));
        return true;
    }

    // 目前先回傳成功，避免 content.js 的圖片背景掃描呼叫出現無回應錯誤。
    // 未來若要做圖片 AI OCR，可在這裡接後端。
    if (action === "scanImageInBackground") {
        sendResponse({
            status: "success",
            ok: true,
            skipped: true,
            message: "圖片背景掃描目前使用本機文字風險判斷為主。"
        });
        return true;
    }

    return false;
});



// =========================
async function getWelcomeOffscreenContexts() {
    if (!chrome.runtime.getContexts) {
        return [];
    }

    const offscreenUrl = chrome.runtime.getURL("offscreen.html");

    return await chrome.runtime.getContexts({
        contextTypes: ["OFFSCREEN_DOCUMENT"],
        documentUrls: [offscreenUrl]
    });
}

async function setupWelcomeOffscreenDocument() {
    const existingContexts = await getWelcomeOffscreenContexts();

    if (existingContexts.length > 0) {
        return;
    }

    if (!chrome.offscreen?.createDocument) {
        throw new Error("目前 Chrome 版本不支援 offscreen document。");
    }

    await chrome.offscreen.createDocument({
        url: "offscreen.html",
        reasons: ["AUDIO_PLAYBACK"],
        justification: "播放 AI 防詐盾牌歡迎頁面的防詐導覽配音"
    });

    // 給 offscreen.html 一點載入時間，避免剛建立就傳訊息造成 Receiving end does not exist
    await new Promise(resolve => setTimeout(resolve, 250));
}

function sendAudioControlSafely(play) {
    return new Promise(resolve => {
        try {
            chrome.runtime.sendMessage(
                {
                    action: "AUDIO_CONTROL",
                    play
                },
                () => {
                    // 這裡刻意吃掉 lastError，避免 offscreen 尚未完成載入時噴紅字
                    if (chrome.runtime.lastError) {
                        console.warn(
                            "AUDIO_CONTROL 暫時沒有接收端：",
                            chrome.runtime.lastError.message
                        );
                    }
                    resolve();
                }
            );
        } catch (error) {
            console.warn("AUDIO_CONTROL 傳送失敗：", error);
            resolve();
        }
    });
}

async function playWelcomeAudioSafely() {
    await setupWelcomeOffscreenDocument();

    // 第一次傳送
    await sendAudioControlSafely(true);

    // 保險重送一次，避免 offscreen script 還沒掛上 listener
    setTimeout(() => {
        sendAudioControlSafely(true);
    }, 300);
}

async function stopWelcomeAudioSafely() {
    const existingContexts = await getWelcomeOffscreenContexts();

    if (existingContexts.length === 0) {
        return;
    }

    await sendAudioControlSafely(false);
}


// =========================
// AI 防詐盾牌：Offscreen 歡迎音訊強化版
// =========================
async function getWelcomeOffscreenContexts() {
    if (!chrome.runtime.getContexts) {
        return [];
    }

    const offscreenUrl = chrome.runtime.getURL("offscreen.html");

    return await chrome.runtime.getContexts({
        contextTypes: ["OFFSCREEN_DOCUMENT"],
        documentUrls: [offscreenUrl]
    });
}

async function setupWelcomeOffscreenDocument() {
    const existingContexts = await getWelcomeOffscreenContexts();

    if (existingContexts.length > 0) {
        return;
    }

    if (!chrome.offscreen?.createDocument) {
        throw new Error("目前 Chrome 版本不支援 offscreen document。");
    }

    await chrome.offscreen.createDocument({
        url: "offscreen.html",
        reasons: ["AUDIO_PLAYBACK"],
        justification: "播放 AI 防詐盾牌歡迎頁面的防詐導覽配音"
    });

    await waitForWelcomeOffscreenReady();
}

function sendAudioMessage(message) {
    return new Promise(resolve => {
        try {
            chrome.runtime.sendMessage(message, response => {
                const lastError = chrome.runtime.lastError;
                if (lastError) {
                    resolve({
                        ok: false,
                        error: lastError.message
                    });
                    return;
                }

                resolve({
                    ok: true,
                    response
                });
            });
        } catch (error) {
            resolve({
                ok: false,
                error: error?.message || String(error)
            });
        }
    });
}

async function waitForWelcomeOffscreenReady() {
    for (let i = 0; i < 10; i += 1) {
        await new Promise(resolve => setTimeout(resolve, 150));

        const result = await sendAudioMessage({
            action: "PING_OFFSCREEN_AUDIO"
        });

        if (result.ok) {
            return true;
        }
    }

    return false;
}

async function playWelcomeAudioSafely() {
    await setupWelcomeOffscreenDocument();

    const result = await sendAudioMessage({
        action: "AUDIO_CONTROL",
        play: true
    });

    if (!result.ok) {
        // 再等一下重送，避免 offscreen listener 剛好尚未完成
        await new Promise(resolve => setTimeout(resolve, 300));

        return await sendAudioMessage({
            action: "AUDIO_CONTROL",
            play: true
        });
    }

    return result;
}

async function stopWelcomeAudioSafely() {
    const existingContexts = await getWelcomeOffscreenContexts();

    if (existingContexts.length === 0) {
        return;
    }

    await sendAudioMessage({
        action: "AUDIO_CONTROL",
        play: false
    });
}

