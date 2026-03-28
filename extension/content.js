/**
 * 🏆 AI 防詐盾牌 - 網頁雙效守護者 (極簡無干擾版)
 * 核心特色：動態網站信譽分級 + 區域限定掃描 + 上下文權重 + 信任護城河扣分 + 條件式圖片掃描 + 自動蒐證快門 + 🛡️ 隱私權物理隔離萃取
 */

// ==========================================
// 🚀 競賽級優化：多層次快取防線 (Multi-layer Cache Defense)
// ==========================================
const scannedCache = new Set();
let currentGlobalRiskScore = 0; 

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
// 🔐 核心升級：無塵室等級的安全文字萃取器 (Safe Text Extractor)
// ==========================================
function getSafePageText(rootElement = document.body) {
    if (!rootElement) return "";

    const dangerousTags = ['SCRIPT', 'STYLE', 'NOSCRIPT', 'INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'IFRAME'];
    const dangerousClasses = ['password', 'pwd', 'secret', 'auth', 'hidden', 'credit-card', 'ssn'];
    
    let extractedText = [];
    
    const walker = document.createTreeWalker(
        rootElement,
        NodeFilter.SHOW_TEXT,
        {
            acceptNode: function(node) {
                let parent = node.parentElement;
                if (!parent) return NodeFilter.FILTER_REJECT;

                if (dangerousTags.includes(parent.tagName)) return NodeFilter.FILTER_REJECT;

                let curr = parent;
                while(curr && curr !== rootElement) {
                    let className = (curr.className && typeof curr.className === 'string') ? curr.className.toLowerCase() : '';
                    if (dangerousClasses.some(cls => className.includes(cls))) {
                        return NodeFilter.FILTER_REJECT;
                    }
                    if (curr.getAttribute('type') === 'password' || curr.getAttribute('type') === 'hidden') {
                        return NodeFilter.FILTER_REJECT;
                    }
                    const style = window.getComputedStyle(curr);
                    if (style.display === 'none' || style.opacity === '0' || style.visibility === 'hidden') {
                        return NodeFilter.FILTER_REJECT;
                    }
                    curr = curr.parentElement;
                }
                return NodeFilter.FILTER_ACCEPT;
            }
        }
    );

    let currentNode;
    while (currentNode = walker.nextNode()) {
        let text = currentNode.nodeValue.trim();
        if (text.length > 0) {
            extractedText.push(text);
        }
    }
    
    return extractedText.join(' ');
}

// 🛑 【終極修復】：將開發環境加入絕對不掃描的名單 (防止自己掃自己的無限迴圈)
function isDevEnvironment() {
    try {
        const devDomains = ['github.com', 'localhost', '127.0.0.1', 'render.com'];
        return devDomains.some(domain => window.location.hostname.includes(domain));
    } catch(e) { return false; }
}

// ==========================================
// 🌐 網站信譽與分類系統 (可動態更新)
// ==========================================
const DEFAULT_REPUTATION = {
    category: "general",
    reputation: 50,
    riskThreshold: 80,
    scanMode: "full"        
};

const BUILTIN_SITE_DATA = {
    "youtube.com": { category: "video", reputation: 100, riskThreshold: 120, scanMode: "ugc" },
    "youtu.be": { category: "video", reputation: 100, riskThreshold: 120, scanMode: "ugc" },
    "google.com": { category: "search", reputation: 100, riskThreshold: 120, scanMode: "ugc" },
    "facebook.com": { category: "social", reputation: 95, riskThreshold: 110, scanMode: "ugc" },
    "twitter.com": { category: "social", reputation: 95, riskThreshold: 110, scanMode: "ugc" },
    "x.com": { category: "social", reputation: 95, riskThreshold: 110, scanMode: "ugc" },
    "instagram.com": { category: "social", reputation: 95, riskThreshold: 110, scanMode: "ugc" },
    "wikipedia.org": { category: "reference", reputation: 100, riskThreshold: 120, scanMode: "ugc" },
    "github.com": { category: "development", reputation: 100, riskThreshold: 120, scanMode: "ugc" },
    "chatgpt.com": { category: "ai", reputation: 100, riskThreshold: 120, scanMode: "ugc" },
    "openai.com": { category: "ai", reputation: 100, riskThreshold: 120, scanMode: "ugc" },
    "pchome.com.tw": { category: "ecommerce", reputation: 80, riskThreshold: 90, scanMode: "full" },
    "cnyes.com": { category: "news", reputation: 80, riskThreshold: 90, scanMode: "full" },
    "msn.com": { category: "portal", reputation: 85, riskThreshold: 95, scanMode: "full" },
    "yahoo.com": { category: "portal", reputation: 85, riskThreshold: 95, scanMode: "full" }
};

async function getSiteReputation() {
    const host = window.location.hostname;
    try {
        const storage = await chrome.storage.local.get(['siteReputation']);
        const custom = storage.siteReputation?.[host];
        if (custom) return { ...DEFAULT_REPUTATION, ...custom };
    } catch (e) {}
    
    for (let [domain, data] of Object.entries(BUILTIN_SITE_DATA)) {
        if (host.includes(domain)) {
            return { ...DEFAULT_REPUTATION, ...data };
        }
    }
    return DEFAULT_REPUTATION;
}

// ==========================================
// 🔍 區域限定掃描 
// ==========================================
function getScannableText() {
    const host = window.location.hostname;
    if (host.includes('youtube.com') || host.includes('youtu.be')) {
        let texts = [];
        const desc = document.querySelector('#description-inline-expander, #description, ytd-text-inline-expander');
        if (desc) texts.push(getSafePageText(desc));
        const comments = document.querySelectorAll('#comments #content-text, ytd-comment-renderer #content-text');
        comments.forEach(c => texts.push(getSafePageText(c)));
        return texts.join('\n');
    }
    if (host.includes('facebook.com')) {
        let texts = [];
        const posts = document.querySelectorAll('[data-ad-comet-preview="message"], div[data-testid="post_message"]');
        posts.forEach(p => texts.push(getSafePageText(p)));
        const comments = document.querySelectorAll('[data-ad-comet-preview="comment"], div[data-testid="UFI2Comment/body"]');
        comments.forEach(c => texts.push(getSafePageText(c)));
        return texts.join('\n');
    }
    return getSafePageText(document.body);
}

// ==========================================
// 🧠 上下文權重調整與信任護城河
// ==========================================
const scamDictionary = [
    { word: "保證獲利", baseScore: 80, contextModifiers: { social: 0.2, video: 0.2, general: 1.0 } },
    { word: "穩賺不賠", baseScore: 80, contextModifiers: { social: 0.2, video: 0.2, general: 1.0 } },
    { word: "解凍金", baseScore: 100, contextModifiers: { social: 0.5, video: 0.5, general: 1.0 } },
    { word: "殺豬盤", baseScore: 100, contextModifiers: { social: 0.8, video: 0.8, general: 1.0 } },
    { word: "不准報警", baseScore: 100, contextModifiers: { social: 0.5, video: 0.5, general: 1.0 } },
    { word: "斷手斷腳", baseScore: 100, contextModifiers: { social: 0.5, video: 0.5, general: 1.0 } },
    { word: "無風險投資", baseScore: 60, contextModifiers: { social: 0.3, video: 0.3, general: 1.0 } },
    { word: "飆股", baseScore: 50, contextModifiers: { social: 0.4, video: 0.4, general: 1.0 } },
    { word: "破解程式", baseScore: 50, contextModifiers: { social: 0.4, video: 0.4, general: 1.0 } },
    { word: "內部消息", baseScore: 50, contextModifiers: { social: 0.4, video: 0.4, general: 1.0 } },
    { word: "加賴領取", baseScore: 40, contextModifiers: { social: 0.6, video: 0.6, general: 1.0 } },
    { word: "加line", baseScore: 30, contextModifiers: { social: 0.5, video: 0.5, general: 1.0 } },
    { word: "保證金", baseScore: 30, contextModifiers: { social: 0.7, video: 0.7, general: 1.0 } },
    { word: "中獎", baseScore: 20, contextModifiers: { social: 0.2, video: 0.2, general: 1.0 } },
    { word: "名額有限", baseScore: 10, contextModifiers: { social: 0.3, video: 0.3, general: 1.0 } },
    { word: "免費註冊", baseScore: 10, contextModifiers: { social: 0.3, video: 0.3, general: 1.0 } }
];

const trustDictionary = [
    { word: "統一編號", score: -30 }, 
    { word: "退換貨政策", score: -30 },
    { word: "隱私權聲明", score: -20 },
    { word: "實體門市", score: -20 }
];

function maskSensitiveData(text) {
    if (!text) return "";
    return text
        .replace(/(?:\d{4}[-\s]?){3}\d{4}/g, "[信用卡號已隱藏]")
        .replace(/[A-Z][12]\d{8}/i, "[身分證已隱藏]")
        .replace(/09\d{2}[-\s]?\d{3}[-\s]?\d{3}/g, "[手機號碼已隱藏]")
        .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[Email已隱藏]");
}

// ==========================================
// 🛡️ 核心掃描函數 (非同步)
// ==========================================
let hasTriggeredBlock = false;

async function scanScamWords() {
    if (hasTriggeredBlock) return;
    if (sessionStorage.getItem('temp_whitelist_' + window.location.href)) return;
    
    const isSystemPage = window.location.protocol === 'chrome-extension:' ||
                         window.location.href.includes('dashboard.html') ||
                         window.location.href.includes('blocked.html') ||
                         window.location.href.includes('simulator.html');
                         
    // 💡 遇到系統或開發環境，完全放棄掃描，避免產生多餘紀錄
    if (isSystemPage || isDevEnvironment()) return;
    
    const siteInfo = await getSiteReputation();
    const { category, reputation, riskThreshold, scanMode } = siteInfo;
    
    if (reputation >= 100) {
        observeElements();
        return;
    }
    
    let textContent = '';
    if (scanMode === 'ugc') {
        textContent = getScannableText();
    } else {
        textContent = getSafePageText(document.body);
    }
    
    if (!textContent || textContent.trim().length < 50) {
        observeElements();
        return;
    }
    
    const textHash = hashString(textContent);
    if (scannedCache.has(textHash)) {
        observeElements();
        return;
    }
    scannedCache.add(textHash);
    if (scannedCache.size > 50) {
        const it = scannedCache.values();
        for (let i = 0; i < 25; i++) scannedCache.delete(it.next().value);
    }
    
    const smartText = extractHighRiskText(textContent);
    const safeText = maskSensitiveData(smartText);
    
    let totalRiskScore = 0;
    let matchedKeywords = [];
    let trustedFootprints = [];
    
    for (let item of scamDictionary) {
        if (safeText.includes(item.word)) {
            let modifier = item.contextModifiers?.[category] ?? 1.0;
            if (reputation > 70 && category !== 'general') {
                modifier *= 0.6;
            }
            let finalScore = Math.floor(item.baseScore * modifier);
            totalRiskScore += finalScore;
            matchedKeywords.push(`${item.word}(+${finalScore})`);
        }
    }

    for (let item of trustDictionary) {
        if (safeText.includes(item.word)) {
            totalRiskScore += item.score; 
            trustedFootprints.push(`[信任]${item.word}(${item.score})`);
        }
    }
    
    totalRiskScore = Math.min(100, Math.max(0, totalRiskScore));
    currentGlobalRiskScore = totalRiskScore; 
    
    if (totalRiskScore >= riskThreshold) {
        let blockReason = `偵測到多重風險特徵 (危險指數 ${totalRiskScore} 分，門檻 ${riskThreshold})：${matchedKeywords.join('、')}`;
        if (trustedFootprints.length > 0) blockReason += `\n(已扣除信任特徵：${trustedFootprints.join('、')})`;
        
        triggerSafeBlock(blockReason, { riskScore: totalRiskScore, reason: blockReason, advice: "請勿輸入個人資料", scamDNA: matchedKeywords });
        return;
    }
    
    // 💡 已徹底拔除中度風險的右下角浮動警告 (showMidRiskWarning)，讓畫面保持乾淨！
    
    observeElements();
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
                        const text = getSafePageText(node) || '';
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

const linkObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            const link = entry.target;
            try {
                const linkUrl = new URL(link.href);
                if (badDomains.some(domain => linkUrl.hostname.includes(domain))) {
                    link.style.cssText = 'color: #ff0000 !important; font-weight: bold; text-decoration: underline wavy red; background-color: #ffe6e6;';
                    triggerSafeBlock("發現釣魚連結：" + linkUrl.hostname);
                }
            } catch (e) {}
            linkObserver.unobserve(link);
        }
    });
});

