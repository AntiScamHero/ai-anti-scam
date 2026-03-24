/**
 * 🏆 AI 防詐盾牌 - 網頁雙效守護者 (2026 競賽冠軍優化版 + 證據保全快門)
 * 核心特色：效能優化 + 多層次快取防線 + 圖片分析 + 個資脫敏 + 友軍免死金牌機制 + 動態防禦 + 浮動警告視窗 + 自動蒐證快門
 */

// ==========================================
// 🚀 競賽級優化：多層次快取防線 (Multi-layer Cache Defense)
// ==========================================
const scannedCache = new Set();

function hashString(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash) + str.charCodeAt(i);
    }
    return hash.toString(16);
}

function extractHighRiskText(text, maxLength = 4000) {
    if (text.length <= maxLength) return text;
    
    const riskKeywords = ["保證獲利", "加賴", "飆股", "解凍", "中獎", "登入", "身分證", "帳號", "密碼"];
    let snippets = [];
    let lastIndex = 0;

    for (let kw of riskKeywords) {
        let idx = text.indexOf(kw, lastIndex);
        if (idx !== -1) {
            let start = Math.max(0, idx - 250);
            let end = Math.min(text.length, idx + 250);
            snippets.push(text.substring(start, end));
            lastIndex = end;
        }
    }

    let finalStr = snippets.join("\n...\n");
    if (finalStr.length === 0) {
        return text.substring(0, 2000) + "\n...\n" + text.substring(text.length - 2000);
    }
    return finalStr.substring(0, maxLength);
}

// ==========================================
// 🛡️ 模組 1：惡意行為捕捉 (BehaviorAnalyzer)
// ==========================================
class BehaviorAnalyzer {
    constructor() { this.setupObservers(); }
    setupObservers() {
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === 1) { 
                        const text = node.innerText || '';
                        const style = window.getComputedStyle(node);
                        if ((style.position === 'fixed' || style.position === 'absolute') && 
                            (text.includes('信用卡') || text.includes('身分證字號') || text.includes('銀行帳號'))) {
                            triggerSafeBlock("惡意行為：網頁試圖強制索取機密個資");
                        }
                    }
                });
            });
        });
        if (document.body) observer.observe(document.body, { childList: true, subtree: true });
    }
}

// ==========================================
// 🌐 模組 2：DOM 元素觀察者 (連結與圖片)
// ==========================================
const badDomains = ["testsafebrowsing.appspot.com", "fake-scam-delivery.com", "win-free-iphone-now.net", "lucky-verify-login.net"];

const linkObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            const link = entry.target;
            try {
                const linkUrl = new URL(link.href);
                if (badDomains.some(domain => linkUrl.hostname.includes(domain))) {
                    link.style.cssText = 'color: #ff0000 !important; font-weight: bold; text-decoration: underline wavy red; background-color: #ffe6e6;';
                    triggerSafeBlock("發現 165 黑名單釣魚連結：" + linkUrl.hostname);
                }
            } catch (e) {}
            observer.unobserve(link); 
        }
    });
});

const imageObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            const img = entry.target;
            if (img.src && !img.src.startsWith('data:') && img.width > 50 && img.height > 50) {
                try {
                    chrome.runtime.sendMessage({ action: "scanImageInBackground", imageUrl: img.src, pageUrl: window.location.href });
                } catch (error) {
                    console.warn("⚠️ 擴充功能已更新，請重新整理此網頁。");
                }
            }
            observer.unobserve(img);
        }
    });
});

function observeElements() {
    document.querySelectorAll('a:not([data-scanned="true"])').forEach(link => {
        link.dataset.scanned = "true"; linkObserver.observe(link);
    });
    document.querySelectorAll('img:not([data-scanned="true"])').forEach(img => {
        img.dataset.scanned = "true"; imageObserver.observe(img);
    });
}

// ==========================================
// 🧠 模組 3：核心文本掃描與脫敏
// ==========================================
const scamKeywords = ["保證獲利", "加賴領取", "穩賺不賠", "飆股", "破解程式", "名額有限", "內部消息", "無風險投資", "斷手斷腳", "不准報警"];
let hasTriggeredBlock = false; 

