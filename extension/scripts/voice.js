// AI 防詐盾牌 - 語音助手（國台語雙語音檔版）
// 功能：
// 1. 優先播放國台語合併語音檔 ai_shield_bilingual_warning.mp3
// 2. 支援攔截頁載入後自動播報
// 3. 支援點擊吉祥物、語音泡泡或重播按鈕後重播
// 4. 若瀏覽器擋自動播放，使用者第一次點擊畫面時會自動補播
(function () {
  var currentAudio = null;
  var unlockInstalled = false;

  // 請確認這個音檔有放在 Chrome Extension 資料夾內
  var AUDIO_FILE_NAME = 'assets/audio/ai_shield_bilingual_warning.mp3';

  function getAudioUrl() {
    try {
      if (
        typeof chrome !== 'undefined' &&
        chrome.runtime &&
        typeof chrome.runtime.getURL === 'function'
      ) {
        return chrome.runtime.getURL(AUDIO_FILE_NAME);
      }
    } catch (e) {}

    return AUDIO_FILE_NAME;
  }

  function stopCurrentAudio() {
    try {
      if (currentAudio) {
        currentAudio.pause();
        currentAudio.currentTime = 0;
      }
    } catch (e) {}
  }

  function installUserGestureFallback() {
    if (unlockInstalled) return;
    unlockInstalled = true;

    var replay = function () {
      playWarningAudio(true);

      document.removeEventListener('click', replay, true);
      document.removeEventListener('keydown', replay, true);
      document.removeEventListener('touchstart', replay, true);
    };

    document.addEventListener('click', replay, true);
    document.addEventListener('keydown', replay, true);
    document.addEventListener('touchstart', replay, true);
  }

  function playWarningAudio(isUserGesture) {
    try {
      stopCurrentAudio();

      var audioUrl = getAudioUrl();
      var audio = new Audio(audioUrl);

      currentAudio = audio;
      audio.volume = 1.0;
      audio.preload = 'auto';

      var playPromise = audio.play();

      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(function (e) {
          console.warn('語音自動播放被瀏覽器阻擋，等待使用者點擊後補播：', e);

          if (!isUserGesture) {
            installUserGestureFallback();
          }
        });
      }

      return true;
    } catch (e) {
      console.warn('音檔播放失敗：', e);

      if (!isUserGesture) {
        installUserGestureFallback();
      }

      return false;
    }
  }

  function speakWarning() {
    // 稍微延遲，讓攔截頁畫面先出來，再開始播放提醒
    setTimeout(function () {
      playWarningAudio(false);
    }, 350);
  }

  window.AIShieldVoice = {
    speakWarning: speakWarning,
    speak: function () {
      playWarningAudio(true);
    },
    replay: function () {
      playWarningAudio(true);
    }
  };

  // 讓 blocked.js 可以用事件方式呼叫語音
  window.addEventListener('AIShieldVoiceRequest', function () {
    speakWarning();
  });

  document.addEventListener('DOMContentLoaded', function () {
    var bubble = document.getElementById('voice-bubble') || document.querySelector('.speech-bubble');
    var mascot = document.getElementById('main-mascot');
    var voiceBtn = document.getElementById('voice-replay-btn');

    // 點語音泡泡可重播
    if (bubble) {
      bubble.addEventListener('click', function () {
        playWarningAudio(true);
      });
      bubble.setAttribute('title', '點一下可以重播國台語提醒');
    }

    // 點吉祥物可重播
    if (mascot) {
      mascot.addEventListener('click', function () {
        playWarningAudio(true);
      });
      mascot.setAttribute('title', '點一下可以重播國台語提醒');
    }

    // 若 blocked.html 有加重播按鈕，也會自動綁定
    if (voiceBtn) {
      voiceBtn.addEventListener('click', function () {
        playWarningAudio(true);
      });
    }

    // 如果 blocked.js 比 voice.js 早設定 pending flag，這裡補播
    if (window.__AI_SHIELD_PENDING_VOICE__) {
      speakWarning();
    }
  });
})();
