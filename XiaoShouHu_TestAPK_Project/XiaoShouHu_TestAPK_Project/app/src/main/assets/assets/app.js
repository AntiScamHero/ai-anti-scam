// 小守護 AI 防詐盾牌｜長輩友善雲端同步版

/* === 20260608 CACHE/UI SAFETY BOOTSTRAP ===
   目的：避免舊版快取與掃描 loading 卡住，並讓核心按鈕即使後面補丁失效也可點。 */
(function(){
  if (window.__AI_SHIELD_BOOTSTRAP_FIXED__) return;
  window.__AI_SHIELD_BOOTSTRAP_FIXED__ = true;
  function byId(id){ return document.getElementById(id); }
  function unlockUI(){
    var loading = byId('scanLoading');
    if (loading) { loading.classList.remove('active'); loading.style.display = 'none'; }
    ['scanBtn','familyClearAllBtn','familyRefreshBtn','familyCopy165Btn','joinFamilyBtn','showJoinFamilyBtn','lineInviteFamilyBtn','lineCopyInviteBtn','lineTestPushBtn','lineRefreshBindStatusBtn'].forEach(function(id){
      var el = byId(id);
      if (el) { el.disabled = false; el.style.pointerEvents = 'auto'; el.removeAttribute('aria-busy'); }
    });
    var scanBtn = byId('scanBtn');
    if (scanBtn && /等待|清除中|載入/.test(scanBtn.textContent || '')) scanBtn.textContent = '開始檢查';
    var msg = byId('message'), url = byId('targetUrl');
    if (msg) msg.disabled = false;
    if (url) url.disabled = false;
  }
  window.aiShieldUnlockUI = unlockUI;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', unlockUI);
  else unlockUI();
  setTimeout(unlockUI, 300);
  setTimeout(unlockUI, 1200);
  setTimeout(unlockUI, 3000);
  })();


/* === RESULT SCREEN HARD GUARD 20260610 ===
   修正：結果頁沒有底部導覽按鈕，導致「檢查」按鈕看起來仍亮著；
   另外用 CSS 強制保證非 result 狀態時，#screen-result 不會殘留在檢查頁下面。 */
(function(){
  if (window.__AI_SHIELD_RESULT_SCREEN_GUARD__) return;
  window.__AI_SHIELD_RESULT_SCREEN_GUARD__ = true;

  function installResultGuardStyle(){
    if (document.getElementById("ai-shield-result-guard-style")) return;
    var style = document.createElement("style");
    style.id = "ai-shield-result-guard-style";
    style.textContent = `
      body:not([data-current-screen="result"]) #screen-result {
        display: none !important;
        visibility: hidden !important;
        height: 0 !important;
        min-height: 0 !important;
        max-height: 0 !important;
        overflow: hidden !important;
        pointer-events: none !important;
      }
      body[data-current-screen="result"] #screen-home,
      body[data-current-screen="result"] #screen-scan,
      body[data-current-screen="result"] #screen-family,
      body[data-current-screen="result"] #screen-education {
        display: none !important;
        visibility: hidden !important;
        height: 0 !important;
        overflow: hidden !important;
      }
    `;
    document.head.appendChild(style);
  }

  function markCurrentScreen(screen){
    document.body.dataset.currentScreen = screen || "home";
  }

  window.aiShieldMarkCurrentScreen = markCurrentScreen;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function(){
      installResultGuardStyle();
      var active = document.querySelector(".screen.active");
      markCurrentScreen(active && active.id ? active.id.replace("screen-", "") : "home");
    });
  } else {
    installResultGuardStyle();
    var active = document.querySelector(".screen.active");
    markCurrentScreen(active && active.id ? active.id.replace("screen-", "") : "home");
  }
})();


    const $ = (id) => document.getElementById(id);

    let xiaoxinScanStepTimer = null;

    function ensureXiaoxinProcessingOverlay() {
      let box = $("xiaoxinProcessingOverlay");
if (box) box.remove();

      box = document.createElement("div");
      box.id = "xiaoxinProcessingOverlay";
      box.className = "xiaoxin-hud-v2";
      box.setAttribute("aria-live", "polite");
      box.setAttribute("aria-hidden", "true");
      box.hidden = true;
      box.innerHTML = `
        <div class="xiaoxin-hud-v2-backdrop"></div>
        <div class="xiaoxin-hud-v2-stage" role="status">
          <div class="xiaoxin-hud-v2-beam"></div>
          <div class="xiaoxin-hud-v2-ring ring-a"></div>
          <div class="xiaoxin-hud-v2-ring ring-b"></div>
          <div class="xiaoxin-hud-v2-scanline"></div>
          <img id="xiaoxinProcessingImage" class="xiaoxin-hud-v2-image" src="xiaoxin.png" alt="小安心檢查中">
          <div class="xiaoxin-hud-v2-title">小安心檢查中...</div>
          <div id="xiaoxinScanStatus" class="xiaoxin-hud-v2-status">🔍 正在分析訊息...</div>
          <div class="xiaoxin-hud-v2-progress"><span></span></div>
          <div class="xiaoxin-hud-v2-tip">請先不要點連結，也不要輸入驗證碼。</div>
        </div>
      `;

      document.body.appendChild(box);
      return box;
    }

    function startXiaoxinScanSteps() {
      const steps = [
        "🔍 正在分析訊息內容...",
        "🕵️‍♂️ 正在比對詐騙關鍵字...",
        "🌐 正在檢查網址安全性...",
        "🛡️ 正在進行高風險比對..."
      ];
      let index = 0;
      const status = $("xiaoxinScanStatus");
      if (status) status.textContent = steps[0];

      if (xiaoxinScanStepTimer) clearInterval(xiaoxinScanStepTimer);
      xiaoxinScanStepTimer = setInterval(() => {
        index = (index + 1) % steps.length;
        const el = $("xiaoxinScanStatus");
        if (el) el.textContent = steps[index];
      }, 850);
    }

    function stopXiaoxinScanSteps() {
      if (xiaoxinScanStepTimer) {
        clearInterval(xiaoxinScanStepTimer);
        xiaoxinScanStepTimer = null;
      }
    }

    function showXiaoxinProcessing() {
      const box = ensureXiaoxinProcessingOverlay();
      box.hidden = false;
      box.classList.add("active");
      box.style.display = "grid";
      box.setAttribute("aria-hidden", "false");

      const btn = $("scanBtn");
      if (btn) btn.textContent = "小安心檢查中...";

      startXiaoxinScanSteps();
    }

    function hideXiaoxinProcessing() {
      const box = $("xiaoxinProcessingOverlay");
      if (!box) return;

      stopXiaoxinScanSteps();
      box.classList.remove("active");
      box.hidden = true;
      box.style.display = "none";
      box.setAttribute("aria-hidden", "true");
    }

    const MIN_XIAOXIN_LOADING_MS = 1500;

    function waitXiaoxin(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }

    async function keepXiaoxinAtLeast(startedAt, minMs = MIN_XIAOXIN_LOADING_MS) {
      const elapsed = Date.now() - startedAt;
      if (elapsed < minMs) {
        await waitXiaoxin(minMs - elapsed);
      }
    }


    const FAMILY_ID_SYNC_KEYS = [
      "savedFamilyID",
      "aiShieldPrimaryFamilyID",
      "AI_SHIELD_FAMILY_ID",
      "currentFamilyID",
      "boundFamilyID",
      "familyCode",
      "dashboardFamilyID",
      "popupFamilyID",
      "aiShieldFamilyID",
      "familyID"
    ];

    // welcome.js 寫入的新家庭代碼專用欄位；index/app 要以這個為主要來源。
    const WELCOME_FAMILY_ID_KEY = "aiShieldWelcomeFamilyID";
    const WELCOME_FAMILY_UPDATED_AT_KEY = "aiShieldWelcomeFamilyUpdatedAt";

    function normalizeFamilyCode(value) {
      return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
    }

    function decodeFamilyInviteText(value) {
      let text = String(value || "").trim();
      for (let i = 0; i < 2; i += 1) {
        try {
          const decoded = decodeURIComponent(text);
          if (decoded === text) break;
          text = decoded;
        } catch (e) {
          break;
        }
      }
      return text;
    }

    function extractFamilyCodeFromText(value) {
      const text = decodeFamilyInviteText(value).toUpperCase();
      if (!text) return "";

      const priorityPatterns = [
        /(?:FAMILYID|FAMILY_ID|FAMILYCODE|FAMILY_CODE|INVITECODE|INVITE_CODE|CODE|FAMILY|家人代碼|家庭代碼|邀請碼|代碼)\s*[:=：\s]+([A-Z0-9]{6})/i,
        /AISHIELD\s*[:：/]\s*([A-Z0-9]{6})/i,
        /AI\s*SHIELD\s*[:：/]\s*([A-Z0-9]{6})/i,
        /(?:\?|&|#)(?:FAMILYID|FAMILY|CODE|INVITECODE|FAMILYCODE)=([A-Z0-9]{6})/i
      ];

      for (const pattern of priorityPatterns) {
        const match = text.match(pattern);
        if (match && match[1]) return normalizeFamilyCode(match[1]);
      }

      const candidates = text.match(/[A-Z0-9]{6}/g) || [];
      const blacklist = new Set(["AISHIE", "SHIELD", "LINEME", "MSGEXT", "TEXTAI", "HTTPSW", "HTTPSS", "FAMILY", "INVITE"]);
      for (const candidate of candidates) {
        const code = normalizeFamilyCode(candidate);
        if (code.length === 6 && !blacklist.has(code) && !isBlockedDemoFamilyID(code)) return code;
      }

      const fallback = normalizeFamilyCode(text);
      return fallback.length === 6 ? fallback : "";
    }

    window.extractFamilyCodeFromText = extractFamilyCodeFromText;

    function normalizeFamilyInputValue(value) {
      return extractFamilyCodeFromText(value) || normalizeFamilyCode(value);
    }

    function getUrlParams() {
      return new URLSearchParams(window.location.search || "");
    }

    function isForceFallbackMode() {
      const params = getUrlParams();
      const raw = String(
        params.get("forceFallback") ||
        params.get("fallback") ||
        params.get("mode") ||
        ""
      ).toLowerCase();

      return raw === "1" || raw === "true" || raw === "yes" || raw === "fallback" || raw === "local";
    }

    const FORCE_FALLBACK_MODE = isForceFallbackMode();
    const AUTO_CREATE_FAMILY_ON_STARTUP = false;
    let manualFamilyActionInProgress = false;
    const BLOCKED_DEMO_FAMILY_IDS = new Set(["", "DEMO01", "TEST01"]);

    function isBlockedDemoFamilyID(code) {
      return BLOCKED_DEMO_FAMILY_IDS.has(normalizeFamilyCode(code));
    }

    function getModeLabel() {
      return FORCE_FALLBACK_MODE ? "小守護基本提醒模式" : "防護系統運作中";
    }

    function getModeDescription() {
      return FORCE_FALLBACK_MODE
        ? "目前使用小守護基本提醒，適合網路不穩時維持防護。"
        : "系統會先幫您檢查內容，遇到網路不穩也會提供基本提醒。";
    }

    function updateAppModeUI() {
      const banner = $("appModeBanner");
      const title = $("appModeTitle");
      const desc = $("appModeDesc");
      const modeText = $("modeText");

      if (banner) banner.classList.toggle("fallback", FORCE_FALLBACK_MODE);
      if (title) title.textContent = "目前狀態：" + getModeLabel();
      if (desc) desc.textContent = getModeDescription();
      if (modeText) modeText.textContent = getModeLabel();
    }

    function clearBlockedDemoFamilyIDs() {
      try {
        FAMILY_ID_SYNC_KEYS.forEach(key => {
          if (isBlockedDemoFamilyID(localStorage.getItem(key))) {
            localStorage.removeItem(key);
          }
        });
        const clearReason = localStorage.getItem("aiShieldFamilyBindingLastClearReason") || "";
        if (!clearReason) {
          localStorage.setItem("aiShieldFamilyBindingLastClearReason", "cleared_demo_family_code");
        }
      } catch (e) {}

      try {
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
          chrome.storage.local.get(FAMILY_ID_SYNC_KEYS, storage => {
            const keys = FAMILY_ID_SYNC_KEYS.filter(key => isBlockedDemoFamilyID(storage?.[key]));
            if (keys.length) chrome.storage.local.remove(keys);
          });
        }
      } catch (e) {}
    }

    function getUrlFamilyID() {
      const params = getUrlParams();
      const direct = params.get("familyID") || params.get("family") || params.get("code") || params.get("inviteCode") || params.get("familyCode") || "";
      return extractFamilyCodeFromText(direct || window.location.href || "");
    }

    function getIncomingFamilyInviteCode() {
      const params = getUrlParams();
      const candidates = [
        params.get("familyID"),
        params.get("family"),
        params.get("code"),
        params.get("inviteCode"),
        params.get("familyCode"),
        params.get("text"),
        params.get("url"),
        params.get("share"),
        window.location.hash,
        window.location.href
      ];
      for (const item of candidates) {
        const code = extractFamilyCodeFromText(item || "");
        if (code) return code;
      }
      return "";
    }

    function getFamilyID() {
      // 先讀 welcome 專用欄位；這是目前畫面顯示與後續掃描使用的主要家庭代碼。
      try {
        const welcomeCode = normalizeFamilyCode(localStorage.getItem(WELCOME_FAMILY_ID_KEY));
        if (welcomeCode.length === 6 && !isBlockedDemoFamilyID(welcomeCode)) return welcomeCode;
      } catch (e) {}

      // 防呆：如果還沒有 welcome 專用欄位，才退回既有欄位。
      for (const key of FAMILY_ID_SYNC_KEYS) {
        try {
          const value = normalizeFamilyCode(localStorage.getItem(key));
          if (value.length === 6 && !isBlockedDemoFamilyID(value)) return value;
        } catch (e) {}
      }

      return "";
    }

    async function getStoredFamilyID() {
      // 比較 localStorage / chrome.storage 裡 welcome 專用欄位的時間，取最新的一組。
      let localCode = "";
      let localTime = 0;
      try {
        localCode = normalizeFamilyCode(localStorage.getItem(WELCOME_FAMILY_ID_KEY));
        localTime = Date.parse(localStorage.getItem(WELCOME_FAMILY_UPDATED_AT_KEY) || "") || 0;
      } catch (e) {}

      let chromeCode = "";
      let chromeTime = 0;
      try {
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
          const storage = await chrome.storage.local.get([WELCOME_FAMILY_ID_KEY, WELCOME_FAMILY_UPDATED_AT_KEY]);
          chromeCode = normalizeFamilyCode(storage?.[WELCOME_FAMILY_ID_KEY]);
          chromeTime = Date.parse(storage?.[WELCOME_FAMILY_UPDATED_AT_KEY] || "") || 0;
        }
      } catch (e) {}

      const localOk = localCode.length === 6 && !isBlockedDemoFamilyID(localCode);
      const chromeOk = chromeCode.length === 6 && !isBlockedDemoFamilyID(chromeCode);

      if (chromeOk && (!localOk || chromeTime >= localTime)) {
        try {
          localStorage.setItem(WELCOME_FAMILY_ID_KEY, chromeCode);
          localStorage.setItem(WELCOME_FAMILY_UPDATED_AT_KEY, chromeTime ? new Date(chromeTime).toISOString() : new Date().toISOString());
        } catch (e) {}
        return chromeCode;
      }

      if (localOk) return localCode;
      return getFamilyID();
    }

    async function saveFamilyID(familyID) {
      const code = normalizeFamilyCode(familyID);
      if (!code) return "";

      // 允許手動輸入的家庭代碼寫入手機端儲存空間，之後 index/app 才能持續使用同一組。
      const now = new Date().toISOString();
      try {
        localStorage.setItem(WELCOME_FAMILY_ID_KEY, code);
        localStorage.setItem(WELCOME_FAMILY_UPDATED_AT_KEY, now);
        localStorage.setItem("aiShieldPrimaryFamilyID", code);
        localStorage.setItem("aiShieldFamilyBindingSource", "welcome");
        localStorage.setItem("aiShieldFamilyBindingUpdatedAt", now);
        localStorage.setItem("aiShieldFamilyBoundAt", now);
      } catch (e) {}

      try {
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
          await chrome.storage.local.set({
            [WELCOME_FAMILY_ID_KEY]: code,
            [WELCOME_FAMILY_UPDATED_AT_KEY]: now,
            aiShieldPrimaryFamilyID: code,
            aiShieldFamilyBindingSource: "welcome",
            aiShieldFamilyBindingUpdatedAt: now,
            aiShieldFamilyBoundAt: now
          });
        }
      } catch (e) {}

      FAMILY_ID = code;
      updateFamilyCodeUI(code);
      if (typeof window.updateCleanFamilyCodeUI === "function") window.updateCleanFamilyCodeUI(code);
      return code;
    }

    function updateFamilyCodeUI(code) {
      const safeCode = normalizeFamilyCode(code);
      const hasCode = safeCode.length === 6 && !isBlockedDemoFamilyID(safeCode);
      const text = hasCode ? safeCode : "尚未綁定";
      document.querySelectorAll("#familyCodeText").forEach(el => { el.textContent = text; });

      // 首頁家庭連線區：沒有代碼時一定保留「建立 / 輸入 / 確認連線」；
      // 已連線後才收起輸入區，避免從 blocked 返回首頁又看起來像斷線。
      const boundPanel = $("familyBoundPanel");
      const joinPanel = $("familyJoinPanel");
      const showJoinBtn = $("showJoinFamilyBtn");
      const input = $("familyCodeInput");
      const statusText = $("familyJoinStatusText");

      if (boundPanel) boundPanel.hidden = !hasCode;
      if (showJoinBtn) showJoinBtn.hidden = !hasCode;
      if (joinPanel) {
        if (!hasCode) {
          joinPanel.hidden = false;
          joinPanel.dataset.userOpened = "1";
        } else if (joinPanel.dataset.userOpened !== "1") {
          joinPanel.hidden = true;
        }
      }
      if (input && hasCode && !input.value) input.value = safeCode;
      if (statusText) {
        statusText.textContent = hasCode
          ? "已連線家庭守護；高風險提醒會自動同步家人與家庭戰情室。"
          : "可以建立新的家庭代碼，也可以輸入家人給的 6 碼代碼。";
      }
    }


    const screens = ["home", "scan", "result", "family", "education"];

    // 優先讀取 config.js 中的配置，保持架構一致性
    const API_BASE_URL = (
      window.CONFIG?.API_BASE_URL ||
      "https://ai-anti-scam.onrender.com"
    ).replace(/\/+$/, "");
    const OFFICIAL_165_URL = "https://165.npa.gov.tw/#/";

    let FAMILY_ID = "";
