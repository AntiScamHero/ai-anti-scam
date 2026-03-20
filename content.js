/**
 * 🏆 AI 防詐盾牌 - 網頁雙效守護者 (2026 競賽冠軍優化版)
 * 核心特色：效能優化 + 多層次快取防線 + 圖片分析 + 個資脫敏 + 友軍免死金牌機制
 */

// ==========================================
// 🚀 競賽級優化：多層次快取防線 (Multi-layer Cache Defense)
// ==========================================
// 目的：避免重複掃描相同的網頁內容，極大化節省 CPU 資源與後端 API 成本。
const scannedCache = new Set();

// 高效字串雜湊函數 (DJB2 演算法變體)
function hashString(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash) + str.charCodeAt(i); /* hash * 33 + c */
    }
    return hash.toString(16); // 轉為 16 進位字串節省記憶體
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
                        // 攔截試圖用浮動視窗強制索取個資的惡意行為
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
// 🟢 修正 1：把測試釣魚網址加入黑名單
const badDomains = ["testsafebrowsing.appspot.com", "fake-scam-delivery.com", "win-free-iphone-now.net", "lucky-verify-login.net"];

// 連結掃描器：針對已知惡意網域進行本地端光速攔截
const linkObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            const link = entry.target;
            try {
                const linkUrl = new URL(link.href);
                if (badDomains.some(domain => linkUrl.hostname.includes(domain))) {
                    link.style.cssText = 'color: #ff0000 !important; font-weight: bold; text-decoration: underline wavy red; background-color: #ffe6e6;';
                    // 🟢 修正 2：不再只跳 alert，直接觸發滿版紅色鎖死大絕招！
                    triggerSafeBlock("發現 165 黑名單釣魚連結：" + linkUrl.hostname);
                }
            } catch (e) {}
            observer.unobserve(link); 
        }
    });
});

// 圖片掃描器：結合後端 Vision AI 進行多模態偵測
const imageObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            const img = entry.target;
            // 排除過小的 icon 或 data URI 圖片，節省資源
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

// 本地端極速個資脫敏 (Edge Computing 概念展示)
function maskSensitiveData(text) {
    if (!text) return "";
    return text
        .replace(/(?:\d{4}[-\s]?){3}\d{4}/g, "[信用卡號已隱藏]")
        .replace(/[A-Z][12]\d{8}/i, "[身分證已隱藏]")
        .replace(/09\d{2}[-\s]?\d{3}[-\s]?\d{3}/g, "[手機號碼已隱藏]")
        .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[Email已隱藏]");
}

// 觸發安全攔截屏障
function triggerSafeBlock(reason) {
    if (hasTriggeredBlock) return;
    // 檢查是否有臨時白名單 (免死金牌)
    if (sessionStorage.getItem('temp_whitelist_' + window.location.href)) return;

    hasTriggeredBlock = true;
    
    // 建立全螢幕紅色阻擋遮罩
    const shield = document.createElement('div');
    shield.style.cssText = "position:fixed; top:0; left:0; width:100vw; height:100vh; background:#ff2a2a; color:white; display:flex; align-items:center; justify-content:center; font-size:45px; font-weight:bold; z-index:2147483647; font-family:sans-serif;";
    shield.innerText = "🚨 詐騙威脅攔截中...";
    document.documentElement.appendChild(shield);
    if (document.body) document.body.style.display = 'none'; 

    try {
        // 通知 Background.js 進行跳轉與記錄
        chrome.runtime.sendMessage({ action: "triggerBlock", reason: reason });
        
        // 雙重保險：如果背景程式 1 秒後沒反應，前端自己強制跳轉
        setTimeout(() => {
            window.location.replace(chrome.runtime.getURL("blocked.html") + "?reason=" + encodeURIComponent(reason) + "&original_url=" + encodeURIComponent(window.location.href));
        }, 1000);
    } catch (error) {
        // 容錯機制：若無法通訊，本地強制跳轉至警告頁面
        try {
            window.location.replace(chrome.runtime.getURL("blocked.html") + "?reason=" + encodeURIComponent(reason) + "&original_url=" + encodeURIComponent(window.location.href));
        } catch (e) {
            alert("🚨 【AI 防詐盾牌】已攔截此危險頁面！");
        }
    }
}

