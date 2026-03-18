/**
 * AI 防詐盾牌 - 網頁雙效守護者 (效能優化 + 圖片分析 + 個資脫敏)
 */

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

const badDomains = ["testsafebrowsing.appspot.com", "fake-scam-delivery.com", "win-free-iphone-now.net"];

const linkObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            const link = entry.target;
            try {
                const linkUrl = new URL(link.href);
                if (badDomains.some(domain => linkUrl.hostname.includes(domain))) {
                    link.style.cssText = 'color: #ff0000 !important; font-weight: bold; text-decoration: underline wavy red; background-color: #ffe6e6;';
                    link.addEventListener('click', e => { e.preventDefault(); alert("🚨【AI 防詐盾牌警告】\n此為高度危險詐騙連結！已阻擋。"); });
                }
            } catch (e) {}
            observer.unobserve(link); 
        }
    });
});

// 👁️ 新增：圖片視覺掃描觀察器 (只掃描使用者看到的圖片，節省 API)
const imageObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            const img = entry.target;
            // 過濾掉太小的 icon 或是 base64 編碼圖片
            if (img.src && !img.src.startsWith('data:') && img.width > 50 && img.height > 50) {
                // 🛡️ 加上 try-catch 保護罩，防止 Extension context invalidated 錯誤
                try {
                    chrome.runtime.sendMessage({ action: "scanImageInBackground", imageUrl: img.src, pageUrl: window.location.href });
                } catch (error) {
                    console.warn("⚠️ 擴充功能已更新，請重新整理此網頁以恢復圖片掃描功能。");
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

const scamKeywords = ["保證獲利", "加賴領取", "穩賺不賠", "飆股", "破解程式", "名額有限", "內部消息", "無風險投資"];
let hasTriggeredBlock = false; 

// 🛡️ 新增：隱私安全脫敏函數
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
    } catch (error) {
        window.location.replace(chrome.runtime.getURL("blocked.html") + "?reason=" + encodeURIComponent(reason) + "&original_url=" + encodeURIComponent(window.location.href));
    }
}

function scanScamWords() {
    if (hasTriggeredBlock) return;
    const textContent = document.body ? (document.body.innerText || document.body.textContent) : document.documentElement.textContent;
    const safeText = maskSensitiveData(textContent); // 脫敏

    for (let keyword of scamKeywords) {
        if (safeText.includes(keyword)) {
            triggerSafeBlock(`偵測到危險字彙：${keyword}`);
            break; 
        }
    }
    observeElements(); 
}

// 🛡️ 記憶體防護：靜止偵測機制
let scanCount = 0;
let lastActivityTime = Date.now();
document.addEventListener('mousemove', () => { lastActivityTime = Date.now(); });
document.addEventListener('keydown', () => { lastActivityTime = Date.now(); });

function scheduleIdleScan() {
    // 若無操作超過設定時間 (CONFIG.INACTIVITY_TIMEOUT_MS)，休眠不掃描
    if (Date.now() - lastActivityTime > (window.CONFIG?.INACTIVITY_TIMEOUT_MS || 300000)) {
        setTimeout(scheduleIdleScan, 5000); // 慢速甦醒檢查
        return;
    }
    
    // 限制每分鐘頻率
    if (scanCount >= (window.CONFIG?.MAX_SCANS_PER_MINUTE || 10)) {
        setTimeout(() => { scanCount = 0; scheduleIdleScan(); }, 60000);
        return;
    }
    scanCount++;

    if (window.requestIdleCallback) {
        requestIdleCallback(() => { scanScamWords(); setTimeout(scheduleIdleScan, window.CONFIG?.SCAN_COOLDOWN_MS || 1500); });
    } else {
        setTimeout(() => { scanScamWords(); scheduleIdleScan(); }, window.CONFIG?.SCAN_COOLDOWN_MS || 1500);
    }
}

if (window.self === window.top) {
    new BehaviorAnalyzer(); 
    scheduleIdleScan();
}