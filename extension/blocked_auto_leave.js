(() => {
  const SAFE_URL = "https://www.google.com";
  const POST_AUDIO_DELAY_SECONDS = 2;
  const FALLBACK_SECONDS = 8;

  let hasNavigated = false;
  let fallbackTimer = null;

  function getSelectedWarningAudio() {
    const tw = document.getElementById("hero-audio-tw");
    const zh = document.getElementById("hero-audio-zh");

    if (tw && !tw.paused && !tw.ended) return tw;
    if (zh && !zh.paused && !zh.ended) return zh;

    return tw || zh || null;
  }

  function goSafe() {
    if (hasNavigated) return;
    hasNavigated = true;

    if (fallbackTimer) {
      clearTimeout(fallbackTimer);
      fallbackTimer = null;
    }

    try {
      if (typeof chrome !== "undefined" && chrome.tabs && chrome.tabs.getCurrent && chrome.tabs.update) {
        chrome.tabs.getCurrent(tab => {
          const err = chrome.runtime && chrome.runtime.lastError;

          if (!err && tab && tab.id) {
            chrome.tabs.update(tab.id, { url: SAFE_URL });
            return;
          }

          window.location.replace(SAFE_URL);
        });
        return;
      }
    } catch (error) {}

    try {
      window.location.replace(SAFE_URL);
    } catch (error) {
      window.location.href = SAFE_URL;
    }
  }

  function setupAutoLeave() {
    const btn = document.getElementById("manual-leave-btn");

    if (btn) {
      btn.innerHTML = '<span class="btn-main">🛡️ 安全離開</span>';
      btn.addEventListener("click", goSafe);
    }

    const audio = getSelectedWarningAudio();

    if (audio) {
      audio.addEventListener("ended", () => {
        setTimeout(goSafe, POST_AUDIO_DELAY_SECONDS * 1000);
      }, { once: true });
    }

    // 保底：語音沒有播放、被瀏覽器擋住，或 ended 事件沒觸發時，也會自動離開。
    fallbackTimer = setTimeout(goSafe, FALLBACK_SECONDS * 1000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      setTimeout(setupAutoLeave, 500);
    }, { once: true });
  } else {
    setTimeout(setupAutoLeave, 500);
  }
})();
