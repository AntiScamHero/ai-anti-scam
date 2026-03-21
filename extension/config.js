/**
 * AI 防詐盾牌 - 全域設定檔
 */
const CONFIG = {
    // 🔗 後端 API 網址 (已更新為 Render 正式上線網址)
    API_BASE_URL: 'https://ai-anti-scam.onrender.com', 
    
    // ⚙️ 效能與記憶體控制參數
    MAX_SCANS_PER_MINUTE: 10,        // 每分鐘最大文字掃描次數
    INACTIVITY_TIMEOUT_MS: 300000,   // 5分鐘無操作即休眠 (防記憶體洩漏)
    SCAN_COOLDOWN_MS: 1500,          // 文字掃描冷卻時間
    
    // 📊 風險與容錯設定
    RISK_THRESHOLD_HIGH: 70,         // 高風險閾值 (觸發攔截)
    RISK_THRESHOLD_MEDIUM: 40,       // 中風險閾值 (觸發警告)
    MAX_RETRIES: 3,                  // API 失敗最高重試次數
    POLLING_INTERVAL_MS: 5000        // 家庭戰情室即時更新頻率
};

// 💡 修正後的匯出邏輯：同時支援 網頁(window) 與 背景腳本(self)
if (typeof self !== 'undefined') {
    self.CONFIG = CONFIG;
}
if (typeof window !== 'undefined') {
    window.CONFIG = CONFIG;
}