const REQUEST_TIMEOUT_MS = 60000;
const MAX_FAMILY_RECORDS = 50;

    function trimFamilyRecordsInMemory() {
      if (Array.isArray(scanRecords) && scanRecords.length > MAX_FAMILY_RECORDS) {
        scanRecords.splice(MAX_FAMILY_RECORDS);
      }
    }

    const demoResults = {
      high: {
        score: 92,
        level: "高風險",
        kind: "high",
        summary: "偵測到補繳費用、立即操作與索取信用卡資料等高風險特徵。",
        reason: "對方要求立即補繳運費，並引導輸入信用卡資料，符合常見釣魚詐騙流程。",
        advice: "不要點擊連結、不要輸入信用卡或驗證碼，先透過官方 App 或 165 查證。",
        tags: ["立即補繳", "信用卡資料", "逾期壓力", "疑似釣魚連結"],
        caseText: "檢查完成後會顯示相似案例。",
        similarity: "--",
        source: "小守護基本提醒",
        family: "使用者的裝置偵測到疑似物流補繳詐騙，風險分數 92/100。請提醒使用者不要點擊連結或輸入資料。"
      },
      mid: {
        score: 58,
        level: "中風險",
        kind: "mid",
        summary: "偵測到投資邀請與高報酬暗示，需要進一步查證來源。",
        reason: "訊息包含投資群組、老師帶單與獲利暗示，雖未要求立即匯款，但已出現投資詐騙常見話術。",
        advice: "不要加入陌生投資群組，不要提供個資或匯款，先確認對方身分與合法資訊。",
        tags: ["投資群組", "老師帶單", "獲利暗示"],
        caseText: "假投資老師邀請加入 LINE 群組，逐步引導儲值或匯款。",
        similarity: "74%",
        source: "小守護基本提醒",
        family: "使用者的裝置偵測到可疑投資訊息，風險分數 58/100。建議先查證，不要加入陌生投資群組。"
      },
      low: {
        score: 16,
        level: "低風險",
        kind: "low",
        summary: "目前未偵測到明顯詐騙特徵，仍建議保持一般警覺。",
        reason: "內容未出現付款、驗證碼、帳戶凍結、限時壓力或異常連結等主要風險訊號。",
        advice: "可正常瀏覽，但只要出現要求輸入個資、信用卡或驗證碼，仍應重新檢查。",
        tags: ["一般內容", "未命中高風險詞"],
        caseText: "一般網站瀏覽與普通訊息，未符合常見詐騙案例。",
        similarity: "18%",
        source: "小守護基本提醒",
        family: "使用者的裝置完成安全檢查，風險分數 16/100，目前未偵測到明顯詐騙特徵。"
      }
    };

    let latestResult = demoResults.high;

    // 全域動態紀錄陣列：正式展示版不再預載假資料。
    // 來源改為 /api/get_alerts 的雲端家庭戰情紀錄；沒有資料時顯示 0。
    const scanRecords = [];
    const homeSessionStats = { scans: 0, high: 0 };
    let cloudSyncState = {
      status: "idle",
      message: "尚未同步",
      lastSyncedAt: 0
    };


    /* === MERGED GUARD 20260611：清除紀錄防回流，不影響 165 官方連結 ===
       重點：
       1) 清除後先記住本機清除時間。
       2) 之後 /api/get_alerts 拉回雲端資料時，會過濾清除前的舊紀錄。
       3) 同時仍保留 /api/clear_alerts，讓後端有機會真正刪除雲端資料。
    */
    const MOBILE_LOCAL_CLEAR_AFTER_PREFIX = "aiShieldMobileClearAfter:";
    const MOBILE_LOCAL_CLEAR_AFTER_LEGACY_PREFIX = "aiShieldMobileLocalClearAfter:";

    function getMobileLocalClearKeys(familyID) {
      const code = normalizeFamilyCode(familyID || FAMILY_ID || getFamilyID());
      if (!code) return [];
      return [
        MOBILE_LOCAL_CLEAR_AFTER_PREFIX + code,
        MOBILE_LOCAL_CLEAR_AFTER_LEGACY_PREFIX + code,
        "aiShieldMobileLastLocalClearAt"
      ];
    }

    function setMobileLocalClearAfter(familyID, timestamp = Date.now()) {
      const code = normalizeFamilyCode(familyID || FAMILY_ID || getFamilyID());
      if (!code) return 0;
      const value = String(Number(timestamp) || Date.now());
      const keys = getMobileLocalClearKeys(code);
      try {
        keys.forEach(key => localStorage.setItem(key, value));
      } catch (e) {}
      try {
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
          const payload = {};
          keys.forEach(key => { payload[key] = value; });
          chrome.storage.local.set(payload);
        }
      } catch (e) {}
      return Number(value) || 0;
    }

    function getMobileLocalClearAfter(familyID) {
      const keys = getMobileLocalClearKeys(familyID);
      let latest = 0;
      for (const key of keys) {
        try {
          latest = Math.max(latest, Number(localStorage.getItem(key) || 0) || 0);
        } catch (e) {}
      }
      return latest;
    }

    function parseCloudRecordTimeMs(record = {}) {
      const report = safeJsonParse(record.report) || record.report || {};
      const candidates = [
        record.timestamp,
        record.createdAt,
        record.created_at,
        record.updatedAt,
        record.updated_at,
        record.alert_time,
        record.time,
        report.timestamp,
        report.createdAt,
        report.created_at
      ];
      for (const value of candidates) {
        if (!value) continue;
        if (typeof value === "number") return value > 1000000000000 ? value : value * 1000;
        const text = String(value).trim();
        const parsed = Date.parse(text.includes("T") ? text : text.replace(" ", "T"));
        if (!Number.isNaN(parsed)) return parsed;
      }
      return 0;
    }

    function shouldKeepCloudRecordAfterLocalClear(record = {}, familyID = "") {
      const clearAfter = getMobileLocalClearAfter(familyID);
      if (!clearAfter) return true;
      const recordTime = parseCloudRecordTimeMs(record);
      // 清除後，沒有時間戳的雲端舊資料也先不顯示，避免清完又被拉回來。
      if (!recordTime) return false;
      return recordTime > clearAfter;
    }

    window.setMobileLocalClearAfter = setMobileLocalClearAfter;
    window.getMobileLocalClearAfter = getMobileLocalClearAfter;

    // 前端 PII 個資脫敏遮罩函數
    function maskPersonalData(text) {
      let masked = text;
      // 1. 遮罩台灣手機號碼 (09xx-xxx-xxx)
      masked = masked.replace(/(09\d{2})[-_ ]?(\d{3})[-_ ]?(\d{3})/g, "$1-***-***");
      // 2. 遮罩 16 碼信用卡號
      masked = masked.replace(/\d{4}[-_ ]?\d{4}[-_ ]?\d{4}[-_ ]?\d{4}/g, "****-****-****-****");
      // 3. 遮罩中華民國身分證字號
      masked = masked.replace(/[A-Z][12]\d{8}/g, (match) => match.slice(0, 3) + "*******");
      return masked;
    }

    function updateClock() {
      const clockEl = $("clock");
      if (!clockEl) return;
      const now = new Date();
      clockEl.textContent = now.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false });
    }
    updateClock();
    setInterval(updateClock, 1000 * 30);
    updateHomeCounters();

    function go(screen) {
      if (typeof window.aiShieldMarkCurrentScreen === "function") window.aiShieldMarkCurrentScreen(screen);
      // 強制切換頁面：避免結果頁卡在檢查頁下面沒有消失
      screens.forEach(name => {
        const el = $("screen-" + name);
        if (!el) return;

        const isActive = name === screen;
        el.classList.toggle("active", isActive);
        el.hidden = !isActive;
        el.style.display = isActive ? "block" : "none";
        el.setAttribute("aria-hidden", isActive ? "false" : "true");
      });

      document.querySelectorAll(".nav-btn").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.screen === screen);
      });

      const area = document.querySelector(".screen-area");
      if (area) area.scrollTop = 0;

      // 離開結果頁時，把結果區塊再保險隱藏一次
      if (screen !== "result") {
        const resultScreen = $("screen-result");
        if (resultScreen) {
          resultScreen.classList.remove("active");
          resultScreen.hidden = true;
          resultScreen.style.display = "none";
          resultScreen.setAttribute("aria-hidden", "true");
        }
      }

      if (screen === "home" || screen === "family") {
        if (typeof renderAppFamilyDashboard === "function") renderAppFamilyDashboard();
      }
    }

    function getNowLabel() {
      return new Date().toLocaleString("zh-TW", { hour12: false });
    }

    function updateHomeCounters() {
      const highCount = scanRecords.filter(item => item.kind === "high" || Number(item.score || 0) >= 70).length;
      const totalCount = scanRecords.length || homeSessionStats.scans;
      if ($("homeScanCount")) $("homeScanCount").textContent = totalCount;
      if ($("homeHighCount")) $("homeHighCount").textContent = scanRecords.length ? highCount : homeSessionStats.high;

      const syncStatus = $("homeSyncStatus");
      if (syncStatus) {
        syncStatus.textContent = cloudSyncState.message || "雲端同步";
      }
    }

    function setCloudSyncStatus(status, message) {
      cloudSyncState = {
        status,
        message,
        lastSyncedAt: status === "success" ? Date.now() : cloudSyncState.lastSyncedAt
      };
      const syncStatus = $("homeSyncStatus");
      if (syncStatus) syncStatus.textContent = message;
    }

    function getRecordReportFromCloud(record = {}) {
      return safeJsonParse(record.report) || record.report || {};
    }

    function recordToAppHistoryItem(record = {}) {
      const report = getRecordReportFromCloud(record);
      const score = Number(
        report.riskScore ??
        report.RiskScore ??
        report.risk_score ??
        record.riskScore ??
        record.score ??
        0
      ) || 0;

      const kind = scoreToKind(score);
      const level = String(report.riskLevel || record.riskLevel || scoreToLevel(score));
      const url = String(
        record.url ||
        record.url_preview ||
        report.originalUrl ||
        report.original_url ||
        report.url ||
        record.domain ||
        ""
      );

      const tags = normalizeArray(report.scamDNA || report.scam_dna || record.scamDNA || record.tags);
      const title = `${level}｜${guessRecordTitle(record.masked_text_preview || report.reason || "", url)}`;

      return {
        id: record.id || "cloud_" + Math.random().toString(36).slice(2, 8),
        kind,
        score,
        level,
        title,
        sub: `${url ? "含網址" : "純文字"}｜${tags.slice(0, 2).join("、") || "雲端紀錄"}｜家庭守護紀錄`,
        url,
        text: record.masked_text_preview || report.text || report.message || "",
        tags,
        source: "家庭守護紀錄",
        reason: report.reason || record.reason || "",
        advice: report.advice || record.advice || "",
        screenshot: record.screenshot_base64 || record.screenshot || report.screenshot_base64 || report.screenshot || "",
        rawRecord: record,
        createdAt: formatRecordTime(record.timestamp || record.createdAt || record.created_at)
      };
    }

    function formatRecordTime(value) {
      if (!value) return getNowLabel();
      try {
        const date = new Date(String(value).replace(" ", "T"));
        if (!Number.isNaN(date.getTime())) {
          return date.toLocaleString("zh-TW", { hour12: false });
        }
      } catch (e) {}
      return String(value);
    }

    async function getApiHeadersForFamily(familyID) {
      const headers = { "Content-Type": "application/json" };
      let token = "";

      try {
        token = await ensureDemoAccessToken();
      } catch (e) {
        console.warn("取得 accessToken 失敗：", e);
      }

      if (token) headers.Authorization = `Bearer ${token}`;
      return headers;
    }
    async function ensureAppFamilyMembership(familyID) {
      const code = normalizeFamilyCode(familyID || FAMILY_ID || getFamilyID());
      if (code.length !== 6 || isBlockedDemoFamilyID(code)) return false;

      const previous = normalizeFamilyCode(FAMILY_ID || getFamilyID());
      if (previous && previous !== code) {
        try {
          [
            "aiShieldMobileAccessToken",
            "aiShieldAccessToken",
            "accessToken",
            "aiShieldMobileTokenExpiresAt",
            "aiShieldTokenExpiresAt",
            "aiShieldMobileTokenFamilyID"
          ].forEach(key => localStorage.removeItem(key));
        } catch (e) {}
      }

      await saveFamilyID(code);

      // 正式版：後端沒有 /api/join_family。
      // 家庭連線只透過 /api/auth/install 建立此 familyID 對應的 accessToken。
      try {
        await ensureDemoAccessToken({ forceRefresh: true, familyID: code });
        setFamilySetupStatus(`已連線家庭代碼：${code}`, "success");
        return true;
      } catch (error) {
        console.warn("家庭權杖建立失敗，已保留家庭代碼：", error);
        setFamilySetupStatus("已儲存家庭代碼；雲端連線稍後會再同步。", "success");
        return true;
      }
    }

    async function refreshCloudDashboardRecords(options = {}) {
      clearBlockedDemoFamilyIDs();
      const familyID = normalizeFamilyCode(FAMILY_ID || getFamilyID());

      if (familyID.length !== 6 || isBlockedDemoFamilyID(familyID)) {
        scanRecords.length = 0;
        setCloudSyncStatus("idle", "尚未綁定");
        renderHistory();
        updateHomeCounters();
        if (typeof renderAppFamilyDashboard === "function") renderAppFamilyDashboard();
        return;
      }

      setCloudSyncStatus("loading", "雲端同步中");

      try {
        if (options.ensureMembership === true && manualFamilyActionInProgress) {
          await ensureAppFamilyMembership(familyID);
        }

        const response = await fetchWithTimeout(`${API_BASE_URL}/api/get_alerts`, {
          method: "POST",
          headers: await getApiHeadersForFamily(familyID),
          body: JSON.stringify({ family_id: familyID, familyID, familyId: familyID })
        }, REQUEST_TIMEOUT_MS);

        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.status !== "success") {
          throw new Error(data.message || `讀取戰情紀錄失敗 (${response.status})`);
        }

        const records = Array.isArray(data.data) ? data.data : [];
        scanRecords.length = 0;
        records
          .filter(record => shouldKeepCloudRecordAfterLocalClear(record, familyID))
          .map(recordToAppHistoryItem)
          .slice(0, MAX_FAMILY_RECORDS)
          .forEach(item => scanRecords.push(item));

        const nowLabel = new Date().toLocaleTimeString("zh-TW", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false
        });
        setCloudSyncStatus("success", `已同步 ${nowLabel}`);
        renderHistory();
        updateHomeCounters();
        if (typeof renderAppFamilyDashboard === "function") renderAppFamilyDashboard();
      } catch (error) {
        console.warn("家庭守護紀錄同步失敗：", error);
        scanRecords.length = 0;
        setCloudSyncStatus("error", "同步失敗");
        renderHistory();
        updateHomeCounters();
        if (typeof renderAppFamilyDashboard === "function") renderAppFamilyDashboard();
      }
    }

    function createRecordFromResult(result, input = {}) {
      const score = Number(result.score || 0);
      const level = result.level || (score >= 70 ? "高風險" : score >= 40 ? "中風險" : "低風險");
      return {
        id: "scan_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8),
        kind: result.kind || scoreToKind(score),
        score,
        level,
        title: input.title || `${level}｜${guessRecordTitle(input.text, input.url)}`,
        sub: buildRecordSub(result, input),
        url: input.url || "",
        text: input.text || "",
        tags: Array.isArray(result.tags) ? result.tags : [],
        source: result.source || "小守護基本提醒",
        reason: result.reason || "",
        advice: result.advice || "",
        family: result.family || "",
        createdAt: getNowLabel()
      };
    }

    function buildRecordSub(result, input = {}) {
      const tags = Array.isArray(result.tags) ? result.tags.slice(0, 2).join("、") : "";
      const source = result.source || "小守護基本提醒";
      const hasUrl = input.url ? "含網址" : "純文字";
      return `${hasUrl}｜${tags || "未命中明確標籤"}｜${source}`;
    }

    function guessRecordTitle(text = "", url = "") {
      const source = `${text}\n${url}`.toLowerCase();
      if (/包裹|物流|運費|parcel|delivery/.test(source)) return "包裹補繳運費";
      if (/投資|股票|飆股|老師|群組/.test(source)) return "投資群組邀請";
      if (/驗證碼|otp|帳戶|凍結/.test(source)) return "帳戶安全驗證";
      if (url) return "可疑網址檢查";
      return "可疑訊息檢查";
    }

    function addScanRecord(result, input = {}) {
      const record = createRecordFromResult(result, input);
      scanRecords.unshift(record);
      trimFamilyRecordsInMemory();
      homeSessionStats.scans += 1;
      if (record.kind === "high") homeSessionStats.high += 1;
      renderHistory();
      updateHomeCounters();
    }

    function scoreToKind(score) {
      if (score >= 70) return "high";
      if (score >= 40) return "mid";
      return "low";
    }

    function scoreToLevel(score) {
      if (score >= 70) return "高風險";
      if (score >= 40) return "中風險";
      return "低風險";
    }

    function classifyInput(text, url) {
      if (window.AppRiskEngine && typeof window.AppRiskEngine.analyzeText === "function") {
        try {
          const analyzed = window.AppRiskEngine.analyzeText(text || "", { url: url || "" });
          const score = Number(analyzed.score || 0);
          const kind = scoreToKind(score);
          const template = kind === "high" ? demoResults.high : kind === "mid" ? demoResults.mid : demoResults.low;
          return {
            ...template,
            score,
            kind,
            level: analyzed.level || scoreToLevel(score),
            summary: score >= 70 ? "小守護提醒：這則內容很危險，請先不要操作。" : score >= 40 ? "小守護提醒：這則內容有可疑訊號，建議先問家人。" : "小守護目前沒有看到明顯危險訊號。",
            reason: analyzed.reason || template.reason,
            advice: analyzed.advice || template.advice,
            tags: Array.isArray(analyzed.scamDNA) && analyzed.scamDNA.length ? analyzed.scamDNA : template.tags,
            source: "小守護本機風險引擎",
            family: `使用者的裝置完成本機風險檢查，風險分數 ${score}/100。${score >= 70 ? "請提醒使用者不要點擊連結或輸入資料。" : score >= 40 ? "建議先查證來源，不要急著操作。" : "目前未偵測到明顯詐騙特徵。"}`
          };
        } catch (e) {
          console.warn("本機風險引擎失敗，改用基本關鍵字分類：", e);
        }
      }

      const source = `${text || ""}
${url || ""}`.toLowerCase();
      let result;

      if (/信用卡|驗證碼|補繳|運費|凍結|立即|逾期|cvv|otp|匯款|轉帳|帳戶/.test(source)) {
        result = { ...demoResults.high };
      } else if (/投資|飆股|老師|群組|獲利|保證|穩賺|內線/.test(source)) {
        result = { ...demoResults.mid };
      } else {
        result = { ...demoResults.low };
      }

      result.source = "小守護基本提醒";
      return result;
    }

    function safeJsonParse(value) {
      if (!value) return null;
      if (typeof value === "object") return value;
      try { return JSON.parse(value); } catch (e) { return null; }
    }

    function normalizeArray(value) {
      if (Array.isArray(value)) return value.filter(Boolean).map(String);
      if (typeof value === "string" && value.trim()) {
        return value.split(/[、,，;；\n]/).map(item => item.trim()).filter(Boolean);
      }
      return [];
    }

    function normalizeApiResult(data, input = {}) {
      const report = safeJsonParse(data?.report) || safeJsonParse(data?.result) || data?.report || data?.result || data || {};
      const score = Math.max(0, Math.min(100, Number(report.riskScore ?? report.RiskScore ?? report.risk_score ?? report.score ?? data?.riskScore ?? data?.score ?? 0)));
      const kind = scoreToKind(score);
      const level = String(report.riskLevel || report.risk_level || data?.riskLevel || data?.risk_level || scoreToLevel(score));

      const tags = normalizeArray(report.scamDNA || report.scam_dna || report.tags || report.matchedKeywords || report.matched_keywords || report.keywords || data?.scamDNA || data?.tags);
      const similarCases = data?.similarCases || data?.similar_cases || report?.similarCases || report?.similar_cases || [];
      const firstCase = Array.isArray(similarCases) && similarCases.length ? similarCases[0] : null;

      return {
        score,
        level,
        kind,
        summary: score >= 70 ? "小守護提醒：這則訊息很危險，請先不要操作。" : score >= 40 ? "小守護提醒：這則訊息有點可疑，建議先問家人。" : "小守護目前沒有看到明顯危險訊號。",
        reason: String(report.reason || report.ai_reason || data?.reason || "小安心已完成檢查，但沒有取得詳細原因。"),
        advice: String(report.advice || data?.advice || (score >= 70 ? "請立即停止操作，不要輸入個資、信用卡、驗證碼或匯款。" : score >= 40 ? "建議先查證來源，不要提供個資或金流資料。" : "目前未發現明顯高風險特徵，仍請保持警覺。")),
        tags: tags.length ? tags.slice(0, 6) : [score >= 70 ? "高風險訊號" : score >= 40 ? "可疑訊號" : "未命中高風險詞"],
        caseText: firstCase?.title || firstCase?.type || report.caseText || "目前沒有相似案例，已顯示小守護判斷摘要。",
        similarity: firstCase?.similarity ? `${firstCase.similarity}` : "--",
        source: "防護系統",
        family: `使用者的裝置完成雲端檢查，風險分數 ${score}/100。${score >= 70 ? "請提醒使用者不要點擊連結或輸入資料。" : "建議家人協助留意後續操作。"}`
      };
    }

    function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
    }

    function getOrCreateInstallID() {
      const key = "aiShieldMobileInstallId";
      let value = localStorage.getItem(key);
      if (!value) {
        value = "mobile_" + (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now());
        localStorage.setItem(key, value);
      }
      return value;
    }

    function getOrCreateUserID() {
      const key = "aiShieldMobileUserId";
      let value = localStorage.getItem(key);
      if (!value) {
        value = "MOBILE_USER_" + Math.random().toString(36).slice(2, 10).toUpperCase();
        localStorage.setItem(key, value);
      }
      return value;
    }
    async function ensureDemoAccessToken(options = {}) {
      const tokenKey = "aiShieldMobileAccessToken";
      const expiresKey = "aiShieldMobileTokenExpiresAt";
      const familyKey = "aiShieldMobileTokenFamilyID";
      const familyID = normalizeFamilyCode(options.familyID || FAMILY_ID || getFamilyID());
      const token = localStorage.getItem(tokenKey) || "";
      const expiresAt = Number(localStorage.getItem(expiresKey) || 0);
      const tokenFamilyID = normalizeFamilyCode(localStorage.getItem(familyKey));
      const now = Math.floor(Date.now() / 1000);

      if (!options.forceRefresh && token && expiresAt && expiresAt - now > 300 && tokenFamilyID === familyID) {
        return token;
      }

      if (token && tokenFamilyID && tokenFamilyID !== familyID) {
        try {
          [tokenKey, "aiShieldAccessToken", "accessToken", expiresKey, "aiShieldTokenExpiresAt", familyKey].forEach(key => localStorage.removeItem(key));
        } catch (e) {}
      }

      const response = await fetchWithTimeout(`${API_BASE_URL}/api/auth/install`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          installID: getOrCreateInstallID(),
          userID: getOrCreateUserID(),
          family_id: familyID,
          familyID,
          familyId: familyID,
          source: "mobile_app",
          scan_source: "mobile_app",
          demoMode: false,
          suppressLine: false,
          suppressLineAlert: false,
          allowLinePush: true
        })
      }, REQUEST_TIMEOUT_MS);

      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.accessToken) throw new Error(data.message || data.error || "無法取得短效權杖");

      const expires = String(data.expiresAt || data.expires_at || (now + 3600));
      localStorage.setItem(tokenKey, data.accessToken);
      localStorage.setItem("aiShieldAccessToken", data.accessToken);
      localStorage.setItem("accessToken", data.accessToken);
      localStorage.setItem(expiresKey, expires);
      localStorage.setItem("aiShieldTokenExpiresAt", expires);
      localStorage.setItem(familyKey, familyID);
      return data.accessToken;
    }

    async function scanWithCloudApi(text, url) {
      let token = "";
      try { token = await ensureDemoAccessToken(); } catch (e) { console.warn("App Demo 認證失敗，改走匿名檢查：", e); }

      const headers = { "Content-Type": "application/json" };
      if (token) headers.Authorization = `Bearer ${token}`;

      const response = await fetchWithTimeout(`${API_BASE_URL}/api/scan`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          text,
          url,
          title: "AI 防詐盾牌家庭守護版",
          family_id: normalizeFamilyCode(FAMILY_ID || getFamilyID()),
          familyID: normalizeFamilyCode(FAMILY_ID || getFamilyID()),
          familyId: normalizeFamilyCode(FAMILY_ID || getFamilyID()),
          source: "mobile_app",
          scan_source: "mobile_app",
          demoMode: false,
          suppressLine: false,
          suppressLineAlert: false,
          allowLinePush: true
        })
      }, REQUEST_TIMEOUT_MS);

      const data = await response.json().catch(() => ({}));
      if (response.ok) return normalizeApiResult(data, { text, url });
      throw new Error(data.message || data.error || `HTTP ${response.status}`);
    }

    async function scanContent(text, url) {
      if (FORCE_FALLBACK_MODE) {
        const fallback = classifyInput(text, url);
        fallback.source = "小守護基本提醒模式";
        fallback.summary = `${fallback.summary}（目前使用基本防護模式）`;
        fallback.advice = `${fallback.advice} 網路不穩時，仍可先提供基本提醒。`;
        fallback.errorMessage = "";
        return fallback;
      }

      try {
        return await scanWithCloudApi(text, url);
      } catch (error) {
        const fallback = classifyInput(text, url);
        fallback.source = "小守護基本提醒";
        fallback.summary = `${fallback.summary}（雲端連線不穩，已啟用本機備援）`;
        fallback.advice = `${fallback.advice} 目前網路連線不穩，小守護已先啟用基本提醒。`;
        fallback.errorMessage = error?.name === "AbortError" ? "網路連線逾時" : String(error?.message || error || "雲端錯誤");
        console.warn("App Demo 自動無縫降級至本機分析：", error);
        return fallback;
      }
    }


    function getFriendlyRiskLabel(result = {}) {
      const score = Number(result.score || 0);
      const kind = result.kind || scoreToKind(score);
      if (kind === "high") return "🔴 危險，先不要點";
      if (kind === "mid") return "🟡 有點可疑，先問家人";
      return "🟢 目前看起來安全";
    }

    function getFriendlyScoreText(result = {}) {
      const score = Number(result.score || 0);
      return `${score}<span> 分</span>`;
    }

    function renderTags(tags, kind) {
      const box = $("tagList");
      if (!box) return;

      box.replaceChildren();

      const safeTags = Array.isArray(tags) && tags.length
        ? tags
        : [kind === "high" ? "高風險訊號" : kind === "mid" ? "可疑訊號" : "未命中高風險詞"];

      safeTags.forEach(text => {
        const tag = document.createElement("span");
        tag.className = "tag" + (kind === "high" ? " danger" : "");
        tag.textContent = String(text || "未知特徵");
        box.appendChild(tag);
      });
    }

    function renderResult(result, options = {}) {
      latestResult = result;

      $("resultHero").className = "result-hero " + result.kind;
      $("riskLevel").className = "risk-level " + result.kind;
      $("riskLevel").textContent = getFriendlyRiskLabel(result);
      $("riskScore").className = "score " + result.kind;
      $("riskScore").innerHTML = getFriendlyScoreText(result);
      $("resultSummary").textContent = result.summary;
      updateAppModeUI();
      startAntiScamTipCarousel();
      if ($("modeText")) $("modeText").textContent = result.source || getModeLabel();
      $("reasonText").textContent = result.reason;
      $("adviceText").textContent = result.advice;
      $("caseText").textContent = result.caseText;
      $("caseSimilarity").textContent = result.similarity;
      if ($("familyMessage")) $("familyMessage").textContent = result.family || "";
      $("resultIcon").style.display = result.kind === "low" ? "none" : "inline-block";

      // 渲染技術日誌與分析來源標籤
      if (result.errorMessage) {
        $("analysisSource").textContent = "小守護基本提醒";
      } else {
        $("analysisSource").textContent = result.source || getModeLabel();
      }

      renderTags(result.tags || [], result.kind);
      renderHistory();

      if (options.autoVoice && result.kind === "high") {
        setTimeout(() => playBilingualWarning({ silent: true }), 250);
      }
    }

    function setSample(type) {
      const reviewerSamples = {
        high: {
          url: "https://parcel-pay.example.com",
          message: "您的包裹配送失敗，請立即補繳運費並輸入信用卡資料，逾期將退回。"
        },
        mid: {
          url: "",
          message: "某知名投資老師開放內部群組名額，保證獲利、尾盤主力內線，想了解請加入 LINE VIP 飆股群。"
        },
        low: {
          url: "https://www.gov.tw",
          message: "這是一則一般活動通知，請至官方網站查看活動時間與地點。"
        },
        parcel: {
          url: "https://post-gov-tw.pay-check.example.top",
          message: "您的包裹配送失敗，今日 18:00 前請立即補繳運費，並輸入信用卡卡號與簡訊驗證碼。"
        },
        invest: {
          url: "https://line-invest-safe.example.net/join",
          message: "老師帶單保證獲利，今晚尾盤拉抬主力內線，加入 VIP 飆股群，先用 USDT 入金即可領申購抽籤必中名額。"
        },
        police: {
          url: "https://gov-check.example.org/account",
          message: "您涉嫌洗錢，檢察官要求帳戶監管，偵查不公開，請不要告訴家人並提供驗證碼。"
        },
        bill: {
          url: "https://tw-power-pay.example.click",
          message: "您的電費未繳，今日不處理將斷電，請立即點擊連結完成付款。"
        },
        official: {
          url: "https://165.npa.gov.tw",
          message: "這是 165 官方防詐宣導，提醒民眾不要點擊可疑連結。"
        },
        normal: {
          url: "",
          message: "今天晚上要不要一起吃飯？我們可以約 6 點半。"
        }
      };

      const sample = reviewerSamples[type] || reviewerSamples.low;
      $("targetUrl").value = sample.url;
      $("message").value = sample.message;
    }

    function speak(text) {
      if (!("speechSynthesis" in window)) { alert("這台裝置不支援語音播放。"); return; }
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = "zh-TW";
      utter.rate = 0.9;
      speechSynthesis.cancel();
      speechSynthesis.speak(utter);
    }

    function playBilingualWarning(options = {}) {
      const fallbackText = "小守護提醒您，這個內容可能是詐騙。請先不要操作，不要輸入信用卡、驗證碼，也不要匯款，先問家人確認。";
      const audio = $("bilingualWarningAudio");
      if (!audio || !audio.getAttribute("src")) { speak(fallbackText); return; }
      try { speechSynthesis.cancel(); } catch (e) {}
      audio.currentTime = 0;
      const playPromise = audio.play();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch(() => { speak(fallbackText); });
      }
    }

    function renderHistory() {
      const list = $("historyList");
      if (!list) {
        // 記錄頁已移除：所有紀錄統一顯示在家人／家庭戰情室。
        return;
      }
      list.replaceChildren();

      if (!scanRecords.length) {
        const empty = document.createElement("div");
        empty.className = "empty-state";
        empty.textContent = "尚無任何檢查紀錄。";
        list.appendChild(empty);
        return;
      }

      scanRecords.forEach(item => {
        const row = document.createElement("div");
        row.className = "history-item";
        const icon = item.kind === "low" ? "✓" : item.kind === "mid" ? "?" : "!";
        row.innerHTML = `
          <div class="history-icon ${item.kind}">${icon}</div>
          <div><div class="history-title"></div><div class="history-sub"></div></div>
          <div class="history-score">${item.score}</div>
        `;
        row.querySelector(".history-title").textContent = item.title;
        row.querySelector(".history-sub").textContent = `${item.createdAt}｜${item.sub}`;
        row.addEventListener("click", () => showFamilyRecordDetail(item));
        list.appendChild(row);
      });
    }

    // ==========================================
