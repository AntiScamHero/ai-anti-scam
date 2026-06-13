// AI 防詐盾牌｜blocked 專業簡化版
// 用途：只顯示高風險攔截畫面。只有外部攔截 externalBlocked=1 才做戰情室備援送出，App 內掃描不重複送。
(function () {
  'use strict';

  const OFFICIAL_API_BASE = 'https://ai-anti-scam.onrender.com';
  const RETURN_SECONDS = 5;

  function $(id) { return document.getElementById(id); }
  function normalizeCode(value) {
    return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  }
  function safeDecode(value) {
    const text = String(value || '');
    try { return decodeURIComponent(text); } catch (e) { return text; }
  }
  function safeJsonParse(value) {
    if (!value) return null;
    if (typeof value === 'object') return value;
    try { return JSON.parse(value); } catch (e) {}
    try { return JSON.parse(safeDecode(value)); } catch (e) {}
    return null;
  }
  function getParams() { return new URLSearchParams(window.location.search || ''); }
  function isExternalBlocked(params) {
    // 正式版規則：只有明確帶 externalBlocked=1 的 blocked.html，才允許 blocked.js 備援送出。
    // blocked_url 只當作被攔截網址，不再當作送出條件，避免 App 內流程被誤判重複新增。
    return params.get('externalBlocked') === '1' || params.get('external_blocked') === '1';
  }
  function getApiBaseUrl() {
    return String((window.CONFIG && window.CONFIG.API_BASE_URL) || OFFICIAL_API_BASE).replace(/\/+$/, '');
  }
  function getPayload(params) {
    const payload = safeJsonParse(params.get('data')) || {};
    const url = payload.originalUrl || payload.url || params.get('blocked_url') || params.get('blockedUrl') || params.get('url') || params.get('original_url') || '';
    return {
      riskScore: Number(payload.riskScore || payload.score || 99) || 99,
      riskLevel: payload.riskLevel || payload.level || '高風險',
      reason: payload.reason || payload.ai_reason || params.get('reason') || '系統偵測到高風險詐騙特徵。',
      advice: payload.advice || '請不要輸入個資、信用卡、驗證碼，也不要付款或掃描 QR Code。',
      scamDNA: Array.isArray(payload.scamDNA) ? payload.scamDNA : Array.isArray(payload.tags) ? payload.tags : [],
      originalUrl: safeDecode(url),
      familyID: normalizeCode(params.get('familyID') || payload.familyID || payload.familyId || localStorage.getItem('aiShieldWelcomeFamilyID')),
      fromAppScan: params.get('fromAppScan') === '1' || params.get('alreadyReported') === '1' || payload.fromAppScan === true || payload.alreadyReported === true,
      externalBlocked: isExternalBlocked(params)
    };
  }
  function setText(id, value) {
    const el = $(id);
    if (el) el.textContent = String(value || '');
  }
  function normalizeHost(rawUrl) {
    const text = String(rawUrl || '').trim();
    if (!text) return '--';
    try {
      const url = new URL(/^https?:\/\//i.test(text) ? text : 'https://' + text.replace(/^\/+/, ''));
      return url.hostname.replace(/^www\./, '').toLowerCase() || '--';
    } catch (e) { return '--'; }
  }
  function createTag(text) {
    const tag = document.createElement('span');
    tag.className = 'detail-tag';
    tag.textContent = String(text || '高風險訊號');
    return tag;
  }
  function saveFamilyIDEverywhere(code) {
    const familyID = normalizeCode(code);
    if (!/^[A-Z0-9]{6}$/.test(familyID)) return '';
    const keys = [
      'aiShieldWelcomeFamilyID', 'aiShieldPrimaryFamilyID', 'familyID', 'currentFamilyID',
      'boundFamilyID', 'savedFamilyID', 'dashboardFamilyID', 'aiShieldFamilyID'
    ];
    const now = new Date().toISOString();
    try {
      keys.forEach(key => localStorage.setItem(key, familyID));
      localStorage.setItem('aiShieldWelcomeFamilyUpdatedAt', now);
      localStorage.setItem('aiShieldFamilyBindingSource', 'blocked_return_bridge');
      localStorage.setItem('aiShieldFamilyBindingUpdatedAt', now);
      sessionStorage.setItem('aiShieldReturnFamilyID', familyID);
    } catch (e) {}
    return familyID;
  }
  function buildReturnUrl(familyID) {
    saveFamilyIDEverywhere(familyID);
    const url = new URL('index.html', window.location.href);
    url.searchParams.set('returnFromBlocked', '1');
    url.searchParams.set('keepFamilyConnection', '1');
    return url.toString();
  }
  function returnToHome(familyID) {
    window.location.replace(buildReturnUrl(familyID));
  }
  function renderPage(payload) {
    const score = Math.max(0, Math.min(100, Number(payload.riskScore || 99) || 99));
    setText('score', score);
    setText('target-url', payload.originalUrl || '');
    setText('original-url', payload.originalUrl || '');
    setText('detail-url', payload.originalUrl || '未取得網址');
    setText('detail-domain', normalizeHost(payload.originalUrl));
    setText('detail-risk-level', payload.riskLevel || '高風險');
    setText('detail-reason', payload.reason || '系統偵測到高風險詐騙特徵。');

    const tagBox = $('detail-scam-dna');
    if (tagBox) {
      tagBox.replaceChildren();
      const tags = payload.scamDNA && payload.scamDNA.length ? payload.scamDNA : ['高風險訊號', '請先停止操作'];
      tags.slice(0, 6).forEach(tag => tagBox.appendChild(createTag(tag)));
    }

    const simpleStatus = $('app-simple-status');
    const familyBtn = $('family-help-btn');

    if (payload.fromAppScan) {
      setText('detail-sync-status', '已同步，不重複送出');
      setText('detail-sync-note', '這筆高風險已由 App 掃描流程自動同步家庭戰情室；攔截頁只顯示提醒，不會重複新增紀錄。');
      if (simpleStatus) simpleStatus.innerHTML = '🚫 已阻擋本次高風險操作<br>✅ App 已同步家庭戰情室，不重複送出';
      if (familyBtn) {
        familyBtn.disabled = true;
        familyBtn.innerHTML = '<span class="btn-main">✅ App 已通知家人</span>';
      }
    } else if (payload.externalBlocked) {
      setText('detail-sync-status', payload.familyID ? '準備通知家人' : '未綁定家庭');
      setText('detail-sync-note', payload.familyID ? '此頁為外部攔截備援，將同步家庭戰情室與 LINE。' : '尚未綁定家庭代碼，因此只顯示本機攔截提醒。');
      if (simpleStatus) simpleStatus.innerHTML = payload.familyID ? '🚫 已阻擋本次高風險操作<br>🔄 正在同步家庭戰情室' : '🚫 已阻擋本次高風險操作<br>ℹ️ 未綁定家庭，僅顯示提醒';
    } else {
      setText('detail-sync-status', '僅顯示提醒');
      setText('detail-sync-note', '正式版 blocked.js 只在 externalBlocked=1 的外部攔截情境才備援送出；此頁不會重複新增戰情室紀錄。');
      if (simpleStatus) simpleStatus.innerHTML = '🚫 已阻擋本次高風險操作<br>ℹ️ 此頁僅顯示提醒，不重複送出';
      if (familyBtn) {
        familyBtn.disabled = true;
        familyBtn.innerHTML = '<span class="btn-main">🛡️ 未重複通知</span>';
      }
    }
  }
  function setupDetailToggle() {
    const btn = $('detail-toggle-btn');
    const box = $('progressive-detail');
    if (!btn || !box) return;
    btn.addEventListener('click', () => {
      const open = box.classList.toggle('open');
      box.setAttribute('aria-hidden', open ? 'false' : 'true');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      btn.textContent = open ? '收起家人詳細原因' : '給家人看的詳細原因';
    });
  }
  async function getOrCreateToken(payload) {
    const cached = localStorage.getItem('aiShieldMobileAccessToken') || localStorage.getItem('aiShieldAccessToken') || localStorage.getItem('accessToken') || '';
    if (cached) return cached;
    try {
      const installID = localStorage.getItem('aiShieldMobileInstallId') || ('blocked_' + Date.now().toString(36));
      const userID = localStorage.getItem('aiShieldMobileUserId') || ('BLOCKED_USER_' + Math.random().toString(36).slice(2, 10).toUpperCase());
      localStorage.setItem('aiShieldMobileInstallId', installID);
      localStorage.setItem('aiShieldMobileUserId', userID);
      const res = await fetch(getApiBaseUrl() + '/api/auth/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          installID, userID, familyID: payload.familyID || 'none',
          source: 'blocked_page_backup', scan_source: 'blocked_page_backup',
          demoMode: false, suppressLine: false, suppressLineAlert: false, allowLinePush: true
        })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.accessToken) {
        localStorage.setItem('aiShieldMobileAccessToken', data.accessToken);
        localStorage.setItem('aiShieldAccessToken', data.accessToken);
        return data.accessToken;
      }
    } catch (e) {}
    return '';
  }
  async function sendBackupLineAlert(payload) {
    if (payload.fromAppScan || !payload.externalBlocked || !payload.familyID) return { skipped: true };
    const familyBtn = $('family-help-btn');
    try {
      if (familyBtn) familyBtn.innerHTML = '<span class="btn-main">🔄 正在通知家人</span>';
      const token = await getOrCreateToken(payload);
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = 'Bearer ' + token;
      const body = {
        url: payload.originalUrl || '',
        originalUrl: payload.originalUrl || '',
        domain: normalizeHost(payload.originalUrl),
        familyID: payload.familyID,
        riskScore: Math.max(0, Math.min(100, Number(payload.riskScore || 99) || 99)),
        riskLevel: payload.riskLevel || '高風險',
        reason: payload.reason || '系統偵測到高風險詐騙特徵。',
        ai_reason: payload.reason || '系統偵測到高風險詐騙特徵。',
        advice: payload.advice,
        scamDNA: payload.scamDNA || [],
        timestamp: new Date().toISOString(),
        source: 'blocked_page_backup_line_alert',
        action_type: 'blocked_page_backup_line_alert',
        summary_only: true,
        screenshot_base64: '',
        allow_screenshot_save: false,
        allowLinePush: true,
        realLinePush: true,
        suppressLine: false,
        suppressLineAlert: false,
        linePushMode: 'backup_only_when_not_app_scan',
        lineAlertTitle: '小守護緊急提醒',
        lineAlertMessage: '小守護提醒：家人剛剛遇到高風險內容，請提醒家人不要輸入資料或付款。',
        text_preview: `${normalizeHost(payload.originalUrl)}｜${payload.reason || ''}`.slice(0, 500)
      };
      const res = await fetch(getApiBaseUrl() + '/api/submit_evidence', { method: 'POST', headers, body: JSON.stringify(body) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      setText('detail-sync-status', '已同步');
      setText('detail-sync-note', '已由攔截頁備援同步家庭戰情室，並要求 LINE 通知家人。');
      if (familyBtn) {
        familyBtn.disabled = true;
        familyBtn.innerHTML = '<span class="btn-main">✅ LINE 已自動通知家人</span>';
      }
      return { ok: true };
    } catch (error) {
      setText('detail-sync-status', '通知失敗');
      setText('detail-sync-note', '備援通知家人暫時失敗，但攔截提醒仍然有效。');
      if (familyBtn) {
        familyBtn.disabled = false;
        familyBtn.innerHTML = '<span class="btn-main">⚠️ 通知失敗，重新通知家人</span>';
        familyBtn.onclick = () => sendBackupLineAlert(payload);
      }
      return { ok: false, error };
    }
  }
  function playVoice() {
    const fallbackText = '小守護提醒，這個內容很危險。請不要點，不要輸入密碼、信用卡或驗證碼，也不要付款。';
    const audio = $('hero-audio');
    if (audio) {
      try {
        audio.currentTime = 0;
        const promise = audio.play();
        if (promise && typeof promise.catch === 'function') promise.catch(() => speak(fallbackText));
        return;
      } catch (e) {}
    }
    speak(fallbackText);
  }
  function speak(text) {
    try {
      if (!('speechSynthesis' in window)) return;
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'zh-TW';
      utterance.rate = 0.88;
      speechSynthesis.cancel();
      speechSynthesis.speak(utterance);
    } catch (e) {}
  }
  function setupReturn(payload) {
    const btn = $('manual-leave-btn');
    const returnText = $('auto-return-text');
    if (returnText) returnText.textContent = '已停在安全頁，請不要回到剛剛的危險網頁。';
    if (btn) {
      btn.innerHTML = '<span class="btn-main">🏠 我知道了，回首頁</span>';
      btn.addEventListener('click', () => returnToHome(payload.familyID));
    }
  }


  document.addEventListener('DOMContentLoaded', () => {
    const params = getParams();
    const payload = getPayload(params);
    saveFamilyIDEverywhere(payload.familyID);
    window.__AI_SHIELD_FROM_APP_SCAN__ = payload.fromAppScan;
    window.__AI_SHIELD_BLOCKED_RETURN_HOME__ = () => returnToHome(payload.familyID);

    renderPage(payload);
    setupDetailToggle();
    setupReturn(payload);
    playVoice();

    const shouldBackupSubmit = payload.externalBlocked && !payload.fromAppScan;
    if (shouldBackupSubmit) {
      setTimeout(() => {
        sendBackupLineAlert(payload).catch(() => {});
      }, 150);
    } else {
      console.log('🛡️ blocked.js 未送出：App 內掃描由 app.js 負責，或缺少 externalBlocked=1。');
    }

    console.log('🛡️ blocked 專業簡化版已啟動', {
      fromAppScan: payload.fromAppScan,
      externalBlocked: payload.externalBlocked,
      backupSubmit: shouldBackupSubmit,
      familyID: payload.familyID || '(none)',
      riskScore: payload.riskScore
    });
  });
})();