function maskSensitiveData(text) {
    if (!text) return "";
    return text
        .replace(/(?:\d{4}[-\s]?){3}\d{4}/g, "[信用卡號已隱藏]")
        .replace(/[A-Z][12]\d{8}/i, "[身分證已隱藏]")
        .replace(/09\d{2}[-\s]?\d{3}[-\s]?\d{3}/g, "[手機號碼已隱藏]")
        .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[Email已隱藏]");
}

// ==========================================
// 🚨 升級重點：觸發蒐證攔截視窗 (異步截圖處理邏輯)
// ==========================================
async function triggerSafeBlock(reason, reportData = null) {
    if (hasTriggeredBlock) return;
    if (sessionStorage.getItem('temp_whitelist_' + window.location.href)) return;

    hasTriggeredBlock = true;

    console.log("🛡️ AI 防詐盾牌：觸發蒐證攔截，正在按下證據快門...", reason);

    // 1. 🟢 視覺：立即顯示簡單蒐證遮罩，凍結使用者操作
    const shield = document.createElement('div');
    shield.id = 'scam-shield-overlay';
    shield.style.cssText = "position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.85); color:white; display:flex; flex-direction:column; align-items:center; justify-content:center; font-size:30px; font-weight:bold; z-index:2147483647; font-family:sans-serif; backdrop-filter:blur(5px);";
    shield.innerHTML = `
        <div style="font-size:60px; margin-bottom:20px;">🛡️</div>
        <div style="margin-bottom:15px;">AI 防詐盾牌攔截中</div>
        <div style="font-size:18px; color:#ffdddd; font-weight:normal;">[正在自動蒐證詐騙快照並上傳雲端，請稍候...]</div>
        <div style="margin-top:20px; font-size:14px; color:#aaa; font-weight:normal;">(證據將作為家人求證或 165 檢舉之用)</div>
    `;
    document.documentElement.appendChild(shield);
    if (document.body) document.body.style.display = 'none';

    // 2. 🟢 動作：通知背景程式按快門 (此為 async 請求)
    try {
        const timestamp = new Date().toISOString(); 
        let familyID = 'none';
        try {
            const storage = await chrome.storage.local.get(['familyID']);
            if (storage.familyID) familyID = storage.familyID;
        } catch (e) {}

        console.log("📸 向 background.js 發送快門指令...");
        
        // 設定一個 3 秒的超時機制，避免背景程式卡住導致畫面無法跳轉
        const sendPromise = chrome.runtime.sendMessage({ 
            action: "captureScamTabWithEvidence", 
            url: window.location.href, 
            reason: reason, 
            timestamp: timestamp, 
            familyID: familyID 
        });
        const timeoutPromise = new Promise(resolve => setTimeout(() => resolve({status: "timeout"}), 3000));
        
        const response = await Promise.race([sendPromise, timeoutPromise]);
        console.log("✅ 證據上傳回應:", response);

    } catch (error) {
        console.error("❌ 自動蒐證快門失敗:", error);
    }

    // 3. 🟢 跳轉：蒐證完成 (或超時後)，正式跳轉到 blocked.html 進行警報
    const dataToSend = reportData ? JSON.stringify(reportData) : JSON.stringify({ riskScore: "99", reason: reason, advice: "請勿輸入任何資料。" });
    try {
        window.location.replace(chrome.runtime.getURL("blocked.html") + "?data=" + encodeURIComponent(dataToSend) + "&url=" + encodeURIComponent(window.location.href));
    } catch (error) {
        try {
            window.location.replace(chrome.runtime.getURL("blocked.html") + "?reason=" + encodeURIComponent(reason) + "&original_url=" + encodeURIComponent(window.location.href));
        } catch (e) {
            alert("🚨 【AI 防詐盾牌】已攔截此危險頁面！");
        }
    }
}

