// mobile_demo.js - AI 防詐盾牌｜手機快篩 Demo
// MV3 修正版：移除 inline script，改由外部 JS 載入，避免 Chrome Extension CSP 阻擋。
(function () {
  'use strict';

  function $(id) {
    return document.getElementById(id);
  }

  function getApiBaseUrl() {
    try {
      const value = window.CONFIG && window.CONFIG.API_BASE_URL;
      if (value) return String(value).replace(/\/$/, '');
    } catch (e) {}
    return 'http://127.0.0.1:5000';
  }

  function setDefaultApiUrl() {
    const input = $('apiUrl');
    if (!input) return;
    const fallback = input.dataset.fallbackApi || 'http://127.0.0.1:5000/api/analyze';
    const apiBase = getApiBaseUrl();
    input.value = `${apiBase}/api/analyze` || fallback;
  }

  function setResultClass(level) {
    const card = $('resultCard');
    if (!card) return;
    card.classList.remove('high', 'mid', 'low');
    if (/高|極度|危險/.test(String(level || ''))) card.classList.add('high');
    else if (/中|可疑/.test(String(level || ''))) card.classList.add('mid');
    else card.classList.add('low');
  }

  function speak(text, lang = 'zh-TW') {
    if (!('speechSynthesis' in window)) {
      alert('這台裝置不支援語音播放。');
      return;
    }
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = lang;
    utter.rate = 0.9;
    speechSynthesis.cancel();
    speechSynthesis.speak(utter);
  }

  function appendText(parent, tagName, text, className = '') {
    const el = document.createElement(tagName);
    if (className) el.className = className;
    el.textContent = String(text || '');
    parent.appendChild(el);
    return el;
  }

  function renderCases(cases = []) {
    const box = $('cases');
    if (!box) return;
    box.replaceChildren();
    if (!Array.isArray(cases) || !cases.length) return;

    const title = appendText(box, 'p', '相似詐騙案例比對');
    title.style.marginTop = '14px';
    title.style.fontWeight = '900';

    cases.slice(0, 2).forEach((item) => {
      const div = document.createElement('div');
      div.className = 'case';
      appendText(div, 'b', item.type || '未知類型');
      appendText(div, 'p', item.title || '');
      appendText(
        div,
        'p',
        `相似度：${item.similarity ?? '--'}｜命中特徵：${(item.matched_signals || []).join('、') || '無'}`,
        'muted'
      );
      box.appendChild(div);
    });
  }

  async function scanNow() {
    const scanBtn = $('scanBtn');
    const apiUrl = String($('apiUrl')?.value || '').trim();
    const text = String($('message')?.value || '').trim();
    const url = String($('targetUrl')?.value || '').trim();

    if (!apiUrl) {
      alert('請先填入 API 位置。');
      return;
    }

    if (scanBtn) {
      scanBtn.textContent = '掃描中...';
      scanBtn.disabled = true;
    }

    try {
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, url, title: 'mobile-demo' })
      });

      const data = await res.json();
      const score = data.riskScore ?? data.score ?? 0;
      const level = data.riskLevel ?? data.risk_level ?? '低風險';

      $('resultCard').style.display = 'block';
      setResultClass(level);
      $('riskScore').textContent = String(score);
      $('riskLevel').textContent = String(level);
      $('reason').textContent = data.reason || '無回傳理由';
      $('advice').textContent = data.advice || '請先暫停操作並詢問家人。';
      renderCases(data.similarCases || data.signals?.similarCases || []);
    } catch (err) {
      $('resultCard').style.display = 'block';
      setResultClass('高風險');
      $('riskScore').textContent = '--';
      $('riskLevel').textContent = '連線失敗';
      $('reason').textContent = '無法連線到後端 API，請確認網路與 Flask / Render 後端是否可用。';
      $('advice').textContent = String(err?.message || err);
    } finally {
      if (scanBtn) {
        scanBtn.textContent = '立即掃描';
        scanBtn.disabled = false;
      }
    }
  }

  function bindEvents() {
    $('scanBtn')?.addEventListener('click', scanNow);
    $('voiceZhBtn')?.addEventListener('click', () => {
      speak('這個內容可能有詐騙風險，請不要輸入信用卡、驗證碼或匯款，先問家人確認。', 'zh-TW');
    });
    $('voiceTwBtn')?.addEventListener('click', () => {
      speak('這是台語提醒示範。這個內容可能是詐騙，請先不要操作，問家人確認。', 'zh-TW');
    });
    $('notifyBtn')?.addEventListener('click', () => {
      alert('Demo：已通知家人。正式版可串接 LINE Push 或家庭 Dashboard。');
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    setDefaultApiUrl();
    bindEvents();
  }, { once: true });
})();
