/**
 * AI 防詐盾牌 - 背景服務 (全自動巡邏 + 高容錯重試 + 圖片視覺掃描 + 右鍵選單 + 自動蒐證快門 + ⏱️ MV3 永不休眠心跳機制)
 */
importScripts('config.js');

// ==========================================
// ⏱️ 核心升級：MV3 Service Worker 永不休眠心跳機制 (Heartbeat)
// ==========================================
const KEEP_ALIVE_ALARM = "keep-alive-alarm";

chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === "install") chrome.tabs.create({ url: "welcome.html" });
    chrome.alarms.create(KEEP_ALIVE_ALARM, { periodInMinutes: 1 });
    
    chrome.contextMenus.removeAll(() => {
        chrome.contextMenus.create({ id: "scan-text", title: "🛡️ 掃描這段可疑話術", contexts: ["selection"] });
        chrome.contextMenus.create({ id: "scan-link", title: "🛡️ 掃描此危險連結", contexts: ["link"] });
        chrome.contextMenus.create({ id: "scan-image", title: "🛡️ 掃描這張可疑圖片", contexts: ["image"] });
    });
});

chrome.runtime.onStartup.addListener(() => {
    chrome.alarms.get(KEEP_ALIVE_ALARM, (alarm) => {
        if (!alarm) {
            chrome.alarms.create(KEEP_ALIVE_ALARM, { periodInMinutes: 1 });
        }
    });
});

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === KEEP_ALIVE_ALARM) {
        console.log("💓 [心跳機制] 防詐盾牌 Service Worker 保持活躍中...", new Date().toLocaleTimeString());
    }
});

// ==========================================
// 🛡️ API 自動重試機制
// ==========================================
async function fetchWithRetry(url, options, maxRetries = CONFIG.MAX_RETRIES) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            const response = await fetch(url, options);
            if (response.ok) return response;
            throw new Error(`HTTP error! status: ${response.status}`);
        } catch (err) {
            if (i === maxRetries - 1) throw err;
            await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1))); 
        }
    }
}

// ==========================================
// 🚀 新增功能：全自動背景巡邏員 (網頁載入即自動掃描)
// ==========================================
const whitelist = [
    'google.com', 'youtube.com', 'yahoo.com.tw', 'gov.tw', 
    'facebook.com', 'line.me', 'instagram.com', 
    'momoshop.com.tw', 'pchome.com.tw', 'shopee.tw',
    'chrome://', 'edge://', 'extensions'
];

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab && tab.url) {
        
        if (whitelist.some(domain => tab.url.includes(domain))) return;
        if (tab.url.includes("blocked.html") || tab.url.includes("dashboard.html")) return;

        try {
            const storage = await chrome.storage.local.get(['userID', 'familyID']);
            let currentUserID = storage.userID || "anonymous";
            let currentFamilyID = storage.familyID || "none";

            let pageText = "";
            try {
                const inject = await chrome.scripting.executeScript({
                    target: { tabId: tabId },
                    func: () => {
                        const title = document.title;
                        const bodyText = (document.documentElement.innerText || document.documentElement.textContent || "").replace(/\s+/g, ' ').substring(0, 800);
                        return `[標題]:${title} [內文]:${bodyText}`;
                    }
                });
                pageText = inject[0]?.result || "";
            } catch (err) { } 

            let screenshotBase64 = null;
            try {
                await new Promise(resolve => setTimeout(resolve, 500)); 
                if (tab.windowId) {
                    screenshotBase64 = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 30 });
                }
            } catch (imgErr) { } 

            let response;
            try {
                response = await fetch(`${CONFIG.API_BASE_URL}/scan`, {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json', 
                        'X-Extension-Secret': CONFIG.EXTENSION_SECRET 
                    },
                    body: JSON.stringify({ 
                        url: tab.url, text: pageText, image: screenshotBase64,
                        userID: currentUserID, familyID: currentFamilyID 
                    })
                });
            } catch (fetchErr) {
                console.warn(`[背景巡邏] 伺服器未連線 (${CONFIG.API_BASE_URL})，暫停掃描。`);
                return; 
            }

            if (!response || !response.ok) return;

            const data = await response.json();
            
            let reportData = {};
            try {
                if (data && data.report) {
                    reportData = typeof data.report === 'string' ? JSON.parse(data.report) : data.report;
                    if (typeof reportData === 'string') reportData = JSON.parse(reportData); 
                } else if (data) {
                    reportData = data; 
                }
            } catch (parseErr) {
                console.warn("[背景巡邏] AI 報告解析失敗，已啟動備援資料", parseErr);
                reportData = data || {}; 
            }

            let score = 0;
            if (reportData) {
                score = parseInt(reportData.riskScore || reportData.RiskScore || reportData.risk_score || data.riskScore) || 0;
            }
            if (score >= CONFIG.RISK_THRESHOLD_HIGH) {
                console.log("🚨 背景巡邏員發現危險，強制攔截！", tab.url);
                const reasonText = reportData?.reason || "系統深層掃描發現高度危險特徵！";
                
                chrome.tabs.get(tabId, (currentTab) => {
                    if (chrome.runtime.lastError) {
                        console.log("[背景巡邏] 目標分頁已關閉，取消攔截。");
                        return;
                    }
                    chrome.tabs.update(tabId, { 
                        url: chrome.runtime.getURL("blocked.html") + "?reason=" + encodeURIComponent(reasonText) + "&original_url=" + encodeURIComponent(tab.url) 
                    }).catch(e => console.log("跳轉攔截頁面失敗:", e));
                });
            }
        } catch (error) {
            console.error("背景自動掃描發生未預期錯誤:", error);
        }
    }
});