// ✅ 雙重保險版：一鍵貼上功能
// ==========================================
async function pasteFromClipboard() {
  const messageBox = document.getElementById("message");
  if (!messageBox) return;

  try {
    // 嘗試使用現代的剪貼簿 API
    if (navigator.clipboard && navigator.clipboard.readText) {
      const text = await navigator.clipboard.readText();
      if (text && text.trim() !== "") {
        messageBox.value = text.trim();
        messageBox.focus(); // 貼上後讓畫面自動跳到輸入框
        return;
      } else {
        alert("剪貼簿目前沒有文字喔！請先複製可疑訊息。");
        return;
      }
    } else {
      // 如果手機不支援 (走到這裡)
      triggerManualPaste(messageBox);
    }
  } catch (error) {
    // 如果被手機安全機制阻擋 (走到這裡)
    triggerManualPaste(messageBox);
  }
}

// 備用方案：引導長輩手動貼上
function triggerManualPaste(inputEl) {
  inputEl.focus(); // 自動幫長輩把游標點進格子裡
  alert("因為手機安全限制，請直接在輸入框【長按】並選擇【貼上】喔！");
}

// ==========================================
// 💡 最重要的一步：把按鈕和功能綁定在一起！
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
  // 請確認你的「一鍵貼上按鈕」的 ID 叫做 pasteBtn，如果不是，請改掉下面的 "pasteBtn"
  const myPasteButton = document.getElementById("pasteBtn"); 
  if (myPasteButton) {
    myPasteButton.addEventListener("click", pasteFromClipboard);
  }
});

    function clearScanInputs() {
      clearVoiceAutoScanTimer();
      if ($("targetUrl")) $("targetUrl").value = "";
      if ($("message")) {
        $("message").value = "";
        $("message").focus();
      }
      setVoiceInputStatus("", "idle");
    }

    let voiceRecognition = null;
    let voiceListening = false;
    let voiceFinalText = "";
    let voiceAutoScanTimer = null;

    function clearVoiceAutoScanTimer() {
      if (voiceAutoScanTimer) {
        clearInterval(voiceAutoScanTimer);
        voiceAutoScanTimer = null;
      }
    }

    function getSpeechRecognitionConstructor() {
      return window.SpeechRecognition || window.webkitSpeechRecognition || null;
    }

    function setVoiceInputStatus(message = "", type = "info") {
      const el = $("voiceInputStatus");
      if (!el) return;
      if (!message) {
        el.style.display = "none";
        el.textContent = "";
        el.className = "notice";
        return;
      }
      el.style.display = "block";
      el.textContent = String(message);
      el.className = "notice";
      if (type === "error") {
        el.style.background = "#fee2e2";
        el.style.borderColor = "#fecaca";
        el.style.color = "#991b1b";
      } else if (type === "success") {
        el.style.background = "#dcfce7";
        el.style.borderColor = "#86efac";
        el.style.color = "#166534";
      } else {
        el.style.background = "#fff8e6";
        el.style.borderColor = "#ffe0a3";
        el.style.color = "#7a4b00";
      }
    }

    function updateVoiceButtons(listening = false) {
      const startBtn = $("voiceInputBtn");
      const stopBtn = $("stopVoiceInputBtn");
      if (startBtn) {
        startBtn.disabled = listening;
        startBtn.textContent = listening ? "🎙️ 正在聆聽..." : "🎙️ 用說的檢查";
      }
      if (stopBtn) stopBtn.style.display = listening ? "block" : "none";
    }

    function stopVoiceInput() {
      clearVoiceAutoScanTimer();
      try {
        if (voiceRecognition && voiceListening) voiceRecognition.stop();
      } catch (e) {}
      voiceListening = false;
      updateVoiceButtons(false);
    }

    function startVoiceInput() {
      const Recognition = getSpeechRecognitionConstructor();
      const messageBox = $("message");
      if (!Recognition || !messageBox) {
        setVoiceInputStatus("這台裝置目前不支援語音輸入，請改用貼上文字檢查。", "error");
        return;
      }

      try {
        clearVoiceAutoScanTimer();
        stopVoiceInput();
        voiceFinalText = "";
        const recognition = new Recognition();
        voiceRecognition = recognition;
        recognition.lang = "zh-TW";
        recognition.continuous = false;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;

        recognition.onstart = () => {
          voiceListening = true;
          updateVoiceButtons(true);
          setVoiceInputStatus("請開始說出可疑訊息，例如：有人叫我去 ATM 解除分期，是真的嗎？", "info");
        };

        recognition.onresult = (event) => {
          let interimText = "";
          for (let i = event.resultIndex; i < event.results.length; i += 1) {
            const transcript = event.results[i][0]?.transcript || "";
            if (event.results[i].isFinal) voiceFinalText += transcript;
            else interimText += transcript;
          }
          const combined = (voiceFinalText || interimText).trim();
          if (combined) {
            messageBox.value = combined;
            setVoiceInputStatus(`小守護聽到：${combined}`, "info");
          }
        };

        recognition.onerror = (event) => {
          voiceListening = false;
          updateVoiceButtons(false);
          const code = String(event?.error || "");
          const friendly = code === "not-allowed"
            ? "瀏覽器沒有允許麥克風權限，請改用貼上文字，或重新允許麥克風。"
            : code === "no-speech"
              ? "剛剛沒有聽到聲音，請靠近手機再試一次。"
              : "語音輸入暫時失敗，請改用文字輸入。";
          setVoiceInputStatus(friendly, "error");
        };

        recognition.onend = () => {
          voiceListening = false;
          updateVoiceButtons(false);
          const finalText = (voiceFinalText || messageBox.value || "").trim();
          if (!finalText) {
            setVoiceInputStatus("沒有取得語音內容，請再試一次或改用貼上文字。", "error");
            return;
          }
          messageBox.value = finalText;
          clearVoiceAutoScanTimer();

          let countdown = 3;
          setVoiceInputStatus(`聽到了！${countdown} 秒後自動檢查。若文字不對，請按「清除」或重新按麥克風。`, "success");

          voiceAutoScanTimer = setInterval(() => {
            countdown -= 1;
            if (countdown > 0) {
              setVoiceInputStatus(`聽到了！${countdown} 秒後自動檢查。若文字不對，請按「清除」或重新按麥克風。`, "success");
              return;
            }

            clearVoiceAutoScanTimer();
            const btn = $("scanBtn");
            const currentText = messageBox.value.trim();
            if (btn && !btn.disabled && !voiceListening && currentText === finalText) btn.click();
          }, 1000);
        };

        recognition.start();
      } catch (error) {
        voiceListening = false;
        updateVoiceButtons(false);
        console.warn("語音輸入啟動失敗：", error);
        setVoiceInputStatus("語音輸入無法啟動，請改用貼上文字檢查。", "error");
      }
    }

    function setupVoiceInputAvailability() {
      const startBtn = $("voiceInputBtn");
      const stopBtn = $("stopVoiceInputBtn");
      if (!startBtn) return;
      if (!getSpeechRecognitionConstructor()) {
        startBtn.style.display = "none";
        if (stopBtn) stopBtn.style.display = "none";
        setVoiceInputStatus("這台裝置不支援語音輸入，仍可用貼上文字檢查。", "info");
        return;
      }
      startBtn.addEventListener("click", startVoiceInput);
      if (stopBtn) stopBtn.addEventListener("click", stopVoiceInput);
    }


    const antiScamTips = [
      ["guardian","🛡️ 小守護提醒","基本防詐","驗證碼、OTP、簡訊碼，不要提供給任何人。"],
      ["guardian","🛡️ 小守護提醒","解除分期","ATM 無法解除分期付款，客服要求操作 ATM 請立刻停下來。"],
      ["guardian","🛡️ 小守護提醒","假客服","假冒銀行、電商、物流客服，常會要求你操作網銀或 ATM。"],
      ["guardian","🛡️ 小守護提醒","假檢警","警察、檢察官不會要求你把錢匯到監管帳戶。"],
      ["guardian","🛡️ 小守護提醒","假檢警","對方說偵查不公開、不能告訴家人，通常就是詐騙話術。"],
      ["guardian","🛡️ 小守護提醒","投資詐騙","保證獲利、穩賺不賠、老師帶單，請提高警覺。"],
      ["guardian","🛡️ 小守護提醒","投資詐騙","飆股群組、主力內線、VIP 明牌，常是詐騙集團包裝。"],
      ["guardian","🛡️ 小守護提醒","ETF 詐騙","高股息 ETF 申購、保證配息，請先查證官方來源。"],
      ["guardian","🛡️ 小守護提醒","虛擬貨幣","要求買 USDT 入金投資，請先確認平台是否真實合法。"],
      ["guardian","🛡️ 小守護提醒","出金詐騙","出金前要求繳保證金、稅金、解凍費，多半是詐騙。"],
      ["guardian","🛡️ 小守護提醒","遠端控制","陌生人要求安裝 AnyDesk、TeamViewer 遠端控制，請拒絕。"],

      ["latest","🚨 最新詐騙","LINE 陷阱","LINE 投票連結、活動連結，可能導致帳號被盜。"],
      ["latest","🚨 最新詐騙","LINE 陷阱","LINE 好友突然借錢，請先打電話確認本人。"],
      ["latest","🚨 最新詐騙","LINE 陷阱","LINE 客服不會主動要求你提供驗證碼或密碼。"],
      ["latest","🚨 最新詐騙","LINE 陷阱","陌生 LINE 投資群組邀請，請不要急著加入。"],
      ["latest","🚨 最新詐騙","Facebook","臉書假包裹通知近期常見，看到補繳運費連結請勿點擊。"],
      ["latest","🚨 最新詐騙","Facebook","Facebook 社團低價商品、限時特賣，請先查證賣家。"],
      ["latest","🚨 最新詐騙","Facebook","臉書假冒品牌特賣會，常用超低價引導付款。"],
      ["latest","🚨 最新詐騙","Facebook","Facebook 廣告連結不一定安全，付款前請先看網址。"],
      ["latest","🚨 最新詐騙","包裹詐騙","包裹卡關、補繳運費、海關補稅，請先到官方平台查詢。"],
      ["latest","🚨 最新詐騙","包裹詐騙","假黑貓宅急便、假中華郵政簡訊，常會誘導輸入信用卡。"],
      ["latest","🚨 最新詐騙","包裹詐騙","超商取貨異常連結請勿亂點，先開官方 App 查詢。"],
      ["latest","🚨 最新詐騙","政府補助","普發現金、退稅、補助申請連結，請先確認是否為政府官方網址。"],

      ["game","🎮 遊戲充值提醒","遊戲詐騙","免費送點數、免費抽造型，多半是盜帳號陷阱。"],
      ["game","🎮 遊戲充值提醒","遊戲詐騙","遊戲代儲請找官方管道，低價代儲可能導致帳號被盜。"],
      ["game","🎮 遊戲充值提醒","遊戲詐騙","不要把遊戲帳號、密碼、驗證碼交給代儲賣家。"],
      ["game","🎮 遊戲充值提醒","遊戲詐騙","陌生人說要送虛寶、送點數，請先確認來源。"],
      ["game","🎮 遊戲充值提醒","遊戲交易","私下買賣遊戲帳號、道具，容易遇到收錢不給貨。"],
      ["game","🎮 遊戲充值提醒","兒少防詐","孩子要儲值遊戲前，請先和家人確認付款方式。"],

      ["latest","🚨 最新詐騙","AI 換臉","視訊看到親友也不一定是真的，借錢請先電話確認。"],
      ["latest","🚨 最新詐騙","AI 換聲","AI 已能模仿聲音，親友急借錢要用第二管道確認。"],
      ["latest","🚨 最新詐騙","求職詐騙","高薪打字員、在家兼職、刷單賺佣金，多為求職陷阱。"],
      ["latest","🚨 最新詐騙","求職詐騙","工作要求先繳保證金、買教材、辦帳戶，請提高警覺。"],
      ["latest","🚨 最新詐騙","訂房旅遊","超低價住宿、旅遊優惠，付款前請確認是否為官方平台。"],
      ["latest","🚨 最新詐騙","愛情詐騙","網友突然談投資、要求匯款或買幣，請提高警覺。"],
      ["latest","🚨 最新詐騙","假網拍退款","假客服說退款失敗、金流異常，常會引導操作網銀。"],
      ["latest","🚨 最新詐騙","假中獎","中獎要先繳稅、手續費、保證金，多半是詐騙。"],

      ["care","❤️ 小安心提醒","家人陪伴","不確定時先問家人，不用自己一個人判斷。"],
      ["care","❤️ 小安心提醒","冷靜三步驟","越急的訊息越要冷靜：先停、先查、先問家人。"],
      ["care","❤️ 小安心提醒","家庭守護","可疑訊息可以傳給家人一起確認，不用害怕被責怪。"],
      ["care","❤️ 小安心提醒","安全習慣","看到限時優惠、最後名額、立刻付款，請先停一下。"],
      ["care","❤️ 小安心提醒","165 查證","有疑問可以撥打 165 反詐騙諮詢專線查證。"],
      ["care","❤️ 小安心提醒","親友借錢","親友突然借錢，請用電話或見面確認，不要只看訊息。"],
      ["care","❤️ 小安心提醒","帳戶安全","帳戶、卡片、密碼、驗證碼，都是不能交給別人的資料。"],
      ["care","❤️ 小安心提醒","安心提醒","遇到可疑訊息不是你的錯，詐騙就是利用人會著急。"]
    ].map(([role,title,category,text]) => ({role,title,category,text}));

    let antiScamTipIndex = 0;
    let antiScamTipTimer = null;

    function renderAntiScamTip(index = antiScamTipIndex) {
      const card = document.querySelector(".anti-scam-tip-card");
      const title = $("tipRoleTitle");
      const category = $("tipCategoryText");
      const text = $("antiScamTipText");
      const counter = $("tipCounterText");
      const dots = $("tipDots");
      if (!card || !title || !category || !text) return;

      const total = antiScamTips.length;
      const tip = antiScamTips[((index % total) + total) % total];
      text.classList.add("is-changing");

      setTimeout(() => {
        card.classList.remove("guardian", "care", "latest", "game");
        card.classList.add(tip.role || "guardian");
        title.textContent = tip.title;
        if(category){ category.style.display = "none"; }
        text.textContent = tip.text;
        if(counter){ counter.style.display = "none"; }
        if (dots) {
          dots.replaceChildren();
          const dotCount = 5;
          const active = ((index % total) + total) % total % dotCount;
          for (let i = 0; i < dotCount; i++) {
            const dot = document.createElement("span");
            if (i === active) dot.className = "active";
            dots.appendChild(dot);
          }
        }
        text.classList.remove("is-changing");
      }, 180);
    }

    function startAntiScamTipCarousel() {
      if (!document.querySelector(".anti-scam-tip-card")) return;
      renderAntiScamTip(antiScamTipIndex);
      if (antiScamTipTimer) clearInterval(antiScamTipTimer);
      antiScamTipTimer = setInterval(() => {
        antiScamTipIndex = (antiScamTipIndex + 1) % antiScamTips.length;
        renderAntiScamTip(antiScamTipIndex);
      }, 5000);
    }


    function setFamilySetupStatus(message, type = "info") {
      const el = $("familySetupStatus");
      if (!el) return;
      el.textContent = String(message || "");
      el.style.background = type === "error" ? "#ffe8e8" : type === "success" ? "#e6f8ee" : "#fff8e6";
      el.style.borderColor = type === "error" ? "#ffcaca" : type === "success" ? "#c3efd3" : "#ffe0a3";
      el.style.color = type === "error" ? "#991b1b" : type === "success" ? "#0f7a35" : "#7a4b00";
    }

    function buildFamilyInviteLink(code = FAMILY_ID || getFamilyID()) {
      const familyCode = normalizeFamilyCode(code);
      if (!familyCode) return "";
      if (!/^https?:$/i.test(window.location.protocol || "")) return "";
      const baseUrl = new URL(window.location.href);
      baseUrl.search = "";
      baseUrl.hash = "";
      baseUrl.searchParams.set("familyID", familyCode);
      baseUrl.searchParams.set("autojoin", "1");
      return baseUrl.toString();
    }

    async function createFamilyFromMobileApp() {
      const btn = $("createFamilyBtn");
      if (btn) {
        btn.disabled = true;
        btn.textContent = "建立中...";
      }
      setFamilySetupStatus("正在建立家庭代碼。");

      try {
        let result;
        if (window.AppEvidenceSync && typeof window.AppEvidenceSync.createFamily === "function") {
          result = await window.AppEvidenceSync.createFamily(getOrCreateUserID());
        } else {
          const token = await ensureDemoAccessToken().catch(() => "");
          const headers = { "Content-Type": "application/json" };
          if (token) headers.Authorization = `Bearer ${token}`;
          const response = await fetchWithTimeout(`${API_BASE_URL}/api/create_family`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              uid: getOrCreateUserID(),
              userID: getOrCreateUserID(),
              installID: getOrCreateInstallID(),
              source: "mobile_app"
            })
          }, REQUEST_TIMEOUT_MS);
          const data = await response.json().catch(() => ({}));
          if (!response.ok || data.status !== "success") throw new Error(data.message || data.error || "建立家庭失敗");
          result = { code: normalizeFamilyCode(data.inviteCode || data.familyID), data };
        }

        const code = normalizeFamilyCode(result?.code || result?.data?.inviteCode || result?.data?.familyID || "");
        if (!code) throw new Error("後端沒有回傳有效家庭代碼");

        FAMILY_ID = code;
        await saveFamilyID(code);
        updateFamilyCodeUI(code); if (typeof window.updateCleanFamilyCodeUI === "function") window.updateCleanFamilyCodeUI(code);
        setFamilySetupStatus(`已建立家庭代碼：${code}`, "success");
        updateHomeCounters();
      } catch (error) {
        console.error("建立家庭守護失敗：", error);
        setFamilySetupStatus(`建立失敗：${error.message || error}`, "error");
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = "➕ 建立新的家庭代碼";
        }
      }
    }

    async function joinFamilyFromMobileApp() {
      // 取得使用者在畫面輸入的 6 碼家庭代碼。
      let inputCode = "";
      const inputEl1 = document.getElementById("familyCodeInput");
      const inputEl2 = document.getElementById("joinFamilyInput");
      if (inputEl1 && inputEl1.value) inputCode = inputEl1.value;
      else if (inputEl2 && inputEl2.value) inputCode = inputEl2.value;

      inputCode = normalizeFamilyInputValue(inputCode);
      if (inputEl1 && inputCode) inputEl1.value = inputCode;
      if (inputEl2 && inputCode) inputEl2.value = inputCode;

      if (!inputCode) {
        FAMILY_ID = await getStoredFamilyID();
        updateFamilyCodeUI(FAMILY_ID);
        setFamilySetupStatus(FAMILY_ID ? `已讀取目前的代碼：${FAMILY_ID}` : "請輸入 6 碼家庭代碼。", FAMILY_ID ? "success" : "error");
        return FAMILY_ID;
      }

      if (inputCode.length !== 6) {
        setFamilySetupStatus("請輸入完整的 6 碼家庭代碼。", "error");
        return "";
      }

      const btn = $("joinFamilyBtn");
      if (btn) {
        btn.disabled = true;
        btn.textContent = "連線中";
      }

      manualFamilyActionInProgress = true;
      setFamilySetupStatus(`正在連線家庭代碼 ${inputCode}...`, "info");

      try {
        const success = await ensureAppFamilyMembership(inputCode);

        if (success) {
          FAMILY_ID = inputCode;
          await saveFamilyID(inputCode);
          setFamilySetupStatus(`✅ 成功連線！已綁定代碼：${inputCode}`, "success");

          await refreshCloudDashboardRecords({ ensureMembership: false }).catch(() => {});
          if (typeof renderAppFamilyDashboard === "function") renderAppFamilyDashboard();
          updateHomeCounters();

          const joinPanel = document.getElementById("familyJoinPanel");
          if (joinPanel) joinPanel.hidden = true;
        } else {
          setFamilySetupStatus("❌ 綁定失敗，代碼可能錯誤或網路異常。", "error");
        }
      } catch (error) {
        console.error("加入家庭守護失敗：", error);
        setFamilySetupStatus(`❌ 綁定失敗：${error.message || error}`, "error");
      } finally {
        manualFamilyActionInProgress = false;
        if (btn) {
          btn.disabled = false;
          btn.textContent = "確認連線家庭";
        }
      }

      return FAMILY_ID;
    }

    async function copyFamilyInviteLink() {
      const code = normalizeFamilyCode(FAMILY_ID || getFamilyID());
      if (!code) {
        setFamilySetupStatus("尚未綁定家庭守護，請先輸入電腦版戰情室或家人分享的家庭代碼。", "error");
        return;
      }

      const inviteLink = buildFamilyInviteLink(code);
      const text = inviteLink
        ? `請點這個連結加入 AI防詐盾牌家庭守護：
${inviteLink}

如果連結沒有自動加入，打開 App 後輸入家庭代碼：${code}`
        : `請打開 AI防詐盾牌 App，在首頁輸入家庭代碼：${code}`;

      // Android WebView 版本一律只複製，不呼叫 navigator.share，避免系統轉 intent:// 後造成白頁。
      try {
        await navigator.clipboard.writeText(text);
        setFamilySetupStatus("家庭邀請文字已複製，可以打開 LINE 貼給家人。", "success");
      } catch (e) {
        setFamilySetupStatus(text, "success");
      }
    }


    let familyAutoJoinTimer = null;
    let lastFamilyAutoJoinCode = "";

    function scheduleFamilyAutoJoin(rawValue, delay = 650) {
      const code = normalizeFamilyInputValue(rawValue);
      if (!code || code.length !== 6) return;
      const input = $("familyCodeInput") || $("joinFamilyInput");
      if (input) input.value = code;
      if (code === lastFamilyAutoJoinCode && FAMILY_ID === code) return;
      if (familyAutoJoinTimer) clearTimeout(familyAutoJoinTimer);
      setFamilySetupStatus(`已讀取家庭代碼 ${code}，正在自動連線...`, "info");
      familyAutoJoinTimer = setTimeout(() => {
        lastFamilyAutoJoinCode = code;
        joinFamilyFromMobileApp();
      }, delay);
    }

    async function pasteFamilyCodeFromClipboard() {
      const input = $("familyCodeInput") || $("joinFamilyInput");
      if (!input) return;
      try {
        if (!navigator.clipboard || !navigator.clipboard.readText) {
          setFamilySetupStatus("這台手機目前不能直接讀剪貼簿，請長按輸入框貼上家人傳來的代碼。", "error");
          input.focus();
          return;
        }
        const text = await navigator.clipboard.readText();
        const code = normalizeFamilyInputValue(text);
        if (!code || code.length !== 6) {
          setFamilySetupStatus("剪貼簿裡沒有讀到 6 碼家庭代碼，請確認有先複製家人傳來的代碼或邀請文字。", "error");
          input.focus();
          return;
        }
        input.value = code;
        setFamilySetupStatus(`已讀取家庭代碼 ${code}，正在連線家庭守護...`, "info");
        await joinFamilyFromMobileApp();
      } catch (error) {
        console.warn("讀取家庭代碼剪貼簿失敗：", error);
        setFamilySetupStatus("手機沒有允許讀取剪貼簿。請長按輸入框貼上，或直接手動輸入 6 碼代碼。", "error");
        input.focus();
      }
    }

    function bindFamilyCodeInputAutoJoin() {
      const input = $("familyCodeInput") || $("joinFamilyInput");
      if (!input || input.dataset.familyAutoJoinBound === "1") return;
      input.dataset.familyAutoJoinBound = "1";
      input.addEventListener("input", event => {
        const code = normalizeFamilyInputValue(event.target.value);
        if (code) event.target.value = code;
        if (code && code.length === 6) scheduleFamilyAutoJoin(code);
      });
      input.addEventListener("paste", () => {
        setTimeout(() => {
          const code = normalizeFamilyInputValue(input.value);
          if (code) {
            input.value = code;
            scheduleFamilyAutoJoin(code, 250);
          }
        }, 30);
      });
    }

    window.scheduleFamilyAutoJoin = scheduleFamilyAutoJoin;
    window.pasteFamilyCodeFromClipboard = pasteFamilyCodeFromClipboard;

    async function autoJoinFromIncomingFamilyInvite() {
      const code = getIncomingFamilyInviteCode();
      if (!code || code.length !== 6) return false;
      const input = $("familyCodeInput") || $("joinFamilyInput");
      if (input) input.value = code;
      if (FAMILY_ID === code || getFamilyID() === code) {
        setFamilySetupStatus(`已連線家庭代碼：${code}`, "success");
        return true;
      }
      setFamilySetupStatus(`偵測到家人傳來的邀請代碼 ${code}，正在自動加入...`, "info");
      await joinFamilyFromMobileApp();
      return true;
    }

    // 事件監聽綁定
    document.querySelectorAll(".nav-btn").forEach(btn => btn.addEventListener("click", () => go(btn.dataset.screen)));
    const homeScanMessageBtn = document.querySelector('[data-action="go-scan-message"]');
    const homeScanUrlBtn = document.querySelector('[data-action="go-scan-url"]');
    const homeScanBtn = document.querySelector('[data-action="go-scan"]');
    const homeFamilyBtn = document.querySelector('[data-action="go-family"]');

    if (homeScanMessageBtn) {
      homeScanMessageBtn.addEventListener("click", () => { setSample("high"); go("scan"); });
    }

    if (homeScanUrlBtn) {
      homeScanUrlBtn.addEventListener("click", () => { setSample("high"); go("scan"); });
    }

    if (homeScanBtn) {
      homeScanBtn.addEventListener("click", () => {
        $("targetUrl").value = "";
        $("message").value = "";
        go("scan");
      });
    }

    if (homeFamilyBtn) {
      homeFamilyBtn.addEventListener("click", () => go("family"));
    }
    document.querySelectorAll("[data-sample]").forEach(btn => btn.addEventListener("click", () => setSample(btn.dataset.sample)));
    if ($("pasteClipboardBtn")) $("pasteClipboardBtn").addEventListener("click", pasteFromClipboard);
    if ($("clearInputBtn")) $("clearInputBtn").addEventListener("click", clearScanInputs);
    setupVoiceInputAvailability();

    if ($("createFamilyBtn")) $("createFamilyBtn").addEventListener("click", createFamilyFromMobileApp);
    if ($("joinFamilyBtn")) $("joinFamilyBtn").addEventListener("click", joinFamilyFromMobileApp);
    if ($("pasteFamilyCodeBtn")) $("pasteFamilyCodeBtn").addEventListener("click", pasteFamilyCodeFromClipboard);
    if ($("copyInviteLinkBtn")) $("copyInviteLinkBtn").addEventListener("click", copyFamilyInviteLink);
    if ($("joinFamilyInput")) $("joinFamilyInput").addEventListener("input", event => {
      const code = normalizeFamilyInputValue(event.target.value);
      event.target.value = code || normalizeFamilyCode(event.target.value);
      if (code && code.length === 6) scheduleFamilyAutoJoin(code);
    });
    bindFamilyCodeInputAutoJoin();




    function isShortenedUrl(url = "") {
      const raw = String(url || "").trim();
      if (!raw) return false;

      const shortUrlPattern = /(?:^|\.)(bit\.ly|bitly\.com|goo\.gl|tinyurl\.com|reurl\.cc|s\.yam\.com|t\.co|is\.gd|buff\.ly|ow\.ly|lihi\.cc)$/i;

      try {
        const parsed = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
        const host = parsed.hostname.replace(/^www\./i, "");
        return shortUrlPattern.test(host);
      } catch (e) {
        return /bit\.ly|bitly\.com|goo\.gl|tinyurl\.com|reurl\.cc|s\.yam\.com|t\.co|is\.gd|buff\.ly|ow\.ly|lihi\.cc/i.test(raw);
      }
    }


    function extractFirstUrlCandidate(text = "") {
      const raw = String(text || "").trim();
      if (!raw) return "";

      // 同時支援完整網址與裸網址，例如：https://bit.ly/abc、bit.ly/abc、reurl.cc/abc。
      // 長輩從簡訊貼上時，短網址常常不會帶 http/https。
      const candidateRegex = /((?:https?:\/\/)?(?:www\.)?(?:(?:bit\.ly|bitly\.com|goo\.gl|tinyurl\.com|reurl\.cc|s\.yam\.com|t\.co|is\.gd|buff\.ly|ow\.ly|lihi\.cc|shorturl\.at|cutt\.ly)|(?:[a-z0-9-]+\.)+(?:com|net|org|tw|gov|edu|co|io|ly|cc|me|info|top|xyz|shop|click|site|online|icu|bond|vip|app|link|to|gl|gd|at|cn|jp|kr|hk|sg|us|uk))(?:\/[^\s"'<>]*)?)/i;
      const match = raw.match(candidateRegex);
      if (!match || !match[1]) return "";

      let candidate = match[1]
        .replace(/[，。！？!?,.;；:：、」』）)】\]}>]+$/g, "")
        .trim();
      if (!candidate) return "";

      return /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`;
    }

    function isSafeSmallTalkText(text = "") {
      const raw = String(text || "").trim();
      if (!raw) return false;
      if (/https?:\/\//i.test(raw) || extractFirstUrlCandidate(raw)) return false;

      // 只放非常明確的日常問候白名單；不要單純用字數，以免「點這領錢」這類短詐騙被放過。
      const normalized = raw
        .toLowerCase()
        .replace(/[\s　，。！？!?,.、~～^_^（）()【】\[\]{}「」『』:：;；\-—_]+/g, "");

      const safeGreetings = new Set([
        "早安", "午安", "晚安", "你好", "您好", "嗨", "哈囉", "哈囉哈囉",
        "hello", "hi", "吃飽沒", "吃飽了嗎", "在嗎", "謝謝", "謝謝你",
        "感謝", "ok", "okay", "好喔", "好哦", "好的"
      ]);

      return safeGreetings.has(normalized);
    }

    function openBlockedPageForHighRisk(result = {}, input = {}) {
      const score = Number(result.score || 0);
      if (score < 70) return false;
      const payload = {
        riskScore: score,
        riskLevel: result.level || scoreToLevel(score),
        reason: result.reason || "系統偵測到高風險內容。",
        advice: result.advice || "請立即離開，不要輸入個資、信用卡、驗證碼或匯款。",
        scamDNA: Array.isArray(result.tags) ? result.tags : [],
        originalUrl: input.url || "",
        familyID: FAMILY_ID || getFamilyID(),
        source: "mobile_app"
      };
      payload.fromAppScan = true;
      payload.alreadyReported = true;
      const data = encodeURIComponent(JSON.stringify(payload));
      const familyForBlocked = encodeURIComponent(FAMILY_ID || getFamilyID() || payload.familyID || "");
      window.location.href = `blocked.html?data=${data}&familyID=${familyForBlocked}&fromAppScan=1&alreadyReported=1&keepFamilyConnection=1`;
      return true;
    }


    const scanBtnMain = $("scanBtn");
    if (scanBtnMain) scanBtnMain.addEventListener("click", async () => {
     // --- 1. 安全讀取：文字與網址作為檢查來源 ---
      const msgEl = $("message");
      const urlEl = $("targetUrl");
      let rawText = msgEl ? msgEl.value.trim() : "";
      let url = urlEl ? urlEl.value.trim() : "";

      // --- 2. 智慧偵測：如果長輩把網址跟文字一起貼在文字框，自動把網址抓出來！ ---
      if (!url && rawText) {
        const detectedUrl = extractFirstUrlCandidate(rawText);
        if (detectedUrl) {
          url = detectedUrl; // 支援 http/https 與裸短網址，例如 bit.ly/xxx、reurl.cc/xxx
          if (urlEl) urlEl.value = detectedUrl;
        }
      }

      let workingText = rawText;
      let workingUrl = url;

      if (workingUrl && isShortenedUrl(workingUrl)) {
        setVoiceInputStatus("⚠️ 發現短網址！詐騙常用短網址隱藏真正目的地，小安心會特別檢查。", "info");
      }

      // 沒有輸入任何內容時，不可以自動帶入範例，避免空白也被判定詐騙。
      if (!workingText && !workingUrl) {
        alert("請先貼上可疑文字或網址。");
        const msgBox = $("message");
        if (msgBox) msgBox.focus();
        return;
      }

      if (!workingUrl && isSafeSmallTalkText(workingText)) {
        alert("這看起來像一般日常問候，請安心！\n\n💡 小提醒：如果對方接著提到「投資、借錢、點網址、驗證碼、信用卡」，請務必再貼過來檢查喔！");
        return;
      }
// 前端送出前做個資脫敏遮罩
      const text = maskPersonalData(workingText);

      const loading = $("scanLoading");
      const btn = $("scanBtn");
      loading.classList.add("active");
      btn.disabled = true;
      btn.textContent = "小安心檢查中...";
      if ($("message")) $("message").disabled = true;
      if ($("targetUrl")) $("targetUrl").disabled = true;
            const xiaoxinStartedAt = Date.now();
      showXiaoxinProcessing();

      try {
  const result = await scanContent(text, workingUrl);

  await keepXiaoxinAtLeast(xiaoxinStartedAt);

  renderResult(result, { autoVoice: true });
  addScanRecord(result, { text, url: workingUrl });

  // 掃描完成後嘗試同步家庭戰情室。
  // 不用 await，避免畫面卡住。
  refreshCloudDashboardRecords({ ensureMembership: false }).catch(error => {
    console.warn("掃描後同步家庭戰情室失敗：", error);
  });

  go("result");

  if (Number(result.score || 0) >= 70) {
    setTimeout(() => openBlockedPageForHighRisk(result, { text, url: workingUrl }), 650);
  }
      } catch (error) {
        await keepXiaoxinAtLeast(xiaoxinStartedAt);

        alert("檢查連線發生異常，請重試。");
        console.error(error);
      } finally {
        hideXiaoxinProcessing();
        loading.classList.remove("active");
        btn.disabled = false;
        btn.textContent = "開始檢查";
        if ($("message")) $("message").disabled = false;
if ($("targetUrl")) $("targetUrl").disabled = false;
      }
    });

    const clearHistoryBtn = $("clearHistoryBtn");
    if (clearHistoryBtn) {
      clearHistoryBtn.addEventListener("click", () => {
        if (confirm("確定要清除本機上所有的 App 檢查紀錄快取嗎？\n(這不會影響已同步至家庭守護紀錄的歷史紀錄)")) {
          scanRecords.length = 0;
          renderHistory();
          updateHomeCounters();
          if (typeof renderAppFamilyDashboard === "function") renderAppFamilyDashboard();
        }
      });
    }
  
            function loadSelectedCaseFromConsole() {
      const params = getUrlParams();
      const caseFromUrl = String(params.get("case") || params.get("caseType") || "").toLowerCase();

      if (["high", "mid", "low"].includes(caseFromUrl)) {
        setSample(caseFromUrl);
        go("scan");
        return true;
      }

      try {
        const raw = localStorage.getItem("AI_SHIELD_SELECTED_DEMO_CASE");
        if (!raw) return false;
        const payload = JSON.parse(raw);
        const selectedAt = new Date(payload.selectedAt || 0).getTime();
        const isFresh = selectedAt && Date.now() - selectedAt < 10 * 60 * 1000;
        if (!isFresh) return false;

        if (payload.url !== undefined) $("targetUrl").value = String(payload.url || "");
        if (payload.text) $("message").value = String(payload.text || "");
        go("scan");
        return true;
      } catch (e) {
        return false;
      }
    }



    // QA：小守護影音素材改為閒置預載，避免弱網環境一開頁就搶頻寬。
    const MASCOT_ASSET_URLS = Array.isArray(window.CONFIG?.MASCOT_ASSET_URLS) ? window.CONFIG.MASCOT_ASSET_URLS : [];

    function scheduleMascotAssetPreload() {
      if (!MASCOT_ASSET_URLS.length || !("fetch" in window)) return;
      const run = () => {
        MASCOT_ASSET_URLS.slice(0, 6).forEach(url => {
          try {
            fetch(url, { cache: "force-cache", priority: "low" }).catch(() => {});
          } catch (e) {}
        });
      };
      if ("requestIdleCallback" in window) {
        requestIdleCallback(run, { timeout: 60000 });
      } else {
        setTimeout(run, 3500);
      }
    }

    function showAppUpdateToast(message) {
      try {
        const old = document.getElementById("app-update-toast");
        if (old) old.remove();
        const toast = document.createElement("div");
        toast.id = "app-update-toast";
        toast.textContent = message;
        toast.style.cssText = "position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:2147483647;background:#0f4fb7;color:#fff;padding:13px 18px;border-radius:999px;font-size:16px;font-weight:900;box-shadow:0 12px 30px rgba(15,79,183,.26);max-width:92vw;text-align:center;";
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 60000);
      } catch (e) {}
    }

    function registerServiceWorkerWithUpdatePrompt() {
  try {
    if (!("serviceWorker" in navigator)) return;

    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").then(registration => {
        console.log("Service Worker 已註冊：", registration.scope);

        const notifyUpdate = () => {
          if (typeof showAppUpdateToast === "function") {
            showAppUpdateToast("小守護已更新，請重新整理頁面。");
          } else {
            console.log("小守護已更新，請重新整理頁面。");
          }
        };

        if (registration.waiting) {
          notifyUpdate();
        }

        registration.addEventListener("updatefound", () => {
          const newWorker = registration.installing;
          if (!newWorker) return;

          newWorker.addEventListener("statechange", () => {
            if (
              newWorker.state === "installed" &&
              navigator.serviceWorker.controller
            ) {
              notifyUpdate();
            }
          });
        });
      }).catch(error => {
        console.warn("Service Worker 註冊失敗：", error);
      });
    });
  } catch (e) {
    console.warn("Service Worker 初始化失敗：", e);
  }
}


    // 正式智慧首頁：小型互動練習，不佔首頁主版面
    const guardianPracticeQuestions = [
      {
        q: "收到簡訊說包裹配送失敗，要你立即補繳運費並輸入信用卡，該怎麼做？",
        right: "先到官方 App 或 165 查證",
        wrong: "馬上點連結補繳",
        explain: "正確做法是先停下來查證。物流補繳、信用卡、驗證碼同時出現，是常見釣魚詐騙組合。"
      },
      {
        q: "LINE 群組裡有人說老師帶單、保證獲利，叫你先匯款加入 VIP 群，該怎麼做？",
        right: "不要匯款，先查證合法來源",
        wrong: "先匯小額試試看",
        explain: "保證獲利、老師帶單、VIP 群組，是假投資常見話術。任何要求先匯款或買 USDT 的投資都要高度警覺。"
      },
      {
        q: "有人自稱檢察官，說你帳戶涉嫌洗錢，要求不能告訴家人並轉到監管帳戶，該怎麼做？",
        right: "立刻停止對話並撥打 165",
        wrong: "照指示轉到監管帳戶",
        explain: "檢警不會用通訊軟體要求轉帳，也不會要求把錢放進監管帳戶。『不能告訴家人』是高風險訊號。"
      },
      {
        q: "朋友傳來 165 官方防詐宣導連結，網址是 165.npa.gov.tw，該怎麼做？",
        right: "確認是官方網址後再閱讀",
        wrong: "所有連結都一定是詐騙",
        explain: "不是所有連結都危險，重點是確認來源與網址。165.npa.gov.tw 屬於官方防詐資訊，可作為查證參考。"
      }
    ];

    let guardianPracticeIndex = 0;

    function renderGuardianPractice() {
      const q = guardianPracticeQuestions[guardianPracticeIndex % guardianPracticeQuestions.length];
      const question = $("practiceQuestion");
      const buttons = document.querySelectorAll("[data-practice-answer]");
      const feedback = $("practiceFeedback");
      if (!q || !question) return;
      question.textContent = q.q;
      buttons.forEach(btn => {
        const isRight = btn.dataset.practiceAnswer === "right";
        btn.textContent = isRight ? q.right : q.wrong;
      });
      if (feedback) {
        feedback.hidden = true;
        feedback.textContent = "";
        feedback.className = "practice-feedback";
      }
    }

    function setupGuardianPracticeCard() {
      const toggle = $("practiceToggleBtn");
      const body = $("practiceBody");
      const arrow = document.querySelector(".practice-arrow");
      const feedback = $("practiceFeedback");
      const nextBtn = $("nextPracticeBtn");
      const nextTipBtn = $("nextTipBtn");
      if (nextTipBtn) {
        nextTipBtn.addEventListener("click", () => {
          antiScamTipIndex = (antiScamTipIndex + 1) % antiScamTips.length;
          renderAntiScamTip(antiScamTipIndex);
          if (antiScamTipTimer) {
            clearInterval(antiScamTipTimer);
            antiScamTipTimer = setInterval(() => {
              antiScamTipIndex = (antiScamTipIndex + 1) % antiScamTips.length;
              renderAntiScamTip(antiScamTipIndex);
            }, 7000);
          }
        });
      }

      if (toggle && body) {
        toggle.addEventListener("click", () => {
          const open = body.hidden;
          body.hidden = !open;
          toggle.setAttribute("aria-expanded", open ? "true" : "false");
          if (arrow) arrow.textContent = open ? "－" : "＋";
          if (open) renderGuardianPractice();
        });
      }

      document.querySelectorAll("[data-practice-answer]").forEach(btn => {
        btn.addEventListener("click", () => {
          const q = guardianPracticeQuestions[guardianPracticeIndex % guardianPracticeQuestions.length];
          if (!feedback || !q) return;
          const isRight = btn.dataset.practiceAnswer === "right";
          feedback.hidden = false;
          feedback.className = "practice-feedback " + (isRight ? "good" : "bad");
          feedback.textContent = (isRight ? "答對了。" : "先不要這樣做。") + q.explain;
          try {
            const count = Number(localStorage.getItem("aiShieldPracticeCompletedCount") || 0) + (isRight ? 1 : 0);
            localStorage.setItem("aiShieldPracticeCompletedCount", String(count));
          } catch (e) {}
        });
      });

      if (nextBtn) {
        nextBtn.addEventListener("click", () => {
          guardianPracticeIndex = (guardianPracticeIndex + 1) % guardianPracticeQuestions.length;
          renderGuardianPractice();
        });
      }

      renderGuardianPractice();
    }


    async function initializeAppDemo() {
      const incomingFamilyCode = getIncomingFamilyInviteCode();
      if (incomingFamilyCode) await saveFamilyID(incomingFamilyCode);
      FAMILY_ID = await getStoredFamilyID();
      updateFamilyCodeUI(FAMILY_ID);
      if (getUrlParams().get("returnFromBlocked") === "1" && FAMILY_ID) {
        setFamilySetupStatus(`已連線家庭代碼：${FAMILY_ID}`, "success");
      }
      updateAppModeUI();
      setupGuardianPracticeCard();
      bindFamilyCodeInputAutoJoin();
      setTimeout(autoJoinFromIncomingFamilyInvite, 350);

      const loaded = loadSelectedCaseFromConsole();
      if (!loaded && FORCE_FALLBACK_MODE) {
        setSample("high");
      }

      // 🌟 核心修改：如果從 welcome 拿到 6 碼代碼，一開網頁就在背景全自動綁定，不讓長輩卡住
      if (FAMILY_ID && FAMILY_ID.length === 6) {
        try {
          await ensureAppFamilyMembership(FAMILY_ID);
        } catch (e) {
          console.warn("背景自動綁定失敗:", e);
        }
      }

      // 不再預先渲染固定高風險 Demo 結果；結果頁會在使用者檢查後更新。
      renderHistory();
      updateHomeCounters();
      refreshCloudDashboardRecords({ ensureMembership: false });
      scheduleMascotAssetPreload();
      registerServiceWorkerWithUpdatePrompt();
    }

    // 初始化渲染
    initializeAppDemo();

/* === 家庭守護頁精簡版補強：建立 / 加入 / 顯示代碼 === */
(function cleanFamilyPageBridge(){
  function $clean(id){ return document.getElementById(id); }
  function normalizeCleanFamilyCode(value){
    if (window.extractFamilyCodeFromText) {
      const extracted = window.extractFamilyCodeFromText(value);
      if (extracted) return extracted;
    }
    return String(value || "").trim().toUpperCase().replace(/^AISHIELD:/, "").replace(/^FAM-/, "").replace(/[^A-Z0-9]/g, "").slice(0, 6);
  }
  function readCleanFamilyCode(){
    const keys = [
      "aiShieldWelcomeFamilyID","aiShieldPrimaryFamilyID","savedFamilyID","boundFamilyID","currentFamilyID",
      "familyCode","familyID","family_id","aiShieldFamilyID","dashboardFamilyID",
      "familyInviteCode","guardianFamilyID","guardianCode","popupFamilyID","popupSavedFamilyID"
    ];
    for (const key of keys) {
      try {
        const code = normalizeCleanFamilyCode(localStorage.getItem(key));
        if (code.length === 6) return code;
      } catch(e){}
    }
    return "";
  }
  window.updateCleanFamilyCodeUI = function(code){
    const familyID = normalizeCleanFamilyCode(code || readCleanFamilyCode());
    const codeEl = $clean("familyCodeText");
    const statusEl = $clean("familyBindStatus");
    const input = $clean("familyCodeInput");
    const boundPanel = $clean("familyBoundPanel");
    const joinPanel = $clean("familyJoinPanel");
    const showJoinBtn = $clean("showJoinFamilyBtn");
    const statusText = $clean("familyJoinStatusText");
    if (codeEl) codeEl.textContent = familyID || "未建立";
    if (statusEl) statusEl.textContent = familyID ? "已綁定" : "尚未綁定";
    if (input && familyID && !input.value) input.value = familyID;
    if (boundPanel) boundPanel.hidden = !familyID;
    if (showJoinBtn) showJoinBtn.hidden = !familyID;
    if (joinPanel) {
      if (familyID && joinPanel.dataset.userOpened !== "1") joinPanel.hidden = true;
      if (!familyID) { joinPanel.hidden = false; joinPanel.dataset.userOpened = "1"; }
    }
    if (statusText) statusText.textContent = familyID
      ? "已連線家庭守護；高風險提醒會自動同步家人與家庭戰情室。"
      : "可以建立新的家庭代碼，也可以輸入家人給的 6 碼代碼。";
  };
  function bindCleanFamilyPage(){
    const createBtn = $clean("createFamilyBtn");
    const joinBtn = $clean("joinFamilyBtn");
    const input = $clean("familyCodeInput");

    if (input && input.dataset.cleanBound !== "1") {
      input.dataset.cleanBound = "1";
      input.addEventListener("input", function(){
        const code = normalizeCleanFamilyCode(input.value);
        input.value = code;
        if (code.length === 6 && typeof window.scheduleFamilyAutoJoin === "function") window.scheduleFamilyAutoJoin(code);
      });
      input.addEventListener("keydown", function(event){
        if (event.key === "Enter" && joinBtn) joinBtn.click();
      });
    }

    // If original app handlers didn't bind because old IDs changed, bridge to original functions when present.
    if (createBtn && createBtn.dataset.cleanClickBound !== "1") {
      createBtn.dataset.cleanClickBound = "1";
      createBtn.addEventListener("click", function(){
        setTimeout(function(){ window.updateCleanFamilyCodeUI(); }, 900);
      });
    }
    if (joinBtn && joinBtn.dataset.cleanClickBound !== "1") {
      joinBtn.dataset.cleanClickBound = "1";
      joinBtn.addEventListener("click", function(){
        setTimeout(function(){ window.updateCleanFamilyCodeUI(); }, 900);
      });
    }

    window.updateCleanFamilyCodeUI();
  }
  document.addEventListener("DOMContentLoaded", bindCleanFamilyPage);
  setTimeout(bindCleanFamilyPage, 500);
  setTimeout(bindCleanFamilyPage, 1500);
})();















/* === 手機 App 原生家庭戰情室：單一資料流、長輩友善 UI === */
function getFamilyStatusSummary(records = scanRecords) {
  const data = Array.isArray(records) ? records : [];
  const high = data.filter(item => item.kind === "high" || Number(item.score || 0) >= 70).length;
  const mid = data.filter(item => item.kind === "mid" || (Number(item.score || 0) >= 40 && Number(item.score || 0) < 70)).length;
  if (high > 0) return { state: "danger", icon: "🔴", title: "危險，先不要點", desc: `目前有 ${high} 筆高風險提醒，請先問家人確認。` };
  if (mid > 0) return { state: "warn", icon: "🟡", title: "有可疑提醒，先查證", desc: `目前有 ${mid} 筆需要留意的紀錄，請不要急著操作。` };
  return { state: "safe", icon: "🟢", title: "目前看起來安全", desc: data.length ? "最近紀錄沒有看到高風險提醒。" : "還沒有看到新的家庭提醒紀錄。" };
}
function build165DraftFromRecord(record = null) {
  const item = record || scanRecords.find(r => r.kind === "high" || Number(r.score || 0) >= 70) || scanRecords[0];
  if (!item) return "目前沒有可整理的防詐紀錄。";
  return [
    "【AI 防詐盾牌｜165 通報資訊草稿】","",
    `一、發生時間：${item.createdAt || "未取得"}`,
    `二、風險等級：${item.level || scoreToLevel(Number(item.score || 0))}`,
    `三、風險分數：${item.score || 0} / 100`,
    `四、可疑類型：${item.title || "可疑訊息"}`,
    `五、可疑網址：${item.url || "未取得網址"}`,
    `六、命中特徵：${Array.isArray(item.tags) && item.tags.length ? item.tags.join("、") : "未提供明確標籤"}`,
    `七、系統判斷原因：${item.reason || item.sub || "系統偵測到可疑風險。"}`,
    `八、建議動作：${item.advice || "請不要點擊連結、不要輸入個資或驗證碼，也不要匯款。"}`,
    `九、家庭代碼：${FAMILY_ID || getFamilyID() || "未綁定"}`,
    `十、165 官方防騙網：${OFFICIAL_165_URL}`,"",
    "請補充：","1. 是否已付款或匯款：＿＿＿＿＿＿","2. 是否已輸入個資、信用卡或驗證碼：＿＿＿＿＿＿","3. 對方 LINE ID / 電話 / 帳號：＿＿＿＿＿＿","4. 是否有對話截圖或付款紀錄：＿＿＿＿＿＿"
  ].join("\n");
}
async function copyAppText(text, successMessage = "已複製。") {
  try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(String(text || "")); alert(successMessage); return true; } } catch (e) {}
  const textarea = document.createElement("textarea");
  textarea.value = String(text || ""); textarea.style.cssText = "position:fixed;left:-9999px;top:-9999px;opacity:0"; document.body.appendChild(textarea); textarea.select();
  const ok = document.execCommand("copy"); textarea.remove(); alert(ok ? successMessage : text); return ok;
}


async function openOfficial165Website(event) {
  if (event && typeof event.preventDefault === "function") event.preventDefault();
  if (event && typeof event.stopPropagation === "function") event.stopPropagation();

  const url = OFFICIAL_165_URL;

  // APK / Capacitor：優先請原生 Browser 外開，App 本身留在原本畫面。
  try {
    const capacitorBrowser = window.Capacitor?.Plugins?.Browser || window.Capacitor?.Browser;
    if (capacitorBrowser && typeof capacitorBrowser.open === "function") {
      await capacitorBrowser.open({ url });
      return false;
    }
  } catch (error) {
    console.warn("Capacitor Browser 開啟 165 失敗，改用網頁外開方式。", error);
  }

  // 若 APK 原生層有提供橋接，也可以從這裡開外部瀏覽器。
  try {
    const androidBridge = window.AndroidBridge || window.Android;
    if (androidBridge && typeof androidBridge.openExternalUrl === "function") {
      androidBridge.openExternalUrl(url);
      return false;
    }
  } catch (error) {
    console.warn("Android 外部瀏覽器開啟 165 失敗，改用網頁外開方式。", error);
  }

  // PWA / 一般瀏覽器：開新分頁或外部瀏覽器，不用 location.href 直接把 App 換掉。
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    anchor.style.position = "fixed";
    anchor.style.left = "-9999px";
    anchor.style.top = "-9999px";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    return false;
  } catch (error) {
    console.warn("165 新分頁開啟失敗。", error);
  }

  try {
    const opened = window.open(url, "_blank", "noopener,noreferrer");
    if (opened) {
      try { opened.opener = null; } catch (e) {}
      return false;
    }
  } catch (error) {
    console.warn("window.open 開啟 165 失敗。", error);
  }

  // 最後才詢問；不再偷偷讓整個 App 直接跳走。
  const leaveApp = confirm("這台手機目前沒有允許 App 直接開啟外部瀏覽器。\n\n要暫時離開防詐盾牌，前往 165 官方防騙網嗎？");
  if (leaveApp) window.location.assign(url);
  return false;
}
function renderAppFamilyDashboard() {
  const familyID = normalizeFamilyCode(FAMILY_ID || getFamilyID());
  const list = $("familyDashboardList"), totalEl = $("familyTotalCount"), highEl = $("familyHighCount"), syncEl = $("familyDashboardSyncStatus"), codeEl = $("familyCodeText"), statusEl = $("familyElderStatusText"), banner = $("familySafeBanner"), iconEl = $("familySafeIcon"), titleEl = $("familySafeTitle"), descEl = $("familySafeDesc");
  if (codeEl) codeEl.textContent = familyID || "尚未綁定";
  if (statusEl) statusEl.textContent = familyID ? "已連接同一套家庭守護資料。" : "尚未綁定家庭代碼，請輸入電腦版戰情室或家人分享的 6 碼代碼。";
  const data = Array.isArray(scanRecords) ? scanRecords.slice(0, MAX_FAMILY_RECORDS) : [];
  const highCount = data.filter(item => item.kind === "high" || Number(item.score || 0) >= 70).length;
  if (totalEl) totalEl.textContent = data.length;
  if (highEl) highEl.textContent = highCount;
  if (syncEl) syncEl.textContent = cloudSyncState.message || (familyID ? "等待同步" : "尚未綁定");
  const summary = getFamilyStatusSummary(data);
  if (banner) { banner.classList.remove("safe", "warn", "danger"); banner.classList.add(summary.state); }
  if (iconEl) iconEl.textContent = summary.icon;
  if (titleEl) titleEl.textContent = summary.title;
  if (descEl) descEl.textContent = summary.desc;
  if (typeof renderLineBindStatus === "function") renderLineBindStatus(lineBindStatusCache);
  if (!list) return;
  list.replaceChildren();
  if (!familyID) { const empty = document.createElement("div"); empty.className = "family-empty-state"; empty.textContent = "請先輸入電腦版戰情室或家人分享的家庭代碼，之後這裡會顯示全家人的防詐提醒。"; list.appendChild(empty); return; }
  if (!data.length) { const empty = document.createElement("div"); empty.className = "family-empty-state"; empty.textContent = cloudSyncState.status === "loading" ? "正在同步家庭提醒紀錄..." : "尚未有家庭提醒紀錄。"; list.appendChild(empty); return; }
  data.forEach(item => {
    const row = document.createElement("button");
    row.type = "button"; row.className = `family-elder-item ${item.kind || scoreToKind(Number(item.score || 0))}`;
    const icon = item.kind === "low" ? "✓" : item.kind === "mid" ? "?" : "!";
    row.innerHTML = `<div class="family-elder-icon">${icon}</div><div><div class="family-elder-title"></div><div class="family-elder-sub"></div></div><div class="family-elder-score"></div>`;
    row.querySelector(".family-elder-title").textContent = item.title || "家庭提醒";
    row.querySelector(".family-elder-sub").textContent = item.createdAt || "剛剛";
    row.querySelector(".family-elder-score").textContent = `${Number(item.score || 0)}/100`;
    row.addEventListener("click", () => showFamilyRecordDetail(item));
    list.appendChild(row);
  });
}
async function updateAppFamilyDashboard(options = {}) {
  renderAppFamilyDashboard();
  if (options && options.forceSync === true) {
    await refreshCloudDashboardRecords(options).catch(() => {});
    renderAppFamilyDashboard();
  }
}
function showFamilyRecordDetail(item = null) {
  const record = item || scanRecords[0], panel = $("familyRecordDetail"), content = $("familyDetailContent");
  if (!panel || !content || !record) return;
  content.className = "family-detail-content"; content.replaceChildren();
  const h2 = document.createElement("h2"); h2.textContent = record.title || "家庭提醒"; content.appendChild(h2);
  const rows = [["時間", record.createdAt || "未取得"],["風險", `${record.level || scoreToLevel(Number(record.score || 0))}｜${record.score || 0}/100`],["提醒", record.reason || record.sub || "系統偵測到可疑風險。"],["建議", record.advice || "先不要點連結、不要輸入驗證碼，也不要匯款。"],["可疑網址", record.url || "未取得"],["特徵", Array.isArray(record.tags) && record.tags.length ? record.tags.join("、") : "未提供明確標籤"]];
  rows.forEach(([label, value]) => { const row = document.createElement("div"); row.className = "family-detail-row"; const span = document.createElement("span"); span.textContent = label; const p = document.createElement("p"); p.textContent = String(value || ""); row.append(span, p); content.appendChild(row); });
  if (record.screenshot) { const img = document.createElement("img"); img.className = "family-detail-shot"; const src = String(record.screenshot); img.src = src.startsWith("data:image") ? src : "data:image/jpeg;base64," + src; img.alt = "證據快照"; content.appendChild(img); }
  const copyBtn = document.createElement("button"); copyBtn.className = "btn btn-soft"; copyBtn.type = "button"; copyBtn.textContent = "📋 複製 165 通報內容"; copyBtn.addEventListener("click", () => copyAppText(build165DraftFromRecord(record), "165 通報內容已複製。")); content.appendChild(copyBtn);
  const open165DetailBtn = document.createElement("button"); open165DetailBtn.className = "btn btn-soft"; open165DetailBtn.type = "button"; open165DetailBtn.textContent = "🔗 開啟 165 官方防騙網"; open165DetailBtn.addEventListener("click", openOfficial165Website); content.appendChild(open165DetailBtn);
  panel.hidden = false;
}
function clearAllFamilyRecords() {
  const familyID = normalizeFamilyCode(FAMILY_ID || getFamilyID());
  const ok = confirm("確定要清除手機 App 畫面上的家庭紀錄嗎？\n\n正式手機版會清除本機畫面，並隱藏清除前的舊雲端紀錄。\n雲端資料只能由家庭守護者後台清除。");
  if (!ok) return;

  // 正式手機版：不要呼叫 /api/clear_alerts。
  // 後端會回 403「此操作僅限家庭守護者」，手機端不具備雲端刪除權限。
  // 這裡只清本機畫面，並用 clearAfter 避免舊雲端紀錄重新拉回來。
  try {
    scanRecords.length = 0;
    homeSessionStats.scans = 0;
    homeSessionStats.high = 0;
    if (familyID) setMobileLocalClearAfter(familyID, Date.now());
    setCloudSyncStatus("success", "手機畫面已清除");
    renderHistory();
    updateHomeCounters();
    renderAppFamilyDashboard();
    setFamilySetupStatus("手機畫面已清除；雲端原始紀錄需由家庭守護者後台清除。", "success");
  } catch (error) {
    console.error("清除本機畫面失敗：", error);
    setFamilySetupStatus("清除失敗，請重新整理後再試。", "error");
  }
}



/* === LINE 家庭通知 MVP：App 端入口 ===
   後端 API 完成後會走 /api/line/invite、/api/line/bind-status、/api/line/test-push、/api/line/unbind。
   後端尚未完成時，仍可產生/複製 oaMessage 備援邀請文字，不影響既有家庭戰情室。 */
let lineBindStatusCache = [];
let lineInviteCache = null;

function getLineConfigValue(key, fallback = "") {
  try {
    return String(window.CONFIG?.[key] || fallback || "").trim();
  } catch (e) {
    return String(fallback || "").trim();
  }
}

function getLineBotName() {
  return getLineConfigValue("LINE_BOT_NAME", "AI防詐測試二號機") || "AI防詐測試二號機";
}

function getLineBotBasicId() {
  return getLineConfigValue("LINE_BOT_BASIC_ID", "").replace(/^＠/, "@").trim();
}

function getLineApiPath(key, fallback) {
  return getLineConfigValue(key, fallback || "");
}

function buildLineApiUrl(path) {
  const cleanPath = String(path || "").trim() || "/api/line/bind-status";
  if (/^https?:\/\//i.test(cleanPath)) return cleanPath;
  return `${API_BASE_URL}${cleanPath.startsWith("/") ? cleanPath : "/" + cleanPath}`;
}

function getLineFamilyID() {
  return normalizeFamilyCode(FAMILY_ID || getFamilyID());
}

function createLocalInviteToken() {
  try {
    const arr = new Uint32Array(2);
    crypto.getRandomValues(arr);
    return Array.from(arr).map(n => n.toString(36).toUpperCase()).join("").slice(0, 8);
  } catch (e) {
    return Math.random().toString(36).slice(2, 10).toUpperCase();
  }
}

function buildLineBindText(familyID, inviteToken = "") {
  const code = normalizeFamilyCode(familyID);
  const token = String(inviteToken || "").trim().toUpperCase();
  return token ? `綁定家人 ${code} ${token}` : `綁定家人 ${code}`;
}

function buildLineOaMessageUrl(bindText) {
  const botId = getLineBotBasicId();
  if (!botId) return "";
  return `https://line.me/R/oaMessage/${encodeURIComponent(botId)}/?${encodeURIComponent(bindText)}`;
}

