


    const $ = (id) => document.getElementById(id);
    const DEFAULT_API_BASE = "https://ai-anti-scam.onrender.com";
    const DEFAULT_SCAN_URL = "https://ai-anti-scam.onrender.com/api/scan";
    const DEFAULT_FAMILY_ID = "";
    const REQUEST_TIMEOUT_MS = Number(window.CONFIG?.REQUEST_TIMEOUT_MS || 12000) || 12000;
    const FORCE_KEY = "AI_SHIELD_FORCE_FALLBACK";
    const API_KEY = "AI_SHIELD_DEMO_API_BASE";
    const SHARED_FAMILY_KEY = "AI_SHIELD_FAMILY_ID";
    const FAMILY_ID_KEYS = [
      "savedFamilyID", "aiShieldPrimaryFamilyID", SHARED_FAMILY_KEY,
      "currentFamilyID", "boundFamilyID", "familyCode", "dashboardFamilyID",
      "popupFamilyID", "aiShieldFamilyID", "familyID"
    ];


    function decodeDemoText(base64Text) {
      try {
        const binary = atob(base64Text);
        const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
        return new TextDecoder("utf-8").decode(bytes);
      } catch (e) {
        return "";
      }
    }

    const SAMPLE_TEXTS = {
      high: decodeDemoText("5oKo55qE5YyF6KO56YWN6YCB5aSx5pWX77yM6KuL56uL5Y2z6KOc57mz6YGL6LK75Lim6Ly45YWl5L+h55So5Y2h6LOH5paZ77yM6YC+5pyf5bCH6YCA5Zue44CC"),
      mid: decodeDemoText("6ICB5bir5LuK5aSp6ZaL5pS+5oqV6LOH576k57WE5ZCN6aGN77yM6Lef5Zau5pON5L2c5Y+v5o6M5o+h6aOG6IKh5qmf5pyD77yM5oOz5LqG6Kej6KuL5Yqg5YWlIExJTkXjgII="),
      low: decodeDemoText("6YCZ5piv5LiA5YmH5LiA6Iis5rS75YuV6YCa55+l77yM6KuL6Iez5a6Y5pa557ay56uZ5p+l55yL5rS75YuV5pmC6ZaT6IiH5Zyw6bue44CC")
    };


    const DEMO_RESULTS = {
      high: {
        score: 92, level: "高風險", kind: "high",
        summary: "偵測到補繳費用、立即操作與索取信用卡資料等高風險特徵。",
        reason: "對方要求立即補繳運費，並引導輸入信用卡資料，符合常見釣魚詐騙流程。",
        advice: "不要點擊連結、不要輸入信用卡或驗證碼，先透過官方 App 或 165 查證。",
        tags: ["立即補繳", "信用卡資料", "逾期壓力", "疑似釣魚連結"],
        caseText: "假冒物流公司補繳運費，誘導輸入信用卡卡號與簡訊驗證碼。",
        similarity: "91%"
      },
      mid: {
        score: 58, level: "中風險", kind: "mid",
        summary: "偵測到投資邀請與高報酬暗示，需要進一步查證來源。",
        reason: "訊息包含投資群組、老師帶單與獲利暗示，已出現投資詐騙常見話術。",
        advice: "不要加入陌生投資群組，不要提供個資或匯款，先確認對方身分與合法資訊。",
        tags: ["投資群組", "老師帶單", "獲利暗示"],
        caseText: "假投資老師邀請加入 LINE 群組，逐步引導儲值或匯款。",
        similarity: "74%"
      },
      low: {
        score: 16, level: "低風險", kind: "low",
        summary: "目前未偵測到明顯詐騙特徵，仍建議保持一般警覺。",
        reason: "內容未出現付款、驗證碼、帳戶凍結、限時壓力或異常連結等主要風險訊號。",
        advice: "可正常瀏覽；若出現要求輸入個資、信用卡或驗證碼，請重新掃描。",
        tags: ["一般內容", "未命中高風險詞"],
        caseText: "一般網站瀏覽與普通訊息，未符合常見詐騙案例。",
        similarity: "18%"
      }
    };

    function normalizeFamilyCode(value) {
      return String(value || "").trim().toUpperCase()
        .replace(/^AISHIELD:/, "").replace(/^FAM-/, "")
        .replace(/[^A-Z0-9]/g, "").slice(0, 6);
    }

    function getUrlParams() {
      try { return new URLSearchParams(window.location.search || ""); }
      catch (e) { return new URLSearchParams(); }
    }

    function getUrlFamilyID() {
      const params = getUrlParams();
      return normalizeFamilyCode(params.get("familyID") || params.get("familyId") || params.get("fid") || "");
    }

    function getFamilyID() {
      const fromUrl = getUrlFamilyID();
      if (fromUrl.length === 6) return fromUrl;

      for (const key of FAMILY_ID_KEYS) {
        try {
          const value = normalizeFamilyCode(localStorage.getItem(key));
          if (value.length === 6) return value;
        } catch (e) {}
      }

      const input = normalizeFamilyCode($("familyCodeInput")?.value);
      if (input.length === 6) return input;

      return "";
    }

    async function getStoredFamilyID() {
      try {
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
          const storage = await chrome.storage.local.get(FAMILY_ID_KEYS);
          for (const key of FAMILY_ID_KEYS) {
            const value = normalizeFamilyCode(storage?.[key]);
            if (value.length === 6) return value;
          }
        }
      } catch (e) {}

      return getFamilyID();
    }

    function saveFamilyID(familyID = getFamilyID()) {
      const code = normalizeFamilyCode(familyID);

      if (!code) {
        $("familyCodeInput").value = "";
        $("familyCodeText").textContent = "尚未綁定";
        $("familyPill").textContent = "家庭：尚未綁定";
        return "";
      }

      try {
        FAMILY_ID_KEYS.forEach(key => localStorage.setItem(key, code));
        localStorage.setItem("aiShieldFamilyBindingUpdatedAt", new Date().toISOString());
        localStorage.setItem("aiShieldFamilyBindingSource", "app-demo");
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
          const payload = {
            aiShieldFamilyBindingUpdatedAt: new Date().toISOString(),
            aiShieldFamilyBindingSource: "app-demo"
          };
          FAMILY_ID_KEYS.forEach(key => { payload[key] = code; });
          chrome.storage.local.set(payload);
        }
      } catch (e) {}

      $("familyCodeInput").value = code;
      $("familyCodeText").textContent = code;
      $("familyPill").textContent = `家庭：${code}`;
      return code;
    }

    function isForceFallback() {
      const params = getUrlParams();
      return params.get("forceFallback") === "1" || localStorage.getItem(FORCE_KEY) === "1";
    }

    function updateModeUI() {
      const forced = isForceFallback();
      $("modePill").textContent = forced ? "強制本機備援" : "雲端 AI 優先";
      $("modePill").className = forced ? "pill pill-yellow" : "pill pill-blue";
    }

    function getApiUrlInput() {
      const value = $("apiUrl").value.trim() || DEFAULT_SCAN_URL;
      try { localStorage.setItem(API_KEY, value); } catch (e) {}
      return value.replace(/\/+$/, "");
    }

    function getApiCandidates(rawValue) {
      const value = String(rawValue || DEFAULT_SCAN_URL).trim().replace(/\/+$/, "");
      const candidates = [];
      const push = (url) => { if (url && !candidates.includes(url)) candidates.push(url); };

      if (/\/api\/scan$|\/scan$|\/api\/analyze$/i.test(value)) {
        push(value);
        push(value.replace(/\/api\/analyze$/i, "/api/scan"));
        return candidates;
      }

      push(`${value}/api/scan`);
      push(`${value}/scan`);
      push(`${value}/api/analyze`);
      return candidates;
    }

    function getApiBaseFromEndpoint(endpoint) {
      try {
        const url = new URL(endpoint);
        return `${url.protocol}//${url.host}`;
      } catch (e) {
        return DEFAULT_API_BASE;
      }
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

    async function fetchWithTimeout(url, options = {}, timeout = REQUEST_TIMEOUT_MS) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      try {
        return await fetch(url, { ...options, signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
    }

    async function getDemoToken(apiBase, familyID) {
      const tokenKey = "aiShieldDemoAccessToken";
      const expiresKey = "aiShieldDemoTokenExpiresAt";
      const token = localStorage.getItem(tokenKey) || "";
      const expiresAt = Number(localStorage.getItem(expiresKey) || 0);
      if (token && expiresAt && expiresAt - Math.floor(Date.now() / 1000) > 300) return token;

      try {
        const res = await fetchWithTimeout(`${apiBase}/api/auth/install`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            installID: getOrCreateInstallID(),
            userID: getOrCreateUserID(),
            familyID,
            source: "app-demo"
          })
        }, 8000);
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.accessToken) {
          localStorage.setItem(tokenKey, data.accessToken);
          localStorage.setItem(expiresKey, String(data.expiresAt || data.expires_at || 0));
          return data.accessToken;
        }
      } catch (e) {}
      return "";
    }

    function scoreToKind(score) {
      const value = Number(score || 0);
      if (value >= 70) return "high";
      if (value >= 40) return "mid";
      return "low";
    }

    function scoreToLevel(score) {
      const kind = scoreToKind(score);
      return kind === "high" ? "高風險" : kind === "mid" ? "中風險" : "低風險";
    }

    function normalizeArray(value) {
      if (Array.isArray(value)) return value.filter(Boolean).map(String);
      if (typeof value === "string" && value.trim()) return value.split(/[、,，;；\n]/).map(s => s.trim()).filter(Boolean);
      return [];
    }

    function classifyInput(text, url) {
      const source = `${text || ""}\n${url || ""}`.toLowerCase();
      let result;
      if (/信用卡|驗證碼|補繳|運費|凍結|立即|逾期|cvv|otp|匯款|轉帳|帳戶|qr code|qrcode/.test(source)) {
        result = { ...DEMO_RESULTS.high };
      } else if (/投資|飆股|老師|群組|獲利|保證|穩賺|內線|usdt|幣圈/.test(source)) {
        result = { ...DEMO_RESULTS.mid };
      } else {
        result = { ...DEMO_RESULTS.low };
      }
      result.source = isForceFallback() ? "強制本機備援模式" : "本機輔助判斷";
      return result;
    }

    function normalizeApiResult(data = {}) {
      const report = data.report && typeof data.report === "object" ? data.report : data;
      const score = Math.max(0, Math.min(100, Number(
        report.riskScore ?? report.RiskScore ?? report.risk_score ?? report.score ?? data.score ?? 0
      ) || 0));
      const kind = scoreToKind(score);
      const tags = normalizeArray(report.scamDNA || report.scam_dna || report.tags || report.matchedKeywords || data.tags);
      const cases = data.similarCases || data.similar_cases || report.similarCases || report.similar_cases || [];
      const firstCase = Array.isArray(cases) && cases.length ? cases[0] : null;

      return {
        score,
        kind,
        level: report.riskLevel || report.risk_level || scoreToLevel(score),
        summary: score >= 70 ? "雲端 AI 偵測到高風險詐騙特徵，建議立即停止操作。" :
                 score >= 40 ? "雲端 AI 偵測到可疑訊號，建議先查證。" :
                 "雲端 AI 目前未偵測到明顯高風險特徵。",
        reason: report.reason || data.reason || "雲端 AI 已完成分析，但未回傳詳細原因。",
        advice: report.advice || data.advice || (score >= 70 ? "請立即停止操作，不要輸入個資、信用卡、驗證碼或匯款。" : "請保持警覺並查證來源。"),
        tags: tags.length ? tags.slice(0, 6) : [score >= 70 ? "高風險訊號" : score >= 40 ? "可疑訊號" : "未命中高風險詞"],
        caseText: firstCase?.title || firstCase?.type || "後端未回傳相似案例，已顯示 AI 判斷摘要。",
        similarity: firstCase?.similarity ? `${firstCase.similarity}` : "--",
        source: "雲端 AI / Flask API"
      };
    }

    async function scanWithApi(text, url) {
      const familyID = saveFamilyID();
      const apiInput = getApiUrlInput();
      const endpoints = getApiCandidates(apiInput);
      let lastError = null;

      for (const endpoint of endpoints) {
        const apiBase = getApiBaseFromEndpoint(endpoint);
        const token = await getDemoToken(apiBase, familyID);
        const headers = { "Content-Type": "application/json" };
        if (token) headers.Authorization = `Bearer ${token}`;

        try {
          const res = await fetchWithTimeout(endpoint, {
            method: "POST",
            headers,
            body: JSON.stringify({
              text,
              url,
              title: "AI 防詐盾牌 App Demo",
              familyID,
              source: "app_demo",
              demoMode: true,
              suppressLine: true,
              suppressLineAlert: true
            })
          });

          const data = await res.json().catch(() => ({}));
          if (res.ok) {
            const result = normalizeApiResult(data);
            if (data.linePushSuppressed) {
              result.source = `${result.source}｜Demo 不推 LINE`;
            }
            return result;
          }
          lastError = new Error(data.message || data.error || `HTTP ${res.status}`);
          if (res.status !== 404) break;
        } catch (e) {
          lastError = e;
          break;
        }
      }

      throw lastError || new Error("雲端掃描失敗");
    }

    async function scanContent(text, url) {
      if (isForceFallback()) {
        const result = classifyInput(text, url);
        result.summary = `${result.summary}（展示模式：已強制啟用本機備援）`;
        return result;
      }

      try {
        return await scanWithApi(text, url);
      } catch (e) {
        const result = classifyInput(text, url);
        result.summary = `${result.summary}（雲端連線不穩，已啟用本機備援）`;
        result.errorMessage = e?.name === "AbortError" ? "雲端分析連線逾時" : String(e?.message || e || "雲端分析失敗");
        return result;
      }
    }

    function setResultClass(kind) {
      const card = $("resultCard");
      const score = $("scoreBox");
      card.className = `card result ${kind}`;
      score.className = `score ${kind}`;
    }

    function renderTags(tags, kind) {
      const box = $("tagList");
      box.replaceChildren();
      (Array.isArray(tags) && tags.length ? tags : ["未提供明確標籤"]).forEach(text => {
        const span = document.createElement("span");
        span.className = "tag" + (kind === "high" ? " danger" : "");
        span.textContent = String(text);
        box.appendChild(span);
      });
    }

    function renderCases(result) {
      const box = $("cases");
      box.replaceChildren();
      if (!result.caseText) return;

      const div = document.createElement("div");
      div.className = "case";
      const title = document.createElement("b");
      title.textContent = "相似詐騙案例比對";
      const p1 = document.createElement("p");
      p1.textContent = result.caseText;
      const p2 = document.createElement("p");
      p2.className = "muted";
      p2.textContent = `相似度：${result.similarity || "--"}`;
      div.appendChild(title);
      div.appendChild(p1);
      div.appendChild(p2);
      box.appendChild(div);
    }

    function getHistoryKey() {
      return `AI_SHIELD_APP_DEMO_HISTORY_${saveFamilyID()}`;
    }

    function addHistory(result, input) {
      const key = getHistoryKey();
      const records = JSON.parse(localStorage.getItem(key) || "[]");
      records.unshift({
        time: new Date().toLocaleString("zh-TW", { hour12: false }),
        score: result.score,
        level: result.level,
        source: result.source,
        text: input.text.slice(0, 40),
        url: input.url
      });
      localStorage.setItem(key, JSON.stringify(records.slice(0, 20)));
      renderHistory();
    }

    function renderHistory() {
      const box = $("historyList");
      box.replaceChildren();
      const records = JSON.parse(localStorage.getItem(getHistoryKey()) || "[]");
      if (!records.length) {
        const p = document.createElement("p");
        p.className = "muted";
        p.textContent = "尚無紀錄。";
        box.appendChild(p);
        return;
      }
      records.slice(0, 5).forEach(record => {
        const div = document.createElement("div");
        div.className = "history-item";
        const b = document.createElement("b");
        b.textContent = `${record.level}｜${record.score}/100`;
        const p = document.createElement("p");
        p.className = "muted";
        p.textContent = `${record.time}｜${record.source}`;
        const q = document.createElement("p");
        q.textContent = record.text || record.url || "未提供內容";
        div.appendChild(b);
        div.appendChild(p);
        div.appendChild(q);
        box.appendChild(div);
      });
    }

    function renderResult(result) {
      $("resultCard").style.display = "block";
      setResultClass(result.kind);
      $("riskScore").textContent = result.score;
      $("riskLevel").textContent = result.level;
      $("summary").textContent = result.summary;
      $("reason").textContent = result.reason;
      $("advice").textContent = result.advice;
      $("sourcePill").textContent = `判定來源：${result.source || "未知"}`;
      $("familyPill").textContent = `家庭：${saveFamilyID()}`;
      renderTags(result.tags, result.kind);
      renderCases(result);
      if (result.kind === "high") setTimeout(() => playBilingualWarning({ silent: true }), 250);
    }

    function speak(text) {
      if (!("speechSynthesis" in window)) {
        alert("這台裝置不支援語音播放。");
        return;
      }
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = "zh-TW";
      utter.rate = 0.9;
      speechSynthesis.cancel();
      speechSynthesis.speak(utter);
    }

    function playBilingualWarning(options = {}) {
      const audio = $("bilingualWarningAudio");
      if (!audio) {
        speak("這個內容可能是詐騙，請先不要操作，問家人確認。");
        return;
      }
      try { speechSynthesis.cancel(); } catch (e) {}
      audio.currentTime = 0;
      const promise = audio.play();
      if (promise && typeof promise.catch === "function") {
        promise.catch(() => {
          if (!options.silent) alert("瀏覽器阻擋自動播放，請再按一次雙語提醒。");
        });
      }
    }

    function openDashboard() {
      const familyID = saveFamilyID();
      const url = `dashboard.html?familyID=${encodeURIComponent(familyID)}&autoStart=1`;
      const opened = window.open(url, "_blank");
      if (!opened) alert("瀏覽器阻擋新視窗，請允許彈出視窗後再試。");
    }

    function setSample(type) {
      const normalized = String(type || "").toLowerCase();
      if (normalized === "high") {
        $("targetUrl").value = "https://parcel-pay.example.com";
        $("message").value = SAMPLE_TEXTS.high;
      } else if (normalized === "mid") {
        $("targetUrl").value = "";
        $("message").value = SAMPLE_TEXTS.mid;
      } else {
        $("targetUrl").value = "https://www.gov.tw";
        $("message").value = SAMPLE_TEXTS.low;
      }
    }

    function loadSelectedCaseFromConsole() {
      const params = getUrlParams();
      const caseFromUrl = String(params.get("case") || params.get("caseType") || "").toLowerCase();

      if (["high", "mid", "low"].includes(caseFromUrl)) {
        setSample(caseFromUrl);
        $("scanHint").textContent = `已從 Demo Console 自動帶入${caseFromUrl === "high" ? "高風險" : caseFromUrl === "mid" ? "中風險" : "低風險"}案例。`;
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
        $("scanHint").textContent = `已從 Demo Console 自動帶入${payload.label || "展示案例"}。`;
        return true;
      } catch (e) {
        return false;
      }
    }

    document.addEventListener("DOMContentLoaded", async () => {
      const apiFromStorage = localStorage.getItem(API_KEY);
      if (apiFromStorage) $("apiUrl").value = apiFromStorage;
      saveFamilyID(await getStoredFamilyID());
      updateModeUI();
      renderHistory();
      loadSelectedCaseFromConsole();

      $("familyCodeInput").addEventListener("input", event => {
        event.target.value = normalizeFamilyCode(event.target.value);
      });
      $("syncFamilyBtn").addEventListener("click", () => {
        saveFamilyID($("familyCodeInput").value);
        renderHistory();
        alert(`已同步家庭代碼：${getFamilyID()}`);
      });

      $("sampleHigh").addEventListener("click", () => setSample("high"));
      $("sampleMid").addEventListener("click", () => setSample("mid"));
      $("sampleLow")?.addEventListener("click", () => setSample("low"));

      $("scanBtn").addEventListener("click", async () => {
        const text = $("message").value.trim();
        const url = $("targetUrl").value.trim();
        let scanText = text;
        let scanUrl = url;
        if (!scanText && !scanUrl) {
          setSample("high");
          scanText = $("message").value.trim();
          scanUrl = $("targetUrl").value.trim();
          $("scanHint").textContent = "未輸入內容，已自動帶入展示測試案例。";
        }

        $("scanBtn").textContent = "掃描中...";
        $("scanBtn").disabled = true;
        $("scanHint").textContent = isForceFallback() ? "正在使用強制本機備援模式..." : "正在優先嘗試雲端 AI 分析...";

        try {
          const result = await scanContent(scanText, scanUrl);
          renderResult(result);
          addHistory(result, { text: scanText, url: scanUrl });
          $("scanHint").textContent = `掃描完成｜${result.source}`;
        } catch (e) {
          alert("掃描流程發生異常，請稍後再試。");
          console.error(e);
        } finally {
          $("scanBtn").textContent = "立即掃描";
          $("scanBtn").disabled = false;
        }
      });

      $("voiceZhBtn").addEventListener("click", () => {
        speak("這個內容可能有詐騙風險，請不要輸入信用卡、驗證碼或匯款，先問家人確認。");
      });
      $("voiceTwBtn").addEventListener("click", () => playBilingualWarning());
      $("notifyBtn").addEventListener("click", () => {
        saveFamilyID();
        localStorage.setItem(`AI_SHIELD_LAST_FAMILY_ALERT_${getFamilyID()}`, JSON.stringify({
          time: new Date().toISOString(),
          message: "App Demo 偵測到高風險內容，已通知家人查看戰情室。"
        }));
        alert(`Demo：已通知家庭 ${getFamilyID()}。`);
      });
      $("openDashboardBtn").addEventListener("click", openDashboard);
    });
  