// ===== voice.js (國台語 .wav 雙聲道連播且可手動觸發版) =====

function playVoiceAlert() {
    const audioZh = document.getElementById('hero-audio-zh');
    const audioTw = document.getElementById('hero-audio-tw');
    
    if (audioZh && audioTw) {
        // 為了避免連點造成聲音重疊，每次點擊都先把兩首歌暫停並歸零
        audioZh.pause();
        audioZh.currentTime = 0;
        audioTw.pause();
        audioTw.currentTime = 0;
        
        // 關鍵接力賽：告訴國語播放器「當你播完時，請立刻叫台語播放器開始播」
        audioZh.onended = function() {
            console.log("🔊 國語播完，接著播台語...");
            audioTw.play().catch(function(error) {
                console.warn("台語連播失敗", error);
            });
        };

        // 第一棒：開始播放國語
        audioZh.play().then(() => {
            console.log("🔊 成功開始播放國語音檔！");
        }).catch((error) => {
            console.warn("💡 提示：瀏覽器阻擋了自動播放，請點擊畫面任何一處來解鎖聲音。", error);
        });
    } else {
        console.error("❌ 找不到音檔播放器，請檢查 blocked.html 裡的 <audio> 標籤是否正確設定！");
    }
}

// 網頁載入完成後的處理
document.addEventListener('DOMContentLoaded', () => {
    // 1. 嘗試自動播放 (延遲 0.5 秒讓畫面先跑出來，減少被瀏覽器阻擋的機率)
    setTimeout(playVoiceAlert, 500);

    // 2. 綁定左側「英雄區塊」點擊播放功能 (長輩沒聽清楚可以再按一次，會從頭雙聲道再播一次)
    const voiceBubble = document.getElementById('voice-bubble');
    if (voiceBubble) {
        voiceBubble.addEventListener('click', playVoiceAlert);
    }
    
    // 也綁定機器人圖片，點擊機器人也能聽一次
    const robotImg = document.querySelector('.robot-img');
    if (robotImg) {
        robotImg.style.cursor = 'pointer'; // 滑鼠移過去顯示手型
        robotImg.addEventListener('click', playVoiceAlert);
    }

    // 3. 綁定畫面任意處點擊 (用來破解瀏覽器的自動播放限制)
    document.body.addEventListener('click', function playOnClick() {
        playVoiceAlert();
        // 點過一次就解除監聽，避免之後點其他按鈕也一直重播
        document.body.removeEventListener('click', playOnClick); 
    });
});