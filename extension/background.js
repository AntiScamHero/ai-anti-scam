/**
 * AI 防詐盾牌 - 背景服務 (高容錯重試 + 圖片視覺掃描處理 + 中風險浮動警告)
 */
importScripts('config.js');

// 🛡️ API 自動重試機制
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

chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === "install") chrome.tabs.create({ url: "welcome.html" });
    chrome.contextMenus.removeAll(() => {
        chrome.contextMenus.create({ id: "scan-text", title: "🛡️ 掃描這段可疑話術", contexts: ["selection"] });
        chrome.contextMenus.create({ id: "scan-link", title: "🛡️ 掃描此危險連結", contexts: ["link"] });
        chrome.contextMenus.create({ id: "scan-image", title: "🛡️ 掃描這張可疑圖片", contexts: ["image"] });
    });
});

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
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: tab.url, text: targetData, image_url: imageUrl, userID: storage.userID || "anonymous", familyID: storage.familyID || "none" })
            });
            const data = await response.json();
            
            let reportData = data;
            if (data.report) {
                reportData = typeof data.report === 'string' ? JSON.parse(data.report) : data.report;
            }
            
            let score = parseInt(reportData.riskScore) || 0; 
            chrome.notifications.clear("scanning");
            
            // 💡 核心修復：高風險強制攔截，中風險(>=60)發送浮動警告！
            if (score >= CONFIG.RISK_THRESHOLD_HIGH) {
                if (tab && tab.id) {
                    chrome.tabs.update(tab.id, { url: chrome.runtime.getURL("blocked.html") + "?reason=" + encodeURIComponent(reportData.reason) + "&original_url=" + encodeURIComponent(tab.url) });
                    chrome.tts.speak("警告！警告！爸，這個網站是騙人的，千萬不要輸入資料！請立刻點擊螢幕上的綠色按鈕聯絡我。", { 'lang': 'zh-TW', 'rate': 1.0, 'pitch': 1.0 });
                    
                    fetchWithRetry(`${CONFIG.API_BASE_URL}/scan`, { 
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ url: tab.url, text: `【手動掃描攔截】${reportData.reason}`, image_url: "", userID: storage.userID || "anonymous", familyID: storage.familyID || "none", is_urgent: true })
                    });
                }
            } else if (score >= 60) {
                // 發送指令給 content.js 顯示浮動警告視窗
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

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "triggerBlock") {
        if (sender.tab && sender.tab.id) {
            const originalUrl = sender.tab.url ? sender.tab.url : "";
            chrome.tabs.update(sender.tab.id, { url: chrome.runtime.getURL("blocked.html") + "?reason=" + encodeURIComponent(request.reason) + "&original_url=" + encodeURIComponent(originalUrl) });
        }
        chrome.tts.speak("警告！警告！爸，這個網站是騙人的，千萬不要輸入資料！請立刻點擊螢幕上的綠色按鈕聯絡我。", { 'lang': 'zh-TW', 'rate': 1.0, 'pitch': 1.0 });
        
        chrome.storage.local.get(['userID', 'familyID']).then(storage => {
            fetchWithRetry(`${CONFIG.API_BASE_URL}/scan`, { 
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: sender.tab ? sender.tab.url : "未知網址", text: `【攔截】${request.reason}`, image_url: "", userID: storage.userID || "anonymous", familyID: storage.familyID || "none", is_urgent: true })
            }).catch(e => console.log("推播請求失敗:", e));
        });
    }
    
    if (request.action === "scanImageInBackground") {
        chrome.storage.local.get(['userID', 'familyID']).then(storage => {
            fetch(`${CONFIG.API_BASE_URL}/scan`, { 
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: request.pageUrl, text: "背景圖片自動分析", image_url: request.imageUrl, userID: storage.userID || "anonymous", familyID: storage.familyID || "none", is_urgent: false })
            }).then(res => res.json()).then(data => {
                let reportData = typeof data.report === 'string' ? JSON.parse(data.report) : data.report;
                let score = parseInt(reportData.riskScore) || 0;
                
                if (score >= CONFIG.RISK_THRESHOLD_HIGH) {
                    chrome.notifications.create({ type: "basic", iconUrl: "icon.png", title: "🚨 圖片含有詐騙風險！", message: reportData.reason });
                } else if (score >= 60 && sender.tab && sender.tab.id) {
                    // 若背景圖片分析為中風險，同樣在原網頁觸發浮動警告
                    chrome.tabs.sendMessage(sender.tab.id, { action: "show_alert", data: reportData }).catch(() => {});
                }
            }).catch(() => {});
        });
    }
});