function buildLineShareUrl(message) {
  return `https://line.me/R/share?text=${encodeURIComponent(message)}`;
}

function buildLineInviteMessage(invite = {}) {
  const familyID = normalizeFamilyCode(invite.familyID || invite.family_id || getLineFamilyID());
  const botName = getLineBotName();
  const bindText = invite.bindText || invite.lineInviteText || buildLineBindText(familyID, invite.inviteToken || invite.invite_token || "");
  const lineInviteUrl = invite.lineInviteUrl || invite.inviteUrl || invite.url || buildLineOaMessageUrl(bindText);
  const safeUrlLine = lineInviteUrl ? `\n\n點這裡加入 ${botName} 並完成綁定：\n${lineInviteUrl}` : "";
  return [
    "我正在使用 AI 防詐盾牌保護家人。",
    `請加入我們的家庭防護網，之後遇到高風險詐騙，${botName} 會協助通知家人。`,
    "",
    `家庭代碼：${familyID}`,
    `LINE 綁定文字：${bindText}`,
    safeUrlLine,
    "",
    "若 LINE 沒有自動帶入文字，請複製上面的 LINE 綁定文字傳給 AI 防詐二號機。"
  ].filter(Boolean).join("\n");
}

function setLineStatusText(message, type = "info") {
  const el = $("lineNotifyStatusText");
  if (!el) return;
  el.textContent = message;
  el.dataset.status = type;
}

