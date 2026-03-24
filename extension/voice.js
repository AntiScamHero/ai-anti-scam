// ===== voice.js (國語終極穩定版) =====

// 將 utterance 設為全域變數，防止被記憶體回收
let globalSpeech = null;

function playVoiceAlert() {
    // 我們稍微潤飾一下台詞，讓國語唸起來比較自然
    const text = "鄉親啊～這個網頁有危險喔！防詐小尖兵已經幫您擋下來了，咱們趕緊離開，比較安全啦！";

    // 🌟 方案 A：擴充功能特權 API (最穩定、可自動播放)
    if (typeof chrome !== 'undefined' && chrome.tts) {
        chrome.tts.stop();
        chrome.tts.speak(text, {
            lang: 'zh-TW', // 強制使用台灣國語
            rate: 1.0,
            pitch: 1.1
        });
        console.log("🔊 成功使用擴充功能特權播放語音！");
        return; 
    }

    // 🌟 方案 B：一般網頁的備用方案 (解決 interrupted 錯誤)
    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel(); // 先清除之前的排程
        
        // 關鍵修復：延遲 50 毫秒再播放，避免 Chrome 語音引擎自己打結導致 interrupted
        setTimeout(() => {
            globalSpeech = new SpeechSynthesisUtterance(text);
            globalSpeech.lang = 'zh-TW';
            globalSpeech.rate = 1.0;
            globalSpeech.pitch = 1.1;

            globalSpeech.onstart = () => console.log("🔊 開始播放國語語音...");
            globalSpeech.onerror = (e) => {
                console.error("❌ 播放發生錯誤:", e.error);
                if (e.error === 'interrupted' || e.error === 'not-allowed') {
                    console.warn("💡 提示：瀏覽器阻擋了自動播放，請點擊畫面任何一處來發聲。");
                }
            };

            window.speechSynthesis.speak(globalSpeech);
        }, 50);
    }
}

// 網頁載入完成後的處理
document.addEventListener('DOMContentLoaded', () => {
    // 1. 嘗試自動播放 (延遲 0.5 秒讓畫面先跑出來)
    setTimeout(playVoiceAlert, 500);

    // 2. 綁定左側「氣泡框」的點擊播放功能 (長輩沒聽清楚可以再按一次)
    const voiceBubble = document.getElementById('voice-bubble');
    if (voiceBubble) {
        voiceBubble.addEventListener('click', playVoiceAlert);
    }

    // 3. 綁定畫面任意處點擊 (這是為了破解一般網頁狀態下的自動播放限制)
    document.body.addEventListener('click', function playOnClick() {
        playVoiceAlert();
        // 點過一次就解除監聽，避免之後點其他按鈕也一直重播
        document.body.removeEventListener('click', playOnClick); 
    });
});