function scanScamWords() {
    if (hasTriggeredBlock) return;
    
    // 前端免死金牌 (知名網站白名單)
    const frontendWhitelist = [
        "yahoo.com", 
        "yahoo.com.tw",
        "tw.stock.yahoo.com",
        "google.com", 
        "msn.com", 
        "pchome.com.tw", 
        "cnyes.com", 
        "github.com", 
        "render.com"
    ];
    
    const currentHost = window.location.hostname;
    const isWhitelisted = frontendWhitelist.some(domain => currentHost.includes(domain));

    const textContent = document.body ? (document.body.innerText || document.body.textContent) : document.documentElement.textContent;
    
    let iframeUrls = Array.from(document.querySelectorAll('iframe')).map(f => f.src).filter(src => src);
    let iframeText = iframeUrls.length > 0 ? `\n[隱藏的Iframe網址]: ${iframeUrls.join(', ')}` : "";

    const cleanText = textContent.trim();
    
    // 如果在白名單內，或文字太少，跳過前端死板攔截，只啟用圖片與連結檢查
    if ((cleanText.length < 50 && iframeUrls.length === 0) || isWhitelisted) {
        observeElements(); 
        return;
    }

    const textHash = hashString(cleanText);
    if (scannedCache.has(textHash)) {
        observeElements();
        return; 
    }
    
    scannedCache.add(textHash);
    
    if (scannedCache.size > 50) {
        const cacheIterator = scannedCache.values();
        for (let i = 0; i < 25; i++) scannedCache.delete(cacheIterator.next().value);
    }

    const smartText = extractHighRiskText(cleanText) + iframeText;
    const safeText = maskSensitiveData(smartText); 

    for (let keyword of scamKeywords) {
        if (safeText.includes(keyword)) {
            triggerSafeBlock(`偵測到危險字彙：${keyword}`);
            return; 
        }
    }
    
    observeElements(); 
}

// ==========================================
// ⏱️ 模組 4：資源管理與排程 (Idle Scheduling)
// ==========================================
let scanCount = 0;
let lastActivityTime = Date.now();

document.addEventListener('mousemove', () => { lastActivityTime = Date.now(); }, { passive: true });
document.addEventListener('keydown', () => { lastActivityTime = Date.now(); }, { passive: true });

function scheduleIdleScan() {
    if (Date.now() - lastActivityTime > (window.CONFIG?.INACTIVITY_TIMEOUT_MS || 300000)) {
        setTimeout(scheduleIdleScan, 5000); 
        return;
    }
    
    if (scanCount >= (window.CONFIG?.MAX_SCANS_PER_MINUTE || 10)) {
        setTimeout(() => { scanCount = 0; scheduleIdleScan(); }, 60000);
        return;
    }
    scanCount++;

    if (window.requestIdleCallback) {
        requestIdleCallback(() => { 
            scanScamWords(); 
            setTimeout(scheduleIdleScan, window.CONFIG?.SCAN_COOLDOWN_MS || 1500); 
        }, { timeout: 2000 });
    } else {
        setTimeout(() => { 
            scanScamWords(); 
            scheduleIdleScan(); 
        }, window.CONFIG?.SCAN_COOLDOWN_MS || 1500);
    }
}

// ==========================================
// 🛡️ 升級功能 1：動態 DOM 變化監測 (防繞過)
// ==========================================
let lastDynamicScanTime = Date.now();
const dynamicObserver = new MutationObserver((mutations) => {
    if (Date.now() - lastDynamicScanTime < 5000) return; 
    
    let significantChange = false;
    mutations.forEach((mutation) => {
        if (mutation.addedNodes.length > 0 && mutation.target.innerText && mutation.target.innerText.length > 100) {
            significantChange = true;
        }
    });

    if (significantChange) {
        lastDynamicScanTime = Date.now();
        console.log("🛡️ AI 防詐盾牌：偵測到網頁內容大幅改變，啟動二次掃描...");
        scanScamWords(); 
    }
});