function renderLineBindStatus(bindings = lineBindStatusCache) {
  const box = $("lineNotifyBoundList");
  if (!box) return;
  box.replaceChildren();

  const active = (Array.isArray(bindings) ? bindings : []).filter(item => String(item.status || "active") !== "disabled");
  if (!active.length) {
    const empty = document.createElement("div");
    empty.className = "family-line-empty";
    empty.textContent = "還沒有綁定 LINE 通知對象。請按「邀請家人加入防護網」。";
    box.appendChild(empty);
    return;
  }

  active.forEach(item => {
    const row = document.createElement("div");
    row.className = "family-line-person";
    const type = item.line_target_type || item.targetType || item.type || "user";
    const name = item.display_name || item.displayName || item.name || (type === "group" ? "家庭 LINE 群組" : "LINE 家人");
    const targetId = item.id || item.binding_id || item.line_target_id || item.targetId || "";
    row.innerHTML = `
      <div class="family-line-avatar">${type === "group" ? "👪" : "👤"}</div>
      <div>
        <div class="family-line-name"></div>
        <div class="family-line-meta"></div>
      </div>
      <button class="family-line-unbind" type="button">解除</button>
    `;
    row.querySelector(".family-line-name").textContent = name;
    row.querySelector(".family-line-meta").textContent = type === "group" ? "家庭群組通知" : "個人 LINE 通知";
    const btn = row.querySelector(".family-line-unbind");
    btn.dataset.lineBindingId = String(targetId || "");
    btn.addEventListener("click", () => unbindLineTarget(item));
    box.appendChild(row);
  });
}