// ==========================================
// 👆 原有功能完美保留：右鍵選單掃描
// ==========================================
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    let targetData = ""; let scanType = ""; let imageUrl = "";
    if (info.menuItemId === "scan-text" && info.selectionText) { targetData = info.selectionText; scanType = "文字"; } 
    else if (info.menuItemId === "scan-link" && info.linkUrl) { targetData = info.linkUrl; scanType = "連結"; } 
    else if (info.menuItemId === "scan-image" && info.srcUrl) { targetData = "圖片分析中..."; imageUrl = info.srcUrl; scanType = "圖片"; }

    if (targetData || imageUrl) {
        chrome.notifications.create("scanning", { type: "basic", iconUrl: "icon.png", title: `🛡️ AI 正在掃描可疑${scanType}`, message: "防詐大腦運算中..." });
        try {
            const storage = await chrome.storage.local.get(['userID', 'familyID']);
            const response = await fetchWithRetry(`${CONFIG.API_BASE_URL}/scan`, {
                method: 'POST', 
                headers: { 
                    'Content-Type': 'application/json',
                    'X-Extension-Secret': CONFIG.EXTENSION_SECRET
                },
                body: JSON.stringify({ url: tab.url, text: targetData, image_url: imageUrl, userID: storage.userID || "anonymous", familyID: storage.familyID || "none" })
            });
            const data = await response.json();
            
            let reportData = data;
            if (data.report) {
                reportData = typeof data.report === 'string' ? JSON.parse(data.report) : data.report;
            }
            
            let score = parseInt(reportData.riskScore) || 0; 
            chrome.notifications.clear("scanning");
            
            if (score >= CONFIG.RISK_THRESHOLD_HIGH) {
                if (tab && tab.id) {
                    chrome.tabs.update(tab.id, { url: chrome.runtime.getURL("blocked.html") + "?reason=" + encodeURIComponent(reportData.reason) + "&original_url=" + encodeURIComponent(tab.url) });
                    chrome.tts.speak("警告！警告！爸，這個網站是騙人的，千萬不要輸入資料！請立刻點擊螢幕上的綠色按鈕聯絡我。", { 'lang': 'zh-TW', 'rate': 1.0, 'pitch': 1.0 });
                    
                    fetchWithRetry(`${CONFIG.API_BASE_URL}/scan`, { 
                        method: 'POST', 
                        headers: { 'Content-Type': 'application/json', 'X-Extension-Secret': CONFIG.EXTENSION_SECRET },
                        body: JSON.stringify({ url: tab.url, text: `【手動掃描攔截】${reportData.reason}`, image_url: "", userID: storage.userID || "anonymous", familyID: storage.familyID || "none", is_urgent: true })
                    });
                }
            } else if (score >= 60) {
                if (tab && tab.id) {
                    chrome.tabs.sendMessage(tab.id, { action: "show_alert", data: reportData }).catch(err => {
                        console.log("無法傳送中度風險警告訊息:", err);
                    });
                }
            } else {
                chrome.notifications.create({ type: "basic", iconUrl: "icon.png", title: "✅ 掃描完成", message: `【風險指數: ${score}%】\n${reportData.advice || "請保持警覺"}` });
            }
        } catch (err) {
            chrome.notifications.create({ type: "basic", iconUrl: "icon.png", title: "❌ 分析失敗", message: "網路連線異常，請稍後再試。" });
        }
    }
});

