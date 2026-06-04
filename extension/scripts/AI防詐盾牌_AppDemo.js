// App Demo 四項優化擴充版
    const $ = (id) => document.getElementById(id);

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

    function normalizeFamilyCode(value) {
      return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
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

    function getModeLabel() {
      return FORCE_FALLBACK_MODE ? "強制本機備援模式" : "雲端 AI 優先 / 失敗自動備援";
    }

    function getModeDescription() {
      return FORCE_FALLBACK_MODE
        ? "本次展示不呼叫雲端 API，直接使用 App 內建本機判斷，適合決賽展示容錯能力。"
        : "正常模式會先呼叫 /api/scan，若雲端逾時或失敗才自動切換本機備援。";
    }

    function updateAppModeUI() {
      const banner = $("appModeBanner");
      const title = $("appModeTitle");
      const desc = $("appModeDesc");
      const modeText = $("modeText");

      if (banner) banner.classList.toggle("fallback", FORCE_FALLBACK_MODE);
      if (title) title.textContent = "目前模式：" + getModeLabel();
      if (desc) desc.textContent = getModeDescription();
      if (modeText) modeText.textContent = getModeLabel();
    }

    function getUrlFamilyID() {
      return normalizeFamilyCode(getUrlParams().get("familyID") || getUrlParams().get("family") || "");
    }

    function getFamilyID() {
      const fromUrl = getUrlFamilyID();
      if (fromUrl.length === 6) return fromUrl;

      for (const key of FAMILY_ID_SYNC_KEYS) {
        try {
          const value = normalizeFamilyCode(localStorage.getItem(key));
          if (value.length === 6) return value;
        } catch (e) {}
      }

      return "";
    }

    async function getStoredFamilyID() {
      try {
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
          const storage = await chrome.storage.local.get(FAMILY_ID_SYNC_KEYS);
          for (const key of FAMILY_ID_SYNC_KEYS) {
            const value = normalizeFamilyCode(storage?.[key]);
            if (value.length === 6) return value;
          }
        }
      } catch (e) {}

      return getFamilyID();
    }

    async function saveFamilyID(familyID) {
      const code = normalizeFamilyCode(familyID);
      if (!code) {
        updateFamilyCodeUI("");
        return "";
      }

      try {
        FAMILY_ID_SYNC_KEYS.forEach(key => localStorage.setItem(key, code));
        localStorage.setItem("aiShieldFamilyBindingUpdatedAt", new Date().toISOString());
        localStorage.setItem("aiShieldFamilyBindingSource", "app-demo-formal");
      } catch (e) {}

      try {
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
          const payload = {
            aiShieldFamilyBindingUpdatedAt: new Date().toISOString(),
            aiShieldFamilyBindingSource: "app-demo-formal"
          };
          FAMILY_ID_SYNC_KEYS.forEach(key => { payload[key] = code; });
          await chrome.storage.local.set(payload);
        }
      } catch (e) {}

      updateFamilyCodeUI(code);
      return code;
    }

    function updateFamilyCodeUI(code) {
      const safeCode = normalizeFamilyCode(code);
      const text = safeCode || "尚未綁定";
      document.querySelectorAll("#familyCodeText").forEach(el => { el.textContent = text; });
    }


    const screens = ["home", "scan", "result", "family", "history"];

    // 優先讀取 config.js 中的配置，保持架構一致性
    const API_BASE_URL = (
      window.CONFIG?.API_BASE_URL ||
      "https://ai-anti-scam.onrender.com"
    ).replace(/\/+$/, "");

    let FAMILY_ID = "";
    const REQUEST_TIMEOUT_MS = Number(window.CONFIG?.REQUEST_TIMEOUT_MS || 12000) || 12000;

    const demoResults = {
      high: {
        score: 92,
        level: "高風險",
        kind: "high",
        summary: "偵測到補繳費用、立即操作與索取信用卡資料等高風險特徵。",
        reason: "對方要求立即補繳運費，並引導輸入信用卡資料，符合常見釣魚詐騙流程。",
        advice: "不要點擊連結、不要輸入信用卡或驗證碼，先透過官方 App 或 165 查證。",
        tags: ["立即補繳", "信用卡資料", "逾期壓力", "疑似釣魚連結"],
        caseText: "假冒物流公司補繳運費，誘導輸入信用卡卡號與簡訊驗證碼。",
        similarity: "91%",
        source: "本機輔助判斷",
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
        source: "本機輔助判斷",
        family: "使用者的裝置偵測到可疑投資訊息，風險分數 58/100。建議先查證，不要加入陌生投資群組。"
      },
      low: {
        score: 16,
        level: "低風險",
        kind: "low",
        summary: "目前未偵測到明顯詐騙特徵，仍建議保持一般警覺。",
        reason: "內容未出現付款、驗證碼、帳戶凍結、限時壓力或異常連結等主要風險訊號。",
        advice: "可正常瀏覽，但只要出現要求輸入個資、信用卡或驗證碼，仍應重新掃描。",
        tags: ["一般內容", "未命中高風險詞"],
        caseText: "一般網站瀏覽與普通訊息，未符合常見詐騙案例。",
        similarity: "18%",
        source: "本機輔助判斷",
        family: "使用者的裝置完成安全掃描，風險分數 16/100，目前未偵測到明顯詐騙特徵。"
      }
    };

    let latestResult = demoResults.high;

    // 全域動態紀錄陣列，初始化預設 3 筆歷史資料
    const scanRecords = [
      createRecordFromResult(demoResults.high, {
        title: "高風險｜包裹補繳運費",
        url: "https://parcel-pay.example.com",
        text: "包裹配送失敗，請立即補繳運費並輸入信用卡資料。"
      }),
      createRecordFromResult(demoResults.mid, {
        title: "中風險｜投資群組邀請",
        url: "",
        text: "老師開放投資群組名額，跟單操作掌握飆股機會。"
      }),
      createRecordFromResult(demoResults.low, {
        title: "低風險｜一般網站瀏覽",
        url: "https://www.gov.tw",
        text: "一般活動通知。"
      })
    ];

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
      const now = new Date();
      $("clock").textContent = now.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false });
    }
    updateClock();
    setInterval(updateClock, 1000 * 30);

    function go(screen) {
      screens.forEach(name => {
        const el = $("screen-" + name);
        if (el) el.classList.toggle("active", name === screen);
      });

      document.querySelectorAll(".nav-btn").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.screen === screen);
      });

      const area = document.querySelector(".screen-area");
      if (area) area.scrollTop = 0;
      
      if (screen === "home") updateHomeCounters();
    }

    function getNowLabel() {
      return new Date().toLocaleString("zh-TW", { hour12: false });
    }

    function updateHomeCounters() {
      if ($("homeScanCount")) $("homeScanCount").textContent = scanRecords.length;
      if ($("homeHighCount")) {
        const highCount = scanRecords.filter(r => r.kind === "high").length;
        $("homeHighCount").textContent = highCount;
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
        source: result.source || "本機輔助判斷",
        createdAt: getNowLabel()
      };
    }

    function buildRecordSub(result, input = {}) {
      const tags = Array.isArray(result.tags) ? result.tags.slice(0, 2).join("、") : "";
      const source = result.source || "本機輔助判斷";
      const hasUrl = input.url ? "含網址" : "純文字";
      return `${hasUrl}｜${tags || "未命中明確標籤"}｜${source}`;
    }

    function guessRecordTitle(text = "", url = "") {
      const source = `${text}\n${url}`.toLowerCase();
      if (/包裹|物流|運費|parcel|delivery/.test(source)) return "包裹補繳運費";
      if (/投資|股票|飆股|老師|群組/.test(source)) return "投資群組邀請";
      if (/驗證碼|otp|帳戶|凍結/.test(source)) return "帳戶安全驗證";
      if (url) return "可疑網址掃描";
      return "可疑訊息掃描";
    }

    function addScanRecord(result, input = {}) {
      const record = createRecordFromResult(result, input);
      scanRecords.unshift(record);
      if (scanRecords.length > 20) scanRecords.splice(20);
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
      const source = `${text || ""}\n${url || ""}`.toLowerCase();
      let result;

      if (/信用卡|驗證碼|補繳|運費|凍結|立即|逾期|cvv|otp|匯款|轉帳|帳戶/.test(source)) {
        result = { ...demoResults.high };
      } else if (/投資|飆股|老師|群組|獲利|保證|穩賺|內線/.test(source)) {
        result = { ...demoResults.mid };
      } else {
        result = { ...demoResults.low };
      }

      result.source = "本機輔助判斷";
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
        summary: score >= 70 ? "雲端 AI 偵測到高風險詐騙特徵，建議立即停止操作。" : score >= 40 ? "雲端 AI 偵測到可疑訊號，建議先查證。" : "雲端 AI 目前未偵測到明顯高風險特徵。",
        reason: String(report.reason || report.ai_reason || data?.reason || "雲端 AI 已完成分析，但未回傳詳細原因。"),
        advice: String(report.advice || data?.advice || (score >= 70 ? "請立即停止操作，不要輸入個資、信用卡、驗證碼或匯款。" : score >= 40 ? "建議先查證來源，不要提供個資或金流資料。" : "目前未發現明顯高風險特徵，仍請保持警覺。")),
        tags: tags.length ? tags.slice(0, 6) : [score >= 70 ? "高風險訊號" : score >= 40 ? "可疑訊號" : "未命中高風險詞"],
        caseText: firstCase?.title || firstCase?.type || report.caseText || "後端未回傳相似案例，已顯示 AI 判斷摘要。",
        similarity: firstCase?.similarity ? `${firstCase.similarity}` : "--",
        source: "雲端 AI / Flask API",
        family: `使用者的裝置完成雲端掃描，風險分數 ${score}/100。${score >= 70 ? "請提醒使用者不要點擊連結或輸入資料。" : "建議家人協助留意後續操作。"}`
      };
    }

    function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
    }

    function getOrCreateInstallID() {
      const key = "aiShieldDemoInstallId";
      let value = localStorage.getItem(key);
      if (!value) {
        value = "demo_" + (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now());
        localStorage.setItem(key, value);
      }
      return value;
    }

    function getOrCreateUserID() {
      const key = "aiShieldDemoUserId";
      let value = localStorage.getItem(key);
      if (!value) {
        value = "DEMO_USER_" + Math.random().toString(36).slice(2, 10).toUpperCase();
        localStorage.setItem(key, value);
      }
      return value;
    }

    async function ensureDemoAccessToken() {
      const tokenKey = "aiShieldDemoAccessToken";
      const expiresKey = "aiShieldDemoTokenExpiresAt";
      const token = localStorage.getItem(tokenKey) || "";
      const expiresAt = Number(localStorage.getItem(expiresKey) || 0);

      if (token && expiresAt && expiresAt - Math.floor(Date.now() / 1000) > 300) {
        return token;
      }

      const response = await fetchWithTimeout(`${API_BASE_URL}/api/auth/install`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          installID: getOrCreateInstallID(),
          userID: getOrCreateUserID(),
          familyID: FAMILY_ID || getFamilyID(),
          source: "app_demo",
          scan_source: "app_demo",
          demoMode: true,
          suppressLine: true,
          suppressLineAlert: true,
          allowLinePush: false
        })
      }, REQUEST_TIMEOUT_MS);

      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.accessToken) throw new Error(data.message || data.error || "無法取得短效權杖");
      localStorage.setItem(tokenKey, data.accessToken);
      localStorage.setItem(expiresKey, String(data.expiresAt || data.expires_at || 0));
      return data.accessToken;
    }

    async function scanWithCloudApi(text, url) {
      let token = "";
      try { token = await ensureDemoAccessToken(); } catch (e) { console.warn("App Demo 認證失敗，改走匿名掃描：", e); }

      const headers = { "Content-Type": "application/json" };
      if (token) headers.Authorization = `Bearer ${token}`;

      const response = await fetchWithTimeout(`${API_BASE_URL}/api/scan`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          text,
          url,
          title: "AI 防詐盾牌 App Demo",
          familyID: FAMILY_ID || getFamilyID(),
          source: "app_demo",
          scan_source: "app_demo",
          demoMode: true,
          suppressLine: true,
          suppressLineAlert: true,
          allowLinePush: false
        })
      }, REQUEST_TIMEOUT_MS);

      const data = await response.json().catch(() => ({}));
      if (response.ok) return normalizeApiResult(data, { text, url });
      throw new Error(data.message || data.error || `HTTP ${response.status}`);
    }

    async function scanContent(text, url) {
      if (FORCE_FALLBACK_MODE) {
        const fallback = classifyInput(text, url);
        fallback.source = "強制本機備援模式";
        fallback.summary = `${fallback.summary}（展示模式：已強制使用本機備援，未呼叫雲端 API）`;
        fallback.advice = `${fallback.advice} 目前為決賽展示用 forceFallback 模式，用來證明雲端異常時仍可提供最低限度防護。`;
        fallback.errorMessage = "";
        return fallback;
      }

      try {
        return await scanWithCloudApi(text, url);
      } catch (error) {
        const fallback = classifyInput(text, url);
        fallback.source = "本機輔助判斷";
        fallback.summary = `${fallback.summary}（雲端連線不穩，已啟用本機備援）`;
        fallback.advice = `${fallback.advice} 目前雲端分析伺服器連線不可用，展示現場已啟動本機離線防禦。`;
        fallback.errorMessage = error?.name === "AbortError" ? "連線逾時(Render喚醒中)" : String(error?.message || error || "雲端錯誤");
        console.warn("App Demo 自動無縫降級至本機分析：", error);
        return fallback;
      }
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
      $("riskLevel").textContent = result.level;
      $("riskScore").className = "score " + result.kind;
      $("riskScore").innerHTML = `${result.score}<span> / 100</span>`;
      $("resultSummary").textContent = result.summary;
      updateAppModeUI();
      if ($("modeText")) $("modeText").textContent = result.source || getModeLabel();
      $("reasonText").textContent = result.reason;
      $("adviceText").textContent = result.advice;
      $("caseText").textContent = result.caseText;
      $("caseSimilarity").textContent = result.similarity;
      $("familyMessage").textContent = result.family;
      $("resultIcon").style.display = result.kind === "low" ? "none" : "inline-block";

      // 渲染技術日誌與分析來源標籤
      if (result.errorMessage) {
        $("analysisSource").innerHTML = `本機輔助判斷 <small style="display:block;font-size:10px;color:var(--sub);margin-top:2px;font-weight:700;">(技術日誌: ${result.errorMessage})</small>`;
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
      if (type === "high") {
        $("targetUrl").value = "https://parcel-pay.example.com";
        $("message").value = "您的包裹配送失敗，請立即補繳運費並輸入信用卡資料，逾期將退回。";
      } else if (type === "mid") {
        $("targetUrl").value = "";
        $("message").value = "老師今天開放投資群組名額，跟單操作可掌握飆股機會，想了解請加入 LINE。";
      } else {
        $("targetUrl").value = "https://www.gov.tw";
        $("message").value = "這是一則一般活動通知，請至官方網站查看活動時間與地點。";
      }
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
      const audio = $("bilingualWarningAudio");
      if (!audio) { speak("這個內容可能是詐騙，請先不要操作，問家人確認。"); return; }
      try { speechSynthesis.cancel(); } catch (e) {}
      audio.currentTime = 0;
      const playPromise = audio.play();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch(() => { if (!options.silent) alert("語音被瀏覽器阻擋，請再點擊一次重試。"); });
      }
    }

    function renderHistory() {
      const list = $("historyList");
      list.replaceChildren();

      if (!scanRecords.length) {
        const empty = document.createElement("div");
        empty.className = "empty-state";
        empty.textContent = "尚無任何掃描紀錄。";
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
        list.appendChild(row);
      });
    }

    // 事件監聽綁定
    document.querySelectorAll(".nav-btn").forEach(btn => btn.addEventListener("click", () => go(btn.dataset.screen)));
    document.querySelector('[data-action="go-scan-message"]').addEventListener("click", () => { setSample("high"); go("scan"); });
    document.querySelector('[data-action="go-scan-url"]').addEventListener("click", () => { setSample("high"); go("scan"); });
    document.querySelectorAll("[data-sample]").forEach(btn => btn.addEventListener("click", () => setSample(btn.dataset.sample)));

    $("scanBtn").addEventListener("click", async () => {
      const rawText = $("message").value.trim();
      const url = $("targetUrl").value.trim();

      // 展示防呆：未輸入時自動帶入高風險範例，避免現場展示斷線。
      let workingText = rawText;
      let workingUrl = url;
      if (!workingText && !workingUrl) {
        setSample("high");
        workingText = $("message").value.trim();
        workingUrl = $("targetUrl").value.trim();
      }

      // 前端送出前做個資脫敏遮罩
      const text = maskPersonalData(workingText);

      const loading = $("scanLoading");
      const btn = $("scanBtn");
      loading.classList.add("active");
      btn.disabled = true;
      btn.textContent = "掃描中...";
      $("message").disabled = true;
      $("targetUrl").disabled = true;

      try {
        const result = await scanContent(text, workingUrl);
        renderResult(result, { autoVoice: true });
        addScanRecord(result, { text, url: workingUrl });
        go("result");
      } catch (error) {
        alert("掃描連線發生異常，請重試。");
        console.error(error);
      } finally {
        loading.classList.remove("active");
        btn.disabled = false;
        btn.textContent = "立即掃描";
        $("message").disabled = false;
        $("targetUrl").disabled = false;
      }
    });

    $("clearHistoryBtn").addEventListener("click", () => {
      if (confirm("確定要清除本機上所有的 App 掃描紀錄快取嗎？\n(這不會影響已同步至雲端戰情室的歷史紀錄)")) {
        scanRecords.length = 0;
        renderHistory();
        updateHomeCounters();
      }
    });

    $("voiceZhBtn").addEventListener("click", () => speak("這個內容可能有詐騙風險，請不要輸入信用卡、驗證碼或匯款，先問家人確認。"));
    $("voiceTwBtn").addEventListener("click", () => playBilingualWarning({ silent: false }));
    $("notifyFamilyBtn").addEventListener("click", () => go("family"));
    
    $("openDashboardBtn").addEventListener("click", () => {
      const url = `dashboard.html?familyID=${encodeURIComponent(FAMILY_ID || getFamilyID())}&autoStart=1`;
      if (!window.open(url, "_blank")) {
        alert("請允許瀏覽器跳出視窗，以正常模擬開啟家庭戰情室。");
      }
    });


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

    async function initializeAppDemo() {
      FAMILY_ID = await getStoredFamilyID();
      updateFamilyCodeUI(FAMILY_ID);
      updateAppModeUI();

      const loaded = loadSelectedCaseFromConsole();
      if (!loaded && FORCE_FALLBACK_MODE) {
        setSample("high");
      }

      renderResult(demoResults.high, { autoVoice: false });
      updateHomeCounters();
    }

    // 初始化渲染
    initializeAppDemo();