async function requestLineInvite() {
  const familyID = getLineFamilyID();
  if (!familyID) {
    alert("請先建立或輸入家庭代碼，再邀請家人加入 LINE 防護網。");
    return null;
  }

  const apiPath = getLineApiPath("LINE_INVITE_API", "/api/line/invite");
  try {
    const response = await fetchWithTimeout(buildLineApiUrl(apiPath), {
      method: "POST",
      headers: await getApiHeadersForFamily(familyID),
      body: JSON.stringify({ family_id: familyID, familyID, familyId: familyID, source: "mobile_app" })
    }, 15000);
    const data = await response.json().catch(() => ({}));
    if (response.ok && (data.status === "success" || data.inviteToken || data.lineInviteUrl || data.data)) {
      const payload = data.data || data;
      const invite = {
        familyID,
        inviteToken: payload.inviteToken || payload.invite_token || payload.token || "",
        bindText: payload.bindText || payload.lineInviteText || payload.message || "",
        lineInviteUrl: payload.lineInviteUrl || payload.inviteUrl || payload.url || ""
      };
      if (!invite.bindText) invite.bindText = buildLineBindText(familyID, invite.inviteToken);
      if (!invite.lineInviteUrl) invite.lineInviteUrl = buildLineOaMessageUrl(invite.bindText);
      lineInviteCache = invite;
      return invite;
    }
    throw new Error(data.message || data.error || `HTTP ${response.status}`);
  } catch (error) {
    console.warn("LINE 邀請 API 尚未可用，改用 App 端備援邀請：", error);
    const invite = {
      familyID,
      inviteToken: createLocalInviteToken(),
      bindText: buildLineBindText(familyID, ""),
      lineInviteUrl: ""
    };
    invite.lineInviteUrl = buildLineOaMessageUrl(invite.bindText);
    invite.localOnly = true;
    lineInviteCache = invite;
    return invite;
  }
}

