// simulator.js - AI 防詐盾牌｜正式版防詐教室
// 特色：無 inline script、隨機情境、加權評分、模糊容錯、狀態與畫面分離、後端不可用也能完整演練。
(function () {
  'use strict';

  const CLASSROOM_CONFIG = {
    typingDelayMs: 950,
    coachDelayMs: 780,
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
    },
    demoFailSafeTimeoutMs: 8000,
    defaultSafetyReply: '網路或瀏覽器反應稍慢，請先記住防詐三步驟：一停、二查、三問家人或打 165。遇到匯款、驗證碼、信用卡或下載 App，先不要操作。'
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
    quickRefuse: 'quick-refuse',
    voice: 'voice-btn',
    scoreIcon: 'score-icon',
    coachDetail: 'coach-detail',
    lessonDetail: 'lesson-detail',
    lessonVideoCard: 'lesson-video-card',
    lessonVideoTitle: 'lesson-video-title',
    lessonVideoDesc: 'lesson-video-desc',
    lessonVideoTag: 'lesson-video-tag',
    lessonVideoPlayer: 'lesson-video-player',
    lessonVideoSource: 'lesson-video-source',
    lessonVideoNote: 'lesson-video-note',
    startPractice: 'start-practice-btn',
    practiceArea: 'practice-area'
  };

  const SAFE_RULES = [
    { label: '明確拒絕照做', weight: CLASSROOM_CONFIG.score.refusalBonus, terms: ['不要', '不會', '拒絕', '不提供', '不給', '不能給', '不匯', '不轉帳', '不操作', '掛掉', '免啦', '先不要', '我不要', '毋通', '不行', '不用', '不要理他', '先不處理'] },
    { label: '提出查證行動', weight: CLASSROOM_CONFIG.score.officialBonus, terms: ['查證', '確認', '官方', '官網', '客服', '銀行', '平台', '物流', '政府網站', '原本電話', '打電話問', '打去問', '問客服', '查一下', '看官方', '先查'] },
    { label: '尋求可信任協助', weight: CLASSROOM_CONFIG.score.familyBonus, terms: ['家人', '兒子', '女兒', '孫子', '孫女', '先生', '太太', '朋友', '警察', '165', '110', '醫院', '藥師', '醫師', '行員', '問小孩', '問孩子', '問家裡的人'] },
    { label: '保護個資與驗證碼', weight: CLASSROOM_CONFIG.score.safeMedium, terms: ['不輸入', '不登入', '不掃', '不點', '驗證碼不能', '密碼不能', '信用卡不能', 'otp不能', '不給驗證碼', '不給密碼', '不給卡號', '不按連結', '不要按連結'] },
    { label: '保留證據或暫停操作', weight: CLASSROOM_CONFIG.score.safeWeak, terms: ['截圖', '保存證據', '先停', '停下來', '冷靜', '等一下'] }
  ];

  const RISKY_RULES = [
    { label: '仍可能提供金錢或轉帳', weight: CLASSROOM_CONFIG.score.directTransferPenalty, terms: ['匯款', '轉帳', '付款', '繳錢', '入金', '儲值', '保證金', '手續費', '稅金', '先付', '付一下', '匯一下', '轉一下'] },
    { label: '仍可能提供驗證碼或密碼', weight: CLASSROOM_CONFIG.score.otpPenalty, terms: ['驗證碼', 'otp', '密碼', '卡號', '信用卡', '提款卡', 'cvv', '背面三碼', '網銀', '簡訊碼', '認證碼', '金融卡', '銀行帳號'] },
    { label: '可能繼續配合對方指示', weight: CLASSROOM_CONFIG.score.riskyMedium, terms: ['照做', '給你', '我給', '我輸入', '我掃', '我點', '加line', '加賴', '私訊'] },
    { label: '受急迫壓力影響', weight: CLASSROOM_CONFIG.score.riskyWeak, terms: ['很急', '馬上', '立即', '現在就', '怕來不及', '先處理'] }
  ];

  const NEGATION_TERMS = ['不', '不要', '不會', '不能', '拒絕', '不提供', '不給', '不匯', '不轉', '不輸入', '不點', '不掃', '先不要'];
  const SAFE_QUICK_REPLIES = {
    verify: '我不會直接照做，我要先到官方網站或官方電話查證。',
    family: '我先不要操作，我要先問家人確認這是不是詐騙。',
    refuse: '我不提供信用卡、密碼、驗證碼，也不會匯款。'
  };

  const VIDEO_LESSONS = [
    {
      title: '第一課：假補助／立即領取詐騙',
      desc: '請注意「立即領取、限時操作、輸入個資」這些高風險警訊。',
      tag: '假補助詐騙',
      src: '../assets/videos/lesson1-fake-claim.mp4',
      altSrc: ['./assets/videos/lesson1-fake-claim.mp4', './videos/lesson1-fake-claim.mp4'],
      note: '看完影片後，請練習回答：看到立即領取按鈕，你第一步會怎麼做？'
    },
    {
      title: '第二課：假通知／假連結詐騙',
      desc: '請注意陌生連結、要求登入、要求輸入驗證碼或信用卡資料。',
      tag: '假連結詐騙',
      src: '../assets/videos/lesson2-fake-link.mp4',
      altSrc: ['./assets/videos/lesson2-fake-link.mp4', './videos/lesson2-fake-link.mp4'],
      note: '看完影片後，請練習回答：對方要你輸入資料，你會怎麼做？'
    },
    {
      title: '第三課：假投資詐騙',
      desc: '示範影片尚未放入。先用互動題練習辨識保證獲利、老師帶單與入金話術。',
      tag: '預留課程',
      src: '',
      note: '這一課可放第3支影片：假投資老師、LINE群組、保證獲利。'
    },
    {
      title: '第四課：假包裹詐騙',
      desc: '示範影片尚未放入。先用互動題練習辨識包裹異常、補繳運費與陌生簡訊連結。',
      tag: '預留課程',
      src: '',
      note: '這一課可放第4支影片：包裹配送失敗、補繳30元、不點陌生連結。'
    },
    {
      title: '第五課：假客服解除分期',
      desc: '示範影片尚未放入。先用互動題練習辨識假客服、誤設分期與操作ATM話術。',
      tag: '預留課程',
      src: '',
      note: '這一課可放第5支影片：假客服來電、ATM不能解除分期。'
    }
  ];

  const state = {
    scenarios: [],
    current: null,
    chatHistory: [],
    recentIds: [],
    isSending: false,
    hasUserAnswered: false,
    timers: [],
    coachFailSafeTimer: null,
    lessonIndex: 0,
    practiceUnlocked: false
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
    if (state.coachFailSafeTimer) {
      clearTimeout(state.coachFailSafeTimer);
      state.coachFailSafeTimer = null;
    }
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

  function sanitizeClassroomText(text) {
    return String(text || '')
      // 防詐教室給 50+ 長輩使用，避免骷髏、死亡、恐怖符號造成壓迫感。
      .replace(/[💀☠️☠]/g, '提醒')
      .replace(/骷髏頭?/g, '警示圖示')
      .replace(/死亡|死掉|恐怖|嚇人/g, '高風險')
      .replace(/血腥|鬼|惡魔/g, '警示');
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
      label = '請先停一下';
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

  function getBuiltInFallbackScenarios() {
    return [
      {
        id: 'builtin_parcel_fee',
        title: '包裹補繳運費詐騙',
        category: '物流詐騙',
        lesson: ['先停下來', '不要點陌生連結', '回官方 App 或 165 查證'],
        scammer: [
          '您好，您的包裹因地址異常無法配送。',
          '請在 10 分鐘內補繳 32 元運費，否則包裹會被退回。',
          '請點擊連結並輸入信用卡資料完成重新配送。'
        ],
        riskyFollowups: ['時間快到了，請你現在先輸入信用卡資料。'],
        coachSafe: '做得好。你沒有直接點連結，而是選擇查證官方來源。',
        coachRisky: '這個回覆仍有風險。包裹補繳、信用卡與限時壓力常一起出現在釣魚詐騙。'
      },
      {
        id: 'builtin_investment_line',
        title: '假投資老師邀請',
        category: '投資詐騙',
        lesson: ['保證獲利就是警訊', '不要加入陌生投資群', '不要轉帳或下載不明 App'],
        scammer: [
          '老師今天開放 VIP 名額，這支飆股明天會漲。',
          '名額有限，現在加入 LINE 群組就能跟單。',
          '先入金一小筆，老師會帶你操作。'
        ],
        riskyFollowups: ['先入金卡位，不然名額就沒有了。'],
        coachSafe: '很好。你有避開陌生投資群與保證獲利話術。',
        coachRisky: '這個回覆仍有風險。老師帶單、VIP、保證獲利與入金都是高風險組合。'
      }
    ];
  }

  function getScenarioPool() {
    const richPool = Array.isArray(window.aiShieldClassroomScenarios) ? window.aiShieldClassroomScenarios : [];
    if (richPool.length) return richPool;

    const legacyPool = Array.isArray(window.allScenarios) ? window.allScenarios : [];
    const normalizedLegacyPool = legacyPool.map((steps, index) => ({
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

    return normalizedLegacyPool.length ? normalizedLegacyPool : getBuiltInFallbackScenarios();
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
      if (els.scoreIcon) {
        /* 保留阿盾老師圖片，不用文字 */
        els.scoreIcon.className = 'score-icon';
      }
      if (els.scoreBar) {
        els.scoreBar.style.width = '50%';
        els.scoreBar.style.background = '#2477f2';
      }
      renderList(els.reasons, ['回覆後，AI 會用簡單方式提醒安全與風險。']);
      return;
    }

    if (els.scoreNum) els.scoreNum.textContent = String(result.score);
    if (els.scoreLabel) els.scoreLabel.textContent = result.label;
    if (els.scoreIcon) {
      els.scoreIcon.className = `score-icon ${result.status || ''}`.trim();
      els.scoreIcon.textContent = result.status === 'safe' ? '✅' : result.status === 'risky' ? '❗' : '🟡';
    }
    if (els.scoreBar) {
      els.scoreBar.style.width = `${result.score}%`;
      els.scoreBar.style.background = result.status === 'safe' ? '#22c55e' : result.status === 'risky' ? '#f97316' : '#f59e0b';
    }
    renderList(els.reasons, result.reasons);

    if (els.coachDetail && window.matchMedia('(max-width: 850px)').matches) {
      els.coachDetail.open = false;
    }
  }

  function renderList(container, items) {
    if (!container) return;
    container.replaceChildren();
    (items || []).forEach((text) => {
      const li = document.createElement('li');
      li.textContent = sanitizeClassroomText(text);
      container.appendChild(li);
    });
  }

  function renderScenarioHeader() {
    const scenario = state.current;
    if (!scenario) return;

    if (els.title) els.title.textContent = sanitizeClassroomText(scenario.title || '防詐情境');
    if (els.meta) {
      els.meta.replaceChildren();
      [scenario.category || '防詐演練', '隨機情境', 'AI 教練判斷'].forEach((text) => {
        const span = document.createElement('span');
        span.className = 'pill';
        span.textContent = sanitizeClassroomText(text);
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
    div.textContent = sanitizeClassroomText(text);
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

  function getCurrentLesson() {
    if (!VIDEO_LESSONS.length) return null;
    return VIDEO_LESSONS[state.lessonIndex % VIDEO_LESSONS.length];
  }

  function setPracticeUnlocked(unlocked) {
    state.practiceUnlocked = Boolean(unlocked);
    if (els.practiceArea) {
      els.practiceArea.classList.toggle('lesson-lock', !state.practiceUnlocked);
    }
    if (els.startPractice) {
      els.startPractice.disabled = false;
      els.startPractice.textContent = state.practiceUnlocked ? '已開始練習' : '開始互動練習';
    }
    if (state.practiceUnlocked && els.input) {
      els.input.focus();
    }
  }

  function renderVideoLesson() {
    const lesson = getCurrentLesson();
    if (!lesson || !els.lessonVideoCard) return;

    if (els.lessonVideoTitle) els.lessonVideoTitle.textContent = lesson.title;
    if (els.lessonVideoDesc) els.lessonVideoDesc.textContent = lesson.desc;
    if (els.lessonVideoTag) els.lessonVideoTag.textContent = lesson.tag || '影片教材';
    if (els.lessonVideoNote) els.lessonVideoNote.textContent = lesson.note || '看完影片後，按「開始互動練習」。';

    if (els.lessonVideoPlayer && els.lessonVideoSource) {
      if (lesson.src) {
        els.lessonVideoCard.classList.remove('hidden');
        lesson._srcIndex = 0;
        const candidates = [lesson.src].concat(lesson.altSrc || []);
        els.lessonVideoPlayer.dataset.videoCandidates = JSON.stringify(candidates);
        els.lessonVideoPlayer.dataset.videoIndex = '0';
        els.lessonVideoSource.src = candidates[0];
        els.lessonVideoPlayer.load();
      } else {
        // 後續三支影片尚未完成時，不擋住互動練習。
        els.lessonVideoSource.removeAttribute('src');
        els.lessonVideoPlayer.removeAttribute('data-video-candidates');
        els.lessonVideoPlayer.load();
      }
    }

    setPracticeUnlocked(!lesson.src);
  }

  function unlockPracticeFromVideo() {
    setPracticeUnlocked(true);
    appendMessage('system', '影片看完了，現在請用自己的話回答這一題。');
  }

  function startScenario(scenario) {
    clearTimers();
    state.current = scenario || pickRandomScenario();
    state.chatHistory = [];
    state.hasUserAnswered = false;
    setSending(false);
    setScoreView(null);
    if (window.matchMedia('(max-width: 850px)').matches) {
      if (els.coachDetail) els.coachDetail.open = false;
      if (els.lessonDetail) els.lessonDetail.open = false;
    }
    renderScenarioHeader();
    renderVideoLesson();
    renderScenarioMessages();
    if (els.input) {
      els.input.value = '';
      if (state.practiceUnlocked) addTimer(() => els.input.focus(), 300);
    }
  }

  function buildCoachReply(result, userText) {
    const scenario = state.current || {};
    if (result.status === 'safe') {
      return sanitizeClassroomText(`${scenario.coachSafe || '做得好，你先停下來查證，這樣很安全。'}\n\nAI 提醒：${result.label}`);
    }

    if (result.status === 'risky') {
      const nextPressure = scenario.riskyFollowups?.[0] ? `\n\n對方可能會繼續說：「${scenario.riskyFollowups[0]}」` : '';
      return sanitizeClassroomText(`${scenario.coachRisky || '這個回覆還要再小心。先不要點連結、不要給資料，也不要匯款。'}${nextPressure}\n\nAI 提醒：${result.label}`);
    }

    return sanitizeClassroomText(`你已經有警覺了。可以更直接說：「我不提供資料，我要先查證或問家人。」\n\nAI 提醒：${result.label}`);
  }

  function clearCoachFailSafe() {
    if (!state.coachFailSafeTimer) return;
    clearTimeout(state.coachFailSafeTimer);
    state.coachFailSafeTimer = null;
  }

  function startCoachFailSafe(typingBubble) {
    clearCoachFailSafe();
    state.coachFailSafeTimer = setTimeout(() => {
      if (!state.isSending) return;
      if (typingBubble) {
        typingBubble.classList.remove('typing');
        typingBubble.textContent = CLASSROOM_CONFIG.defaultSafetyReply;
      } else {
        appendMessage('coach', CLASSROOM_CONFIG.defaultSafetyReply);
      }
      state.chatHistory.push({ role: 'assistant', content: CLASSROOM_CONFIG.defaultSafetyReply });
      setScoreView({
        score: CLASSROOM_CONFIG.thresholds.caution,
        label: '啟用備援提醒',
        status: 'caution',
        reasons: ['AI 教練回覆逾時，已啟用預設防詐提醒。'],
        hasSafe: false,
        hasRisk: false
      });
      setSending(false);
      if (els.input) els.input.focus();
    }, CLASSROOM_CONFIG.demoFailSafeTimeoutMs);
  }

  function submitUserReply(replyText) {
    if (state.isSending || !state.current) return;
    if (!state.practiceUnlocked) {
      appendMessage('system', '請先觀看影片，再按「開始互動練習」。');
      return;
    }
    const text = String(replyText || els.input?.value || '').trim();
    if (!text) {
      appendMessage('coach', '請先輸入你的回應。可以試著說：「我不提供資料，我要先查證。」');
      return;
    }

    state.hasUserAnswered = true;
    appendMessage('user', `我：${text}`);
    state.chatHistory.push({ role: 'user', content: text });
    if (els.input) els.input.value = '';

    let result;
    try {
      result = evaluateUserReply(text);
      setScoreView(result);
    } catch (error) {
      console.warn('AI 教練本機評分失敗，啟用備援提醒：', error);
      result = {
        score: CLASSROOM_CONFIG.thresholds.caution,
        label: '啟用備援提醒',
        status: 'caution',
        reasons: ['本機評分暫時失敗，已改用固定防詐提醒。'],
        hasSafe: false,
        hasRisk: false
      };
      setScoreView(result);
    }

    setSending(true);

    const typingBubble = appendMessage('coach', 'AI 教練正在判斷...', { typing: true });
    startCoachFailSafe(typingBubble);

    addTimer(() => {
      try {
        clearCoachFailSafe();
        const reply = buildCoachReply(result, text) || CLASSROOM_CONFIG.defaultSafetyReply;
        if (typingBubble) {
          typingBubble.classList.remove('typing');
          typingBubble.textContent = reply;
        }
        state.chatHistory.push({ role: 'assistant', content: typingBubble?.textContent || reply });
      } catch (error) {
        console.warn('AI 教練回覆生成失敗，啟用預設提醒：', error);
        if (typingBubble) {
          typingBubble.classList.remove('typing');
          typingBubble.textContent = CLASSROOM_CONFIG.defaultSafetyReply;
        }
        state.chatHistory.push({ role: 'assistant', content: CLASSROOM_CONFIG.defaultSafetyReply });
      } finally {
        clearCoachFailSafe();
        setSending(false);
        if (els.input) els.input.focus();
      }
    }, CLASSROOM_CONFIG.coachDelayMs);
  }



  let speechRecognition = null;
  let isVoiceListening = false;

  function getSpeechRecognitionConstructor() {
    return window.SpeechRecognition || window.webkitSpeechRecognition || null;
  }

  function setVoiceButtonState(stateName, label) {
    if (!els.voice) return;
    els.voice.classList.toggle('listening', stateName === 'listening');
    els.voice.classList.toggle('unsupported', stateName === 'unsupported');
    els.voice.setAttribute('aria-pressed', stateName === 'listening' ? 'true' : 'false');
    els.voice.textContent = label;
  }

  function setupVoiceInput() {
    if (!els.voice) return;

    const SpeechRecognition = getSpeechRecognitionConstructor();
    if (!SpeechRecognition) {
      setVoiceButtonState('unsupported', '🎙️ 不支援');
      els.voice.disabled = true;
      els.voice.title = '此瀏覽器不支援語音輸入，可改用快速回應按鈕。';
      return;
    }

    speechRecognition = new SpeechRecognition();
    speechRecognition.lang = 'zh-TW';
    speechRecognition.interimResults = true;
    speechRecognition.continuous = false;

    speechRecognition.onstart = () => {
      isVoiceListening = true;
      setVoiceButtonState('listening', '正在聽...');
    };

    speechRecognition.onend = () => {
      isVoiceListening = false;
      setVoiceButtonState('', '🎙️ 語音');
    };

    speechRecognition.onerror = () => {
      isVoiceListening = false;
      setVoiceButtonState('', '🎙️ 語音');
      appendMessage('system', '語音輸入暫時沒有聽清楚，也可以直接點上方安全回應。');
    };

    speechRecognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0]?.transcript || '')
        .join('')
        .trim();

      if (els.input && transcript) {
        els.input.value = transcript;
      }
    };

    els.voice.addEventListener('click', () => {
      try {
        if (isVoiceListening) {
          speechRecognition.stop();
          return;
        }
        speechRecognition.start();
      } catch (error) {
        console.warn('語音輸入啟動失敗：', error);
        appendMessage('system', '語音輸入暫時無法啟動，可以使用快速回應按鈕。');
      }
    });
  }


  function handleVideoError() {
    if (!els.lessonVideoPlayer || !els.lessonVideoSource) return;

    let candidates = [];
    try {
      candidates = JSON.parse(els.lessonVideoPlayer.dataset.videoCandidates || '[]');
    } catch (error) {
      candidates = [];
    }

    const currentIndex = Number(els.lessonVideoPlayer.dataset.videoIndex || '0');
    const nextIndex = currentIndex + 1;

    if (candidates[nextIndex]) {
      els.lessonVideoPlayer.dataset.videoIndex = String(nextIndex);
      els.lessonVideoSource.src = candidates[nextIndex];
      els.lessonVideoPlayer.load();
      if (els.lessonVideoNote) {
        els.lessonVideoNote.textContent = '正在嘗試另一個影片路徑，請稍等一下。';
      }
      return;
    }

    if (els.lessonVideoNote) {
      els.lessonVideoNote.textContent = '影片暫時讀不到，請確認 MP4 是否放在 assets/videos。你也可以先按「開始互動練習」。';
    }
    setPracticeUnlocked(true);
    appendMessage('system', '影片暫時無法載入，已開放互動練習。請確認影片檔案路徑。');
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
    if (els.next) els.next.addEventListener('click', () => {
      state.lessonIndex += 1;
      startScenario(pickRandomScenario());
    });
    if (els.restart) els.restart.addEventListener('click', () => startScenario(state.current));
    if (els.quickVerify) els.quickVerify.addEventListener('click', () => submitUserReply(SAFE_QUICK_REPLIES.verify));
    if (els.quickFamily) els.quickFamily.addEventListener('click', () => submitUserReply(SAFE_QUICK_REPLIES.family));
    if (els.quickRefuse) els.quickRefuse.addEventListener('click', () => submitUserReply(SAFE_QUICK_REPLIES.refuse));
    if (els.startPractice) els.startPractice.addEventListener('click', unlockPracticeFromVideo);
    if (els.lessonVideoPlayer) {
      els.lessonVideoPlayer.addEventListener('ended', unlockPracticeFromVideo);
      els.lessonVideoPlayer.addEventListener('error', handleVideoError);
    }
    setupVoiceInput();
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

  function safeInit() {
    try {
      init();
    } catch (error) {
      console.error('AI 防詐教室初始化失敗，啟用靜態備援：', error);
      cacheDom();
      if (els.chat) {
        els.chat.replaceChildren();
        appendMessage('system', CLASSROOM_CONFIG.defaultSafetyReply);
      }
      setSending(false);
    }
  }

  window.addEventListener('online', () => appendMessage('system', '✅ 網路已恢復，防詐教室可繼續使用。'));
  window.addEventListener('offline', () => appendMessage('system', '目前網路不穩，但防詐教室會以本機模式繼續演練。'));

  document.addEventListener('DOMContentLoaded', safeInit, { once: true });
})();
