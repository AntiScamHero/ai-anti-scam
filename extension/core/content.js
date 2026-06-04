/**
 * AI 防詐盾牌 - Content Script（效能 / 誤判 / 審核風險優化版）
 *
 * 重點：
 * 1. 保留全網文字、連結、圖片、本地規則與自動攔截功能
 * 2. MutationObserver 改成累積變動量 + debounce，降低動態網站負擔
 * 3. 高信譽網站改掃 UGC / 外連附近文字，不整站放行
 * 4. 前端個資遮蔽補強：全形、零寬字元、混淆手機 / 身分證 / 信用卡 / Email
 * 5. inject_fake_data 改成必須由 CONFIG.ENABLE_FAKE_DATA_INJECTION=true 才可使用
 * 6. 攔截時保留證據摘要，正式版預設不保存完整截圖
 * 7. 🌟 新增 AI 平台防護機制：針對 DeepSeek/ChatGPT 降權討論型關鍵字、排除 Sidebar、無動作時封頂分數
 * 8. 決賽封版：反催促機制凍結可疑倒數，降低長輩受時間壓力誤導
 * 9. 決賽封版：安心閱讀模式，一鍵放大文字並淡化廣告/彈窗/iframe
 */

(() => {
    if (window.__AI_SHIELD_CONTENT_SCRIPT_LOADED__) {
        return;
    }

    window.__AI_SHIELD_CONTENT_SCRIPT_LOADED__ = true;

    // ------------------------------------------------------------
    // 競賽展示 / Extension 內部頁白名單：最前置判斷
    // 避免 demo_console.html / App Demo 內含詐騙測試文字而被自己的 Content Script 誤攔。
    // ------------------------------------------------------------
    const AI_SHIELD_INTERNAL_PAGE_KEYWORDS_PRECHECK = [
        "demo_console.html",
        "ai防詐盾牌_appdemo.html",
        "AI防詐盾牌_AppDemo.html",
        "validation_report.html",
        "dashboard.html",
        "blocked.html",
        "simulator.html",
        "welcome.html",
        "popup.html",
        "mobile_demo.html",
        "help.html",
        "test.html"
    ];

    function aiShieldSafeDecodePrecheck(value) {
        try {
            return decodeURIComponent(String(value || ""));
        } catch (e) {
            return String(value || "");
        }
    }

    function aiShieldIsInternalPagePrecheck() {
        const href = String(window.location.href || "");
        const path = String(window.location.pathname || "");
        const decodedHref = aiShieldSafeDecodePrecheck(href);
        const decodedPath = aiShieldSafeDecodePrecheck(path);

        const protocol = String(window.location.protocol || "").toLowerCase();
        if (protocol === "chrome-extension:" || protocol.startsWith("chrome-extension:")) {
            return true;
        }

        const haystacks = [
            href.toLowerCase(),
            path.toLowerCase(),
            decodedHref.toLowerCase(),
            decodedPath.toLowerCase()
        ];

        return AI_SHIELD_INTERNAL_PAGE_KEYWORDS_PRECHECK.some(keyword => {
            const key = String(keyword || "").toLowerCase();
            return haystacks.some(text => text.includes(key));
        });
    }

    if (aiShieldIsInternalPagePrecheck()) {
        window.__AI_SHIELD_SKIP_SCAN__ = true;
        console.log("🛡️ AI 防詐盾牌：內部展示頁已加入白名單，跳過自動掃描。");
        return;
    }


    // ------------------------------------------------------------
    // 可信網域與特殊頁面判斷
    // ------------------------------------------------------------
    function normalizeDomainHost(host) {
        return String(host || "").replace(/^www\./, "").toLowerCase();
    }

    const AI_SHIELD_INTERNAL_PAGE_KEYWORDS = [
        "mobile_demo.html",
        "ai防詐盾牌_appdemo.html",
        "AI防詐盾牌_AppDemo.html",
        "demo_console.html",
        "validation_report.html",
        "dashboard.html",
        "blocked.html",
        "simulator.html",
        "welcome.html",
        "popup.html",
        "help.html",
        "test.html"
    ];

    function safeDecodeUrlText(value) {
        try {
            return decodeURIComponent(String(value || ""));
        } catch (e) {
            return String(value || "");
        }
    }

    function isAiShieldInternalDemoPage(urlString = window.location.href) {
        const href = String(urlString || "");
        const decodedHref = safeDecodeUrlText(href);
        const pathname = String(window.location.pathname || "");
        const decodedPathname = safeDecodeUrlText(pathname);

        const haystacks = [
            href.toLowerCase(),
            decodedHref.toLowerCase(),
            pathname.toLowerCase(),
            decodedPathname.toLowerCase()
        ];

        return AI_SHIELD_INTERNAL_PAGE_KEYWORDS.some(keyword => {
            const key = String(keyword || "").toLowerCase();
            return haystacks.some(text => text.includes(key));
        });
    }


    function isGoogleDomain(host) {
        const cleanHost = normalizeDomainHost(host);
        return cleanHost === "google.com" || /^google\.[a-z.]+$/i.test(cleanHost);
    }

    function isBingDomain(host) {
        const cleanHost = normalizeDomainHost(host);
        return cleanHost === "bing.com" || cleanHost.endsWith(".bing.com");
    }

    function isYahooDomain(host) {
        const cleanHost = normalizeDomainHost(host);
        return cleanHost === "yahoo.com" || cleanHost.endsWith(".yahoo.com") || cleanHost.endsWith(".yahoo.com.tw");
    }

    function isTrustedSearchResultUrl(urlString = window.location.href) {
        try {
            const url = new URL(String(urlString || window.location.href));
            const host = normalizeDomainHost(url.hostname);
            const path = url.pathname.toLowerCase();

            return (
                isGoogleDomain(host) && path === "/search"
            ) || (
                isBingDomain(host) && path === "/search"
            ) || (
                isYahooDomain(host) && path.includes("search")
            );
        } catch (e) {
            return false;
        }
    }

    function shouldSkipAiShieldAutoScanPage() {
        try {
            const href = String(window.location.href || "").toLowerCase();
            const pathname = String(window.location.pathname || "").toLowerCase();

            if (window.__AI_SHIELD_SKIP_SCAN__ === true) return true;

            const meta = document.querySelector('meta[name="ai-shield-skip-scan"]');
            if (meta && String(meta.content || "").toLowerCase() === "true") return true;

            if (document.body && document.body.dataset && document.body.dataset.aiShieldSkipScan === "true") return true;

            if (isTrustedSearchResultUrl(window.location.href)) return true;

            if (isAiShieldInternalDemoPage(window.location.href)) return true;

            if (href.includes("demo_console.html") || pathname.endsWith("/demo_console.html")) return true;
            if (href.includes("ai防詐盾牌_appdemo.html") || href.includes("ai%E9%98%B2") || pathname.toLowerCase().includes("appdemo.html")) return true;
            if (href.includes("validation_report.html") || pathname.endsWith("/validation_report.html")) return true;
            if (href.includes("test.html") || pathname.endsWith("/test.html")) return true;
            if (href.includes("mobile_demo.html") || pathname.endsWith("/mobile_demo.html")) return true;
            if (href.includes("blocked.html") || pathname.endsWith("/blocked.html")) return true;
            if (href.includes("simulator.html") || pathname.endsWith("/simulator.html")) return true;
            if (href.includes("dashboard.html") || pathname.endsWith("/dashboard.html")) return true;
            if (href.includes("welcome.html") || pathname.endsWith("/welcome.html")) return true;
            if (href.includes("popup.html") || pathname.endsWith("/popup.html")) return true;

            return false;
        } catch (e) {
            return false;
        }
    }

    if (shouldSkipAiShieldAutoScanPage()) {
        console.log("🛡️ AI 防詐盾牌：此頁為內部頁或可信搜尋結果頁，跳過自動掃描。");
        return;
    }

    const scannedCache = new Set();
    const observedLinks = new WeakSet();
    const observedImages = new WeakSet();

    let currentGlobalRiskScore = 0;
    let hasTriggeredBlock = false;
    let scanCount = 0;
    let lastActivityTime = Date.now();
    let isScanning = false;
    let dynamicObserver = null;
    let behaviorAnalyzer = null;
    let idleScanTimer = null;
    let mutationScanTimer = null;
    let pendingMutationScore = 0;
    let linkObserver = null;
    let imageObserver = null;
    let timePressureDefusalTimer = null;
    let timePressureDefusedCount = 0;
    let zenReadingModeActive = false;
    let zenReadingHiddenElements = [];
    let zenReadingStyleElement = null;

    const USER_WHITELIST_KEY = "userWhitelistDomains";
    const TEMP_WHITELIST_KEY = "temporaryWhitelistDomains";
    const USER_REPORTED_DOMAINS_KEY = "aiShieldUserReportedDomains";

    const DEFAULT_TRUSTED_DOMAINS = Array.isArray(window.CONFIG?.TRUSTED_DOMAINS)
        ? window.CONFIG.TRUSTED_DOMAINS
        : ["wikipedia.org", "ccsh.tn.edu.tw", "gov.tw", "fsc.gov.tw", "moneywise.fsc.gov.tw", "165.npa.gov.tw", "npa.gov.tw", "mohw.gov.tw", "nhia.gov.tw", "edu.tw"];

    const DEFAULT_REPUTATION = {
        category: "general",
        reputation: 50,
        riskThreshold: 80,
        scanMode: "full"
    };

    const BUILTIN_SITE_DATA = window.CONFIG?.SITE_REPUTATION || {
        "youtube.com": { category: "video", reputation: 100, riskThreshold: 120, scanMode: "ugc" },
        "youtu.be": { category: "video", reputation: 100, riskThreshold: 120, scanMode: "ugc" },
        "google.com": { category: "search", reputation: 100, riskThreshold: 120, scanMode: "ugc" },
        "facebook.com": { category: "social", reputation: 95, riskThreshold: 110, scanMode: "ugc" },
        "chatgpt.com": { category: "ai", reputation: 100, riskThreshold: 120, scanMode: "ugc" },
        "openai.com": { category: "ai", reputation: 100, riskThreshold: 120, scanMode: "ugc" },
        "deepseek.com": { category: "ai", reputation: 100, riskThreshold: 120, scanMode: "ugc" }
    };

    const SCAM_RULES = [
        { word: "包裹配送失敗", baseScore: 70, contextModifiers: { social: 0.9, video: 0.9, search: 0.9, ai: 0.6, general: 1.0 } },
        { word: "補繳運費", baseScore: 75, contextModifiers: { social: 0.9, video: 0.9, search: 0.9, ai: 0.6, general: 1.0 } },
        { word: "付款驗證", baseScore: 68, contextModifiers: { social: 0.9, video: 0.9, search: 0.9, ai: 0.6, general: 1.0 } },
        { word: "信用卡卡號", baseScore: 80, contextModifiers: { social: 0.95, video: 0.95, search: 0.95, ai: 0.75, general: 1.0 } },
        { word: "CVV", baseScore: 80, contextModifiers: { social: 0.95, video: 0.95, search: 0.95, ai: 0.75, general: 1.0 } },
        { word: "安全碼", baseScore: 72, contextModifiers: { social: 0.95, video: 0.95, search: 0.95, ai: 0.75, general: 1.0 } },
        { word: "簡訊驗證碼", baseScore: 78, contextModifiers: { social: 0.95, video: 0.95, search: 0.95, ai: 0.75, general: 1.0 } },
        { word: "OTP", baseScore: 78, contextModifiers: { social: 0.95, video: 0.95, search: 0.95, ai: 0.75, general: 1.0 } },
        { word: "保證獲利", baseScore: 80, contextModifiers: { social: 0.25, video: 0.25, search: 0.35, ai: 0.1, general: 1.0 } },
        { word: "穩賺不賠", baseScore: 80, contextModifiers: { social: 0.25, video: 0.25, search: 0.35, ai: 0.1, general: 1.0 } },
        { word: "無風險投資", baseScore: 65, contextModifiers: { social: 0.35, video: 0.35, search: 0.45, ai: 0.1, general: 1.0 } },
        { word: "保本保息", baseScore: 70, contextModifiers: { social: 0.35, video: 0.35, search: 0.45, ai: 0.1, general: 1.0 } },
        { word: "飆股", baseScore: 22, contextModifiers: { social: 0.35, video: 0.35, search: 0.2, ai: 0.1, general: 0.55 } },
        { word: "內部消息", baseScore: 45, contextModifiers: { social: 0.4, video: 0.4, search: 0.25, ai: 0.1, general: 0.8 } },
        { word: "內線消息", baseScore: 45, contextModifiers: { social: 0.4, video: 0.4, search: 0.25, ai: 0.1, general: 0.8 } },
        { word: "老師帶單", baseScore: 70, contextModifiers: { social: 0.55, video: 0.55, search: 0.55, ai: 0.1, general: 1.0 } },
        { word: "解凍金", baseScore: 100, contextModifiers: { social: 0.65, video: 0.65, search: 0.7, ai: 0.8, general: 1.0 } },
        { word: "殺豬盤", baseScore: 100, contextModifiers: { social: 0.9, video: 0.9, search: 0.9, ai: 0.1, general: 1.0 } },
        { word: "不准報警", baseScore: 100, contextModifiers: { social: 0.75, video: 0.75, search: 0.8, ai: 0.8, general: 1.0 } },
        { word: "斷手斷腳", baseScore: 100, contextModifiers: { social: 0.75, video: 0.75, search: 0.8, ai: 0.8, general: 1.0 } },
        { word: "偵查不公開", baseScore: 95, contextModifiers: { social: 0.8, video: 0.8, search: 0.8, ai: 0.8, general: 1.0 } },
        { word: "監管帳戶", baseScore: 95, contextModifiers: { social: 0.8, video: 0.8, search: 0.8, ai: 0.8, general: 1.0 } },
        { word: "法院公證人", baseScore: 95, contextModifiers: { social: 0.8, video: 0.8, search: 0.8, ai: 0.8, general: 1.0 } },
        { word: "解除分期", baseScore: 90, contextModifiers: { social: 0.8, video: 0.8, search: 0.8, ai: 0.8, general: 1.0 } },
        { word: "取消分期", baseScore: 85, contextModifiers: { social: 0.8, video: 0.8, search: 0.8, ai: 0.8, general: 1.0 } },
        { word: "提款卡密碼", baseScore: 95, contextModifiers: { social: 0.9, video: 0.9, search: 0.9, ai: 0.9, general: 1.0 } },
        { word: "驗證碼", baseScore: 55, contextModifiers: { social: 0.5, video: 0.5, search: 0.55, ai: 0.3, general: 1.0 } },
        { word: "加賴領取", baseScore: 55, contextModifiers: { social: 0.7, video: 0.7, search: 0.75, ai: 0.8, general: 1.0 } },
        { word: "加line", baseScore: 40, contextModifiers: { social: 0.55, video: 0.55, search: 0.65, ai: 0.3, general: 1.0 } },
        { word: "加 line", baseScore: 40, contextModifiers: { social: 0.55, video: 0.55, search: 0.65, ai: 0.3, general: 1.0 } },
        { word: "保證金", baseScore: 45, contextModifiers: { social: 0.75, video: 0.75, search: 0.8, ai: 0.5, general: 1.0 } },
        { word: "通關費", baseScore: 70, contextModifiers: { social: 0.8, video: 0.8, search: 0.8, ai: 0.8, general: 1.0 } },
        { word: "中獎", baseScore: 25, contextModifiers: { social: 0.3, video: 0.3, search: 0.35, ai: 0.1, general: 1.0 } },
        { word: "限時領取", baseScore: 45, contextModifiers: { social: 0.5, video: 0.5, search: 0.55, ai: 0.4, general: 1.0 } },
        { word: "名額有限", baseScore: 18, contextModifiers: { social: 0.35, video: 0.35, search: 0.45, ai: 0.2, general: 1.0 } },
        { word: "下載apk", baseScore: 80, contextModifiers: { social: 0.85, video: 0.85, search: 0.85, ai: 0.9, general: 1.0 } },
        { word: "掃qr", baseScore: 50, contextModifiers: { social: 0.65, video: 0.65, search: 0.7, ai: 0.1, general: 1.0 } }
    ];

    const TRUST_RULES = [
        { word: "統一編號", score: -30 },
        { word: "退換貨政策", score: -30 },
        { word: "隱私權聲明", score: -20 },
        { word: "實體門市", score: -20 },
        { word: "客服專線", score: -10 }
    ];

    const BAD_DOMAINS = [
        "testsafebrowsing.appspot.com",
        "fake-scam-delivery.com",
        "win-free-iphone-now.net",
        "lucky-verify-login.net"
    ];

    function getConfigValue(key, fallback) {
        try {
            if (window.CONFIG && window.CONFIG[key] !== undefined) {
                return window.CONFIG[key];
            }
        } catch (e) {}

        return fallback;
    }

    function toHalfWidth(text) {
        return String(text || "").replace(/[！-～]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
    }

    function normalizeText(text) {
        return toHalfWidth(String(text || ""))
            .replace(/[\u200B-\u200D\uFEFF]/g, "")
            .replace(/\s+/g, " ")
            .trim();
    }

    function toAbsoluteHttpUrl(rawUrl) {
        if (!rawUrl) return "";
        const trimmed = String(rawUrl).trim();
        if (/^https?:\/\//i.test(trimmed)) return trimmed;
        if (/^(chrome|chrome-extension|edge|about|file):/i.test(trimmed)) return trimmed;
        return "https://" + trimmed.replace(/^\/+/, "");
    }

    function normalizeHost(rawUrl) {
        try {
            const host = new URL(toAbsoluteHttpUrl(rawUrl)).hostname.toLowerCase();
            return host.replace(/^www\./, "");
        } catch (e) {
            return "";
        }
    }

    function domainMatchesHost(host, domain) {
        if (!host || !domain) return false;
        const cleanDomain = String(domain).toLowerCase().replace(/^www\./, "");
        return host === cleanDomain || host.endsWith("." + cleanDomain);
    }

    function isDevEnvironment() {
        // 主動防護必須能在本機測試頁與 Render 展示頁運作。
        // 內部頁白名單已由 isSystemPage / isAiShieldInternalDemoPage 處理，
        // 因此這裡不再因 localhost、127.0.0.1 或 render.com 關閉掃描。
        return false;
    }

    function isSystemPage() {
        const href = window.location.href;
        return window.location.protocol === "chrome-extension:" ||
            isAiShieldInternalDemoPage(href) ||
            href.includes("dashboard.html") ||
            href.includes("blocked.html") ||
            href.includes("simulator.html") ||
            href.includes("popup.html") ||
            href.includes("welcome.html");
    }

    function isLegacySessionWhitelist() {
        try {
            return Boolean(sessionStorage.getItem("temp_whitelist_" + window.location.href));
        } catch (e) {
            return false;
        }
    }

    async function getStorage(keys) {
        try {
            if (typeof chrome !== "undefined" && chrome.storage?.local) {
                return await chrome.storage.local.get(keys);
            }
        } catch (e) {}

        return {};
    }

    async function isCurrentUrlTrustedOrWhitelisted() {
        const host = normalizeHost(window.location.href);
        if (!host) return false;

        if (isTrustedSearchResultUrl(window.location.href)) {
            return true;
        }

        if (DEFAULT_TRUSTED_DOMAINS.some(domain => domainMatchesHost(host, domain))) {
            return true;
        }

        try {
            const storage = await getStorage([USER_WHITELIST_KEY, TEMP_WHITELIST_KEY]);
            const userWhitelist = Array.isArray(storage[USER_WHITELIST_KEY]) ? storage[USER_WHITELIST_KEY] : [];

            if (userWhitelist.some(domain => domainMatchesHost(host, domain))) {
                return true;
            }

            const temporaryWhitelist = storage[TEMP_WHITELIST_KEY] || {};
            const now = Date.now();
            let changed = false;

            for (const [domain, expiresAt] of Object.entries(temporaryWhitelist)) {
                const expires = Number(expiresAt);
                if (expires <= now) {
                    delete temporaryWhitelist[domain];
                    changed = true;
                    continue;
                }

                if (domainMatchesHost(host, domain)) {
                    return true;
                }
            }

            if (changed && chrome.storage?.local) {
                await chrome.storage.local.set({ [TEMP_WHITELIST_KEY]: temporaryWhitelist });
            }
        } catch (e) {}

        return isLegacySessionWhitelist();
    }


    function normalizeReportedDomainItem(item) {
        if (typeof item === "string") {
            return {
                domain: normalizeDomainHost(item),
                reason: "家人曾回報此網站可疑。",
                reportedAt: "",
                confirmedAt: "",
                status: "watchlist",
                source: "legacy_string"
            };
        }

        const domain = normalizeDomainHost(item?.domain || normalizeHost(item?.url || ""));
        const status = String(item?.status || item?.reviewStatus || "").toLowerCase();

        return {
            domain,
            reason: item?.reason || (status === "confirmed_high_risk" ? "家人已確認此網站為高風險。" : "家人曾回報此網站可疑。"),
            reportedAt: item?.reportedAt || "",
            confirmedAt: item?.confirmedAt || "",
            status: status || "watchlist",
            source: item?.source || "user_reported_domain"
        };
    }

    function isConfirmedHighRiskDomainHit(hit) {
        const status = String(hit?.status || "").toLowerCase();
        return status === "confirmed_high_risk" || status === "confirmed_scam";
    }

    async function getUserReportedDomainHit() {
        const host = normalizeHost(window.location.href);
        if (!host) return null;

        try {
            const storage = await getStorage([USER_REPORTED_DOMAINS_KEY, USER_WHITELIST_KEY]);
            const userWhitelist = Array.isArray(storage[USER_WHITELIST_KEY]) ? storage[USER_WHITELIST_KEY] : [];

            // 若已被家人標成誤報 / 安全名單，安全名單優先。
            if (userWhitelist.some(domain => domainMatchesHost(host, domain))) {
                return null;
            }

            const reports = Array.isArray(storage[USER_REPORTED_DOMAINS_KEY])
                ? storage[USER_REPORTED_DOMAINS_KEY]
                : [];

            for (const item of reports) {
                const normalized = normalizeReportedDomainItem(item);
                if (normalized.domain && domainMatchesHost(host, normalized.domain)) {
                    return normalized;
                }
            }
        } catch (e) {}

        return null;
    }

    function showUserReportedDomainWarning(hit) {
        if (!hit) return;

        // 狀態可能從「家人回報可疑」變成「家人確認高風險」。
        // 舊版若橘色提醒已存在會直接 return，導致確認後不會變紅。
        const oldBox = document.getElementById("ai-shield-user-reported-warning");
        if (oldBox) oldBox.remove();

        const confirmed = isConfirmedHighRiskDomainHit(hit);

        const box = document.createElement("div");
        box.id = "ai-shield-user-reported-warning";
        box.dataset.aiShieldReportedStatus = confirmed ? "confirmed_high_risk" : "watchlist";
        box.style.cssText = `
            position: fixed;
            z-index: 2147483647;
            left: 18px;
            right: 18px;
            top: 16px;
            max-width: 880px;
            margin: 0 auto;
            padding: 16px 18px;
            border-radius: 20px;
            background: ${confirmed ? "#fff1f2" : "#fff7ed"};
            color: ${confirmed ? "#991b1b" : "#7c2d12"};
            border: 3px solid ${confirmed ? "#f87171" : "#fdba74"};
            box-shadow: 0 18px 46px ${confirmed ? "rgba(153,27,27,.24)" : "rgba(124,45,18,.20)"};
            font-family: "Microsoft JhengHei", system-ui, sans-serif;
            line-height: 1.55;
        `;

        const title = document.createElement("div");
        title.textContent = confirmed
            ? "🚨 AI 防詐盾牌警示：家人已確認這個網站高風險"
            : "🚩 AI 防詐盾牌提醒：家人曾回報這個網站可疑";
        title.style.cssText = "font-size:21px;font-weight:1000;margin-bottom:8px;";

        const body = document.createElement("div");
        body.textContent = confirmed
            ? "這個網站已被家人確認為高風險。請不要輸入信用卡、驗證碼、帳號密碼或匯款資料；若你確認這是誤報，請到家庭戰情室標記為正常。"
            : "這不代表一定是詐騙，但建議先不要輸入信用卡、驗證碼、帳號密碼或匯款資料。若確認是正常網站，可到家庭戰情室標記為正常。";
        body.style.cssText = "font-size:17px;font-weight:850;margin-bottom:12px;";

        const actions = document.createElement("div");
        actions.style.cssText = "display:flex;gap:10px;flex-wrap:wrap;";

        const closeBtn = document.createElement("button");
        closeBtn.type = "button";
        closeBtn.textContent = "我知道了";
        closeBtn.style.cssText = `min-height:42px;padding:9px 17px;border:0;border-radius:999px;background:${confirmed ? "#991b1b" : "#9a3412"};color:#fff;font-size:15px;font-weight:1000;cursor:pointer;`;
        closeBtn.addEventListener("click", () => box.remove());

        actions.appendChild(closeBtn);
        box.append(title, body, actions);
        document.documentElement.appendChild(box);
    }

    async function refreshUserReportedDomainWarningForCurrentPage() {
        try {
            const hit = await getUserReportedDomainHit();
            const oldBox = document.getElementById("ai-shield-user-reported-warning");

            if (!hit) {
                if (oldBox) oldBox.remove();
                return;
            }

            showUserReportedDomainWarning(hit);
        } catch (error) {
            console.warn("AI 防詐盾牌：更新家人回報提醒失敗", error);
        }
    }

    function setupUserReportedDomainStorageListener() {
        try {
            if (typeof chrome === "undefined" || !chrome.storage?.onChanged) return;

            chrome.storage.onChanged.addListener((changes, areaName) => {
                if (areaName !== "local") return;

                if (changes[USER_REPORTED_DOMAINS_KEY] || changes[USER_WHITELIST_KEY]) {
                    refreshUserReportedDomainWarningForCurrentPage();
                }
            });
        } catch (e) {}
    }


    function hashString(str) {
        let hash = 5381;
        const value = String(str || "");
        for (let i = 0; i < value.length; i++) {
            hash = ((hash << 5) + hash) + value.charCodeAt(i);
        }
        return hash.toString(16);
    }

    function maskSensitiveData(text) {
        if (!text) return "";

        let value = normalizeText(text);
        const noise = "[\\s.\\-•*_\\|/\\\\:()\\[\\]{}]*";

        value = value.replace(new RegExp("0" + noise + "9" + noise + "(?:\\d" + noise + "){8}", "g"), "[手機號碼已隱藏]");
        value = value.replace(new RegExp("[A-Za-z]" + noise + "[12]" + noise + "(?:\\d" + noise + "){8}", "g"), "[身分證已隱藏]");
        value = value.replace(new RegExp("(?:\\d" + noise + "){12,18}\\d", "g"), "[信用卡號已隱藏]");
        value = value.replace(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, "[Email已隱藏]");
        value = value.replace(/(?:bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}/gi, "[加密貨幣地址已隱藏]");
        value = value.replace(/0x[a-fA-F0-9]{40}/g, "[加密貨幣地址已隱藏]");

        return value;
    }

    function extractHighRiskText(text, maxLength = 4000) {
        const value = normalizeText(text);
        if (!value) return "";
        if (value.length <= maxLength) return value;

        const riskKeywords = [
            "保證獲利", "穩賺不賠", "飆股", "內線", "解凍", "中獎", "驗證碼", "身分證",
            "帳號", "密碼", "提款卡", "ATM", "加LINE", "加 line", "法院", "檢察官", "USDT", "QR"
        ];

        const snippets = [];
        const usedRanges = [];

        for (const keyword of riskKeywords) {
            let idx = value.indexOf(keyword);
            while (idx !== -1 && snippets.join("\n...\n").length < maxLength) {
                const start = Math.max(0, idx - 260);
                const end = Math.min(value.length, idx + keyword.length + 260);
                const overlaps = usedRanges.some(([s, e]) => start <= e && end >= s);

                if (!overlaps) {
                    snippets.push(value.slice(start, end));
                    usedRanges.push([start, end]);
                }

                idx = value.indexOf(keyword, idx + keyword.length);
            }
        }

        if (snippets.length > 0) {
            return snippets.join("\n...\n").slice(0, maxLength);
        }

        return value.slice(0, Math.floor(maxLength * 0.55)) + "\n...\n" + value.slice(-Math.floor(maxLength * 0.45));
    }

    function getSafePageText(rootElement = document.body, maxChars = 9000) {
        if (!rootElement) return "";

        const dangerousTags = ["SCRIPT", "STYLE", "NOSCRIPT", "INPUT", "TEXTAREA", "SELECT", "OPTION", "IFRAME", "SVG", "CANVAS"];
        const dangerousClasses = ["password", "pwd", "secret", "auth", "hidden", "credit-card", "ssn", "token"];
        const extractedText = [];
        let totalLength = 0;
        let visitedNodes = 0;
        const maxNodes = 1200;

        try {
            const walker = document.createTreeWalker(
                rootElement,
                NodeFilter.SHOW_TEXT,
                {
                    acceptNode(node) {
                        visitedNodes += 1;
                        if (visitedNodes > maxNodes) return NodeFilter.FILTER_REJECT;

                        const parent = node.parentElement;
                        if (!parent) return NodeFilter.FILTER_REJECT;
                        if (dangerousTags.includes(parent.tagName)) return NodeFilter.FILTER_REJECT;

                        let curr = parent;
                        while (curr && curr !== rootElement) {
                            const className = typeof curr.className === "string" ? curr.className.toLowerCase() : "";
                            const inputType = (curr.getAttribute("type") || "").toLowerCase();

                            if (dangerousClasses.some(cls => className.includes(cls))) return NodeFilter.FILTER_REJECT;
                            if (["password", "hidden"].includes(inputType)) return NodeFilter.FILTER_REJECT;
                            if (curr.getAttribute("aria-hidden") === "true") return NodeFilter.FILTER_REJECT;

                            try {
                                const style = window.getComputedStyle(curr);
                                if (style.display === "none" || style.opacity === "0" || style.visibility === "hidden") {
                                    return NodeFilter.FILTER_REJECT;
                                }
                            } catch (e) {}

                            curr = curr.parentElement;
                        }

                        return NodeFilter.FILTER_ACCEPT;
                    }
                }
            );

            let currentNode;
            while ((currentNode = walker.nextNode())) {
                const text = normalizeText(currentNode.nodeValue);
                if (!text) continue;

                extractedText.push(text);
                totalLength += text.length;

                if (totalLength >= maxChars) break;
            }
        } catch (e) {
            return normalizeText(rootElement.innerText || rootElement.textContent || "").slice(0, maxChars);
        }

        return extractedText.join(" ").slice(0, maxChars);
    }

    async function getSiteReputation() {
        const host = normalizeHost(window.location.href) || window.location.hostname;

        if (isGoogleDomain(host) || isBingDomain(host) || isYahooDomain(host)) {
            return {
                ...DEFAULT_REPUTATION,
                category: "search",
                reputation: 100,
                riskThreshold: 120,
                scanMode: "ugc"
            };
        }

        try {
            const storage = await getStorage(["siteReputation"]);
            const custom = storage.siteReputation?.[host];
            if (custom) return { ...DEFAULT_REPUTATION, ...custom };
        } catch (e) {}

        for (const [domain, data] of Object.entries(BUILTIN_SITE_DATA)) {
            if (domainMatchesHost(host, domain)) return { ...DEFAULT_REPUTATION, ...data };
        }

        return DEFAULT_REPUTATION;
    }

    function getScannableText() {
        const host = window.location.hostname;
        const texts = [];

        if (host.includes("chatgpt.com") || host.includes("openai.com") || host.includes("deepseek.com") || host.includes("claude.ai")) {
            document.querySelectorAll("main, [role='main'], .chat-container, .markdown, article").forEach(el => {
                const text = getSafePageText(el, 3000);
                if (text) texts.push(text);
            });
            return texts.join("\n");
        }

        if (host.includes("youtube.com") || host.includes("youtu.be")) {
            document.querySelectorAll("#description-inline-expander, #description, ytd-text-inline-expander, #comments #content-text, ytd-comment-renderer #content-text").forEach(el => {
                texts.push(getSafePageText(el, 2500));
            });
            return texts.join("\n");
        }

        if (host.includes("facebook.com")) {
            document.querySelectorAll('[data-ad-comet-preview="message"], div[data-testid="post_message"], [data-ad-comet-preview="comment"], div[data-testid="UFI2Comment/body"]').forEach(el => {
                texts.push(getSafePageText(el, 3000));
            });
            return texts.join("\n");
        }

        if (isGoogleDomain(host) || isBingDomain(host) || isYahooDomain(host)) {
            document.querySelectorAll("a, cite, h3, .VwiC3b, [role='heading'], article").forEach(el => {
                const text = getSafePageText(el, 800);
                if (text) texts.push(text);
            });
            return texts.join("\n");
        }

        return getSafePageText(document.body);
    }

    function calculateLocalRisk(safeText, siteInfo) {
        const text = normalizeText(safeText);
        const textLower = text.toLowerCase();
        const category = siteInfo.category || "general";
        const reputation = Number(siteInfo.reputation || 50);

        let totalRiskScore = 0;
        const matchedKeywords = [];
        const trustedFootprints = [];

        for (const item of SCAM_RULES) {
            const keyword = item.word.toLowerCase();
            if (!textLower.includes(keyword)) continue;

            let modifier = item.contextModifiers?.[category] ?? item.contextModifiers?.general ?? 1.0;
            if (reputation > 70 && category !== "general") modifier *= 0.68;

            const finalScore = Math.max(1, Math.floor(item.baseScore * modifier));
            totalRiskScore += finalScore;
            matchedKeywords.push(`${item.word}(+${finalScore})`);
        }

        for (const item of TRUST_RULES) {
            if (text.includes(item.word)) {
                totalRiskScore += item.score;
                trustedFootprints.push(`[信任]${item.word}(${item.score})`);
            }
        }

        const comboRules = [
            [/驗證碼|otp|簡訊碼/i, /信用卡|帳號|密碼|身分證/i, 35, "驗證碼 + 個資"],
            [/包裹|海關|物流|宅配|配送失敗/i, /補繳|通關費|運費|付款|付款驗證/i, 42, "包裹 + 付款"],
            [/信用卡|卡號|cvv|安全碼/i, /驗證碼|簡訊碼|otp|付款驗證/i, 45, "信用卡 + 驗證碼"],
            [/補繳|付款|運費/i, /信用卡|cvv|安全碼|驗證碼|otp/i, 48, "補繳 + 金融資料"],
            [/中獎|獎金|禮物/i, /運費|稅金|手續費|領取/i, 32, "中獎 + 費用"],
            [/投資|股票|虛擬貨幣|usdt|btc/i, /保證|穩賺|老師|vip|群/i, 35, "投資 + 保證收益"],
            [/atm|網銀/i, /解除|取消|分期|扣款/i, 40, "ATM + 解除分期"]
        ];

        for (const [a, b, score, label] of comboRules) {
            if (a.test(textLower) && b.test(textLower)) {
                const finalComboScore = category === "ai" ? Math.floor(score * 0.5) : score;
                totalRiskScore += finalComboScore;
                matchedKeywords.push(`${label}(+${finalComboScore})`);
            }
        }

        // ✅ 核心防護：AI 平台討論內容封頂機制
        if (category === "ai") {
            const hasDangerousAction = /請.{0,8}(點擊|輸入|匯款|轉帳|掃描|下載|安裝|加入|加LINE|加 line)|立即.{0,8}(付款|匯款|轉帳|驗證)|下載apk|掃qr|輸入驗證碼|輸入信用卡|提供提款卡密碼/i.test(textLower);

            if (!hasDangerousAction) {
                totalRiskScore = Math.min(totalRiskScore, 65);
                if (totalRiskScore === 65) {
                    trustedFootprints.push("[信任]純防詐討論(分數封頂)");
                }
            }
        }

        totalRiskScore = Math.min(100, Math.max(0, totalRiskScore));

        return { totalRiskScore, matchedKeywords, trustedFootprints };
    }

    async function scanScamWords(source = "scheduled") {
        if (isScanning || hasTriggeredBlock) return;
        if (isLegacySessionWhitelist()) return;
        if (isSystemPage() || isDevEnvironment()) return;

        isScanning = true;

        try {
            if (await isCurrentUrlTrustedOrWhitelisted()) {
                console.log("✅ AI 防詐盾牌：白名單 / 預設可信網域命中，略過內容掃描", window.location.hostname);
                observeElements();
                return;
            }

            const siteInfo = await getSiteReputation();
            const userReportedHit = await getUserReportedDomainHit();
            const { reputation, riskThreshold, scanMode } = siteInfo;

            if (userReportedHit) {
                showUserReportedDomainWarning(userReportedHit);
            }

            const textContent = (scanMode === "ugc" || reputation >= 95)
                ? getScannableText()
                : getSafePageText(document.body);

            if (!textContent || textContent.trim().length < 50) {
                observeElements();
                return;
            }

            const smartText = extractHighRiskText(textContent);
            const safeText = maskSensitiveData(smartText);
            const textHash = hashString(`${window.location.href}|${safeText}`);

            if (scannedCache.has(textHash)) {
                observeElements();
                return;
            }

            scannedCache.add(textHash);
            if (scannedCache.size > 80) {
                const iterator = scannedCache.values();
                for (let i = 0; i < 40; i += 1) scannedCache.delete(iterator.next().value);
            }

            const riskResult = calculateLocalRisk(safeText, siteInfo);
            let { totalRiskScore, matchedKeywords, trustedFootprints } = riskResult;

            if (userReportedHit) {
                if (isConfirmedHighRiskDomainHit(userReportedHit)) {
                    showUserReportedDomainWarning(userReportedHit);
                    await new Promise(resolve => setTimeout(resolve, 900));

                    totalRiskScore = Math.max(totalRiskScore, 90);
                    matchedKeywords = Array.from(new Set([
                        ...matchedKeywords,
                        `家人已確認高風險：${userReportedHit.domain}`,
                        "家庭確認高風險名單"
                    ]));
                } else {
                    totalRiskScore = Math.min(99, totalRiskScore + 25);
                    matchedKeywords = Array.from(new Set([
                        ...matchedKeywords,
                        `家人回報可疑：${userReportedHit.domain}`
                    ]));
                }
            }

            currentGlobalRiskScore = totalRiskScore;

            if (totalRiskScore >= getConfigValue("TIME_PRESSURE_DEFUSAL_MIN_SCORE", 40)) {
                applyTimePressureDefusal(source);
            }

            const effectiveRiskThreshold = (scanMode === "ugc" || reputation >= 95)
                ? Math.min(riskThreshold, matchedKeywords.length >= 2 ? 90 : riskThreshold)
                : riskThreshold;

            if (totalRiskScore >= effectiveRiskThreshold) {
                let blockReason = `偵測到多重風險特徵（危險指數 ${totalRiskScore} 分，門檻 ${effectiveRiskThreshold}）：${matchedKeywords.join("、")}`;

                if (trustedFootprints.length > 0) {
                    blockReason += `\n已扣除信任特徵：${trustedFootprints.join("、")}`;
                }

                await triggerSafeBlock(blockReason, {
                    riskScore: totalRiskScore,
                    riskLevel: totalRiskScore >= 90 ? "極度危險" : "中高風險",
                    reason: blockReason,
                    advice: "請勿輸入個資、信用卡、驗證碼或依照頁面指示匯款。",
                    scamDNA: matchedKeywords,
                    source
                });
                return;
            }

            observeElements();
        } finally {
            isScanning = false;
        }
    }

    class BehaviorAnalyzer {
        constructor() {
            this.observer = null;
            this.setupObservers();
        }

        setupObservers() {
            if (!document.body) return;

            this.observer = new MutationObserver(mutations => {
                if (hasTriggeredBlock || isSystemPage() || isDevEnvironment()) return;

                for (const mutation of mutations) {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType !== Node.ELEMENT_NODE) continue;
                        const text = getSafePageText(node, 1000) || "";
                        if (!text) continue;

                        let style = null;
                        try { style = window.getComputedStyle(node); } catch (e) {}

                        if (
                            style &&
                            (style.position === "fixed" || style.position === "absolute") &&
                            /信用卡|身分證字號|銀行帳號|驗證碼|提款卡|網銀密碼/.test(text)
                        ) {
                            triggerSafeBlock("惡意行為：網頁試圖用浮層或彈窗索取機密個資。", {
                                riskScore: 95,
                                riskLevel: "極度危險",
                                reason: "網頁以浮層索取高敏感資料。",
                                advice: "請勿輸入資料，立即離開此頁面。",
                                scamDNA: ["規避查緝", "恐懼訴求"]
                            });
                            return;
                        }
                    }
                }
            });

            this.observer.observe(document.body, { childList: true, subtree: true });
        }

        disconnect() {
            if (this.observer) this.observer.disconnect();
        }
    }

    function analyzeLinkRiskForHover(link) {
        try {
            if (!link?.href) return null;
            const parsed = new URL(link.href);
            const host = parsed.hostname.toLowerCase();

            if (DEFAULT_TRUSTED_DOMAINS.some(domain => domainMatchesHost(host, domain))) return null;

            if (BAD_DOMAINS.some(domain => host.includes(domain))) return { level: 'high', reason: '已知高風險網域' };
            if (/\.(xyz|top|claim|click|cc|monster|icu)$/i.test(host)) return { level: 'medium', reason: '可疑網址結尾' };
            if (/(google|yahoo|line|facebook|apple|gov|bank).*[\-.](verify|login|security|claim)|verify.*(google|line|apple|bank)/i.test(host)) return { level: 'high', reason: '疑似品牌偽裝' };
            if (/bit\.ly|tinyurl|reurl|shorturl|is\.gd|t\.co/i.test(link.href)) return { level: 'medium', reason: '短網址，請先確認來源' };
            return null;
        } catch (e) {
            return null;
        }
    }

    function removeHoverWarning() {
        const old = document.getElementById('ai-shield-link-hover-warning');
        if (old) old.remove();
    }

    function attachHoverWarning(link) {
        if (!link || link.dataset.aiShieldHoverAttached === 'true') return;
        link.dataset.aiShieldHoverAttached = 'true';

        link.addEventListener('mouseenter', () => {
            const risk = analyzeLinkRiskForHover(link);
            if (!risk) return;

            removeHoverWarning();
            const bubble = document.createElement('div');
            bubble.id = 'ai-shield-link-hover-warning';
            bubble.textContent = `AI 提醒：${risk.reason}`;
            bubble.style.cssText = `
                position: fixed;
                left: 12px;
                top: 12px;
                max-width: 320px;
                background: ${risk.level === 'high' ? '#ff4d4f' : '#ffbb33'};
                color: ${risk.level === 'high' ? '#fff' : '#111'};
                padding: 9px 12px;
                border-radius: 999px;
                font-size: 13px;
                font-weight: 900;
                z-index: 2147483646;
                box-shadow: 0 10px 24px rgba(0,0,0,.25);
                font-family: 'Microsoft JhengHei', system-ui, sans-serif;
                pointer-events: none;
            `;
            document.documentElement.appendChild(bubble);

            const rect = link.getBoundingClientRect();
            const top = Math.max(8, rect.top - 42);
            const left = Math.min(Math.max(8, rect.left), window.innerWidth - 340);
            bubble.style.top = `${top}px`;
            bubble.style.left = `${left}px`;
        }, { passive: true });

        link.addEventListener('mouseleave', removeHoverWarning, { passive: true });
        link.addEventListener('blur', removeHoverWarning, { passive: true });
    }

    function scanSingleLink(link) {
        try {
            if (!link?.href) return;
            const linkUrl = new URL(link.href);
            const host = linkUrl.hostname.toLowerCase();
            const isBad = BAD_DOMAINS.some(domain => host.includes(domain));
            const suspiciousTld = /\.(xyz|top|claim|click|cc|monster|icu)$/i.test(host);
            const brandSpoof = /(google|yahoo|line|facebook|apple|gov|bank).*[\-.](verify|login|security|claim)|verify.*(google|line|apple|bank)/i.test(host);

            if (isBad || suspiciousTld || brandSpoof) {
                link.style.cssText = "color:#ff0000!important;font-weight:bold;text-decoration:underline wavy red;background-color:#ffe6e6;";
                triggerSafeBlock("發現高風險釣魚連結：" + host, {
                    riskScore: isBad ? 100 : 88,
                    riskLevel: "極度危險",
                    reason: "連結網域具有釣魚或品牌偽裝特徵。",
                    advice: "請勿點擊此連結。",
                    scamDNA: ["偽裝官方", "規避查緝"]
                });
            }
        } catch (e) {}
    }

    function hasStrongImageScamContext(text = "") {
        const value = normalizeText(text).toLowerCase();

        const explicitAction = /(?:請|立即|馬上|現在|立刻).{0,14}(點擊|輸入|匯款|轉帳|付款|掃描|掃qr|掃 qr|下載|安裝|加入|加line|加 line|加賴)|輸入.{0,10}(驗證碼|信用卡|提款卡密碼|銀行帳號|身分證)|下載\s*apk|匯款到|轉帳到/i.test(value);
        const investmentTrap = /(保證獲利|穩賺不賠|老師帶單|內線消息|內部消息|飆股|投資群|vip群|usdt|虛擬貨幣|加密貨幣).{0,24}(加line|加 line|加賴|入群|匯款|轉帳|儲值|保證金|入金|付款)/i.test(value);
        const qrTrap = /(qr|qrcode|掃碼|掃描).{0,24}(付款|匯款|領獎|補助|驗證|解鎖|繳費|儲值|下載|安裝)/i.test(value);
        const prizeTrap = /(中獎|領獎|補助|獎金|禮物|bonus|claim|prize|gift|lottery).{0,24}(付款|匯款|手續費|保證金|稅金|運費|驗證|掃碼|掃qr|下載)/i.test(value);

        return explicitAction || investmentTrap || qrTrap || prizeTrap;
    }

    function buildImageRiskContext(img) {
        const pieces = [
            document.title || "",
            img?.alt || "",
            img?.title || "",
            img?.src || ""
        ];

        // 只有頁面已經有明顯文字風險時才補一小段頁面上下文，避免正常圖表網站因圖片多而被誤掃。
        if (currentGlobalRiskScore >= 45) {
            try {
                pieces.push(getScannableText().slice(0, 1200));
            } catch (e) {}
        }

        return normalizeText(pieces.join(" ")).slice(0, 1600);
    }

    async function scanSingleImage(img) {
        try {
            if (!img?.src || img.src.startsWith("data:")) return;
            if (img.width < 80 || img.height < 80) return;

            const siteInfo = await getSiteReputation();
            if (siteInfo.category === "ai") return;

            const imageContext = buildImageRiskContext(img);
            const contextLower = imageContext.toLowerCase();

            const hasQR = /qr|qrcode|掃碼|掃描/.test(contextLower);
            const hasCTA = /中獎|領獎|付款|匯款|claim|bonus|prize|gift|lottery|補助|驗證|下載apk|手續費|保證金|儲值/.test(contextLower);
            const hasStrongScamAction = hasStrongImageScamContext(imageContext);

            // 圖表、產品截圖、投資工具頁都會有大量圖片；不能只因「低信譽 + 有圖」就送背景警示。
            // 只有強誘導語境、QR/領獎/付款組合，或本頁文字本身已達高風險時才進一步掃圖。
            const shouldScanImage =
                (hasQR && hasCTA) ||
                hasStrongScamAction ||
                (siteInfo.reputation < 40 && currentGlobalRiskScore >= 60 && img.width > 120 && img.height > 120);

            if (!shouldScanImage) return;

            chrome.runtime.sendMessage({
                action: "scanImageInBackground",
                imageUrl: img.src,
                pageUrl: window.location.href,
                reason: hasStrongScamAction || (hasQR && hasCTA)
                    ? "圖片或周邊文字具有明確詐騙誘導語境"
                    : "低信譽頁面且整體文字風險偏高，需輔助圖片掃描",
                pageRiskScore: currentGlobalRiskScore,
                pageTextContext: imageContext
            }).catch(() => {});
        } catch (e) {}
    }

    function observeElements() {
        document.querySelectorAll("a[href]").forEach(link => {
            if (observedLinks.has(link)) return;
            observedLinks.add(link);
            link.dataset.aiShieldScanned = "true";

            attachHoverWarning(link);

            if (linkObserver) linkObserver.observe(link);
            else scanSingleLink(link);
        });

        document.querySelectorAll("img[src]").forEach(img => {
            if (observedImages.has(img)) return;
            observedImages.add(img);
            img.dataset.aiShieldScanned = "true";

            if (imageObserver) imageObserver.observe(img);
            else scanSingleImage(img);
        });
    }

    function setupIntersectionObservers() {
        if (typeof IntersectionObserver === "undefined") return;

        linkObserver = new IntersectionObserver(entries => {
            entries.forEach(entry => {
                if (!entry.isIntersecting) return;
                scanSingleLink(entry.target);
                linkObserver.unobserve(entry.target);
            });
        }, { rootMargin: "200px" });

        imageObserver = new IntersectionObserver(entries => {
            entries.forEach(entry => {
                if (!entry.isIntersecting) return;
                scanSingleImage(entry.target);
                imageObserver.unobserve(entry.target);
            });
        }, { rootMargin: "300px" });
    }

    async function triggerSafeBlock(reason, reportData = null) {
        if (hasTriggeredBlock) return;
        if (isLegacySessionWhitelist()) return;
        if (isSystemPage() || isDevEnvironment()) return;

        if (await isCurrentUrlTrustedOrWhitelisted()) {
            console.log("✅ AI 防詐盾牌：白名單 / 預設可信網域命中，取消攔截", window.location.href);
            return;
        }

        hasTriggeredBlock = true;
        cleanupObservers();

        const explainItems = Array.isArray(reportData?.explain)
            ? reportData.explain
            : Array.isArray(reportData?.explanation)
                ? reportData.explanation
                : [reason];

        const finalReport = reportData
            ? {
                ...reportData,
                explain: explainItems.length ? explainItems : [reason],
                explanation: explainItems.length ? explainItems : [reason]
            }
            : {
                riskScore: 99,
                riskLevel: "極度危險",
                reason,
                advice: "請勿輸入任何資料。",
                scamDNA: ["系統強制警示"],
                explain: [reason],
                explanation: [reason]
            };

        console.log("🛡️ AI 防詐盾牌：發現威脅，定住畫面並按下快門", reason);

        if (document.body) {
            document.body.style.pointerEvents = "none";
            document.body.style.userSelect = "none";
            document.body.style.border = "5px solid rgba(255, 77, 79, 0.5)";
        }

        try {
            let familyID = "none";
            try {
                const storage = await getStorage(["familyID"]);
                if (storage.familyID) familyID = storage.familyID;
            } catch (e) {}

            const sendPromise = chrome.runtime.sendMessage({
                action: "captureScamTabWithEvidence",
                url: window.location.href,
                reason,
                timestamp: new Date().toISOString(),
                familyID
            });

            await Promise.race([sendPromise, new Promise(resolve => setTimeout(resolve, 2000))]);
        } catch (error) {
            console.error("❌ 自動蒐證快門失敗:", error);
        }

        renderBlockingOverlay();

        const originalUrl = window.location.href;
        const payload = {
            ...finalReport,
            explain: Array.isArray(finalReport.explain) && finalReport.explain.length ? finalReport.explain : [reason],
            explanation: Array.isArray(finalReport.explanation) && finalReport.explanation.length ? finalReport.explanation : (Array.isArray(finalReport.explain) ? finalReport.explain : [reason]),
            originalUrl,
            original_url: originalUrl,
            targetUrl: originalUrl,
            target_url: originalUrl,
            pageUrl: originalUrl,
            page_url: originalUrl,
            url: originalUrl,
            source: "content-script",
            timestamp: Date.now()
        };
        const blockedUrl = chrome.runtime.getURL("pages/blocked.html") +
            "?data=" + encodeURIComponent(JSON.stringify(payload)) +
            "&original_url=" + encodeURIComponent(originalUrl) +
            "&url=" + encodeURIComponent(originalUrl);

        let didUseFrontendFallback = false;

        const fallbackToBlockedPage = () => {
            if (didUseFrontendFallback) return;
            didUseFrontendFallback = true;

            try {
                window.location.replace(blockedUrl);
            } catch (error) {
                try {
                    window.location.href = blockedUrl;
                } catch (e) {
                    alert("🚨 【AI 防詐盾牌】已攔截此危險頁面！");
                }
            }
        };

        chrome.runtime.sendMessage({
            action: "redirect_to_blocked",
            url: blockedUrl
        }, (response) => {
            if (chrome.runtime.lastError || !response || response.status !== "success") {
                fallbackToBlockedPage();
            }
        });

        setTimeout(fallbackToBlockedPage, 1500);
    }

    function renderBlockingOverlay() {
        const overlay = document.createElement("div");
        overlay.style.cssText = "position:fixed;top:0;left:0;width:100vw;height:100vh;background:#141e30;color:white;display:flex;align-items:center;justify-content:center;z-index:2147483647;font-family:sans-serif;padding:24px;box-sizing:border-box;";

        const box = document.createElement("div");
        box.style.cssText = "max-width:640px;text-align:center;line-height:1.7;";

        const title = document.createElement("div");
        title.style.cssText = "font-size:26px;font-weight:900;color:#ff4d4f;margin-bottom:12px;";
        title.textContent = "🚨 證據保全完畢，系統攔截中。";

        const subtitle = document.createElement("div");
        subtitle.style.cssText = "font-size:16px;color:#c9d1d9;";
        subtitle.textContent = "請不要輸入任何個資、驗證碼、信用卡或匯款資訊。";

        box.appendChild(title);
        box.appendChild(subtitle);
        overlay.appendChild(box);

        if (document.body) document.body.replaceChildren(overlay);
        else document.documentElement.appendChild(overlay);
    }

    function scheduleIdleScan() {
        if (hasTriggeredBlock || isSystemPage() || isDevEnvironment()) return;

        const inactivityTimeout = Number(getConfigValue("INACTIVITY_TIMEOUT_MS", 5 * 60 * 1000));
        const maxScansPerMinute = Number(getConfigValue("MAX_SCANS_PER_MINUTE", 10));
        const cooldownMs = Number(getConfigValue("SCAN_COOLDOWN_MS", 1500));

        if (Date.now() - lastActivityTime > inactivityTimeout) {
            idleScanTimer = setTimeout(scheduleIdleScan, Math.max(5000, cooldownMs));
            return;
        }

        if (scanCount >= maxScansPerMinute) {
            idleScanTimer = setTimeout(() => {
                scanCount = 0;
                scheduleIdleScan();
            }, 60000);
            return;
        }

        scanCount += 1;

        const run = () => {
            scanScamWords("idle");
            idleScanTimer = setTimeout(scheduleIdleScan, cooldownMs);
        };

        if (window.requestIdleCallback) requestIdleCallback(run, { timeout: 2000 });
        else idleScanTimer = setTimeout(run, cooldownMs);
    }

    function scheduleMutationScan() {
        if (mutationScanTimer) return;

        const debounceMs = Number(getConfigValue("CONTENT_MUTATION_DEBOUNCE_MS", 3500));
        mutationScanTimer = setTimeout(() => {
            mutationScanTimer = null;
            if (pendingMutationScore < 220) {
                pendingMutationScore = 0;
                return;
            }

            pendingMutationScore = 0;
            console.log("🛡️ AI 防詐盾牌：偵測到網頁內容大幅改變，啟動二次掃描");
            scanScamWords("mutation");
        }, debounceMs);
    }

    function setupDynamicObserver() {
        if (!document.body) return;

        dynamicObserver = new MutationObserver(mutations => {
            if (hasTriggeredBlock || isSystemPage() || isDevEnvironment()) return;

            for (const mutation of mutations) {
                pendingMutationScore += mutation.addedNodes.length * 8;

                for (const node of mutation.addedNodes) {
                    if (node.nodeType !== Node.ELEMENT_NODE) continue;
                    const text = normalizeText(node.innerText || node.textContent || "");
                    if (text.length > 100) pendingMutationScore += Math.min(250, text.length / 4);
                }
            }

            scheduleMutationScan();
        });

        dynamicObserver.observe(document.body, { childList: true, subtree: true });
    }

    function cleanupObservers() {
        if (idleScanTimer) clearTimeout(idleScanTimer);
        if (mutationScanTimer) clearTimeout(mutationScanTimer);
        if (timePressureDefusalTimer) clearInterval(timePressureDefusalTimer);
        if (dynamicObserver) dynamicObserver.disconnect();
        if (behaviorAnalyzer) behaviorAnalyzer.disconnect();
        if (linkObserver) linkObserver.disconnect();
        if (imageObserver) imageObserver.disconnect();
        timePressureDefusalTimer = null;
    }

    function bindUserActivity() {
        document.addEventListener("mousemove", () => { lastActivityTime = Date.now(); }, { passive: true });
        document.addEventListener("keydown", () => { lastActivityTime = Date.now(); }, { passive: true });
        document.addEventListener("scroll", () => { lastActivityTime = Date.now(); }, { passive: true });
        window.addEventListener("beforeunload", cleanupObservers, { once: true });
    }

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === "inject_fake_data") {
            const enabled = Boolean(getConfigValue("ENABLE_FAKE_DATA_INJECTION", false));
            if (!enabled) {
                sendResponse({ status: "disabled", message: "正式模式未啟用假資料注入。" });
                return true;
            }

            const inputs = document.querySelectorAll('input[type="text"], input[type="tel"], input[type="email"]');
            let injectedCount = 0;

            inputs.forEach(input => {
                const name = String(input.name || "").toLowerCase();
                const placeholder = String(input.placeholder || "").toLowerCase();

                if (name.includes("name") || placeholder.includes("姓名")) {
                    input.value = "王大明（防詐測試）";
                    injectedCount += 1;
                } else if (name.includes("phone") || name.includes("tel") || placeholder.includes("電話") || placeholder.includes("手機")) {
                    input.value = "0987987987";
                    injectedCount += 1;
                } else if (name.includes("email") || placeholder.includes("信箱")) {
                    input.value = "shield-test@example.com";
                    injectedCount += 1;
                }
            });

            sendResponse({ status: "success", injectedCount });
            return true;
        }

        if (request.action === "show_alert") {
            const data = request.data || {};
            const reason = data.reason || "此頁面具有可疑特徵，請提高警覺。";
            showInlineWarning(reason);
            sendResponse({ status: "success" });
            return true;
        }

        return false;
    });

    function showInlineWarning(reason) {
        if (document.getElementById("ai-shield-inline-warning")) return;

        const box = document.createElement("div");
        box.id = "ai-shield-inline-warning";
        box.style.cssText = "position:fixed;right:20px;bottom:20px;max-width:360px;background:#fff8e1;color:#5f370e;border:2px solid #ffbb33;border-radius:14px;padding:14px 16px;z-index:2147483646;font-family:'Microsoft JhengHei',sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.25);line-height:1.55;";

        const title = document.createElement("strong");
        title.textContent = "⚠️ AI 防詐提醒";

        const content = document.createElement("div");
        content.textContent = reason;
        content.style.marginTop = "6px";

        const close = document.createElement("button");
        close.type = "button";
        close.textContent = "我知道了";
        close.style.cssText = "margin-top:10px;border:0;border-radius:8px;background:#ffbb33;color:#111;padding:7px 10px;font-weight:800;cursor:pointer;";
        close.addEventListener("click", () => box.remove());

        box.appendChild(title);
        box.appendChild(content);
        box.appendChild(close);
        document.documentElement.appendChild(box);
    }


    // ==========================================
    // 決賽封版：銀髮族心理防護 / A11y
    // 1) 反催促機制：凍結可疑倒數計時器
    // 2) 安心閱讀模式：一鍵降低誤觸、放大文字
    // ==========================================
    function hasPressureContext(text = "") {
        const value = normalizeText(text).toLowerCase();
        return /(倒數|剩餘|限時|最後|逾期|立即|馬上|現在|只剩|名額|截止|凍結|停權|驗證|付款|匯款|補繳|領取|優惠|解除|解鎖|countdown|timer|limited|expire|expires|urgent|verify|payment|pay now)/i.test(value);
    }

    function hasCountdownLikeText(text = "") {
        const value = normalizeText(text);
        if (!value || value.length > 180) return false;

        const patterns = [
            /\b\d{1,2}:\d{2}(?::\d{2})?\b/,
            /\b\d{1,2}\s*(?:分鐘|分|秒)\b/,
            /(?:剩餘|倒數|限時|截止|expires?|countdown|timer).{0,18}\d{1,2}/i,
            /\d{1,2}.{0,4}(?:分鐘|秒).{0,12}(?:完成|驗證|付款|領取|解鎖|處理)/
        ];

        return patterns.some(pattern => pattern.test(value));
    }

    function hasPagePressureRiskContext() {
        if (currentGlobalRiskScore >= 40) return true;
        try {
            const pageText = normalizeText(getScannableText()).slice(0, 5000);
            const hasPaymentOrCredential = /(驗證碼|信用卡|付款|匯款|補繳|解除分期|帳號|密碼|身分證|下載apk|加line|加 line|加賴)/i.test(pageText);
            const hasPressure = hasPressureContext(pageText);
            return hasPaymentOrCredential && hasPressure;
        } catch (e) {
            return false;
        }
    }

    function getElementPressureText(el) {
        const ownText = normalizeText(el?.innerText || el?.textContent || "");
        const parentText = normalizeText(el?.parentElement?.innerText || "").slice(0, 360);
        const titleText = normalizeText(document.title || "").slice(0, 160);
        return `${titleText} ${parentText} ${ownText}`;
    }

    function isCountdownElementCandidate(el) {
        if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
        if (el.dataset?.aiShieldCountdownDefused === "true") return false;
        if (el.closest?.("#ai-shield-time-pressure-notice, #ai-shield-zen-toggle, #ai-shield-zen-panel, #ai-shield-inline-warning, #ai-shield-link-hover-warning")) return false;
        if (["SCRIPT", "STYLE", "NOSCRIPT", "INPUT", "TEXTAREA", "SELECT", "OPTION", "SVG", "CANVAS", "VIDEO", "AUDIO"].includes(el.tagName)) return false;
        if (el.children && el.children.length > 8) return false;

        const text = normalizeText(el.innerText || el.textContent || "");
        if (!text || text.length > 180) return false;
        if (!hasCountdownLikeText(text)) return false;

        const context = getElementPressureText(el);
        if (!hasPressureContext(context)) return false;

        try {
            const rect = el.getBoundingClientRect();
            if (rect.width < 12 || rect.height < 8 || rect.width > Math.max(520, window.innerWidth * 0.9)) return false;
            const style = window.getComputedStyle(el);
            if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
        } catch (e) {}

        return true;
    }

    function createTimePressureNotice(originalText = "") {
        const notice = document.createElement("div");
        notice.id = "ai-shield-time-pressure-notice-" + Math.random().toString(36).slice(2);
        notice.className = "ai-shield-time-pressure-notice";
        notice.textContent = "🛡️ AI 已為您凍結可疑倒數，請安心慢慢看，這沒有時間限制。";
        notice.title = `原本倒數文字：${String(originalText || "").slice(0, 80)}`;
        notice.style.cssText = `
            display:block!important;
            margin:8px 0!important;
            padding:12px 14px!important;
            border-radius:16px!important;
            background:#dcfce7!important;
            color:#14532d!important;
            border:2px solid #22c55e!important;
            font-family:'Microsoft JhengHei', system-ui, sans-serif!important;
            font-size:18px!important;
            line-height:1.55!important;
            font-weight:1000!important;
            box-shadow:0 10px 26px rgba(34,197,94,.18)!important;
            text-align:left!important;
            z-index:2147483600!important;
        `;
        return notice;
    }

    function defuseCountdownElement(el) {
        if (!el || el.dataset.aiShieldCountdownDefused === "true") return false;

        const originalText = normalizeText(el.innerText || el.textContent || "").slice(0, 120);
        const notice = createTimePressureNotice(originalText);

        try {
            el.dataset.aiShieldCountdownDefused = "true";
            el.dataset.aiShieldOriginalDisplay = el.style.display || "";
            el.dataset.aiShieldOriginalAriaHidden = el.getAttribute("aria-hidden") || "";
            el.style.display = "none";
            el.setAttribute("aria-hidden", "true");
            el.insertAdjacentElement("afterend", notice);
            timePressureDefusedCount += 1;
            return true;
        } catch (e) {
            return false;
        }
    }

    function applyTimePressureDefusal(reason = "scheduled") {
        if (hasTriggeredBlock || isSystemPage() || isDevEnvironment()) return 0;
        if (!document.body || !hasPagePressureRiskContext()) return 0;

        const candidates = Array.from(document.querySelectorAll("div,span,p,strong,b,em,small,li,button,a,label,time"))
            .filter(isCountdownElementCandidate)
            .slice(0, 8);

        let count = 0;
        candidates.forEach(el => {
            if (defuseCountdownElement(el)) count += 1;
        });

        if (count > 0) {
            showInlineWarning(`AI 已凍結 ${count} 個可疑倒數。遇到催促付款、驗證或輸入資料時，請先停下來查證。`);
            console.log("🛡️ AI 防詐盾牌：反催促機制已凍結可疑倒數", { count, reason });
        }

        return count;
    }

    function setupTimePressureDefusal() {
        if (timePressureDefusalTimer || isSystemPage() || isDevEnvironment()) return;

        setTimeout(() => applyTimePressureDefusal("initial"), 1400);
        timePressureDefusalTimer = setInterval(() => {
            if (hasTriggeredBlock) return;
            applyTimePressureDefusal("interval");
        }, Number(getConfigValue("TIME_PRESSURE_DEFUSAL_INTERVAL_MS", 3500)) || 3500);
    }

    function ensureZenReadingStyles() {
        if (zenReadingStyleElement) return;

        zenReadingStyleElement = document.createElement("style");
        zenReadingStyleElement.id = "ai-shield-zen-reading-style";
        zenReadingStyleElement.textContent = `
            html.ai-shield-zen-reading-active body {
                background: #fbfdff !important;
            }
            html.ai-shield-zen-reading-active p,
            html.ai-shield-zen-reading-active article,
            html.ai-shield-zen-reading-active main,
            html.ai-shield-zen-reading-active section,
            html.ai-shield-zen-reading-active li {
                font-size: max(22px, 1.15em) !important;
                line-height: 1.85 !important;
                letter-spacing: .02em !important;
            }
            html.ai-shield-zen-reading-active a {
                text-decoration-thickness: 2px !important;
                text-underline-offset: 4px !important;
            }
            .ai-shield-zen-hidden {
                display: none !important;
            }
        `;
        document.documentElement.appendChild(zenReadingStyleElement);
    }

    function isLikelyAdOrDistractorElement(el) {
        if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
        if (el.closest?.("#ai-shield-zen-toggle, #ai-shield-zen-panel, #ai-shield-inline-warning, #ai-shield-time-pressure-notice")) return false;
        if (["HTML", "BODY", "MAIN", "ARTICLE"].includes(el.tagName)) return false;

        const idClass = `${el.id || ""} ${typeof el.className === "string" ? el.className : ""} ${el.getAttribute("aria-label") || ""}`.toLowerCase();
        const role = String(el.getAttribute("role") || "").toLowerCase();
        const isFrame = el.tagName === "IFRAME";
        const isAside = el.tagName === "ASIDE";
        const isDialog = role === "dialog" || role === "complementary";
        const keywordHit = /(\bad\b|ads|advert|advertisement|banner|popup|pop-up|modal|sponsor|promoted|recommend|related|subscribe|newsletter|floating|float|overlay|side.?bar|右欄|廣告|贊助|推薦|彈窗|訂閱)/i.test(idClass);

        if (!(isFrame || isAside || isDialog || keywordHit)) return false;

        try {
            const rect = el.getBoundingClientRect();
            if (rect.width < 24 || rect.height < 24) return false;
            if (rect.width > window.innerWidth * 0.96 && rect.height > window.innerHeight * 0.75) return false;
        } catch (e) {}

        return true;
    }

    function applyZenReadingMode() {
        if (zenReadingModeActive || !document.body) return;

        ensureZenReadingStyles();
        zenReadingModeActive = true;
        document.documentElement.classList.add("ai-shield-zen-reading-active");
        zenReadingHiddenElements = [];

        const candidates = Array.from(document.querySelectorAll("iframe, aside, [class], [id], [role='dialog'], [role='complementary']"))
            .filter(isLikelyAdOrDistractorElement)
            .slice(0, 120);

        candidates.forEach(el => {
            if (el.classList.contains("ai-shield-zen-hidden")) return;
            el.classList.add("ai-shield-zen-hidden");
            zenReadingHiddenElements.push(el);
        });

        updateZenToggleUI();
        showInlineWarning(`已開啟安心閱讀模式：隱藏 ${zenReadingHiddenElements.length} 個容易誤觸的廣告/彈窗區塊，並放大文章文字。`);
    }

    function restoreZenReadingMode() {
        zenReadingModeActive = false;
        document.documentElement.classList.remove("ai-shield-zen-reading-active");
        zenReadingHiddenElements.forEach(el => {
            try { el.classList.remove("ai-shield-zen-hidden"); } catch (e) {}
        });
        zenReadingHiddenElements = [];
        updateZenToggleUI();
        showInlineWarning("已還原原本網頁顯示。若再次覺得雜亂，可以重新開啟安心閱讀模式。");
    }

    function updateZenToggleUI() {
        const btn = document.getElementById("ai-shield-zen-toggle");
        if (!btn) return;
        btn.textContent = zenReadingModeActive ? "↩ 還原原網頁" : "📖 安心閱讀";
        btn.setAttribute("aria-pressed", zenReadingModeActive ? "true" : "false");
        btn.style.background = zenReadingModeActive ? "linear-gradient(135deg,#16a34a,#15803d)" : "linear-gradient(135deg,#2563eb,#1d4ed8)";
    }

    function setupZenReadingButton() {
        if (!document.body || document.getElementById("ai-shield-zen-toggle") || isSystemPage() || isDevEnvironment()) return;

        const panel = document.createElement("div");
        panel.id = "ai-shield-zen-panel";
        panel.style.cssText = `
            position:fixed!important;
            right:18px!important;
            bottom:18px!important;
            z-index:2147483645!important;
            font-family:'Microsoft JhengHei', system-ui, sans-serif!important;
            display:flex!important;
            flex-direction:column!important;
            align-items:flex-end!important;
            gap:8px!important;
            pointer-events:none!important;
        `;

        const hint = document.createElement("div");
        hint.textContent = "高齡友善｜降低誤觸";
        hint.style.cssText = `
            padding:6px 10px!important;
            border-radius:999px!important;
            background:rgba(255,255,255,.94)!important;
            color:#334155!important;
            border:1px solid rgba(37,99,235,.22)!important;
            font-size:12px!important;
            font-weight:900!important;
            box-shadow:0 8px 22px rgba(15,23,42,.12)!important;
            pointer-events:none!important;
        `;

        const btn = document.createElement("button");
        btn.id = "ai-shield-zen-toggle";
        btn.type = "button";
        btn.textContent = "📖 安心閱讀";
        btn.setAttribute("aria-pressed", "false");
        btn.style.cssText = `
            min-width:142px!important;
            border:0!important;
            border-radius:999px!important;
            padding:12px 16px!important;
            color:#fff!important;
            background:linear-gradient(135deg,#2563eb,#1d4ed8)!important;
            font-size:16px!important;
            line-height:1.3!important;
            font-weight:1000!important;
            cursor:pointer!important;
            box-shadow:0 14px 30px rgba(37,99,235,.28)!important;
            pointer-events:auto!important;
        `;
        btn.addEventListener("click", () => {
            if (zenReadingModeActive) restoreZenReadingMode();
            else applyZenReadingMode();
        });

        const actionRow = document.createElement("div");
        actionRow.style.cssText = `
            display:flex!important;
            gap:6px!important;
            align-items:center!important;
            pointer-events:auto!important;
        `;

        const closeBtn = document.createElement("button");
        closeBtn.type = "button";
        closeBtn.textContent = "✕";
        closeBtn.style.cssText = `
            width:40px!important;
            height:40px!important;
            border:none!important;
            border-radius:50%!important;
            background:#e5e7eb!important;
            color:#374151!important;
            font-size:18px!important;
            font-weight:900!important;
            cursor:pointer!important;
            pointer-events:auto!important;
        `;

        closeBtn.addEventListener("click", () => {
            panel.innerHTML = "";

            const miniBtn = document.createElement("button");
            miniBtn.textContent = "📖";
            miniBtn.style.cssText = `
                width:52px!important;
                height:52px!important;
                border:none!important;
                border-radius:50%!important;
                background:linear-gradient(135deg,#2563eb,#1d4ed8)!important;
                color:white!important;
                font-size:22px!important;
                cursor:pointer!important;
                pointer-events:auto!important;
                box-shadow:0 14px 30px rgba(37,99,235,.28)!important;
            `;

            miniBtn.addEventListener("click", () => {
                panel.remove();
                setupZenReadingButton();
            });

            panel.appendChild(miniBtn);
        });

        actionRow.appendChild(btn);
        actionRow.appendChild(closeBtn);

        panel.appendChild(hint);
        panel.appendChild(actionRow);
        document.documentElement.appendChild(panel);
    }

    async function initializeAntiScamContentScript() {
        if (window.self !== window.top) return;

        if (isSystemPage() || isDevEnvironment()) {
            console.log("🛡️ AI 防詐盾牌：系統或開發頁面，關閉自動掃描");
            return;
        }

        if (await isCurrentUrlTrustedOrWhitelisted()) {
            console.log("✅ AI 防詐盾牌：白名單 / 預設可信網域，關閉自動掃描", window.location.hostname);
            return;
        }

        bindUserActivity();
        setupIntersectionObservers();

        if (document.body) {
            behaviorAnalyzer = new BehaviorAnalyzer();
            setupDynamicObserver();
        }

        setupUserReportedDomainStorageListener();
        observeElements();

        // 頁面載入後立即做兩次主動掃描：
        // 第一次處理靜態 HTML，第二次處理動態插入內容。
        // 這樣進入假物流 / 釣魚頁時，不需要先點 Popup 才有反應。
        setTimeout(() => scanScamWords("initial-page-load"), 650);
        setTimeout(() => scanScamWords("initial-page-load-confirm"), 1800);

        scheduleIdleScan();
        setupTimePressureDefusal();
        setupZenReadingButton();

        console.log("🛡️ AI 防詐盾牌：Content Script 已上線，主動掃描已啟動");
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initializeAntiScamContentScript, { once: true });
    } else {
        initializeAntiScamContentScript();
    }
})();