async function openLineInvite() {
  const invite = await requestLineInvite();
  if (!invite) return;
  const message = buildLineInviteMessage(invite);

  // Android WebView 會把 LINE 分享網址轉成 intent://，導致 ERR_UNKNOWN_URL_SCHEME。
  // 這版完全不導向 LINE / intent / line.me，只複製文字並提示手動貼到 LINE。
  const copied = await copyAppText(message, "LINE 邀請文字已複製。請打開 LINE 貼給家人。");
  setLineStatusText("LINE 邀請文字已複製；請打開 LINE，選家人後長按貼上。", "success");
  alert("LINE 邀請文字已複製。\n\n請打開 LINE → 選家人 → 長按輸入框貼上 → 傳送。\n\n這樣就不會再跳到 intent:// 錯誤頁。");
  if (!copied) {
    console.log("LINE invite text fallback:", message);
  }
}

async function copyLineInviteText() {
  const invite = lineInviteCache || await requestLineInvite();
  if (!invite) return;
  await copyAppText(buildLineInviteMessage(invite), "LINE 邀請文字已複製。請貼給家人。");
}

async function loadLineBindStatus(options = {}) {
  const familyID = getLineFamilyID();
  if (!familyID) {
    lineBindStatusCache = [];
    setLineStatusText("尚未綁定家庭代碼，請先建立或輸入 6 碼家庭代碼。", "idle");
    renderLineBindStatus();
    return;
  }

  if (!options.silent) setLineStatusText("正在確認 LINE 通知狀態...", "loading");
  const apiPath = getLineApiPath("LINE_BIND_STATUS_API", "/api/line/bind-status");
  try {
    const response = await fetchWithTimeout(buildLineApiUrl(apiPath), {
      method: "POST",
      headers: await getApiHeadersForFamily(familyID),
      body: JSON.stringify({ family_id: familyID, familyID, familyId: familyID, source: "mobile_app" })
    }, 15000);
    const data = await response.json().catch(() => ({}));
    if (!response.ok || (data.status && data.status !== "success")) throw new Error(data.message || data.error || `HTTP ${response.status}`);
    const payload = data.data || data;
    lineBindStatusCache = payload.bindings || payload.items || payload.targets || [];
    renderLineBindStatus(lineBindStatusCache);
    setLineStatusText(lineBindStatusCache.length ? `已綁定 ${lineBindStatusCache.length} 個 LINE 通知對象。` : "尚未綁定 LINE 通知對象。", "success");
  } catch (error) {
    console.warn("LINE 綁定狀態 API 尚未可用：", error);
    setLineStatusText("LINE 綁定 API 尚未啟用；目前可先使用邀請文字測試流程。", "warn");
    renderLineBindStatus(lineBindStatusCache);
  }
}