// ==========================================
// 👆 原有功能完美保留：前端與背景的訊息溝通 (蒐證快門、觸發阻擋)
// ==========================================
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "captureScamTabWithEvidence") {
        const { url, reason, timestamp, familyID } = request;
        const tabId = sender.tab ? sender.tab.id : null;
        const windowId = sender.tab ? sender.tab.windowId : null; 
        
        if (!tabId || !windowId) {
            sendResponse({status: "fail", message: "No tabId or windowId"});
            return true;
        }

        (async () => {
            try {
                const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 30 });
                const fetchResponse = await fetch(`${CONFIG.API_BASE_URL}/api/submit_evidence`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-Extension-Secret': CONFIG.EXTENSION_SECRET },
                    body: JSON.stringify({ url: url, timestamp: timestamp, familyID: familyID, screenshot_base64: dataUrl, reported_reason: reason })
                });
                const data = await fetchResponse.json();
                sendResponse({status: "success", backendResponse: data});
            } catch (error) {
                console.error("❌ 截圖權限受限:", error);
                sendResponse({status: "error", details: "截圖受限於 Chrome 本機安全機制"});
            }
        })();
        return true; 
    }

    if (request.action === "triggerBlock") {
        const originalUrl = sender.tab ? sender.tab.url : "未知網址";
        const windowId = sender.tab ? sender.tab.windowId : null;
        const tabId = sender.tab ? sender.tab.id : null;

        // 🛑 【新增免死金牌】：開發環境與維基百科免死金牌
        const devWhitelist = ['github.com', 'localhost', '127.0.0.1', 'wikipedia.org'];
        if (devWhitelist.some(domain => originalUrl.includes(domain))) {
            console.log("🛠️ 觸發免死金牌，放行開發環境:", originalUrl);
            return true; 
        }

        chrome.storage.local.get(['userID', 'familyID']).then(async storage => {
            let screenshotBase64 = null;
            try {
                if (windowId) {
                    screenshotBase64 = await chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 30 });
                }
            } catch(e) { console.log("緊急快門失敗:", e); }

            if (tabId) {
                chrome.tabs.update(tabId, { url: chrome.runtime.getURL("blocked.html") + "?reason=" + encodeURIComponent(request.reason) + "&original_url=" + encodeURIComponent(originalUrl) });
            }
            chrome.tts.speak("警告！警告！爸，這個網站是騙人的，千萬不要輸入資料！請立刻點擊螢幕上的綠色按鈕聯絡我。", { 'lang': 'zh-TW', 'rate': 1.0, 'pitch': 1.0 });

            if (screenshotBase64) {
                fetchWithRetry(`${CONFIG.API_BASE_URL}/api/submit_evidence`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-Extension-Secret': CONFIG.EXTENSION_SECRET },
                    body: JSON.stringify({ 
                        url: originalUrl, 
                        timestamp: new Date().toLocaleTimeString('zh-TW', { hour12: false }), 
                        familyID: storage.familyID || "none", 
                        screenshot_base64: screenshotBase64, 
                        reported_reason: request.reason 
                    })
                });
            } else {
                fetchWithRetry(`${CONFIG.API_BASE_URL}/scan`, { 
                    method: 'POST', 
                    headers: { 'Content-Type': 'application/json', 'X-Extension-Secret': CONFIG.EXTENSION_SECRET },
                    body: JSON.stringify({ url: originalUrl, text: `【緊急攔截】${request.reason}`, image_url: "", userID: storage.userID || "anonymous", familyID: storage.familyID || "none", is_urgent: false })
                });
            }
        });
        return true;
    }
    
    if (request.action === "scanImageInBackground") {
        chrome.storage.local.get(['userID', 'familyID']).then(storage => {
            fetch(`${CONFIG.API_BASE_URL}/scan`, { 
                method: 'POST', 
                headers: { 'Content-Type': 'application/json', 'X-Extension-Secret': CONFIG.EXTENSION_SECRET },
                body: JSON.stringify({ url: request.pageUrl, text: "背景圖片自動分析", image_url: request.imageUrl, userID: storage.userID || "anonymous", familyID: storage.familyID || "none", is_urgent: false })
            }).then(res => res.json()).then(data => {
                let reportData = typeof data.report === 'string' ? JSON.parse(data.report) : data.report;
                let score = parseInt(reportData.riskScore) || 0;
                
                if (score >= CONFIG.RISK_THRESHOLD_HIGH) {
                    chrome.notifications.create({ type: "basic", iconUrl: "icon.png", title: "🚨 圖片含有詐騙風險！", message: reportData.reason });
                } else if (score >= 60 && sender.tab && sender.tab.id) {
                    chrome.tabs.sendMessage(sender.tab.id, { action: "show_alert", data: reportData }).catch(() => {});
                }
            }).catch(() => {});
        });
    }
});