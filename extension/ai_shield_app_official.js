// AI 防詐盾牌行動端 App：正式整合版
    const AI_SHIELD_BUILD_VERSION = "20260528-v10-ai-assistant-clean-ui";
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
        ? "本次不呼叫雲端 API，直接使用 App 內建本機判斷，適合驗證雲端異常時的備援能力。"
        : "正常模式會先連線雲端 AI，若雲端逾時或失敗才自動切換本機備援。";
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


    const screens = ["home", "scan", "emergency", "result", "family", "history"];

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
    let latestScanInput = { text: "", url: "", sourceLabel: "" };

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


    function sleep(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function setPrivacyMaskStatus(message, active = true) {
      const box = $("privacyMaskStatus");
      if (!box) return;
      box.innerHTML = message || "";
      box.classList.toggle("active", Boolean(active && message));
    }

    async function applyPrivacyMaskVisual(originalText) {
      const maskedText = maskPersonalData(originalText || "");
      const hasMasked = String(originalText || "") !== String(maskedText || "");

      if (!hasMasked) {
        setPrivacyMaskStatus("", false);
        return maskedText;
      }

      const messageBox = $("message");
      if (messageBox) {
        messageBox.value = maskedText;
        messageBox.classList.add("privacy-mask-flash");
      }

      setPrivacyMaskStatus("🔒 <strong>個資已自動保護：</strong>系統已將手機、信用卡或身分證等敏感資料打碼後再進行分析。", true);
      await sleep(950);

      if (messageBox) messageBox.classList.remove("privacy-mask-flash");
      return maskedText;
    }

    function setReportStatus(message) {
      const el = $("reportStatus");
      if (el) el.textContent = message || "";
    }

    function buildErrorReportBody() {
      const score = Number(latestResult?.score || 0);
      const level = latestResult?.level || scoreToLevel(score);
      const source = latestResult?.source || getModeLabel();
      const tags = Array.isArray(latestResult?.tags) ? latestResult.tags.join("、") : "";
      return [
        "AI 防詐盾牌｜判斷不準回報",
        "",
        "【目前判定】",
        `風險等級：${level}`,
        `風險分數：${score}/100`,
        `判定來源：${source}`,
        `命中特徵：${tags || "未提供"}`,
        "",
        "【AI 判斷原因】",
        latestResult?.reason || "未提供",
        "",
        "【AI 建議動作】",
        latestResult?.advice || "未提供",
        "",
        "【使用者提供內容（已盡量遮蔽個資）】",
        `網址：${latestScanInput.url || "未提供"}`,
        `文字：${maskPersonalData(latestScanInput.text || $("message")?.value || "") || "未提供"}`,
        "",
        "【請協助補充】",
        "1. 這筆應該是：□ 高風險詐騙 □ 中風險可疑 □ 低風險正常",
        "2. 判斷不準的原因：",
        "3. 其他補充："
      ].join("\n");
    }

    async function reportIncorrectResult() {
      const body = buildErrorReportBody();
      const subject = "AI 防詐盾牌｜判斷不準回報";
      setReportStatus("已整理本次掃描摘要，準備開啟 Email 回報。");
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(body);
          setReportStatus("已將回報內容複製到剪貼簿，並準備開啟 Email。");
        }
      } catch (e) {}
      const mailto = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      window.location.href = mailto;
    }


    function updateClock() {
      const now = new Date();
      $("clock").textContent = now.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false });
    }
    updateClock();
    setInterval(updateClock, 1000 * 30);

    function triggerHighRiskVibration() {
      if (!navigator.vibrate) return;
      try { navigator.vibrate([300, 150, 300, 150, 300]); } catch (e) {}
    }

    function buildLineHelpMessage() {
      const score = Number(latestResult?.score || 0);
      const level = latestResult?.level || scoreToLevel(score);
      const reason = latestResult?.reason || "系統偵測到可疑特徵。";
      const advice = latestResult?.advice || "請先不要點連結、不要輸入個資或匯款。";
      return [
        "🆘【AI 防詐盾牌求助】",
        "",
        `我剛剛收到一則可疑訊息，系統判定為「${level}」，風險分數 ${score}/100。`,
        "",
        `AI 判斷原因：${reason}`,
        "",
        `建議動作：${advice}`,
        "",
        "可以幫我確認這是不是詐騙嗎？"
      ].join("\n");
    }

    function openLineHelp() {
      const message = buildLineHelpMessage();
      const lineUrl = `https://line.me/R/msg/text/?${encodeURIComponent(message)}`;
      window.location.href = lineUrl;
    }


    function buildFriendShareMessage() {
      const pageUrl = `${location.origin}${location.pathname}`;
      return [
        "我找到一個可以幫忙檢查可疑簡訊、網址和 QR Code 的防詐工具：AI 防詐盾牌。",
        "遇到包裹補繳、假客服、假投資、假親友借錢或陌生連結，可以先用它檢查，不要急著點連結或匯款。",
        pageUrl
      ].join("\n");
    }

    function shareToLineFriends() {
      const message = buildFriendShareMessage();
      window.location.href = `https://line.me/R/msg/text/?${encodeURIComponent(message)}`;
    }


    const AI_THINKING_STEPS = [
      "✨ AI 正在讀取您的內容...",
      "🔍 正在比對常見詐騙話術...",
      "🧠 正在分析網址、語意與壓力關鍵字...",
      "🛡️ 正在產生安全建議..."
    ];
    let aiThinkingTimer = null;

    function setAiThinkingText(text) {
      const el = $("aiThinkingText");
      if (el) el.textContent = text || AI_THINKING_STEPS[0];
    }

    function startAiThinking(sourceLabel = "") {
      const loading = $("scanLoading");
      if (!loading) return;
      let index = 0;
      setAiThinkingText(sourceLabel ? `✨ AI 正在處理「${sourceLabel}」...` : AI_THINKING_STEPS[0]);
      loading.classList.add("active");
      clearInterval(aiThinkingTimer);
      aiThinkingTimer = setInterval(() => {
        index = (index + 1) % AI_THINKING_STEPS.length;
        setAiThinkingText(AI_THINKING_STEPS[index]);
      }, 1350);
    }

    function stopAiThinking(finalText = "✅ 分析完成！") {
      clearInterval(aiThinkingTimer);
      aiThinkingTimer = null;
      setAiThinkingText(finalText);
      const loading = $("scanLoading");
      if (loading) loading.classList.remove("active");
    }

    function toggleAiToolPanel(force) {
      const panel = $("aiToolPanel");
      const btn = $("aiToolToggleBtn");
      if (!panel || !btn) return;
      const next = typeof force === "boolean" ? force : !panel.classList.contains("active");
      panel.classList.toggle("active", next);
      btn.setAttribute("aria-expanded", next ? "true" : "false");
      btn.innerHTML = next
        ? '<span class="ai-plus">−</span> 收起輔助工具'
        : '<span class="ai-plus">＋</span> 我不會貼上，改用其他方式';
    }

    function enableDeveloperDemoMode() {
      document.body.classList.toggle("dev-mode");
      const enabled = document.body.classList.contains("dev-mode");
      setClipboardStatus(enabled ? "展示測試模式已開啟，可使用高／中／低風險範例。" : "展示測試模式已關閉。", enabled ? "success" : "");
    }

    function resetSensitiveInputState() {
      if ($("message")) $("message").value = "";
      if ($("targetUrl")) $("targetUrl").value = "";
      if ($("ocrExtractedText")) $("ocrExtractedText").value = "";
      if ($("screenshotInput")) $("screenshotInput").value = "";
      if ($("ocrPreview")) $("ocrPreview").removeAttribute("src");
      if ($("ocrPreviewWrap")) $("ocrPreviewWrap").classList.remove("active");
      if ($("ocrTextBox")) $("ocrTextBox").classList.remove("active");
      if ($("privacyMaskStatus")) $("privacyMaskStatus").classList.remove("active");
      stopAiThinking("");
      setVoiceStatus("");
      setClipboardStatus("");
      setQrStatus("掃描到網址後，系統會先送 AI 防詐分析，不會直接開啟網頁。", "");
      setOcrStatus("請選擇一張包含可疑訊息的截圖。", null);
      latestScanInput = { text: "", url: "", sourceLabel: "" };
    }

    function applyZeroRetentionIfNeeded(screen) {
      const previousScreen = document.body?.dataset?.currentScreen || "";
      const leavingScanToSafeArea = previousScreen === "scan" && !["scan", "result"].includes(screen);
      if (screen !== "home" && !leavingScanToSafeArea) return;
      try { stopSafeQrScanner({ hide: true }); } catch (e) {}
      resetSensitiveInputState();
    }

    function go(screen) {
      applyZeroRetentionIfNeeded(screen);
      if (document.body) document.body.dataset.currentScreen = screen;

      screens.forEach(name => {
        const el = $("screen-" + name);
        if (el) el.classList.toggle("active", name === screen);
      });

      document.querySelectorAll(".nav-btn").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.screen === screen);
      });

      const area = document.querySelector(".screen-area");
      if (area) area.scrollTop = 0;
      
      if (screen === "home") {
        updateHomeCounters();
      }
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
      const hadUrl = Boolean(String(input.url || "").trim());
      const hadText = Boolean(String(input.text || "").trim());
      return {
        id: "scan_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8),
        kind: result.kind || scoreToKind(score),
        score,
        level,
        title: input.title || `${level}｜${guessRecordTitle(input.text, input.url)}`,
        sub: buildRecordSub(result, input),
        url: "",
        text: "",
        hadUrl,
        hadText,
        sensitiveCleared: true,
        tags: Array.isArray(result.tags) ? result.tags.slice(0, 6) : [],
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
      try { token = await ensureDemoAccessToken(); } catch (e) { console.warn("App 認證失敗，改走匿名掃描：", e); }

      const headers = { "Content-Type": "application/json" };
      if (token) headers.Authorization = `Bearer ${token}`;

      const response = await fetchWithTimeout(`${API_BASE_URL}/api/scan`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          text,
          url,
          title: "AI 防詐盾牌",
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
        fallback.summary = `${fallback.summary}（已使用本機備援，未呼叫雲端 API）`;
        fallback.advice = `${fallback.advice} 目前為本機備援模式，用來確保雲端異常時仍可提供基本防護。`;
        fallback.errorMessage = "";
        return fallback;
      }

      try {
        return await scanWithCloudApi(text, url);
      } catch (error) {
        const fallback = classifyInput(text, url);
        fallback.source = "本機輔助判斷";
        fallback.summary = `${fallback.summary}（雲端連線不穩，已啟用本機備援）`;
        fallback.advice = `${fallback.advice} 目前雲端分析伺服器連線不可用，已啟動本機離線防護。`;
        fallback.errorMessage = error?.name === "AbortError" ? "連線逾時(Render喚醒中)" : String(error?.message || error || "雲端錯誤");
        console.warn("App 自動降級至本機分析：", error);
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



    function escapeHTML(value) {
      return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    function extractFirstUrl(text = "", url = "") {
      const direct = String(url || "").trim();
      if (direct) return direct;
      const source = String(text || "").trim();
      const match = source.match(/https?:\/\/[^\s\u3000]+|(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s\u3000]*)?/i);
      return match ? match[0].replace(/[。？！、，,]+$/g, "") : "";
    }

    function parseUrlForMirror(raw) {
      const trimmed = String(raw || "").trim();
      if (!trimmed) return null;
      try {
        const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
        return new URL(normalized);
      } catch (e) {
        return null;
      }
    }

    function getMainDomain(hostname) {
      const host = String(hostname || "").toLowerCase().replace(/^www\./, "");
      const parts = host.split(".").filter(Boolean);
      if (parts.length <= 2) return host;
      const twoLevelSuffixes = new Set([
        "com.tw", "net.tw", "org.tw", "edu.tw", "gov.tw", "idv.tw",
        "com.hk", "com.cn", "com.jp", "co.jp", "co.uk"
      ]);
      const lastTwo = parts.slice(-2).join(".");
      if (twoLevelSuffixes.has(lastTwo) && parts.length >= 3) return parts.slice(-3).join(".");
      return parts.slice(-2).join(".");
    }

    function analyzeUrlMirror(rawUrl, text = "") {
      const found = extractFirstUrl(text, rawUrl);
      const parsed = parseUrlForMirror(found);
      if (!found || !parsed) return null;

      const host = parsed.hostname.toLowerCase();
      const mainDomain = getMainDomain(host);
      const full = String(found);
      const path = `${parsed.pathname || ""}${parsed.search || ""}`.toLowerCase();
      const beforeMainDomain = host.replace(mainDomain, "");
      const shorteners = /(^|\.)(bit\.ly|ppt\.cc|reurl\.cc|tinyurl\.com|is\.gd|lihi\d*\.cc|cutt\.ly)$/i;
      const officialHints = /(gov|政府|健保|銀行|bank|post|郵局|tax|國稅|police|警察|戶政|監理|台電|台水)/i;
      const financeHints = /(bank|銀行|card|credit|信用卡|atm|pay|payment|login|verify|otp)/i;

      let level = "low";
      let advice = "請確認網址來源是否與官方網站一致，不要只看前面的品牌字樣。";
      let tag = "網址解析";

      if (host.includes("xn--")) {
        level = "high";
        advice = "網址含有 punycode 編碼，可能利用相似字元偽裝官方網站，請不要輸入帳密或信用卡。";
        tag = "相似字元網域";
      } else if (full.includes("@")) {
        level = "high";
        advice = "網址含有 @ 符號，可能把真正前往的網域藏在後面，請不要點擊。";
        tag = "@ 偽裝網址";
      } else if (shorteners.test(host)) {
        level = "mid";
        advice = "這是短網址，會隱藏真正目的地。若涉及付款、登入或驗證碼，請先查證。";
        tag = "短網址隱藏來源";
      } else if (/(gov|政府|健保|警察|國稅|戶政|監理)/i.test(beforeMainDomain) && !/\.gov\.tw$/.test(host)) {
        level = "high";
        advice = "網址前段出現政府或機關字樣，但真實主網域不是 .gov.tw，疑似偽冒官方網站。";
        tag = "偽冒政府機關網址";
      } else if (financeHints.test(beforeMainDomain) && /(login|verify|secure|pay|payment|vip|tw|service)/i.test(mainDomain)) {
        level = "high";
        advice = "網址前段像銀行或付款服務，但真實主網域不是官方品牌，可能是釣魚登入頁。";
        tag = "偽冒金融登入網址";
      } else if (officialHints.test(full) && /(login|verify|pay|payment|card|otp|secure)/i.test(path)) {
        level = "mid";
        advice = "網址內容同時出現官方/付款語意與登入驗證路徑，請先從官方 App 或官方網站查證。";
        tag = "可疑登入付款路徑";
      }

      const escapedUrl = escapeHTML(full);
      const escapedMain = escapeHTML(mainDomain);
      const highlighted = escapedUrl.replace(
        new RegExp(escapedMain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"),
        `<span class="url-mirror-highlight">${escapedMain}</span>`
      );

      return { raw: full, host, mainDomain, highlighted, level, advice, tag };
    }

    function updateUrlMirror(rawUrl = "", text = "") {
      const card = $("urlMirrorCard");
      if (!card) return null;
      const analysis = analyzeUrlMirror(rawUrl, text);
      if (!analysis) {
        card.hidden = true;
        return null;
      }
      card.hidden = false;
      if ($("urlMirrorDisplay")) $("urlMirrorDisplay").innerHTML = analysis.highlighted;
      if ($("urlMirrorDomain")) $("urlMirrorDomain").innerHTML = `<span class="url-risk-badge ${analysis.level}">${escapeHTML(analysis.mainDomain)}</span>`;
      if ($("urlMirrorAdvice")) $("urlMirrorAdvice").textContent = analysis.advice;
      return analysis;
    }


    function getElderVerdict(kind) {
      if (kind === "high") {
        return {
          title: "危險！先不要點",
          desc: "這個內容很像詐騙，請停止操作，先問家人或撥 165 查證。"
        };
      }
      if (kind === "mid") {
        return {
          title: "注意！先問家人",
          desc: "這個內容有可疑地方，建議先暫停，不要提供個資或匯款。"
        };
      }
      return {
        title: "目前安全，仍保持警覺",
        desc: "目前沒有明顯詐騙特徵，但只要要求付款、驗證碼或帳密，請重新查證。"
      };
    }

    function renderResult(result, options = {}) {
      latestResult = result;
      if (Object.prototype.hasOwnProperty.call(options, "text") || Object.prototype.hasOwnProperty.call(options, "url")) {
        latestScanInput = {
          text: options.text || latestScanInput.text || "",
          url: options.url || latestScanInput.url || "",
          sourceLabel: latestScanInput.sourceLabel || ""
        };
      }

      $("resultHero").className = "result-hero " + result.kind;
      $("riskLevel").className = "risk-level " + result.kind;
      $("riskLevel").textContent = result.level;
      $("riskScore").className = "score " + result.kind;
      $("riskScore").innerHTML = `${result.score}<span> / 100</span>`;
      $("resultSummary").textContent = result.summary;

      const verdict = getElderVerdict(result.kind);
      if ($("elderVerdict")) $("elderVerdict").className = "elder-verdict " + result.kind;
      if ($("elderVerdictTitle")) $("elderVerdictTitle").textContent = verdict.title;
      if ($("elderVerdictDesc")) $("elderVerdictDesc").textContent = verdict.desc;

      updateAppModeUI();
      if ($("modeText")) $("modeText").textContent = result.source || getModeLabel();
      if ($("backupStatusText")) {
        if (FORCE_FALLBACK_MODE) {
          $("backupStatusText").textContent = "目前為強制本機備援模式，未呼叫雲端 API。";
        } else if (result.errorMessage) {
          $("backupStatusText").textContent = `雲端連線異常，已啟動本機備援。技術日誌：${result.errorMessage}`;
        } else if (String(result.source || "").includes("雲端")) {
          $("backupStatusText").textContent = "雲端 API 正常，本機備援未啟動。";
        } else {
          $("backupStatusText").textContent = "本次使用本機輔助判斷。";
        }
      }
      $("reasonText").textContent = result.reason;
      $("adviceText").textContent = result.advice;
      $("caseText").textContent = result.caseText;
      $("caseSimilarity").textContent = result.similarity;
      $("familyMessage").textContent = result.family;
      $("resultIcon").style.display = result.kind === "low" ? "none" : "inline-block";

      // 渲染技術日誌與分析來源標籤
      if (result.errorMessage) {
        $("analysisSource").innerHTML = `本機輔助判斷 <small style="display:block;font-size:12px;color:var(--sub);margin-top:3px;font-weight:800;">技術日誌：${result.errorMessage}</small>`;
      } else {
        $("analysisSource").textContent = result.source || getModeLabel();
      }

      updateUrlMirror(options.url || "", options.text || "");
      renderTags(result.tags || [], result.kind);
      renderHistory();

      if (options.autoVoice && result.kind === "high") {
        triggerHighRiskVibration();
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



    const scenarioRescueCases = {
      atm: {
        title: "ATM 操作求救",
        icon: "🏧",
        inputText: "我現在人在 ATM 前，對方叫我解除分期、操作退款、身份認證或轉帳到安全帳戶。",
        result: {
          score: 99,
          level: "極度危險",
          kind: "high",
          summary: "這是 ATM 操作型詐騙的最高風險情境，請立即停止操作。",
          reason: "ATM 無法解除分期付款、無法辦理退款、無法完成身分認證。只要有人用電話或 LINE 指示你操作 ATM，幾乎就是詐騙。",
          advice: "立刻按取消、拔出提款卡、離開 ATM。不要轉帳、不要輸入任何代碼，請直接撥 165 或請現場行員協助。",
          tags: ["ATM操作", "解除分期", "假客服", "轉帳壓力", "零打字求救"],
          caseText: "假客服聲稱訂單錯誤或退款失敗，要求被害人到 ATM 依照指示操作，實際上是誘導轉帳。",
          similarity: "99%",
          source: "一鍵情境求救卡",
          family: "使用者點擊「ATM 操作求救卡」，目前可能正在 ATM 前被指示操作。請立即聯絡使用者，提醒他停止操作、拔出提款卡並離開現場。"
        }
      },
      prosecutor: {
        title: "假檢警保密求救",
        icon: "👮",
        inputText: "對方說是警察、檢察官或法院，說我帳戶有問題，要求我保密、視訊辦案、匯款到安全帳戶或交出金融資料。",
        result: {
          score: 99,
          level: "極度危險",
          kind: "high",
          summary: "偵測到假檢警社交工程情境，對方正在用恐懼與保密要求控制你。",
          reason: "真正警察、檢察官、法院不會用電話或 LINE 要你匯款到安全帳戶，也不會要求你對家人保密。要求保密、視訊辦案、監管帳戶都是典型詐騙訊號。",
          advice: "立刻掛斷電話，不要視訊、不要匯款、不要交出存摺提款卡。請自行撥打 165 或官方電話查證。",
          tags: ["假檢警", "要求保密", "安全帳戶", "恐嚇話術", "社交工程"],
          caseText: "假冒檢警辦案，聲稱涉及洗錢或帳戶異常，要求被害人保密並轉帳到安全帳戶。",
          similarity: "99%",
          source: "一鍵情境求救卡",
          family: "使用者點擊「假檢警保密求救卡」，可能正被假警察或假檢察官要求保密與匯款。請立即聯絡使用者，提醒他掛斷並撥 165 查證。"
        }
      },
      familyMoney: {
        title: "親友急借錢求救",
        icon: "👨‍👩‍👧",
        inputText: "有人自稱家人、朋友、姪子或同事，說換門號、遇到急事、出車禍、住院或被扣款，要求我馬上匯款，還叫我不要問其他人。",
        result: {
          score: 96,
          level: "高風險",
          kind: "high",
          summary: "這是常見假親友借錢詐騙情境，請先不要匯款。",
          reason: "詐騙常用換門號、急需用錢、不要告訴別人等方式製造壓力。真正親友遇到急事，也應該能透過原本電話、其他家人或視訊確認身分。",
          advice: "先不要匯款。請用原本的電話號碼回撥本人，或問其他家人確認；確認前不要提供帳戶、提款卡、驗證碼或任何金錢。",
          tags: ["假親友", "換門號", "急借錢", "要求保密", "匯款壓力"],
          caseText: "詐騙者冒充親友換新門號，先建立信任，再以事故、住院或周轉為由要求匯款。",
          similarity: "96%",
          source: "一鍵情境求救卡",
          family: "使用者點擊「親友急借錢求救卡」，可能正被假親友要求匯款。請協助用原本電話或其他家人管道確認身分，並提醒使用者先不要匯款。"
        }
      }
    };

    function activateScenarioRescue(key) {
      const scenario = scenarioRescueCases[key];
      if (!scenario) return;

      const text = scenario.inputText;
      if ($("targetUrl")) $("targetUrl").value = "";
      if ($("message")) $("message").value = text;
      setVoiceStatus("");
      setClipboardStatus("已啟動一鍵情境求救卡，不需要打字，系統已直接判定為高風險。", "warn");

      const result = {
        ...scenario.result,
        tags: [...scenario.result.tags]
      };

      latestScanInput = {
        text,
        url: "",
        sourceLabel: scenario.title
      };

      renderResult(result, { autoVoice: true, text, url: "" });
      addScanRecord(result, { text, url: "", title: `${result.level}｜${scenario.title}` });
      go("result");
    }

    let escapeBellTimer = null;
    let escapeBellAudioContext = null;

    function setEscapeStatus(message) {
      const el = $("escapeStatus");
      if (el) el.textContent = message || "";
    }

    function openEscapeModal() {
      const modal = $("escapeModal");
      if (modal) modal.hidden = false;
    }

    function stopEscapeBell() {
      if (escapeBellTimer) {
        clearTimeout(escapeBellTimer);
        escapeBellTimer = null;
      }
      const btn = $("escapeBellBtn");
      if (btn) btn.classList.remove("is-ringing");
      setEscapeStatus("警鈴已停止。請先離開對方話術，再用 165 或家人管道查證。只要還不確定，就不要匯款或提供資料。");
    }

    function closeEscapeModal() {
      stopEscapeBell();
      const modal = $("escapeModal");
      if (modal) modal.hidden = true;
    }

    function playEscapeToneSequence(durationMs = 8500) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return false;

      try {
        if (!escapeBellAudioContext) escapeBellAudioContext = new AudioCtx();
        const ctx = escapeBellAudioContext;
        if (ctx.state === "suspended") ctx.resume();

        const startedAt = Date.now();
        const playTone = (freq, delay, duration) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "sine";
          osc.frequency.value = freq;
          gain.gain.setValueAtTime(0.001, ctx.currentTime + delay);
          gain.gain.exponentialRampToValueAtTime(0.28, ctx.currentTime + delay + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + duration);
          osc.connect(gain).connect(ctx.destination);
          osc.start(ctx.currentTime + delay);
          osc.stop(ctx.currentTime + delay + duration + 0.04);
        };

        const schedulePattern = () => {
          playTone(880, 0, 0.18);
          playTone(660, 0.23, 0.18);
          playTone(880, 0.50, 0.2);
          if (Date.now() - startedAt < durationMs) {
            escapeBellTimer = setTimeout(schedulePattern, 1100);
          } else {
            stopEscapeBell();
          }
        };

        schedulePattern();
        return true;
      } catch (error) {
        console.warn("緊急脫身鈴播放失敗：", error);
        return false;
      }
    }

    function startEscapeBell() {
      openEscapeModal();
      const btn = $("escapeBellBtn");
      if (btn) btn.classList.add("is-ringing");
      setEscapeStatus("警鈴播放中。請直接說：「我現在有事，等一下再說。」然後立刻掛斷電話。仍可按下方按鈕停止或撥打 165。");
      triggerHighRiskVibration();
      const played = playEscapeToneSequence();
      if (!played) {
        playBilingualWarning({ silent: true });
        speak("請立刻掛斷電話，不要繼續聽對方指示，先撥打一六五或問家人查證。");
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



    function setOcrStatus(message, progress = null) {
      const status = $("ocrStatus");
      const progressBox = $("ocrProgress");
      const bar = $("ocrProgressBar");
      if (status) status.textContent = message;
      if (progressBox && bar) {
        if (typeof progress === "number") {
          progressBox.classList.add("active");
          bar.style.width = Math.max(0, Math.min(100, progress)) + "%";
        } else {
          progressBox.classList.remove("active");
          bar.style.width = "0%";
        }
      }
    }

    function openScreenshotPicker() {
      go("scan");
      const panel = $("ocrPanel");
      if (panel) panel.classList.add("active");
      setOcrStatus("請選擇一張包含 LINE、簡訊或網頁訊息的截圖。", null);
      const input = $("screenshotInput");
      if (input) input.click();
    }

    function setVoiceStatus(message) {
      const status = $("voiceStatus");
      if (status) status.textContent = message || "";
    }


    function setVoiceRecordingState(isRecording) {
      const voiceBtn = $("voiceAskBtn");
      if (!voiceBtn) return;
      voiceBtn.classList.toggle("is-recording", Boolean(isRecording));
      const strong = voiceBtn.querySelector("strong");
      if (strong) strong.textContent = isRecording ? "正在聆聽中..." : "用說的問 AI";
    }

    function getNumberConfig(key, fallback) {
      const value = Number(window.CONFIG?.[key]);
      return Number.isFinite(value) && value > 0 ? value : fallback;
    }

    function canvasToDataUrlSafe(canvas, type, quality) {
      try {
        return canvas.toDataURL(type, quality);
      } catch (e) {
        console.warn("圖片壓縮輸出失敗，改用 PNG：", e);
        return canvas.toDataURL("image/png", 0.92);
      }
    }

    function drawScaledImageToCanvas(img, maxSide, alpha = false) {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true, alpha });
      ctx.drawImage(img, 0, 0, w, h);
      return { canvas, ctx, w, h };
    }

    async function prepareImageForOcr(file) {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const img = await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = dataUrl;
      });

      // 預覽圖走 WebP 壓縮，避免手機記憶體與前端狀態被大型截圖拖慢；OCR 圖仍在本機產生，不上傳原圖。
      const previewMaxSide = getNumberConfig("OCR_PREVIEW_MAX_SIDE", 1200);
      const previewQuality = Math.max(0.25, Math.min(0.85, getNumberConfig("OCR_PREVIEW_WEBP_QUALITY", 0.58)));
      const previewCanvas = drawScaledImageToCanvas(img, previewMaxSide, false).canvas;
      const previewUrl = canvasToDataUrlSafe(previewCanvas, "image/webp", previewQuality);

      const maxSide = getNumberConfig("OCR_PROCESS_MAX_SIDE", 1800);
      const { canvas, ctx, w, h } = drawScaledImageToCanvas(img, maxSide, false);

      // 輕量灰階與對比增強，讓手機截圖文字更容易被辨識。
      try {
        const imageData = ctx.getImageData(0, 0, w, h);
        const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
          const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
          const boosted = gray > 168 ? 255 : gray < 92 ? 0 : gray;
          data[i] = data[i + 1] = data[i + 2] = boosted;
        }
        ctx.putImageData(imageData, 0, 0);
      } catch (e) {
        console.warn("OCR 圖片前處理失敗，改用原圖：", e);
      }

      return {
        previewUrl,
        ocrUrl: canvas.toDataURL("image/png", 0.92),
        originalBytes: file.size || 0,
        previewBytes: Math.ceil((previewUrl.split(',')[1] || '').length * 3 / 4)
      };
    }

    function cleanOcrText(text) {
      return String(text || "")
        .replace(/[\u200B-\u200D\uFEFF]/g, "")
        .replace(/\s*https\s*:\s*\/\s*\//gi, " https://")
        .replace(/\s+/g, " ")
        .replace(/([。！？!?])\s+/g, "$1\n")
        .trim();
    }

    async function recognizeScreenshotText(file) {
      if (!file) return;
      if (!/^image\//.test(file.type || "")) {
        alert("請上傳圖片檔，例如截圖、JPG 或 PNG。");
        return;
      }
      if (file.size > 8 * 1024 * 1024) {
        alert("圖片太大，請改用 8MB 以下的截圖。");
        return;
      }

      const panel = $("ocrPanel");
      const wrap = $("ocrPreviewWrap");
      const preview = $("ocrPreview");
      const textBox = $("ocrTextBox");
      const out = $("ocrExtractedText");
      if (panel) panel.classList.add("active");
      if (textBox) textBox.classList.remove("active");
      if (out) out.value = "";

      try {
        setOcrStatus("正在準備圖片，會先壓縮並強化文字對比...", 8);
        const prepared = await prepareImageForOcr(file);
        if (preview) preview.src = prepared.previewUrl;
        if (wrap) wrap.classList.add("active");
        if (prepared.originalBytes && prepared.previewBytes) {
          const saved = Math.max(0, 100 - Math.round(prepared.previewBytes / prepared.originalBytes * 100));
          setOcrStatus(`圖片已在本機壓縮約 ${saved}% 並準備 OCR；原圖不會上傳後端。`, 12);
        }

        if (!window.Tesseract || typeof window.Tesseract.recognize !== "function") {
          setOcrStatus("OCR 套件尚未載入，請確認網路或改用貼上文字。", null);
          throw new Error("Tesseract.js 未載入");
        }

        setOcrStatus("正在辨識截圖文字，第一次載入模型可能需要較久...", 15);
        let result;
        try {
          result = await window.Tesseract.recognize(prepared.ocrUrl, "chi_tra+eng", {
            logger: (m) => {
              if (m.status === "recognizing text" && typeof m.progress === "number") {
                setOcrStatus(`正在辨識截圖文字... ${Math.round(m.progress * 100)}%`, 20 + Math.round(m.progress * 75));
              } else if (m.status) {
                setOcrStatus(`OCR 狀態：${m.status}`, 18);
              }
            }
          });
        } catch (e) {
          console.warn("繁中 OCR 失敗，嘗試英文模型：", e);
          result = await window.Tesseract.recognize(prepared.ocrUrl, "eng", {
            logger: (m) => {
              if (m.status === "recognizing text" && typeof m.progress === "number") {
                setOcrStatus(`正在使用備援 OCR 模型... ${Math.round(m.progress * 100)}%`, 20 + Math.round(m.progress * 75));
              }
            }
          });
        }

        const extracted = cleanOcrText(result?.data?.text || "");
        if (!extracted || extracted.length < 3) {
          setOcrStatus("辨識完成，但沒有抓到足夠文字。請換一張更清楚的截圖，或改用貼上文字。", null);
          return;
        }

        if (out) out.value = extracted;
        if (textBox) textBox.classList.remove("active");
        $("message").value = extracted;
        setOcrStatus("截圖文字已辨識完成，正在自動進行 AI 防詐掃描...", 100);

        setTimeout(() => runScanFromCurrentInput({ sourceLabel: "截圖 OCR" }), 500);
      } catch (error) {
        console.error("OCR 辨識失敗：", error);
        setOcrStatus("OCR 辨識失敗。可改用文字貼上繼續查證。", null);
      }
    }

    async function runScanFromCurrentInput(options = {}) {
      const rawText = ($("message")?.value || "").trim();
      const manualUrl = ($("targetUrl")?.value || "").trim();
      const detectedUrl = extractFirstUrl(rawText, manualUrl);

      // v10 去表單化：畫面只有一個 AI 魔法框，網址由系統自動抽取。
      let workingText = rawText;
      let workingUrl = manualUrl || detectedUrl;
      if (!workingText && !workingUrl) {
        setClipboardStatus("請先貼上可疑訊息、網址，或點「＋」改用截圖、語音、QR 掃碼。", "warn");
        toggleAiToolPanel(true);
        return;
      }

      // 前端送出前做個資脫敏遮罩，並用視覺提示讓使用者知道資料已被保護
      const text = await applyPrivacyMaskVisual(workingText);

      latestScanInput = {
        text,
        url: workingUrl,
        sourceLabel: options.sourceLabel || "手動輸入"
      };

      const btn = $("scanBtn");
      startAiThinking(options.sourceLabel || "AI 查詐騙");
      if (btn) {
        btn.disabled = true;
        btn.textContent = options.sourceLabel === "截圖 OCR" ? "OCR 掃描中..." : "AI 分析中...";
      }
      if ($("message")) $("message").disabled = true;
      if ($("targetUrl")) $("targetUrl").disabled = true;

      try {
        const result = await scanContent(text, workingUrl);
        if (options.sourceLabel === "截圖 OCR") {
          result.summary = `${result.summary}（輸入來源：截圖 OCR）`;
          result.tags = Array.from(new Set([...(result.tags || []), "截圖 OCR"])).slice(0, 7);
        }
        if (options.sourceLabel === "語音詢問") {
          result.summary = `${result.summary}（輸入來源：語音詢問）`;
          result.tags = Array.from(new Set([...(result.tags || []), "語音詢問"])).slice(0, 7);
        }
        if (options.sourceLabel === "一鍵情境求救卡") {
          result.summary = `${result.summary}（輸入來源：一鍵情境求救卡）`;
          result.tags = Array.from(new Set([...(result.tags || []), "一鍵情境求救卡"])).slice(0, 7);
        }
        if (options.sourceLabel === "QR 掃碼") {
          result.summary = `${result.summary}（輸入來源：安全 QR 掃碼）`;
          result.tags = Array.from(new Set([...(result.tags || []), "安全 QR 掃碼", "實體 QR Code"])).slice(0, 7);
        }

        const urlMirror = analyzeUrlMirror(workingUrl, text);
        if (urlMirror) {
          result.tags = Array.from(new Set([...(result.tags || []), urlMirror.tag])).slice(0, 7);
          if (urlMirror.level === "high" && Number(result.score || 0) < 75) {
            result.score = 78;
            result.kind = "high";
            result.level = "高風險";
            result.summary = `${result.summary}（網址照妖鏡偵測到可疑主網域）`;
          }
          if (urlMirror.level !== "low") {
            result.reason = `${result.reason} 網址照妖鏡提醒：${urlMirror.advice}`;
            result.advice = `${result.advice} 請特別確認真實主網域是否為官方網站。`;
          }
        }
        renderResult(result, { autoVoice: true, url: workingUrl, text });
        addScanRecord(result, { text, url: workingUrl, title: options.sourceLabel ? `${scoreToLevel(result.score)}｜${options.sourceLabel}` : undefined });
        go("result");
      } catch (error) {
        alert("掃描連線發生異常，請重試。");
        console.error(error);
      } finally {
        stopAiThinking();
        if (btn) {
          btn.disabled = false;
          btn.textContent = "✨ 幫我查是不是詐騙";
        }
        if ($("message")) $("message").disabled = false;
        if ($("targetUrl")) $("targetUrl").disabled = false;
      }
    }

    function startVoiceAsk() {
      go("scan");
      const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!Recognition) {
        setVoiceRecordingState(false);
        setVoiceStatus("這個瀏覽器不支援語音輸入，請改用文字貼上或截圖辨識。");
        return;
      }

      const recognition = new Recognition();
      recognition.lang = "zh-TW";
      recognition.interimResults = true;
      recognition.continuous = false;
      let finalText = "";
      setVoiceRecordingState(true);
      setVoiceStatus("正在聆聽，請直接說出可疑訊息內容...");
      recognition.onresult = (event) => {
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0]?.transcript || "";
          if (event.results[i].isFinal) finalText += transcript;
          else interim += transcript;
        }
        const combined = (finalText || interim).trim();
        if (combined) {
          $("message").value = combined;
          setVoiceStatus(`已聽到：${combined}`);
        }
      };
      recognition.onerror = (event) => {
        setVoiceStatus(`語音輸入失敗：${event.error || "未知錯誤"}。請改用文字貼上。`);
      };
      recognition.onend = () => {
        setVoiceRecordingState(false);
        const text = $("message").value.trim();
        if (text) {
          setVoiceStatus("語音輸入完成，正在送出 AI 分析...");
          runScanFromCurrentInput({ sourceLabel: "語音詢問" });
        } else {
          setVoiceStatus("沒有收到語音內容，請再試一次或改用文字貼上。");
        }
      };
      try {
        recognition.start();
      } catch (error) {
        setVoiceRecordingState(false);
        setVoiceStatus("語音輸入無法啟動，請改用文字貼上或截圖辨識。");
        console.warn("語音輸入啟動失敗：", error);
      }
    }


    // PWA 安裝提示：支援的瀏覽器會觸發 beforeinstallprompt；不支援時顯示手動加入說明。
    let deferredInstallPrompt = null;

    function updateInstallStatus(message) {
      const el = $("installStatus");
      if (el) el.textContent = message || "";
    }

    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      deferredInstallPrompt = event;
      updateInstallStatus("可以安裝到手機桌面。點擊上方按鈕即可加入主畫面。");
    });

    window.addEventListener("appinstalled", () => {
      deferredInstallPrompt = null;
      updateInstallStatus("已成功加入手機主畫面。");
    });

    async function installAppToHomeScreen() {
      if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        const choice = await deferredInstallPrompt.userChoice.catch(() => null);
        deferredInstallPrompt = null;
        if (choice?.outcome === "accepted") {
          updateInstallStatus("已送出安裝請求。完成後可從手機主畫面開啟。");
        } else {
          updateInstallStatus("尚未安裝。也可以稍後再加入手機主畫面。");
        }
        return;
      }

      const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent || "");
      if (isIOS) {
        updateInstallStatus("iPhone 請點 Safari 分享按鈕，再選擇「加入主畫面」。");
      } else {
        updateInstallStatus("若沒有跳出安裝視窗，請從瀏覽器選單選擇「安裝 App」或「加入主畫面」。");
      }
    }

    function setClipboardStatus(message, type = "") {
      const el = $("clipboardStatus");
      if (!el) return;
      el.textContent = message || "";
      el.className = "clipboard-status" + (type ? " " + type : "");
    }

    async function pasteClipboardToInput() {
      go("scan");

      if (!navigator.clipboard || typeof navigator.clipboard.readText !== "function") {
        setClipboardStatus("這個瀏覽器不支援一鍵讀取剪貼簿，請改用手動貼上。", "warn");
        return;
      }

      try {
        const text = await navigator.clipboard.readText();
        const cleanText = String(text || "").trim();
        if (!cleanText) {
          setClipboardStatus("剪貼簿目前沒有文字內容。", "warn");
          return;
        }

        $("message").value = cleanText;
        setClipboardStatus("已貼上剛剛複製的內容，可以直接按「立即掃描」。", "success");
        const box = $("message");
        if (box) {
          box.style.borderColor = "#16a34a";
          box.style.boxShadow = "0 0 0 4px rgba(22,163,74,.14)";
          setTimeout(() => {
            box.style.borderColor = "";
            box.style.boxShadow = "";
          }, 1200);
        }
      } catch (error) {
        console.warn("讀取剪貼簿失敗：", error);
        setClipboardStatus("無法讀取剪貼簿。請允許權限，或改用手動貼上。", "warn");
      }
    }

    const quizCases = [
      {
            "text": "【物流通知】您的包裹配送失敗，請於 30 分鐘內點擊連結補繳 12 元運費，逾期將退回。",
            "answer": "scam",
            "explain": "小額補繳是常見釣魚手法，後面通常會要求信用卡或驗證碼。",
            "remember": "包裹問題請回官方 App 查，不要點簡訊連結。"
      },
      {
            "text": "宅配司機通知：今天下午會再次配送，若不方便可在官方 App 修改收件時間。",
            "answer": "safe",
            "explain": "訊息沒有陌生連結、付款要求或驗證碼要求，風險較低。",
            "remember": "正常通知不會急著叫你付款或輸入卡號。"
      },
      {
            "text": "您的貨件海關卡關，需立即繳納保證金 1,980 元，請加入 LINE 客服處理。",
            "answer": "scam",
            "explain": "要求加入 LINE 處理費用與保證金，是常見假物流/假海關詐騙。",
            "remember": "官方費用查詢請走官方網站或 App。"
      },
      {
            "text": "郵局提醒：包裹今日已投遞至社區管理室，請攜帶證件領取。",
            "answer": "safe",
            "explain": "這是一般收件通知，沒有要求點連結、付款或提供個資。",
            "remember": "沒有金流、連結、驗證碼，通常風險較低。"
      },
      {
            "text": "【便利商店取貨】您的包裹逾期未取，請點擊短網址 reurl.cc/xxx 重新安排配送。",
            "answer": "scam",
            "explain": "短網址會隱藏真實目的地，搭配逾期壓力時要特別小心。",
            "remember": "短網址加上催促，先不要點。"
      },
      {
            "text": "【健保署通知】您的健保卡疑似遭盜用，請立即加入 LINE 客服處理，逾時將凍結帳戶。",
            "answer": "scam",
            "explain": "政府機關不會要求加入私人 LINE 辦案，也不會用威脅凍結帳戶的方式要求操作。",
            "remember": "政府機關不會用 LINE 辦案。"
      },
      {
            "text": "戶政事務所公告：本週六上午系統維護，暫停部分線上申辦服務。",
            "answer": "safe",
            "explain": "這是一般公告，沒有要求轉帳、驗證碼或陌生連結登入。",
            "remember": "公告型訊息要看是否要求你操作金流或個資。"
      },
      {
            "text": "【警政署】你涉及洗錢案件，請勿告訴家人，立刻依照指示匯款到安全帳戶。",
            "answer": "scam",
            "explain": "假檢警會要求保密與匯款，真正警察不會叫民眾匯款到安全帳戶。",
            "remember": "聽到安全帳戶就是詐騙高風險。"
      },
      {
            "text": "國稅局退稅通知：請點擊 tw-tax-refund.vip 輸入金融帳戶與提款卡密碼。",
            "answer": "scam",
            "explain": "退稅不會要求輸入提款卡密碼，且網址主網域不像官方 .gov.tw。",
            "remember": "官方政府網址通常是 .gov.tw。"
      },
      {
            "text": "監理站提醒：您的駕照即將到期，請至監理服務網或現場辦理換照。",
            "answer": "safe",
            "explain": "訊息沒有要求你點陌生網址付款，也沒有要求輸入敏感資料。",
            "remember": "可自行搜尋官方網站，不要從陌生連結進入。"
      },
      {
            "text": "老師帶單群組限時開放，保證獲利 30%，想翻身就加入 LINE 立即匯款卡位。",
            "answer": "scam",
            "explain": "保證獲利、帶單群組、要求匯款，符合假投資詐騙常見話術。",
            "remember": "投資不會保證獲利。"
      },
      {
            "text": "這檔股票有內線消息，今天不買明天漲停，先匯 5 萬進平台才能跟單。",
            "answer": "scam",
            "explain": "內線消息、漲停保證、先入金，都是假投資常見話術。",
            "remember": "先匯款才能賺錢，多半是陷阱。"
      },
      {
            "text": "銀行理專通知：若有投資需求，請至分行或官方 App 查詢基金風險說明。",
            "answer": "safe",
            "explain": "內容引導到官方管道，沒有要求私下匯款或加入陌生群組。",
            "remember": "金融投資請走合法金融機構正式管道。"
      },
      {
            "text": "虛擬貨幣平台活動，只要儲值 3 萬就送 1 萬，客服會教你避開銀行查核。",
            "answer": "scam",
            "explain": "教你避開查核、要求儲值與高額回饋，都是詐騙高風險訊號。",
            "remember": "叫你避開銀行查核的人最可疑。"
      },
      {
            "text": "朋友分享投資文章：這篇是在介紹風險，沒有叫你加入群組或匯款。",
            "answer": "safe",
            "explain": "單純風險教育文章不等於詐騙，仍需注意後續是否要求私下加入或付款。",
            "remember": "看內容目的，不要一看到投資就恐慌。"
      },
      {
            "text": "媽，我手機掉了，現在用朋友手機傳訊息，急需 2 萬，先匯到這個帳號。",
            "answer": "scam",
            "explain": "假冒親友急借錢很常見，尤其會阻止你打電話確認。",
            "remember": "借錢先打電話確認本人。"
      },
      {
            "text": "爸，我今天加班會晚點到家，晚餐不用等我。",
            "answer": "safe",
            "explain": "這是一般生活訊息，沒有金錢、驗證碼或帳戶要求。",
            "remember": "生活訊息通常不會要求你立刻轉帳。"
      },
      {
            "text": "你孫子出車禍在醫院，現在需要保證金，請先不要報警，立刻匯款。",
            "answer": "scam",
            "explain": "利用家人受傷製造恐慌，要求保密與匯款，是典型詐騙。",
            "remember": "越急越要停下來確認。"
      },
      {
            "text": "家人傳訊息說：到家記得打電話，我剛剛買了水果。",
            "answer": "safe",
            "explain": "沒有要求付款、個資或點連結，屬於一般家庭訊息。",
            "remember": "安全訊息通常不會製造壓力。"
      },
      {
            "text": "我是你姪子，換新門號了，先加我 LINE，等等有急事請你幫忙匯款。",
            "answer": "scam",
            "explain": "換門號、加 LINE、接著借錢，是假親友常見套路。",
            "remember": "換門號要用舊電話或其他家人確認。"
      },
      {
            "text": "您的帳戶異常登入，請立即提供簡訊驗證碼給客服協助解除限制。",
            "answer": "scam",
            "explain": "驗證碼等於帳戶鑰匙，任何客服都不應要求你提供。",
            "remember": "驗證碼永遠不能給別人。"
      },
      {
            "text": "銀行通知：若懷疑帳戶異常，請自行撥打信用卡背面客服電話確認。",
            "answer": "safe",
            "explain": "自行撥打卡片背面或官方電話是正確查證方式。",
            "remember": "自己找官方電話，不要回撥陌生來電。"
      },
      {
            "text": "系統偵測到您的網銀將凍結，請點擊 secure-bank-login.vip 重新驗證。",
            "answer": "scam",
            "explain": "凍結威脅與可疑登入網址，是釣魚網站常見組合。",
            "remember": "網銀登入請手動開官方 App。"
      },
      {
            "text": "LINE 傳來：請把剛收到的 6 位數驗證碼傳給我，我幫你領補助。",
            "answer": "scam",
            "explain": "補助不會要求你轉交驗證碼；驗證碼可能用來登入或盜帳號。",
            "remember": "驗證碼不是給人看的。"
      },
      {
            "text": "電信帳單通知：本期帳單已寄到 Email，可登入官方 App 查看明細。",
            "answer": "safe",
            "explain": "沒有陌生網址與立即付款壓力，指向官方 App 查詢較安全。",
            "remember": "帳單請回官方 App 查。"
      },
      {
            "text": "恭喜中獎！你獲得 iPhone，請先支付 899 元手續費並提供身分證照片。",
            "answer": "scam",
            "explain": "中獎先付費、要求身分證，是常見假抽獎詐騙。",
            "remember": "沒參加的抽獎不要信。"
      },
      {
            "text": "社區管委會公告：下週一電梯保養，請住戶留意現場公告。",
            "answer": "safe",
            "explain": "這是生活公告，沒有要求付款、密碼或個資。",
            "remember": "公告沒有金流要求通常風險較低。"
      },
      {
            "text": "水費逾期未繳，請點 bit.ly/water-pay 今日內補繳，否則立即停水。",
            "answer": "scam",
            "explain": "短網址、限時威脅、付款壓力同時出現，非常可疑。",
            "remember": "水電費請回官方 App 或帳單查。"
      },
      {
            "text": "朋友傳旅遊照片連結，內容是公開相簿，沒有要求登入或付款。",
            "answer": "safe",
            "explain": "一般相簿分享不一定是詐騙，但若要求登入帳密仍要小心。",
            "remember": "安全與否要看是否要求敏感操作。"
      },
      {
            "text": "客服說系統退款失敗，要你到 ATM 依照指示解除分期付款設定。",
            "answer": "scam",
            "explain": "ATM 不能解除分期或退款，要求操作 ATM 是典型解除分期詐騙。",
            "remember": "ATM 只能領錢轉帳，不能解除設定。"
      }
];

    let quizIndex = 0;
    let quizCorrectCount = 0;
    let quizAnswered = false;
    let quizFinished = false;

    function openQuiz() {
      quizIndex = 0;
      quizCorrectCount = 0;
      quizAnswered = false;
      quizFinished = false;
      const modal = $("quizModal");
      if (modal) modal.hidden = false;
      renderQuizQuestion();
    }

    function closeQuiz() {
      const modal = $("quizModal");
      if (modal) modal.hidden = true;
    }

    function renderQuizQuestion() {
      const item = quizCases[quizIndex];
      quizAnswered = false;

      if ($("quizQuestion")) $("quizQuestion").textContent = item.text;
      if ($("quizProgress")) $("quizProgress").textContent = `第 ${quizIndex + 1} 題 / ${quizCases.length} 題`;
      if ($("quizScore")) $("quizScore").textContent = `目前答對 ${quizCorrectCount} 題`;
      if ($("quizFeedback")) {
        $("quizFeedback").className = "quiz-feedback";
        $("quizFeedback").textContent = "";
      }
      if ($("quizNextBtn")) {
        $("quizNextBtn").style.display = "none";
        $("quizNextBtn").textContent = quizIndex === quizCases.length - 1 ? "完成模擬考" : "下一題";
      }
      if ($("quizSafeBtn")) $("quizSafeBtn").disabled = false;
      if ($("quizScamBtn")) $("quizScamBtn").disabled = false;
    }

    function answerQuiz(choice) {
      if (quizAnswered) return;
      quizAnswered = true;

      const item = quizCases[quizIndex];
      const correct = choice === item.answer;
      if (correct) quizCorrectCount += 1;

      const feedback = $("quizFeedback");
      if (feedback) {
        feedback.className = "quiz-feedback active " + (correct ? "correct" : "wrong");
        feedback.innerHTML = `${correct ? "✅ 答對了！" : "⚠️ 這題要小心！"}<br>${item.explain}${item.remember ? `<br><strong>記住：</strong>${item.remember}` : ""}`;
      }
      if ($("quizScore")) $("quizScore").textContent = `目前答對 ${quizCorrectCount} 題`;
      if ($("quizSafeBtn")) $("quizSafeBtn").disabled = true;
      if ($("quizScamBtn")) $("quizScamBtn").disabled = true;
      if ($("quizNextBtn")) $("quizNextBtn").style.display = "block";
    }

    function nextQuizQuestion() {
      if (quizFinished) { closeQuiz(); return; }
      if (quizIndex < quizCases.length - 1) {
        quizIndex += 1;
        renderQuizQuestion();
        return;
      }

      const feedback = $("quizFeedback");
      if (feedback) {
        feedback.className = "quiz-feedback active correct";
        feedback.innerHTML = `🎉 模擬考完成！<br>你答對 ${quizCorrectCount} / ${quizCases.length} 題。遇到不確定的訊息，記得先截圖、不要急著點，必要時撥 165 或問家人。`;
      }
      quizFinished = true;
      if ($("quizNextBtn")) $("quizNextBtn").textContent = "關閉";
      if ($("quizSafeBtn")) $("quizSafeBtn").disabled = true;
      if ($("quizScamBtn")) $("quizScamBtn").disabled = true;
    }




    // 安全 QR Code 掃描器：掃到後不直接開啟，而是送入既有 AI 掃描流程。
    let safeQrScanner = null;
    let safeQrRunning = false;

    function setQrStatus(message, state = "") {
      const el = $("qrStatus");
      if (!el) return;
      el.textContent = message || "";
      el.classList.remove("error", "success");
      if (state) el.classList.add(state);
    }

    function showQrScannerPanel(show = true) {
      const panel = $("qrScannerContainer");
      if (!panel) return;
      panel.classList.toggle("active", Boolean(show));
      if (show) panel.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    function normalizeQrDecodedText(value) {
      return String(value || "").trim().replace(/[。？！、，,]+$/g, "");
    }

    function isLikelyQrUrl(value) {
      const text = normalizeQrDecodedText(value);
      if (!text) return false;
      if (/^https?:\/\//i.test(text)) return true;
      return /^(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?$/i.test(text);
    }

    function stopSafeQrScanner(options = {}) {
      const hide = options.hide !== false;
      const afterStop = () => {
        safeQrRunning = false;
        if (hide) showQrScannerPanel(false);
      };

      if (!safeQrScanner || !safeQrRunning) {
        afterStop();
        return Promise.resolve();
      }

      return safeQrScanner.stop()
        .catch(() => {})
        .then(afterStop);
    }

    async function startSafeQrScanner() {
      go("scan");
      showQrScannerPanel(true);
      setQrStatus("正在啟動相機，請允許使用相機權限。", "");

      if (!window.Html5Qrcode) {
        setQrStatus("本地 QR 掃描核心尚未載入完成，請重新整理；也可以直接貼上 QR Code 內的網址。", "error");
        return;
      }

      if (safeQrRunning) {
        setQrStatus("相機已啟動，請將 QR Code 放到畫面中央。", "");
        return;
      }

      try {
        if (!safeQrScanner) safeQrScanner = new Html5Qrcode("qr-reader");
        const config = { fps: 10, qrbox: { width: 250, height: 250 }, aspectRatio: 1.0 };
        safeQrRunning = true;
        await safeQrScanner.start(
          { facingMode: "environment" },
          config,
          async (decodedText) => {
            const cleanText = normalizeQrDecodedText(decodedText);
            if (!cleanText) return;
            try { if (navigator.vibrate) navigator.vibrate([100, 50, 100]); } catch (e) {}
            setQrStatus("掃描成功，正在關閉相機並送出 AI 防詐分析...", "success");
            await stopSafeQrScanner({ hide: true });

            if (isLikelyQrUrl(cleanText)) {
              const url = /^https?:\/\//i.test(cleanText) ? cleanText : `https://${cleanText}`;
              $("targetUrl").value = url;
              $("message").value = "掃描自實體 QR Code，請協助判斷此網址是否安全。";
            } else {
              $("targetUrl").value = "";
              $("message").value = cleanText;
            }

            runScanFromCurrentInput({ sourceLabel: "QR 掃碼" });
          },
          () => {}
        );
        setQrStatus("相機已開啟。請將 QR Code 放在畫面中央，掃到後不會直接開網頁。", "");
      } catch (error) {
        console.warn("QR 掃描器啟動失敗：", error);
        safeQrRunning = false;
        showQrScannerPanel(true);
        setQrStatus("無法啟動相機。請確認已允許相機權限、使用 HTTPS 網址，或改用手動貼上網址掃描。", "error");
      }
    }

    // 事件監聽綁定
    document.querySelectorAll(".nav-btn").forEach(btn => btn.addEventListener("click", () => go(btn.dataset.screen)));
    document.querySelectorAll("[data-action]").forEach(btn => {
      btn.addEventListener("click", () => {
        const action = btn.dataset.action;
        if (action === "go-ai-scan" || action === "go-scan-message" || action === "go-scan-url") go("scan");
        if (action === "go-emergency") go("emergency");
        if (action === "go-family") go("family");
        if (action === "go-history") go("history");
        if (action === "go-upload-screenshot") openScreenshotPicker();
        if (action === "go-voice-ask") startVoiceAsk();
      });
    });
    const installAppBtn = $("installAppBtn");
    if (installAppBtn) installAppBtn.addEventListener("click", installAppToHomeScreen);
    const startQuizBtn = $("startQuizBtn");
    if (startQuizBtn) startQuizBtn.addEventListener("click", openQuiz);
    const shareFriendsBtn = $("shareFriendsBtn");
    if (shareFriendsBtn) shareFriendsBtn.addEventListener("click", shareToLineFriends);
    const aiToolToggleBtn = $("aiToolToggleBtn");
    if (aiToolToggleBtn) aiToolToggleBtn.addEventListener("click", () => toggleAiToolPanel());
    const uploadScreenshotBtn = $("uploadScreenshotBtn");
    if (uploadScreenshotBtn) uploadScreenshotBtn.addEventListener("click", openScreenshotPicker);
    const voiceAskBtn = $("voiceAskBtn");
    if (voiceAskBtn) voiceAskBtn.addEventListener("click", startVoiceAsk);
    const startQrBtn = $("startQrBtn");
    if (startQrBtn) startQrBtn.addEventListener("click", startSafeQrScanner);
    const closeQrBtn = $("closeQrBtn");
    if (closeQrBtn) closeQrBtn.addEventListener("click", () => stopSafeQrScanner({ hide: true }));
    if ($("screenshotInput")) $("screenshotInput").addEventListener("change", (event) => recognizeScreenshotText(event.target.files?.[0]));
    const pasteClipboardBtn = $("pasteClipboardBtn");
    if (pasteClipboardBtn) pasteClipboardBtn.addEventListener("click", pasteClipboardToInput);
    if ($("scanOcrTextBtn")) $("scanOcrTextBtn").addEventListener("click", () => {
      const text = $("ocrExtractedText").value.trim();
      if (text) $("message").value = text;
      runScanFromCurrentInput({ sourceLabel: "截圖 OCR" });
    });
    document.querySelectorAll("[data-sample]").forEach(btn => btn.addEventListener("click", () => setSample(btn.dataset.sample)));

    if ($("scanBtn")) $("scanBtn").addEventListener("click", () => runScanFromCurrentInput());

    let mascotTapCount = 0;
    const assistantMascotTap = $("assistantMascotTap");
    if (assistantMascotTap) {
      assistantMascotTap.addEventListener("click", () => {
        mascotTapCount += 1;
        if (mascotTapCount >= 5) {
          mascotTapCount = 0;
          enableDeveloperDemoMode();
        }
        clearTimeout(window.__aiShieldMascotTapTimer);
        window.__aiShieldMascotTapTimer = setTimeout(() => { mascotTapCount = 0; }, 1400);
      });
    }


    document.querySelectorAll("[data-scenario]").forEach(btn => {
      btn.addEventListener("click", () => activateScenarioRescue(btn.dataset.scenario));
    });

    const escapeBellBtn = $("escapeBellBtn");
    if (escapeBellBtn) escapeBellBtn.addEventListener("click", startEscapeBell);
    const stopEscapeBellBtn = $("stopEscapeBellBtn");
    if (stopEscapeBellBtn) stopEscapeBellBtn.addEventListener("click", closeEscapeModal);
    const replayEscapeBellBtn = $("replayEscapeBellBtn");
    if (replayEscapeBellBtn) replayEscapeBellBtn.addEventListener("click", startEscapeBell);
    const escapeLineHelpBtn = $("escapeLineHelpBtn");
    if (escapeLineHelpBtn) escapeLineHelpBtn.addEventListener("click", openLineHelp);
    const emergencyLineHelpBtn = $("emergencyLineHelpBtn");
    if (emergencyLineHelpBtn) emergencyLineHelpBtn.addEventListener("click", openLineHelp);
    const escapeBellMainBtn = $("escapeBellMainBtn");
    if (escapeBellMainBtn) escapeBellMainBtn.addEventListener("click", startEscapeBell);
    const escapeModal = $("escapeModal");
    if (escapeModal) {
      escapeModal.addEventListener("click", (event) => {
        if (event.target === escapeModal) closeEscapeModal();
      });
    }

    const closeQuizBtn = $("closeQuizBtn");
    if (closeQuizBtn) closeQuizBtn.addEventListener("click", closeQuiz);
    const quizSafeBtn = $("quizSafeBtn");
    if (quizSafeBtn) quizSafeBtn.addEventListener("click", () => answerQuiz("safe"));
    const quizScamBtn = $("quizScamBtn");
    if (quizScamBtn) quizScamBtn.addEventListener("click", () => answerQuiz("scam"));
    const quizNextBtn = $("quizNextBtn");
    if (quizNextBtn) quizNextBtn.addEventListener("click", nextQuizQuestion);
    const quizModal = $("quizModal");
    if (quizModal) {
      quizModal.addEventListener("click", (event) => {
        if (event.target === quizModal) closeQuiz();
      });
    }

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
    const guardianHelpBtn = $("guardianHelpBtn");
    if (guardianHelpBtn) {
      guardianHelpBtn.addEventListener("click", openLineHelp);
    }
    const reportErrorBtn = $("reportErrorBtn");
    if (reportErrorBtn) {
      reportErrorBtn.addEventListener("click", reportIncorrectResult);
    }
    
    if ($("openDashboardBtn")) $("openDashboardBtn").addEventListener("click", () => {
      const url = `dashboard.html?familyID=${encodeURIComponent(FAMILY_ID || getFamilyID())}&autoStart=1`;
      if (!window.open(url, "_blank")) {
        alert("請允許瀏覽器跳出視窗，以開啟家庭戰情室。");
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

      const params = getUrlParams();
      const requestedScreen = String(params.get("screen") || "").toLowerCase();
      if (!loaded && screens.includes(requestedScreen)) {
        go(requestedScreen);
      }

      const requestedScenario = String(params.get("scenario") || "").toLowerCase();
      const scenarioKeyMap = { atm: "atm", prosecutor: "prosecutor", familymoney: "familyMoney", family: "familyMoney" };
      if (!loaded && scenarioKeyMap[requestedScenario]) {
        go("emergency");
        setTimeout(() => activateScenarioRescue(scenarioKeyMap[requestedScenario]), 250);
      }

      if (!loaded && ["1", "true", "yes"].includes(String(params.get("escape") || "").toLowerCase())) {
        go("emergency");
        setTimeout(startEscapeBell, 350);
      }

      if (!loaded && String(params.get("action") || "").toLowerCase() === "qr") {
        go("scan");
        setTimeout(startSafeQrScanner, 600);
      }

      updateHomeCounters();
    }

    // 初始化渲染
    initializeAppDemo();

    function registerServiceWorker() {
      if (!("serviceWorker" in navigator)) return;
      if (location.protocol === "file:") return;
      window.addEventListener("load", () => {
        navigator.serviceWorker.register("./sw.js")
          .then(() => console.log("AI 防詐盾牌離線模式已啟用"))
          .catch((error) => console.warn("Service Worker 註冊失敗：", error));
      });
    }

    registerServiceWorker();