async function testLinePush() {
  const familyID = getLineFamilyID();
  if (!familyID) { alert("請先建立或輸入家庭代碼。"); return; }
  const apiPath = getLineApiPath("LINE_TEST_PUSH_API", "/api/line/test-push");
  try {
    setLineStatusText("正在送出測試通知...", "loading");
    const response = await fetchWithTimeout(buildLineApiUrl(apiPath), {
      method: "POST",
      headers: await getApiHeadersForFamily(familyID),
      body: JSON.stringify({ family_id: familyID, familyID, familyId: familyID, source: "mobile_app" })
    }, 15000);
    const data = await response.json().catch(() => ({}));
    if (!response.ok || (data.status && data.status !== "success")) throw new Error(data.message || data.error || `HTTP ${response.status}`);
    setLineStatusText("測試通知已送出，請到 LINE 查看。", "success");
    alert("測試通知已送出，請到 LINE 查看。");
    await loadLineBindStatus({ silent: true });
  } catch (error) {
    console.warn("LINE 測試通知失敗：", error);
    setLineStatusText("目前後端尚未啟用 LINE 測試通知 API。", "warn");
    alert("目前後端尚未啟用 LINE 測試通知 API，前端按鈕已準備好，等後端完成即可使用。");
  }
}

async function unbindLineTarget(item = {}) {
  const familyID = getLineFamilyID();
  const bindingId = item.id || item.binding_id || item.line_target_id || item.targetId || "";
  const name = item.display_name || item.displayName || item.name || "這個 LINE 對象";
  if (!familyID || !bindingId) return;
  if (!confirm(`確定要解除「${name}」的 LINE 通知嗎？`)) return;
  const apiPath = getLineApiPath("LINE_UNBIND_API", "/api/line/unbind");
  try {
    const response = await fetchWithTimeout(buildLineApiUrl(apiPath), {
      method: "POST",
      headers: await getApiHeadersForFamily(familyID),
      body: JSON.stringify({ family_id: familyID, familyID, id: bindingId, bindingID: bindingId, bindingId, binding_id: bindingId, line_target_id: bindingId })
    }, 15000);
    const data = await response.json().catch(() => ({}));
    if (!response.ok || (data.status && data.status !== "success")) throw new Error(data.message || data.error || `HTTP ${response.status}`);
    lineBindStatusCache = lineBindStatusCache.filter(x => String(x.id || x.binding_id || x.line_target_id || x.targetId || "") !== String(bindingId));
    renderLineBindStatus(lineBindStatusCache);
    setLineStatusText("已解除 LINE 通知對象。", "success");
  } catch (error) {
    console.warn("解除 LINE 綁定失敗：", error);
    alert("目前後端尚未啟用解除綁定 API，前端管理畫面已先準備好。");
  }
}

function bindLineNotifyButtons() {
  const inviteBtn = $("lineInviteFamilyBtn");
  if (inviteBtn && inviteBtn.dataset.bound !== "1") {
    inviteBtn.dataset.bound = "1";
    inviteBtn.addEventListener("click", openLineInvite);
  }
  const copyBtn = $("lineCopyInviteBtn");
  if (copyBtn && copyBtn.dataset.bound !== "1") {
    copyBtn.dataset.bound = "1";
    copyBtn.addEventListener("click", copyLineInviteText);
  }
  const testBtn = $("lineTestPushBtn");
  if (testBtn && testBtn.dataset.bound !== "1") {
    testBtn.dataset.bound = "1";
    testBtn.addEventListener("click", testLinePush);
  }
  const refreshBtn = $("lineRefreshBindStatusBtn");
  if (refreshBtn && refreshBtn.dataset.bound !== "1") {
    refreshBtn.dataset.bound = "1";
    refreshBtn.addEventListener("click", () => loadLineBindStatus({ silent: false }));
  }
  renderLineBindStatus();
}

function bindNativeFamilyDashboard() {
  if (typeof bindLineNotifyButtons === "function") bindLineNotifyButtons();
  const refreshBtn = $("familyRefreshBtn");
  if (refreshBtn && refreshBtn.dataset.bound !== "1") { refreshBtn.dataset.bound = "1"; refreshBtn.addEventListener("click", () => updateAppFamilyDashboard({ ensureMembership: false, forceSync: true })); }
  const showJoinBtn = $("showJoinFamilyBtn"), joinPanel = $("familyJoinPanel");
  if (showJoinBtn && showJoinBtn.dataset.bound !== "1") { showJoinBtn.dataset.bound = "1"; showJoinBtn.addEventListener("click", () => { if (joinPanel) { joinPanel.hidden = !joinPanel.hidden; joinPanel.dataset.userOpened = joinPanel.hidden ? "0" : "1"; } if (joinPanel && !joinPanel.hidden && $("familyCodeInput")) $("familyCodeInput").focus(); }); }
  const copy165Btn = $("familyCopy165Btn");
  if (copy165Btn && copy165Btn.dataset.bound !== "1") { copy165Btn.dataset.bound = "1"; copy165Btn.addEventListener("click", () => copyAppText(build165DraftFromRecord(), "165 通報內容已複製。")); }
  const resultOfficial165Btn = $("resultOfficial165Link");
  if (resultOfficial165Btn && resultOfficial165Btn.dataset.bound !== "1") { resultOfficial165Btn.dataset.bound = "1"; resultOfficial165Btn.addEventListener("click", openOfficial165Website); }
  const open165Btn = $("familyOpen165Btn");
  if (open165Btn && open165Btn.dataset.bound !== "1") { open165Btn.dataset.bound = "1"; open165Btn.addEventListener("click", openOfficial165Website); }
  const clearAllBtn = $("familyClearAllBtn");
  if (clearAllBtn && clearAllBtn.dataset.bound !== "1") { clearAllBtn.dataset.bound = "1"; clearAllBtn.addEventListener("click", clearAllFamilyRecords); }
  const closeBtn = $("familyDetailCloseBtn");
  if (closeBtn && closeBtn.dataset.bound !== "1") { closeBtn.dataset.bound = "1"; closeBtn.addEventListener("click", () => { if ($("familyRecordDetail")) $("familyRecordDetail").hidden = true; }); }
  const input = $("familyCodeInput");
  if (input && input.dataset.bound !== "1") { input.dataset.bound = "1"; input.addEventListener("input", event => { const code = normalizeFamilyInputValue(event.target.value); event.target.value = code || normalizeFamilyCode(event.target.value); if (code && code.length === 6) scheduleFamilyAutoJoin(code); }); }
  ["joinFamilyBtn"].forEach(id => { const btn = $(id); if (btn && btn.dataset.nativeRefreshBound !== "1") { btn.dataset.nativeRefreshBound = "1"; btn.addEventListener("click", () => { setTimeout(() => renderAppFamilyDashboard(), 900); }, true); } });
  renderAppFamilyDashboard();
}
document.addEventListener("DOMContentLoaded", bindNativeFamilyDashboard);
setTimeout(bindNativeFamilyDashboard, 600);
window.renderAppFamilyDashboard = renderAppFamilyDashboard;
window.updateAppFamilyDashboard = updateAppFamilyDashboard;
window.clearAllFamilyRecords = clearAllFamilyRecords;
window.openLineInvite = openLineInvite;
window.copyLineInviteText = copyLineInviteText;
window.loadLineBindStatus = loadLineBindStatus;
window.testLinePush = testLinePush;
// ==========================================
// ✅ 正式版：長輩專用介面自動化邏輯 (終極完全體)
// ==========================================
(function() {
  document.addEventListener("DOMContentLoaded", () => {
    setTimeout(() => {
      const inputEl = document.getElementById("familyCodeInput");
      const boxes = document.querySelectorAll(".senior-boxes .s-box");
      const stateUnconnected = document.getElementById("senior-state-unconnected");
      const stateConnected = document.getElementById("senior-state-connected");
      
      if (!inputEl) return;

      // 1. 監聽輸入：支援英文大寫與數字
      inputEl.addEventListener("input", (e) => {
        let val = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
        e.target.value = val;

        boxes.forEach((box, idx) => {
          if (idx < val.length) {
            box.textContent = val[idx];
            box.style.borderColor = "#06C755";
            box.style.backgroundColor = "#ffffff";
          } else {
            box.textContent = "";
            box.style.borderColor = "#cbd5e1";
            box.style.backgroundColor = "#f8fafc";
          }
        });

        // 滿 6 碼自動觸發連線
        if (val.length === 6) {
          // 【關鍵修正】一打滿6碼，馬上強制把這組代碼死記進手機記憶體！
          localStorage.setItem("family_code", val); 

          if (typeof scheduleFamilyAutoJoin === "function") {
             scheduleFamilyAutoJoin(val);
          } else {
             const legacyInput = document.getElementById("familyCodeInput"); 
             if(legacyInput) legacyInput.value = val;
             const joinBtn = document.getElementById("joinFamilyBtn");
             if(joinBtn) {
                 joinBtn.disabled = false;
                 joinBtn.click();
             }
          }
        }
      });

      // 2. 剪貼簿一鍵貼上功能
      const pasteBtn = document.getElementById("senior-paste-btn");
      if (pasteBtn) {
        pasteBtn.onclick = async () => {
          try {
            const text = await navigator.clipboard.readText();
            const match = text.toUpperCase().match(/[A-Z0-9]{6}/);
            if (match) {
              inputEl.value = match[0];
              inputEl.dispatchEvent(new Event('input'));
            } else {
              alert("剪貼簿裡沒有找到 6 碼的代碼喔！請重新複製。");
            }
          } catch (err) {
            alert("無法讀取剪貼簿，請手動輸入。");
          }
        };
      }

      // 3. 自動偵測連線狀態
      setInterval(() => {
        const isBound = localStorage.getItem("family_code") || localStorage.getItem("familyId");
        if (isBound) {
          if (stateUnconnected) stateUnconnected.style.display = "none";
          if (stateConnected) stateConnected.style.display = "block";
        } else {
          if (stateUnconnected) stateUnconnected.style.display = "block";
          if (stateConnected) stateConnected.style.display = "none";
          document.getElementById("senior-qr-container").style.display = "none"; 
          if (inputEl.value === "") {
            boxes.forEach(box => {
              box.textContent = ""; box.style.borderColor = "#cbd5e1"; box.style.backgroundColor = "#f8fafc";
            });
          }
        }
      }, 500);

      // 4. 【終極版】取得真正的代碼
      function getRealFamilyCode() {
        // 第一順位：舊系統隱藏文字 (伺服器確認過的)
        const legacyCodeText = document.getElementById("familyCodeText");
        if (legacyCodeText && legacyCodeText.innerText && legacyCodeText.innerText !== "------" && legacyCodeText.innerText.trim() !== "") {
            return legacyCodeText.innerText.trim();
        } 
        
        // 第二順位：記憶體裡的 (可能剛輸入滿6碼強制存入的)
        let memCode = localStorage.getItem("family_code") || localStorage.getItem("familyId");
        if (memCode) return memCode;

        // 第三順位：【關鍵修正】看畫面上輸入框裡現在寫了什麼！(解決從電腦貼上還沒存檔的問題)
        if (inputEl && inputEl.value && inputEl.value.length === 6) {
            localStorage.setItem("family_code", inputEl.value);
            return inputEl.value;
        }

        // 第四順位：真的全部都沒有，才自己產生一組亂數
        const newCode = Math.floor(100000 + Math.random() * 900000).toString();
        localStorage.setItem("family_code", newCode);
        if (typeof renderAppFamilyDashboard === "function") renderAppFamilyDashboard();
        return newCode;
      }

      // 5. LINE 邀請與顯示 QR Code
      async function handleLineInvite() {
        const currentCode = getRealFamilyCode();
        const inviteMsg = `這是我在用的防詐盾牌，我的家人連線數字是：【 ${currentCode} 】，請幫我在手機輸入連線，一起守護我們家！`;
        try {
          await navigator.clipboard.writeText(inviteMsg);
          alert("LINE 邀請文字已複製。\n請打開 LINE，選家人後長按貼上並送出。");
        } catch (e) {
          alert(inviteMsg);
        }
      }

      document.getElementById("senior-line-invite-1")?.addEventListener("click", handleLineInvite);
      document.getElementById("senior-line-invite-2")?.addEventListener("click", handleLineInvite);

      const showQrBtn = document.getElementById("senior-show-qr-btn");
      if (showQrBtn) {
        showQrBtn.onclick = () => {
          const currentCode = getRealFamilyCode();
          const qrContainer = document.getElementById("senior-qr-container");
          const qrImg = document.getElementById("senior-qr-image");
          const qrText = document.getElementById("senior-qr-code-text");
          
          qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${currentCode}`;
          qrText.textContent = currentCode;
          
          qrContainer.style.display = qrContainer.style.display === "none" ? "block" : "none";
        };
      }

      // 6. 改連另一位家人
      document.getElementById("senior-change-connection")?.addEventListener("click", () => {
        if (confirm("確定要改連另一位家人嗎？")) {
          localStorage.removeItem("family_code");
          localStorage.removeItem("familyId");
          inputEl.value = "";
          if (typeof window.renderAppFamilyDashboard === "function") window.renderAppFamilyDashboard();
        }
      });
    }, 1500);
  });
})();

/* === Android WebView LINE intent 防呆：禁止 App 內直接導向 line.me / intent:// === */
(function installLineIntentGuard(){
  if (window.__AI_SHIELD_LINE_INTENT_GUARD__) return;
  window.__AI_SHIELD_LINE_INTENT_GUARD__ = true;
  document.addEventListener("click", async function(event){
    const link = event.target && event.target.closest ? event.target.closest("a[href]") : null;
    if (!link) return;
    const href = String(link.getAttribute("href") || "");
    if (/^(intent:\/\/|line:\/\/|https?:\/\/line\.me\/R\/(msg|share|oaMessage))/i.test(href)) {
      event.preventDefault();
      event.stopPropagation();
      const text = link.dataset.inviteText || link.textContent || href;
      try { await navigator.clipboard.writeText(text); } catch (e) {}
      alert("這台手機的 App 內瀏覽器不能直接開 LINE 連結。\n\n已改成複製文字，請打開 LINE 後貼上傳給家人。");
    }
  }, true);
})();
