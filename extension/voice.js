// ===== voice.js (終極解鎖雙聲道連播版) =====

function playVoiceAlert() {
    const audioZh = document.getElementById('hero-audio-zh');
    const audioTw = document.getElementById('hero-audio-tw');
    
    if (audioZh && audioTw) {
        // 先暫停並歸零，避免連點時聲音重疊
        audioZh.pause();
        audioZh.currentTime = 0;
        audioTw.pause();
        audioTw.currentTime = 0;
        
        // 接力賽機制：國語播完後，緊接著播台語
        audioZh.onended = function() {
            console.log("🔊 國語播完，接著播台語...");
            let playTwPromise = audioTw.play();
            if (playTwPromise !== undefined) {
                playTwPromise.catch(e => console.warn("💡 台語連播被阻擋:", e));
            }
        };

        // 開始播放國語，並捕捉瀏覽器的自動播放阻擋
        let playZhPromise = audioZh.play();
        if (playZhPromise !== undefined) {
            playZhPromise.then(() => {
                console.log("🔊 成功開始播放語音！");
            }).catch(error => {
                console.warn("💡 瀏覽器安全機制阻擋了自動播放。等待滑鼠點擊畫面解鎖聲音...");
            });
        }
    } else {
        console.error("❌ 找不到音檔，請檢查 HTML 裡的 <audio> 標籤與檔案路徑！");
    }
}

// 確保網頁載入完成後執行
window.addEventListener('load', () => {
    // 1. 延遲 0.5 秒嘗試自動播放 (讓畫面先出現)
    setTimeout(playVoiceAlert, 500);

    // 2. 【終極解鎖機制】：將點擊事件綁定到「整個畫面(document)」
    const unlockAudio = function() {
        playVoiceAlert();
        // 播出來之後，就移除這個監聽器，避免之後點擊任何東西都一直重播
        document.removeEventListener('click', unlockAudio);
    };
    
    // 只要長輩在畫面上隨便點一下，就會立刻解鎖發聲
    document.addEventListener('click', unlockAudio);

    // 3. 綁定機器人與對話氣泡，讓長輩可以隨時主動點擊重聽
    const voiceBubble = document.getElementById('voice-bubble');
    const robotImg = document.querySelector('.robot-img');
    
    if (voiceBubble) {
        voiceBubble.addEventListener('click', playVoiceAlert);
    }
    if (robotImg) {
        robotImg.addEventListener('click', playVoiceAlert);
    }
});