const imageObserver = new IntersectionObserver(async (entries) => {
    const siteInfo = await getSiteReputation();
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            const img = entry.target;
            if (siteInfo.reputation < 80 && currentGlobalRiskScore > 20 && img.src && !img.src.startsWith('data:') && img.width > 50 && img.height > 50) {
                try {
                    chrome.runtime.sendMessage({ action: "scanImageInBackground", imageUrl: img.src, pageUrl: window.location.href });
                } catch (error) {
                    // 💡 靜音處理：不印出警告黃字，保持主控台乾淨！
                }
            }
            imageObserver.unobserve(img);
        }
    });
});

function observeElements() {
    document.querySelectorAll('a:not([data-scanned="true"])').forEach(link => {
        link.dataset.scanned = "true";
        linkObserver.observe(link);
    });
    document.querySelectorAll('img:not([data-scanned="true"])').forEach(img => {
        img.dataset.scanned = "true";
        imageObserver.observe(img);
    });
}

// ==========================================
// 🚨 模組 3：觸發蒐證攔截視窗 
// ==========================================
async function triggerSafeBlock(reason, reportData = null) {
    if (hasTriggeredBlock) return;
    if (sessionStorage.getItem('temp_whitelist_' + window.location.href)) return;
    if (isDevEnvironment()) return; // 開發環境完全不介入

    hasTriggeredBlock = true;
    console.log("🛡️ AI 防詐盾牌：發現威脅，定住畫面並按下快門...", reason);

    // 🛑 【教育防彈背心】：維基百科等教育類網站，傳戰情室但不跳轉！
    const isEduSite = ['wikipedia.org'].some(domain => window.location.hostname.includes(domain));

    if (!isEduSite && document.body) {
        document.body.style.pointerEvents = 'none';
        document.body.style.userSelect = 'none';
        document.body.style.border = '5px solid rgba(255, 77, 79, 0.5)';
    }

    try {
        const timestamp = new Date().toISOString(); 
        let familyID = 'none';
        try {
            const storage = await chrome.storage.local.get(['familyID']);
            if (storage.familyID) familyID = storage.familyID;
        } catch (e) {}
        
        // 📸 拍照並上傳 (無條件執行，確保戰情室有資料！)
        const sendPromise = chrome.runtime.sendMessage({ 
            action: "captureScamTabWithEvidence", 
            url: window.location.href, 
            reason: reason, 
            timestamp: timestamp, 
            familyID: familyID 
        });

        const timeoutPromise = new Promise(resolve => setTimeout(resolve, 2000));
        await Promise.race([sendPromise, timeoutPromise]);

    } catch (error) {
        console.error("❌ 自動蒐證快門失敗:", error);
    }

    if (isEduSite) {
        console.log("🛠️ 觸發教育防彈背心：已將警報送至戰情室，但不強制跳轉畫面。");
        return; 
    }

    document.documentElement.innerHTML = `
        <div style="position:fixed; top:0; left:0; width:100vw; height:100vh; background:#141e30; color:white; display:flex; align-items:center; justify-content:center; z-index:2147483647; font-family:sans-serif;">
            <div style="font-size:24px; font-weight:bold; color:#ff4d4f;">🚨 證據保全完畢，系統攔截中...</div>
        </div>
    `;

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

// ==========================================
// ⏱️ 模組 4：資源管理與排程
// ==========================================
let scanCount = 0;
let lastActivityTime = Date.now();

document.addEventListener('mousemove', () => { lastActivityTime = Date.now(); }, { passive: true });
document.addEventListener('keydown', () => { lastActivityTime = Date.now(); }, { passive: true });

function scheduleIdleScan() {
    if (isDevEnvironment()) return; // 💡 開發環境排程中止
    if (Date.now() - lastActivityTime > 300000) {
        setTimeout(scheduleIdleScan, 5000);
        return;
    }
    
    if (scanCount >= 10) {
        setTimeout(() => { scanCount = 0; scheduleIdleScan(); }, 60000);
        return;
    }
    scanCount++;

    if (window.requestIdleCallback) {
        requestIdleCallback(() => { 
            scanScamWords(); 
            setTimeout(scheduleIdleScan, 1500); 
        }, { timeout: 2000 });
    } else {
        setTimeout(() => { 
            scanScamWords(); 
            scheduleIdleScan(); 
        }, 1500);
    }
}

// ==========================================
// 🛡️ 升級功能 1：動態 DOM 變化監測
// ==========================================
let lastDynamicScanTime = Date.now();
const dynamicObserver = new MutationObserver((mutations) => {
    if (isDevEnvironment()) return;
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
// 🛡️ 啟動邏輯
// ==========================================
if (window.self === window.top) {
    const isSystemPage = window.location.protocol === 'chrome-extension:' ||
                         window.location.href.includes('dashboard.html') ||
                         window.location.href.includes('blocked.html') ||
                         window.location.href.includes('simulator.html'); 
                         
    if (!isSystemPage && !isDevEnvironment()) {
        new BehaviorAnalyzer(); 
        if (document.body) dynamicObserver.observe(document.body, { childList: true, subtree: true });
        scheduleIdleScan();
        console.log("🛡️ AI 防詐盾牌：無塵室安全萃取與動態防護系統已上線");
    } else {
        console.log("🛡️ AI 防詐盾牌：已偵測到系統或開發頁面，關閉自動掃描");
    }
}