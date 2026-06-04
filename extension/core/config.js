/**
 * AI 防詐盾牌 - 競賽封版公開設定檔
 *
 * 這份檔案只放「可公開」的前端設定：API 網址、風險閾值、效能參數、儲存 key、展示模式開關。
 * 不可放真正後端密鑰。正式驗證一律走 /api/auth/install 核發的短效 Bearer Token。
 */

const CONFIG = Object.freeze({
    EXTENSION_MODE: "competition",
    API_BASE_URL: "https://ai-anti-scam.onrender.com",
    SCAN_API_PATH: "/api/scan",

    // 🔐 短效權杖與安裝身分
    ACCESS_TOKEN_STORAGE_KEY: "aiShieldAccessToken",
    INSTALL_ID_STORAGE_KEY: "aiShieldInstallId",
    TOKEN_EXPIRES_AT_STORAGE_KEY: "aiShieldTokenExpiresAt",
    TOKEN_REFRESH_WINDOW_MS: 5 * 60 * 1000,
    REQUIRE_AUTH_TOKEN: true,

    // ⚙️ 效能與記憶體控制參數
    MAX_SCANS_PER_MINUTE: 10,
    INACTIVITY_TIMEOUT_MS: 5 * 60 * 1000,
    SCAN_COOLDOWN_MS: 1500,
    BACKGROUND_SCAN_COOLDOWN_MS: 30 * 1000,
    BACKGROUND_MAX_TEXT_LENGTH: 1200,
    BACKGROUND_LOCAL_RISK_MIN: 40,
    
    // ✅ 已修正：維持 12 秒，避免 Popup 或擴充功能卡頓
    REQUEST_TIMEOUT_MS: 12000,
    
    MAX_RETRIES: 3,
    POLLING_INTERVAL_MS: 5000,

    // 📊 風險閾值
    RISK_THRESHOLD_HIGH: 70,
    RISK_THRESHOLD_MEDIUM: 40,
    CONTEXT_MENU_WARN_THRESHOLD: 60,

    // 🧾 隱私化證據保全：先在瀏覽器端壓縮，後端預設只保存摘要。
    SAVE_FULL_SCREENSHOT_BY_DEFAULT: false,
    CAPTURE_JPEG_QUALITY: 28,
    CAPTURE_WEBP_QUALITY: 0.32,
    CAPTURE_MAX_WIDTH: 900,
    CAPTURE_MAX_HEIGHT: 1200,
    CAPTURE_MAX_BYTES: 80 * 1024,
    CAPTURE_DROP_IF_OVER_LIMIT: true,

    // App Demo / OCR 圖片前處理：只在前端辨識，送後端時只送文字。
    OCR_PREVIEW_MAX_SIDE: 1200,
    OCR_PREVIEW_WEBP_QUALITY: 0.58,
    OCR_PROCESS_MAX_SIDE: 1800,

    // MV3 Service Worker 是事件驅動。競賽封版預設不刻意常駐，只在需要時由事件喚醒。
    ENABLE_SERVICE_WORKER_HEARTBEAT: false,
    HEARTBEAT_LOG_ENABLED: false,

    // 🏁 比賽展示預熱：預設關閉；決賽現場可在 config.js 改 true，或用外部 cron 打 /health。
    DEMO_KEEP_ALIVE: false,
    KEEP_ALIVE_PATH: "/health",
    KEEP_ALIVE_INTERVAL_MS: 5 * 60 * 1000,

    // Demo 開關保留給展示環境，但競賽封版預設關閉，不再默默降級成無驗證模式。
    USE_PUBLIC_DEMO_MODE: false,
    AI_SHIELD_DEMO_MODE: false,
    DEMO_MODE: false,
    POPUP_ALLOW_OFFLINE_FALLBACK: true,
    POPUP_AUTO_SCAN_ON_OPEN: false,
    ENABLE_FAKE_DATA_INJECTION: false,

    // 👨‍👩‍👧 家庭代碼共用主鍵：Demo Console / App Demo / Popup / Dashboard 統一讀寫這個 key。
    SHARED_FAMILY_ID_KEY: "AI_SHIELD_FAMILY_ID",

    // 🧪 競賽展示內部頁：自動掃描會跳過，避免自己的測試文字被誤攔。
    INTERNAL_DEMO_PAGES: [
        "AI防詐盾牌_AppDemo.html",
        "demo_console.html",
        "validation_report.html",
        "dashboard.html",
        "blocked.html",
        "simulator.html",
        "welcome.html",
        "popup.html",
        "mobile_demo.html",
        "help.html",
        "test.html"
    ],


    TRUSTED_DOMAINS: [
        "wikipedia.org",
        "ccsh.tn.edu.tw"
    ],

    SITE_REPUTATION: {
        "youtube.com": { category: "video", reputation: 100, riskThreshold: 120, scanMode: "ugc" },
        "youtu.be": { category: "video", reputation: 100, riskThreshold: 120, scanMode: "ugc" },
        "google.com": { category: "search", reputation: 100, riskThreshold: 120, scanMode: "ugc" },
        "google.com.tw": { category: "search", reputation: 100, riskThreshold: 120, scanMode: "ugc" },
        "facebook.com": { category: "social", reputation: 95, riskThreshold: 110, scanMode: "ugc" },
        "twitter.com": { category: "social", reputation: 95, riskThreshold: 110, scanMode: "ugc" },
        "x.com": { category: "social", reputation: 95, riskThreshold: 110, scanMode: "ugc" },
        "instagram.com": { category: "social", reputation: 95, riskThreshold: 110, scanMode: "ugc" },
        // 🌟 LINE 官方與短連結高信譽保護：只掃 UGC，不封鎖整個通訊工具
        "line.me": { category: "social", reputation: 95, riskThreshold: 110, scanMode: "ugc" },
        "liff.line.me": { category: "social", reputation: 95, riskThreshold: 110, scanMode: "ugc" },
        "lin.ee": { category: "social", reputation: 95, riskThreshold: 110, scanMode: "ugc" },
        "line.naver.jp": { category: "social", reputation: 95, riskThreshold: 110, scanMode: "ugc" },
        "wikipedia.org": { category: "reference", reputation: 100, riskThreshold: 120, scanMode: "ugc" },
        "ccsh.tn.edu.tw": { category: "education", reputation: 100, riskThreshold: 120, scanMode: "ugc" },
        "github.com": { category: "development", reputation: 100, riskThreshold: 120, scanMode: "ugc" },
        
        // 🌟 各大 AI 平台高信譽保護
        "chatgpt.com": { category: "ai", reputation: 100, riskThreshold: 120, scanMode: "ugc" },
        "openai.com": { category: "ai", reputation: 100, riskThreshold: 120, scanMode: "ugc" },
        "deepseek.com": { category: "ai", reputation: 100, riskThreshold: 120, scanMode: "ugc" },
        "chat.deepseek.com": { category: "ai", reputation: 100, riskThreshold: 120, scanMode: "ugc" },
        "claude.ai": { category: "ai", reputation: 100, riskThreshold: 120, scanMode: "ugc" },
        
        "pchome.com.tw": { category: "ecommerce", reputation: 80, riskThreshold: 90, scanMode: "full" },
        "momoshop.com.tw": { category: "ecommerce", reputation: 80, riskThreshold: 90, scanMode: "full" },
        "momo.com.tw": { category: "ecommerce", reputation: 80, riskThreshold: 90, scanMode: "full" },
        "shopee.tw": { category: "ecommerce", reputation: 75, riskThreshold: 90, scanMode: "full" },
        "cnyes.com": { category: "news", reputation: 80, riskThreshold: 90, scanMode: "full" },
        "msn.com": { category: "portal", reputation: 85, riskThreshold: 95, scanMode: "full" },
        "yahoo.com": { category: "portal", reputation: 85, riskThreshold: 95, scanMode: "full" }
    }
});

if (typeof self !== "undefined") self.CONFIG = CONFIG;
if (typeof window !== "undefined") window.CONFIG = CONFIG;