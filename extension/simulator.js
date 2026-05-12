// simulator.js - AI 防詐盾牌｜正式版防詐教室
// 特色：無 inline script、隨機情境、加權評分、模糊容錯、狀態與畫面分離、後端不可用也能完整演練。
(function () {
  'use strict';

  const CLASSROOM_CONFIG = {
    typingDelayMs: 420,
    coachDelayMs: 520,
    maxRecentScenarioIds: 6,
    score: {
      base: 50,
      safeStrong: 22,
      safeMedium: 14,
      safeWeak: 8,
      riskyStrong: -30,
      riskyMedium: -20,
      riskyWeak: -12,
      conflictPenalty: -18,
      directTransferPenalty: -24,
      otpPenalty: -26,
      familyBonus: 16,
      officialBonus: 14,
      refusalBonus: 18
    },
    thresholds: {
      safe: 72,
      caution: 45
    }
  };

  const DOM_IDS = {
    title: 'scenario-title',
    meta: 'scenario-meta',
    chat: 'chat-box',
    input: 'user-input',
    send: 'send-btn',
    next: 'next-btn',
    restart: 'restart-btn',
    scoreNum: 'score-num',
    scoreLabel: 'score-label',
    scoreBar: 'score-bar',
    reasons: 'reason-list',
    lessons: 'lesson-list',
    quickVerify: 'quick-verify',
    quickFamily: 'quick-family',
    quickRefuse: 'quick-refuse'
  };

  const SAFE_RULES = [
    { label: '明確拒絕照做', weight: CLASSROOM_CONFIG.score.refusalBonus, terms: ['不要', '不會', '拒絕', '不提供', '不給', '不能給', '不匯', '不轉帳', '不操作', '掛掉'] },
    { label: '提出查證行動', weight: CLASSROOM_CONFIG.score.officialBonus, terms: ['查證', '確認', '官方', '官網', '客服', '銀行', '平台', '物流', '政府網站', '原本電話'] },
    { label: '尋求可信任協助', weight: CLASSROOM_CONFIG.score.familyBonus, terms: ['家人', '朋友', '警察', '165', '110', '醫院', '藥師', '醫師', '行員'] },
    { label: '保護個資與驗證碼', weight: CLASSROOM_CONFIG.score.safeMedium, terms: ['不輸入', '不登入', '不掃', '不點', '驗證碼不能', '密碼不能', '信用卡不能', 'otp不能'] },
    { label: '保留證據或暫停操作', weight: CLASSROOM_CONFIG.score.safeWeak, terms: ['截圖', '保存證據', '先停', '停下來', '冷靜', '等一下'] }
  ];

  const RISKY_RULES = [
    { label: '仍可能提供金錢或轉帳', weight: CLASSROOM_CONFIG.score.directTransferPenalty, terms: ['匯款', '轉帳', '付款', '繳錢', '入金', '儲值', '保證金', '手續費', '稅金'] },
    { label: '仍可能提供驗證碼或密碼', weight: CLASSROOM_CONFIG.score.otpPenalty, terms: ['驗證碼', 'otp', '密碼', '卡號', '信用卡', '提款卡', 'cvv', '背面三碼', '網銀'] },
    { label: '可能繼續配合對方指示', weight: CLASSROOM_CONFIG.score.riskyMedium, terms: ['照做', '給你', '我給', '我輸入', '我掃', '我點', '加line', '加賴', '私訊'] },
    { label: '受急迫壓力影響', weight: CLASSROOM_CONFIG.score.riskyWeak, terms: ['很急', '馬上', '立即', '現在就', '怕來不及', '先處理'] }
  ];

  const NEGATION_TERMS = ['不', '不要', '不會', '不能', '拒絕', '不提供', '不給', '不匯', '不轉', '不輸入', '不點', '不掃', '先不要'];
  const SAFE_QUICK_REPLIES = {
    verify: '我不會直接照做，我要先到官方網站或官方電話查證。',
    family: '我先不要操作，我要先問家人確認這是不是詐騙。',
    refuse: '我不提供信用卡、密碼、驗證碼，也不會匯款。'
  };

  const state = {
    scenarios: [],
    current: null,
    chatHistory: [],
    recentIds: [],
    isSending: false,
    hasUserAnswered: false,
    timers: []
  };

  function $(id) {
    return document.getElementById(id);
  }

  const els = {};

  function cacheDom() {
    Object.entries(DOM_IDS).forEach(([key, id]) => {
      els[key] = $(id);
    });
  }

  function clearTimers() {
    state.timers.forEach((timer) => clearTimeout(timer));
    state.timers = [];
  }

  function addTimer(fn, delay) {
    const timer = setTimeout(fn, delay);
    state.timers.push(timer);
    return timer;
  }

  function normalizeText(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/\s+/g, '')
      .trim();
  }

  function segmentText(text) {
    return String(text || '')
      .split(/[，,。.!！?？；;、\n\s]+/)
      .map((part) => normalizeText(part))
      .filter(Boolean);
  }

  function levenshtein(a, b) {
    const s = normalizeText(a);
    const t = normalizeText(b);
    if (s === t) return 0;
    if (!s) return t.length;
    if (!t) return s.length;

    const rows = s.length + 1;
    const cols = t.length + 1;
    const dp = Array.from({ length: rows }, () => new Array(cols).fill(0));

    for (let i = 0; i < rows; i += 1) dp[i][0] = i;
    for (let j = 0; j < cols; j += 1) dp[0][j] = j;

    for (let i = 1; i < rows; i += 1) {
      for (let j = 1; j < cols; j += 1) {
        const cost = s[i - 1] === t[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + cost
        );
      }
    }

    return dp[s.length][t.length];
  }

  function containsTerm(text, term) {
    const value = normalizeText(text);
    const target = normalizeText(term);
    if (!value || !target) return false;
    if (value.includes(target)) return true;

    // 針對短句錯字容錯：例如「不會款」接近「不匯款」。
    if (target.length >= 3 && value.length <= 40) {
      const windows = [];
      for (let i = 0; i <= Math.max(0, value.length - target.length); i += 1) {
        windows.push(value.slice(i, i + target.length));
      }
      return windows.some((part) => levenshtein(part, target) <= 1);
    }

    return false;
  }

  function hasNearbyNegation(rawText, term) {
    const value = normalizeText(rawText);
    const target = normalizeText(term);
    const idx = value.indexOf(target);
    if (idx < 0) return false;

    const before = value.slice(Math.max(0, idx - 8), idx + target.length);
    return NEGATION_TERMS.some((neg) => before.includes(normalizeText(neg)));
  }

  function evaluateUserReply(text) {
    const normalized = normalizeText(text);
    const clauses = segmentText(text);
    let score = CLASSROOM_CONFIG.score.base;
    const reasons = [];
    const safeHits = [];
    const riskyHits = [];

    for (const rule of SAFE_RULES) {
      const matched = rule.terms.some((term) => containsTerm(normalized, term));
      if (matched) {
        score += rule.weight;
        safeHits.push(rule.label);
        reasons.push(`安全行為：${rule.label}`);
      }
    }

    for (const rule of RISKY_RULES) {
      const matchedTerms = rule.terms.filter((term) => containsTerm(normalized, term));
      if (!matchedTerms.length) continue;

      const allNegated = matchedTerms.every((term) => hasNearbyNegation(text, term));
      if (allNegated) {
        score += CLASSROOM_CONFIG.score.safeWeak;
        safeHits.push(`拒絕${rule.label.replace('仍可能', '')}`);
        reasons.push(`安全行為：有提到「${matchedTerms[0]}」，但語意是拒絕或不提供。`);
      } else {
        score += rule.weight;
        riskyHits.push(rule.label);
        reasons.push(`風險線索：${rule.label}`);
      }
    }

    const hasSafe = safeHits.length > 0;
    const hasRisk = riskyHits.length > 0;

    // 混合語句不能直接判安全，例如：「我不提供密碼，但你可以把匯款帳號給我」。
    if (hasSafe && hasRisk) {
      score += CLASSROOM_CONFIG.score.conflictPenalty;
      reasons.push('注意：你的回覆同時有安全行為與危險行為，AI 判定仍需小心。');
    }

    // 完全沒有明確安全動作時，不給高分。
    if (!hasSafe && clauses.length > 0) {
      score -= 8;
      reasons.push('建議：請明確說出「我不提供資料、我要查證或問家人」。');
    }

    score = Math.max(0, Math.min(100, Math.round(score)));

    let label = '需要再小心';
    let status = 'caution';
    if (score >= CLASSROOM_CONFIG.thresholds.safe && hasSafe && !hasRisk) {
      label = '安全做法';
      status = 'safe';
    } else if (score < CLASSROOM_CONFIG.thresholds.caution || hasRisk) {
      label = '仍有風險';
      status = 'risky';
    }

    return {
      score,
      label,
      status,
      reasons: reasons.length ? Array.from(new Set(reasons)).slice(0, 5) : ['AI 還沒有看到明確的拒絕、查證或求助行為。'],
      hasSafe,
      hasRisk
    };
  }

  function getScenarioPool() {
    const richPool = Array.isArray(window.aiShieldClassroomScenarios) ? window.aiShieldClassroomScenarios : [];
    if (richPool.length) return richPool;

    const legacyPool = Array.isArray(window.allScenarios) ? window.allScenarios : [];
    return legacyPool.map((steps, index) => ({
      id: `legacy_${index}`,
      title: `防詐情境 ${index + 1}`,
      category: '防詐演練',
      lesson: ['先停下來', '不要提供資料', '查證後再決定'],
      scammer: steps.filter((step) => step.role === 'scammer').map((step) => step.text).filter(Boolean),
      safeReplies: steps.filter((step) => step.role === 'victim').map((step) => step.text).filter(Boolean),
      riskyFollowups: ['時間不多了，請你現在照我說的做。'],
      coachSafe: steps.find((step) => step.role === 'system')?.text || '做得好，先停下來查證。',
      coachRisky: '這個回覆仍有風險，請先拒絕、查證或問家人。'
    })).filter((item) => item.scammer.length);
  }

  function pickRandomScenario() {
    const pool = state.scenarios;
    if (!pool.length) return null;

    const available = pool.filter((scenario) => !state.recentIds.includes(scenario.id));
    const source = available.length ? available : pool;
    const scenario = source[Math.floor(Math.random() * source.length)];

    state.recentIds.push(scenario.id);
    if (state.recentIds.length > CLASSROOM_CONFIG.maxRecentScenarioIds) {
      state.recentIds.shift();
    }

    return scenario;
  }

  function setSending(isSending) {
    state.isSending = isSending;
    if (els.send) {
      els.send.disabled = isSending;
      els.send.textContent = isSending ? '判斷中...' : '送出';
    }
    if (els.input) els.input.disabled = isSending;
  }

  function setScoreView(result) {
    if (!result) {
      if (els.scoreNum) els.scoreNum.textContent = '--';
      if (els.scoreLabel) els.scoreLabel.textContent = '等待你的回應';
      if (els.scoreBar) {
        els.scoreBar.style.width = '50%';
        els.scoreBar.style.background = '#2477f2';
      }
      renderList(els.reasons, ['回覆後，AI 會指出安全與風險線索。']);
      return;
    }

    if (els.scoreNum) els.scoreNum.textContent = String(result.score);
    if (els.scoreLabel) els.scoreLabel.textContent = result.label;
    if (els.scoreBar) {
      els.scoreBar.style.width = `${result.score}%`;
      els.scoreBar.style.background = result.status === 'safe' ? '#22c55e' : result.status === 'risky' ? '#ef4444' : '#f59e0b';
    }
    renderList(els.reasons, result.reasons);
  }

  function renderList(container, items) {
    if (!container) return;
    container.replaceChildren();
    (items || []).forEach((text) => {
      const li = document.createElement('li');
      li.textContent = text;
      container.appendChild(li);
    });
  }

  function renderScenarioHeader() {
    const scenario = state.current;
    if (!scenario) return;

    if (els.title) els.title.textContent = scenario.title || '防詐情境';
    if (els.meta) {
      els.meta.replaceChildren();
      [scenario.category || '防詐演練', '隨機情境', 'AI 教練判斷'].forEach((text) => {
        const span = document.createElement('span');
        span.className = 'pill';
        span.textContent = text;
        els.meta.appendChild(span);
      });
    }
    renderList(els.lessons, scenario.lesson || ['先停下來', '不要提供資料', '查證後再決定']);
  }

  function appendMessage(type, text, options = {}) {
    if (!els.chat) return null;
    const div = document.createElement('div');
    const className = type === 'user' ? 'user-msg' : type === 'coach' ? 'coach-msg' : type === 'system' ? 'system-msg' : 'scammer-msg';
    div.className = `message ${className}`;
    if (options.typing) div.classList.add('typing');
    div.textContent = text;
    els.chat.appendChild(div);
    els.chat.scrollTop = els.chat.scrollHeight;
    return div;
  }

  function renderScenarioMessages() {
    if (!els.chat || !state.current) return;
    els.chat.replaceChildren();
    const messages = state.current.scammer || [];
    messages.slice(0, 3).forEach((text, index) => {
      addTimer(() => appendMessage('scammer', text), index * CLASSROOM_CONFIG.typingDelayMs);
    });
  }

  function startScenario(scenario) {
    clearTimers();
    state.current = scenario || pickRandomScenario();
    state.chatHistory = [];
    state.hasUserAnswered = false;
    setSending(false);
    setScoreView(null);
    renderScenarioHeader();
    renderScenarioMessages();
    if (els.input) {
      els.input.value = '';
      addTimer(() => els.input.focus(), 300);
    }
  }

  function buildCoachReply(result, userText) {
    const scenario = state.current || {};
    if (result.status === 'safe') {
      return `${scenario.coachSafe || '做得好。你已經做到先拒絕、再查證。'}\n\nAI 判斷：${result.label}（${result.score} 分）`;
    }

    if (result.status === 'risky') {
      const nextPressure = scenario.riskyFollowups?.[0] ? `\n\n對方可能會繼續說：「${scenario.riskyFollowups[0]}」` : '';
      return `${scenario.coachRisky || '這個回覆仍有風險。請先停下來，不要提供資料或匯款。'}${nextPressure}\n\nAI 判斷：${result.label}（${result.score} 分）`;
    }

    return `你已經有警覺，但可以更明確一點。建議直接說：「我不提供資料，我要先查證或問家人。」\n\nAI 判斷：${result.label}（${result.score} 分）`;
  }

  function submitUserReply(replyText) {
    if (state.isSending || !state.current) return;
    const text = String(replyText || els.input?.value || '').trim();
    if (!text) {
      appendMessage('coach', '請先輸入你的回應。可以試著說：「我不提供資料，我要先查證。」');
      return;
    }

    state.hasUserAnswered = true;
    appendMessage('user', `我：${text}`);
    state.chatHistory.push({ role: 'user', content: text });
    if (els.input) els.input.value = '';

    const result = evaluateUserReply(text);
    setScoreView(result);
    setSending(true);

    const typingBubble = appendMessage('coach', 'AI 教練正在判斷...', { typing: true });
    addTimer(() => {
      if (typingBubble) {
        typingBubble.classList.remove('typing');
        typingBubble.textContent = buildCoachReply(result, text);
      }
      state.chatHistory.push({ role: 'assistant', content: typingBubble?.textContent || '' });
      setSending(false);
      if (els.input) els.input.focus();
    }, CLASSROOM_CONFIG.coachDelayMs);
  }

  function bindEvents() {
    if (els.send) els.send.addEventListener('click', () => submitUserReply());
    if (els.input) {
      els.input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          submitUserReply();
        }
      });
    }
    if (els.next) els.next.addEventListener('click', () => startScenario(pickRandomScenario()));
    if (els.restart) els.restart.addEventListener('click', () => startScenario(state.current));
    if (els.quickVerify) els.quickVerify.addEventListener('click', () => submitUserReply(SAFE_QUICK_REPLIES.verify));
    if (els.quickFamily) els.quickFamily.addEventListener('click', () => submitUserReply(SAFE_QUICK_REPLIES.family));
    if (els.quickRefuse) els.quickRefuse.addEventListener('click', () => submitUserReply(SAFE_QUICK_REPLIES.refuse));
  }

  function init() {
    cacheDom();

    if (!els.chat || !els.input || !els.send) {
      console.error('AI 防詐教室缺少必要 DOM，請確認 simulator.html 已更新為正式版。');
      return;
    }

    state.scenarios = getScenarioPool();
    if (!state.scenarios.length) {
      appendMessage('system', '目前找不到防詐劇本，請確認 scenarios.js 已放在同一個資料夾。');
      return;
    }

    bindEvents();
    startScenario(pickRandomScenario());
    console.log('🛡️ AI 防詐教室已啟動', { scenarioCount: state.scenarios.length });
  }

  document.addEventListener('DOMContentLoaded', init, { once: true });
})();
