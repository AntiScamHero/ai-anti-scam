/**
 * 🏆 AI 防詐盾牌 - 網頁雙效守護者 (2026 競賽冠軍優化版)
 * 核心特色：效能優化 + 多層次快取防線 + 圖片分析 + 個資脫敏 + 友軍免死金牌機制 + 動態防禦
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

function triggerSafeBlock(reason) {
    if (hasTriggeredBlock) return;
    if (sessionStorage.getItem('temp_whitelist_' + window.location.href)) return;

    hasTriggeredBlock = true;
    
    const shield = document.createElement('div');
    shield.style.cssText = "position:fixed; top:0; left:0; width:100vw; height:100vh; background:#ff2a2a; color:white; display:flex; align-items:center; justify-content:center; font-size:45px; font-weight:bold; z-index:2147483647; font-family:sans-serif;";
    shield.innerText = "🚨 詐騙威脅攔截中...";
    document.documentElement.appendChild(shield);
    if (document.body) document.body.style.display = 'none'; 

    try {
        chrome.runtime.sendMessage({ action: "triggerBlock", reason: reason });
        setTimeout(() => {
            window.location.replace(chrome.runtime.getURL("blocked.html") + "?reason=" + encodeURIComponent(reason) + "&original_url=" + encodeURIComponent(window.location.href));
        }, 1000);
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
    const textContent = document.body ? (document.body.innerText || document.body.textContent) : document.documentElement.textContent;
    
    let iframeUrls = Array.from(document.querySelectorAll('iframe')).map(f => f.src).filter(src => src);
    let iframeText = iframeUrls.length > 0 ? `\n[隱藏的Iframe網址]: ${iframeUrls.join(', ')}` : "";

    const cleanText = textContent.trim();
    
    if (cleanText.length < 50 && iframeUrls.length === 0) {
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
// 🛡️ 啟動邏輯：系統判定與免死金牌
// ==========================================
if (window.self === window.top) {
    const isSystemPage = window.location.protocol === 'chrome-extension:' ||
                         window.location.href.includes('dashboard.html') ||
                         window.location.href.includes('blocked.html') ||
                         window.location.href.includes('simulator.html') || // 🟢 新增：給演練戰情室免死金牌
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