// 核心掃描器 (已加入效能優化)
function scanScamWords() {
    if (hasTriggeredBlock) return;
    const textContent = document.body ? (document.body.innerText || document.body.textContent) : document.documentElement.textContent;
    
    const cleanText = textContent.trim();
    
    // 💡 效能優化 1：過濾極短無意義文本 (少於 50 字不掃描)，節省 CPU 運算
    if (cleanText.length < 50) {
        observeElements(); 
        return;
    }

    // 💡 效能優化 2：Hash 快取比對，若內容未改變則直接跳過
    const textHash = hashString(cleanText);
    if (scannedCache.has(textHash)) {
        observeElements();
        return; 
    }
    
    // 將新內容加入快取
    scannedCache.add(textHash);
    
    // 為防止記憶體洩漏，當快取超過 50 筆時清空一半
    if (scannedCache.size > 50) {
        const cacheIterator = scannedCache.values();
        for (let i = 0; i < 25; i++) scannedCache.delete(cacheIterator.next().value);
    }

    // 進行本地個資脫敏
    const safeText = maskSensitiveData(cleanText); 

    // 關鍵字速查防線
    for (let keyword of scamKeywords) {
        if (safeText.includes(keyword)) {
            triggerSafeBlock(`偵測到危險字彙：${keyword}`);
            return; // 觸發攔截後直接中斷後續操作
        }
    }
    
    // 啟動 DOM 觀察者
    observeElements(); 
}

// ==========================================
// ⏱️ 模組 4：資源管理與排程 (Idle Scheduling)
// ==========================================
let scanCount = 0;
let lastActivityTime = Date.now();

// 監測使用者活動
document.addEventListener('mousemove', () => { lastActivityTime = Date.now(); }, { passive: true });
document.addEventListener('keydown', () => { lastActivityTime = Date.now(); }, { passive: true });

function scheduleIdleScan() {
    // 💡 效能優化 3：閒置休眠模式 (超過設定時間無操作即暫停掃描)
    if (Date.now() - lastActivityTime > (window.CONFIG?.INACTIVITY_TIMEOUT_MS || 300000)) {
        setTimeout(scheduleIdleScan, 5000); 
        return;
    }
    
    // 💡 效能優化 4：API 頻率限制 (Rate Limiting)
    if (scanCount >= (window.CONFIG?.MAX_SCANS_PER_MINUTE || 10)) {
        setTimeout(() => { scanCount = 0; scheduleIdleScan(); }, 60000);
        return;
    }
    scanCount++;

    // 💡 效能優化 5：利用 requestIdleCallback 讓出主執行緒，確保網頁捲動不卡頓
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
// 🛡️ 啟動邏輯：系統判定與免死金牌
// ==========================================
if (window.self === window.top) {
    // 判斷是否為系統自家的安全頁面 (包含 dashboard, 本地檔案, 擴充功能設定頁)
    const isSystemPage = window.location.protocol === 'chrome-extension:' ||
                         // window.location.protocol === 'file:' ||  <-- 🟢 修正 3：已移除這行，允許掃描桌面 test.html！
                         window.location.href.includes('dashboard.html') ||
                         window.location.href.includes('blocked.html') ||
                         window.location.hostname === 'localhost' ||
                         window.location.hostname === '127.0.0.1';

    // 只有在「不是」系統頁面的時候，才啟動自動掃描機制
    if (!isSystemPage) {
        new BehaviorAnalyzer(); 
        scheduleIdleScan();
        console.log("🛡️ AI 防詐盾牌：防護系統已上線 (啟用多層快取防禦)");
    } else {
        console.log("🛡️ AI 防詐盾牌：已偵測到友軍系統頁面 (戰情室)，已關閉自動掃描以防誤傷！");
    }
}