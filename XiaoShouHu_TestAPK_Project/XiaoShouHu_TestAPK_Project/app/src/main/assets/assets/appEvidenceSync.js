/*
 * AI 防詐盾牌 Mobile App - 家庭 / 戰情室 / 證據同步
 * 從 background.js 與 popup.js 抽離，移除 chrome.*，改用 localStorage + fetch。
 */
(() => {
  const CONFIG = window.CONFIG || {};
  const API_BASE_URL = String(CONFIG.API_BASE_URL || "https://ai-anti-scam.onrender.com").replace(/\/+$/, "");
  const REQUEST_TIMEOUT_MS = Number(CONFIG.REQUEST_TIMEOUT_MS || 12000) || 12000;
  const FAMILY_ID_KEYS = [
    "aiShieldWelcomeFamilyID",
    "AI_SHIELD_FAMILY_ID",
    "aiShieldPrimaryFamilyID",
    "savedFamilyID",
    "currentFamilyID",
    "boundFamilyID",
    "familyCode",
    "dashboardFamilyID",
    "popupFamilyID",
    "aiShieldFamilyID",
    "familyID"
  ];
  const USER_KEY = "aiShieldMobileUserId";
  const HISTORY_KEY = "aiShieldMobileScanHistory";
  const OFFLINE_QUEUE_KEY = "aiShieldOfflineEvidenceQueue";
  const CIRCUIT_KEY = "aiShieldApiCircuitBreaker";
  const CIRCUIT_FAIL_LIMIT = Number(CONFIG.CIRCUIT_FAIL_LIMIT || 3) || 3;
  const CIRCUIT_OPEN_MS = Number(CONFIG.CIRCUIT_OPEN_MS || 30000) || 30000;
  const OFFLINE_QUEUE_LIMIT = Number(CONFIG.OFFLINE_QUEUE_LIMIT || 30) || 30;
  const memoryStorageFallback = new Map();

  function safeStorageGet(key, fallback = "") {
    try {
      const value = localStorage.getItem(key);
      return value === null || value === undefined ? fallback : value;
    } catch (e) {
      return memoryStorageFallback.has(key) ? memoryStorageFallback.get(key) : fallback;
    }
  }

  function safeStorageSet(key, value) {
    const stringValue = String(value ?? "");
    try {
      localStorage.setItem(key, stringValue);
      memoryStorageFallback.set(key, stringValue);
      return true;
    } catch (e) {
      memoryStorageFallback.set(key, stringValue);
      return false;
    }
  }

  function safeStorageRemove(key) {
    try { localStorage.removeItem(key); } catch (e) {}
    memoryStorageFallback.delete(key);
  }

  function isStoragePersistent() {
    try {
      const key = "__ai_shield_storage_probe__";
      localStorage.setItem(key, "1");
      localStorage.removeItem(key);
      return true;
    } catch (e) {
      return false;
    }
  }


  function normalizeFamilyCode(value = "") {
    const code = String(value || "")
      .trim()
      .toUpperCase()
      .replace(/^AISHIELD:/, "")
      .replace(/^FAM-/, "")
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 6);
    return /^[A-Z0-9]{6}$/.test(code) ? code : "";
  }

  function getStoredFamilyID() {
    for (const key of FAMILY_ID_KEYS) {
      try {
        const code = normalizeFamilyCode(safeStorageGet(key));
        if (code) return code;
      } catch (e) {}
    }
    return "";
  }

  function saveFamilyID(familyID) {
    const code = normalizeFamilyCode(familyID);
    if (!code) return "";
    FAMILY_ID_KEYS.forEach(key => safeStorageSet(key, code));
    const now = new Date().toISOString();
    safeStorageSet("aiShieldWelcomeFamilyID", code);
    safeStorageSet("aiShieldWelcomeFamilyUpdatedAt", now);
    safeStorageSet("aiShieldFamilyBindingUpdatedAt", now);
    safeStorageSet("aiShieldFamilyBindingSource", "mobile-app");
    return code;
  }

  function getOrCreateUserID() {
    let value = safeStorageGet(USER_KEY);
    if (!value) {
      value = "MOBILE_USER_" + Math.random().toString(36).slice(2, 10).toUpperCase();
      safeStorageSet(USER_KEY, value);
    }
    return value;
  }

  function getInstallID() {
    const key = CONFIG.INSTALL_ID_STORAGE_KEY || "aiShieldMobileInstallId";
    let value = safeStorageGet(key);
    if (!value) {
      value = "mob_" + (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now());
      safeStorageSet(key, value);
    }
    return value;
  }

  function readCircuitState() {
    try {
      return JSON.parse(safeStorageGet(CIRCUIT_KEY) || "{}") || {};
    } catch (e) {
      return {};
    }
  }

  function writeCircuitState(state = {}) {
    try {
      safeStorageSet(CIRCUIT_KEY, JSON.stringify({
        failures: Number(state.failures || 0),
        openedUntil: Number(state.openedUntil || 0),
        lastError: String(state.lastError || ""),
        updatedAt: new Date().toISOString()
      }));
    } catch (e) {}
  }

  function isCircuitOpen() {
    const state = readCircuitState();
    return Number(state.openedUntil || 0) > Date.now();
  }

  function getCircuitStatus() {
    const state = readCircuitState();
    const openedUntil = Number(state.openedUntil || 0);
    return {
      isOpen: openedUntil > Date.now(),
      failures: Number(state.failures || 0),
      openedUntil,
      retryAfterMs: Math.max(0, openedUntil - Date.now()),
      lastError: state.lastError || ""
    };
  }

  function recordApiSuccess() {
    writeCircuitState({ failures: 0, openedUntil: 0, lastError: "" });
  }

  function recordApiFailure(error) {
    const state = readCircuitState();
    const failures = Number(state.failures || 0) + 1;
    const shouldOpen = failures >= CIRCUIT_FAIL_LIMIT;
    writeCircuitState({
      failures,
      openedUntil: shouldOpen ? Date.now() + CIRCUIT_OPEN_MS : 0,
      lastError: error?.message || String(error || "API request failed")
    });
  }

  function loadOfflineQueue() {
    try {
      const list = JSON.parse(safeStorageGet(OFFLINE_QUEUE_KEY) || "[]");
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function saveOfflineQueue(list = []) {
    let queue = Array.isArray(list) ? list.slice(-OFFLINE_QUEUE_LIMIT) : [];
    let saved = safeStorageSet(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
    while (!saved && queue.length > 0) {
      queue = queue.slice(Math.min(5, queue.length));
      saved = safeStorageSet(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
    }
    return saved;
  }

  function enqueueOfflineEvidence(payload = {}, reason = "") {
    const list = loadOfflineQueue();
    list.push({
      id: payload.recordID || `offline_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      payload,
      reason: String(reason || "network_unavailable"),
      createdAt: new Date().toISOString(),
      attempts: 0
    });
    saveOfflineQueue(list);
    return list.length;
  }

  async function flushOfflineQueue() {
    if (isCircuitOpen() || !navigator.onLine) {
      return { ok: false, reason: "offline_or_circuit_open", remaining: loadOfflineQueue().length };
    }

    const queue = loadOfflineQueue();
    if (!queue.length) return { ok: true, sent: 0, remaining: 0 };

    const remaining = [];
    let sent = 0;

    for (const item of queue) {
      try {
        const response = await resilientFetch(`${API_BASE_URL}/api/submit_evidence`, {
          method: "POST",
          headers: await getApiHeaders({ familyID: item.payload?.familyID }),
          body: JSON.stringify(item.payload)
        }, REQUEST_TIMEOUT_MS, { bypassQueue: true });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.message || data.error || `HTTP ${response.status}`);
        sent += 1;
      } catch (error) {
        item.attempts = Number(item.attempts || 0) + 1;
        item.lastError = error?.message || String(error);
        item.lastAttemptAt = new Date().toISOString();
        remaining.push(item);
      }
    }

    saveOfflineQueue(remaining);
    return { ok: remaining.length === 0, sent, remaining: remaining.length };
  }

  function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
  }

  async function resilientFetch(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS, extra = {}) {
    if (!extra.ignoreCircuit && isCircuitOpen()) {
      const status = getCircuitStatus();
      throw new Error(`API 暫時降級中，約 ${Math.ceil(status.retryAfterMs / 1000)} 秒後再試`);
    }

    try {
      const response = await fetchWithTimeout(url, options, timeoutMs);
      if (response.ok) {
        recordApiSuccess();
      } else if (response.status >= 500 || response.status === 429) {
        recordApiFailure(new Error(`HTTP ${response.status}`));
      }
      return response;
    } catch (error) {
      recordApiFailure(error);
      throw error;
    }
  }

  async function ensureAccessToken(options = {}) {
    const tokenKey = CONFIG.ACCESS_TOKEN_STORAGE_KEY || "aiShieldAccessToken";
    const expiresKey = CONFIG.TOKEN_EXPIRES_AT_STORAGE_KEY || "aiShieldTokenExpiresAt";
    const token = safeStorageGet(tokenKey) || "";
    const expiresRaw = Number(safeStorageGet(expiresKey) || 0);
    const expiresMs = expiresRaw > 9999999999 ? expiresRaw : expiresRaw * 1000;
    const refreshWindow = Number(CONFIG.TOKEN_REFRESH_WINDOW_MS || 300000) || 300000;
    if (token && expiresMs - Date.now() > refreshWindow) return token;

    const userID = options.userID || getOrCreateUserID();
    const familyID = normalizeFamilyCode(options.familyID || getStoredFamilyID()) || "none";
    const response = await resilientFetch(`${API_BASE_URL}/api/auth/install`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        installID: getInstallID(),
        userID,
        familyID,
        source: "mobile_app"
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.accessToken) throw new Error(data.message || data.error || "無法取得授權權杖");
    safeStorageSet(tokenKey, data.accessToken);
    safeStorageSet(expiresKey, String(data.expiresAt || data.expires_at || 0));
    if (data.userID) safeStorageSet(USER_KEY, data.userID);
    if (data.familyID && normalizeFamilyCode(data.familyID)) saveFamilyID(data.familyID);
    return data.accessToken;
  }

  async function getApiHeaders(options = {}) {
    const headers = { "Content-Type": "application/json" };
    try {
      const token = await ensureAccessToken(options);
      if (token) headers.Authorization = `Bearer ${token}`;
    } catch (e) {
      console.warn("Mobile App token 暫時不可用：", e?.message || e);
    }
    return headers;
  }

  async function createFamily(userID = getOrCreateUserID()) {
    const response = await resilientFetch(`${API_BASE_URL}/api/create_family`, {
      method: "POST",
      headers: await getApiHeaders({ userID }),
      body: JSON.stringify({ uid: userID, userID, installID: getInstallID(), source: "mobile_app" })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.status !== "success") throw new Error(data.message || data.error || "建立家庭失敗");
    const code = normalizeFamilyCode(data.inviteCode || data.familyID);
    if (!code) throw new Error("後端沒有回傳有效家庭代碼");
    saveFamilyID(code);
    if (data.accessToken) safeStorageSet(CONFIG.ACCESS_TOKEN_STORAGE_KEY || "aiShieldAccessToken", data.accessToken);
    if (data.expiresAt || data.expires_at) safeStorageSet(CONFIG.TOKEN_EXPIRES_AT_STORAGE_KEY || "aiShieldTokenExpiresAt", String(data.expiresAt || data.expires_at));
    return { code, data };
  }

  async function joinFamily(code, userID = getOrCreateUserID()) {
    const familyID = normalizeFamilyCode(code);
    if (!familyID) throw new Error("請輸入正確的 6 碼家庭代碼。");
    const response = await resilientFetch(`${API_BASE_URL}/api/join_family`, {
      method: "POST",
      headers: await getApiHeaders({ userID, familyID }),
      body: JSON.stringify({ uid: userID, userID, inviteCode: familyID, familyID, installID: getInstallID(), source: "mobile_app" })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.status !== "success") throw new Error(data.message || data.error || "綁定家庭失敗");
    saveFamilyID(familyID);
    if (data.accessToken) safeStorageSet(CONFIG.ACCESS_TOKEN_STORAGE_KEY || "aiShieldAccessToken", data.accessToken);
    if (data.expiresAt || data.expires_at) safeStorageSet(CONFIG.TOKEN_EXPIRES_AT_STORAGE_KEY || "aiShieldTokenExpiresAt", String(data.expiresAt || data.expires_at));
    return { code: familyID, data };
  }

  async function fetchFamilyAlerts(familyID = getStoredFamilyID()) {
    const code = normalizeFamilyCode(familyID);
    if (!code) return [];
    const response = await resilientFetch(`${API_BASE_URL}/api/get_alerts`, {
      method: "POST",
      headers: await getApiHeaders({ familyID: code }),
      body: JSON.stringify({ familyID: code, source: "mobile_app" })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.status !== "success") throw new Error(data.message || data.error || "讀取家庭紀錄失敗");
    return Array.isArray(data.data) ? data.data : [];
  }

  function loadLocalHistory() {
    try { return JSON.parse(safeStorageGet(HISTORY_KEY) || "[]"); } catch (e) { return []; }
  }

  function saveLocalHistory(records = []) {
    safeStorageSet(HISTORY_KEY, JSON.stringify(records.slice(0, 50)));
  }

  function normalizeScore(value) {
    const score = Number(value || 0);
    return Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 0;
  }

  function readLinePushDemoMap() {
    const key = CONFIG.LINE_PUSH_DEMO_STORAGE_KEY || "aiShieldDemoLinePushEnabledByFamily";
    try {
      const parsed = JSON.parse(safeStorageGet(key) || "{}");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function isLinePushAllowedForFamily(familyID = getStoredFamilyID(), extra = {}) {
    if (extra.allowLinePush !== undefined) return Boolean(extra.allowLinePush);
    const code = normalizeFamilyCode(familyID);
    const map = readLinePushDemoMap();
    if (code && Object.prototype.hasOwnProperty.call(map, code)) return Boolean(map[code]);

    const localFlags = [
      "allowLinePush",
      "allowDemoLinePush",
      "aiShieldLinePushTestEnabled",
      "aiShieldDemoLinePushEnabled",
      "aiShieldAllowDemoLinePush",
      "aiShieldDashboardLinePushTestEnabled"
    ];

    return localFlags.some(key => /^(1|true|yes|on)$/i.test(String(safeStorageGet(key) || "")));
  }

  function buildMobileEvidencePayload(result = {}, input = {}, extra = {}) {
    const score = normalizeScore(result.score || result.riskScore);
    const familyID = normalizeFamilyCode(extra.familyID || getStoredFamilyID()) || "none";
    const allowLinePush = isLinePushAllowedForFamily(familyID, extra);
    const riskLevel = result.level || (score >= 70 ? "高風險" : score >= 40 ? "中風險" : "低風險");
    const reason = result.reason || "手機版手動掃描偵測到高風險內容。";

    return {
      url: input.url || result.input?.url || "",
      timestamp: new Date().toISOString(),
      familyID,
      screenshot_base64: "",
      summary_only: true,
      reported_reason: reason,
      reason,
      riskScore: score,
      riskLevel,
      recordID: extra.recordID || `mobile_scan_${Date.now()}`,
      source: extra.source || "mobile_app_manual_scan",
      action_type: extra.action_type || "mobile_app_manual_scan",
      allowLinePush,
      realLinePush: allowLinePush,
      suppressLine: !allowLinePush,
      suppressLineAlert: !allowLinePush,
      linePushMode: allowLinePush ? "enabled_by_dashboard_toggle" : "disabled",
      lineAlertTitle: extra.lineAlertTitle || (score >= 70 ? "小守護緊急提醒" : "小安心提醒"),
      lineAlertMessage: extra.lineAlertMessage || (score >= 70
        ? `小守護提醒：家人遇到${riskLevel}內容，風險分數 ${score}/100。請協助確認。`
        : `小安心提醒：家人完成檢查，${riskLevel}，風險分數 ${score}/100。`),
      demoMode: Boolean(extra.demoMode),
      allow_screenshot_save: false,
      text_preview: String(input.text || result.input?.text || "").slice(0, 500)
    };
  }

  const reportedClientErrors = new Map();

  async function reportClientError(error, context = {}) {
    const message = error?.message || String(error || "unknown_error");
    const key = `${context.source || "client"}:${message.slice(0, 120)}`;
    const last = reportedClientErrors.get(key) || 0;
    if (Date.now() - last < 60 * 1000) return false;
    reportedClientErrors.set(key, Date.now());
    try {
      await resilientFetch(`${API_BASE_URL}/api/log_error`, {
        method: "POST",
        headers: await getApiHeaders({ familyID: getStoredFamilyID() }),
        body: JSON.stringify({
          message,
          context,
          familyID: getStoredFamilyID() || "none",
          source: "mobile_app_frontend",
          timestamp: new Date().toISOString()
        })
      }, Math.min(REQUEST_TIMEOUT_MS, 6000), { ignoreCircuit: true });
      return true;
    } catch (e) {
      return false;
    }
  }

  async function submitRiskEvent(result = {}, input = {}, extra = {}) {
    const payload = buildMobileEvidencePayload(result, input, extra);
    try {
      const response = await resilientFetch(`${API_BASE_URL}/api/submit_evidence`, {
        method: "POST",
        headers: await getApiHeaders({ familyID: payload.familyID }),
        body: JSON.stringify(payload)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || data.error || `同步戰情室失敗：${response.status}`);
      flushOfflineQueue().catch(() => {});
      return { ok: true, data, payload, queued: false };
    } catch (error) {
      const queueSize = enqueueOfflineEvidence(payload, error?.message || error);
      return {
        ok: false,
        queued: true,
        queueSize,
        payload,
        error: error?.message || String(error)
      };
    }
  }


  if (typeof window !== "undefined") {
    window.addEventListener("online", () => {
      setTimeout(() => flushOfflineQueue().catch(() => {}), 1200);
    });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) flushOfflineQueue().catch(() => {});
    });
    window.addEventListener("unhandledrejection", event => {
      const reason = event?.reason || {};
      const message = reason?.message || String(reason || "");
      if (/Failed to fetch|NetworkError|Load failed|AbortError|timeout|The Internet connection appears to be offline/i.test(message)) {
        event.preventDefault?.();
        reportClientError(reason, { source: "unhandledrejection", network: true }).catch(() => {});
      }
    });
  }

  window.AppEvidenceSync = Object.freeze({
    normalizeFamilyCode,
    getStoredFamilyID,
    saveFamilyID,
    getOrCreateUserID,
    getInstallID,
    fetchWithTimeout,
    resilientFetch,
    getCircuitStatus,
    flushOfflineQueue,
    loadOfflineQueue,
    enqueueOfflineEvidence,
    ensureAccessToken,
    getApiHeaders,
    createFamily,
    joinFamily,
    fetchFamilyAlerts,
    submitRiskEvent,
    buildMobileEvidencePayload,
    reportClientError,
    isStoragePersistent,
    loadLocalHistory,
    saveLocalHistory,
    HISTORY_KEY
  });
})();
