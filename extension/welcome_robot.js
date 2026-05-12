(function () {
  'use strict';

  const WELCOME_ROBOT_CONFIG = {
    redirectSeconds: 8,
    tipIntervalMs: 2600,
    safeBrowsingUrl: 'https://www.google.com',
    tips: [
      '先深呼吸，慢一點。',
      '看到要你付款，先查證。',
      '覺得怪怪的，先問家人。',
      '對方一直催，更要小心。',
      '不確定，就撥打 165。'
    ]
  };

  const state = {
    tipIndex: 0,
    remaining: WELCOME_ROBOT_CONFIG.redirectSeconds,
    redirectTimer: null,
    tipTimer: null,
    stopped: false
  };

  function $(id) {
    return document.getElementById(id);
  }

  function clearTimer(timer) {
    if (timer) clearInterval(timer);
  }

  function stopTimers() {
    state.stopped = true;
    clearTimer(state.redirectTimer);
    clearTimer(state.tipTimer);
    state.redirectTimer = null;
    state.tipTimer = null;
  }

  function setBubble(text) {
    const bubble = $('robot-bubble');
    if (!bubble) return;

    bubble.replaceChildren();

    String(text || '')
      .split('。')
      .map(part => part.trim())
      .filter(Boolean)
      .forEach((part, index) => {
        if (index > 0) bubble.appendChild(document.createElement('br'));
        bubble.appendChild(document.createTextNode(part + '。'));
      });
  }

  function pulseRobot() {
    const robot = $('assistant-robot');
    if (!robot) return;

    robot.classList.remove('is-talking');
    // 重新觸發 CSS animation。
    void robot.offsetWidth;
    robot.classList.add('is-talking');
  }

  function rotateTip() {
    if (state.stopped) return;

    const tips = WELCOME_ROBOT_CONFIG.tips;
    const tip = tips[state.tipIndex % tips.length];
    state.tipIndex += 1;

    setBubble(tip);
    pulseRobot();
  }

  function updateProgress() {
    const countdown = $('countdown-text');
    const progress = $('redirect-progress');
    const total = WELCOME_ROBOT_CONFIG.redirectSeconds;
    const done = ((total - state.remaining) / total) * 100;

    if (countdown) countdown.textContent = String(Math.max(0, state.remaining));
    if (progress) progress.style.width = `${Math.max(0, Math.min(100, done))}%`;
  }

  function goSafeBrowsing() {
    window.location.href = WELCOME_ROBOT_CONFIG.safeBrowsingUrl;
  }

  function tickRedirect() {
    if (state.stopped) return;

    updateProgress();

    if (state.remaining <= 0) {
      const progress = $('redirect-progress');
      if (progress) progress.style.width = '100%';
      stopTimers();
      goSafeBrowsing();
      return;
    }

    state.remaining -= 1;
  }

  function bindControls() {
    const startBtn = $('start-safe-browsing');
    if (startBtn) {
      startBtn.addEventListener('click', stopTimers);
    }

    const robot = $('assistant-robot');
    const bubble = $('robot-bubble');
    [robot, bubble].forEach(element => {
      if (!element) return;
      element.addEventListener('click', rotateTip);
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stopTimers();
    }, { once: true });
  }

  document.addEventListener('DOMContentLoaded', () => {
    bindControls();
    rotateTip();
    tickRedirect();

    state.tipTimer = setInterval(rotateTip, WELCOME_ROBOT_CONFIG.tipIntervalMs);
    state.redirectTimer = setInterval(tickRedirect, 1000);
  });
})();