// ==========================================
// 🃏 升級功能 2：反制模式 - 一鍵注入幽默假資料
// ==========================================
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "inject_fake_data") {
        const inputs = document.querySelectorAll('input[type="text"], input[type="tel"], input[type="email"]');
        let injectedCount = 0;
        
        inputs.forEach(input => {
            const name = input.name ? input.name.toLowerCase() : '';
            const placeholder = input.placeholder ? input.placeholder.toLowerCase() : '';
            
            if (name.includes('name') || placeholder.includes('姓名')) {
                input.value = "王大明 (防詐測試員)";
                injectedCount++;
            } else if (name.includes('phone') || name.includes('tel') || placeholder.includes('電話') || placeholder.includes('手機')) {
                input.value = "0987987987"; 
                injectedCount++;
            } else if (name.includes('email') || placeholder.includes('信箱')) {
                input.value = "scammer_hunter@police.gov.tw";
                injectedCount++;
            }
        });
        
        alert(`🛡️ 已成功為您注入 ${injectedCount} 筆反制假資料！`);
        sendResponse({status: "success"});
    }
});

// ==========================================
// ⚠️ 升級功能 3：接收背景警告指令 (浮動警告視窗)
// ==========================================
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request.action === "show_alert") {
        console.log("⚠️ 收到警告指令，顯示浮動視窗");
        if (document.getElementById("ai-fraud-alert-box")) return;

        let alertDiv = document.createElement("div");
        alertDiv.id = "ai-fraud-alert-box";
        alertDiv.style.position = "fixed";
        alertDiv.style.bottom = "20px";
        alertDiv.style.right = "20px";
        alertDiv.style.backgroundColor = "#ff4d4f";
        alertDiv.style.color = "white";
        alertDiv.style.padding = "15px 20px";
        alertDiv.style.borderRadius = "8px";
        alertDiv.style.boxShadow = "0 4px 12px rgba(0,0,0,0.3)";
        alertDiv.style.zIndex = "999999";
        alertDiv.style.fontFamily = "sans-serif";
        alertDiv.style.fontSize = "16px";
        alertDiv.style.fontWeight = "bold";
        alertDiv.style.maxWidth = "300px";

        let title = document.createElement("div");
        title.innerText = "⚠️ AI 防詐盾牌警告";
        title.style.fontSize = "18px";
        title.style.marginBottom = "8px";

        let content = document.createElement("div");
        let riskScore = request.data.riskScore !== undefined ? request.data.riskScore : "未知";
        let reason = request.data.reason || "系統偵測到潛在風險";
        content.innerText = `此網頁存在中度風險 (${riskScore}分)，疑似包含詐騙特徵，請小心操作！\n原因：${reason}`;
        content.style.fontSize = "14px";
        content.style.lineHeight = "1.4";

        let closeBtn = document.createElement("button");
        closeBtn.innerText = "我知道了";
        closeBtn.style.marginTop = "10px";
        closeBtn.style.padding = "5px 10px";
        closeBtn.style.border = "none";
        closeBtn.style.borderRadius = "4px";
        closeBtn.style.backgroundColor = "white";
        closeBtn.style.color = "#ff4d4f";
        closeBtn.style.cursor = "pointer";
        closeBtn.style.fontWeight = "bold";
        closeBtn.style.width = "100%";

        closeBtn.onclick = function() { alertDiv.remove(); };

        alertDiv.appendChild(title);
        alertDiv.appendChild(content);
        alertDiv.appendChild(closeBtn);
        document.body.appendChild(alertDiv);
    }
});

// ==========================================
// 🛡️ 啟動邏輯：系統判定與免死金牌
// ==========================================
if (window.self === window.top) {
    const isSystemPage = window.location.protocol === 'chrome-extension:' ||
                         window.location.href.includes('dashboard.html') ||
                         window.location.href.includes('blocked.html') ||
                         window.location.href.includes('simulator.html') || 
                         window.location.hostname === 'localhost' ||
                         window.location.hostname === '127.0.0.1';

    if (!isSystemPage) {
        new BehaviorAnalyzer(); 
        if (document.body) dynamicObserver.observe(document.body, { childList: true, subtree: true });
        scheduleIdleScan();
        console.log("🛡️ AI 防詐盾牌：防護系統已上線 (啟用多層快取與動態防禦)");
    } else {
        console.log("🛡️ AI 防詐盾牌：已偵測到友軍系統頁面 (戰情室)，已關閉自動掃描以防誤傷！");
    }
}