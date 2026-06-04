document.addEventListener("DOMContentLoaded", function () {
    const videoBoy = document.getElementById("avatar-video-boy");
    const videoGirl = document.getElementById("avatar-video-girl");
    const startOverlay = document.getElementById("start-overlay");
    const statusText = document.getElementById("status-text");
    const startNowBtn = document.getElementById("start-now-btn");

    async function startWelcome() {
        if (!videoBoy || !videoGirl) return;
        try {
            // 嘗試播放時，先隱藏漂亮引導層
            if (startOverlay) startOverlay.classList.remove("show");
            
            videoGirl.style.opacity = "0";
            videoGirl.style.zIndex = "2";
            videoBoy.style.opacity = "1";
            videoBoy.style.zIndex = "3";
            
            videoGirl.currentTime = 0;
            videoBoy.currentTime = 0;
            
            // 解除靜音並嘗試播放
            videoBoy.muted = false;
            await videoBoy.play(); 
            
            if (statusText) {
                statusText.classList.remove("success");
                statusText.innerHTML = "💬 防護精靈為您解說中...";
            }
            
        } catch (e) {
            console.log("瀏覽器阻擋自動播放，顯示優雅引導層");
            // 播放失敗（被瀏覽器擋下），顯示漂亮的引導層，讓長輩隨意點擊
            if (startOverlay) startOverlay.classList.add("show");
        }
    }

    if (videoBoy) {
        videoBoy.addEventListener("ended", async function () {
            if (videoGirl) {
                try {
                    videoGirl.style.zIndex = "4";
                    videoGirl.style.opacity = "1";
                    videoBoy.style.opacity = "0";
                    
                    videoGirl.muted = false;
                    await videoGirl.play();
                } catch (e) {
                    console.error("小安心播放失敗", e);
                }
            }
        });
    }

    if (videoGirl) {
        videoGirl.addEventListener("ended", function () {
            if (statusText) {
                statusText.classList.add("success");
                statusText.innerHTML = "✅ 解說完畢，即將為您啟動防護！";
            }
            setTimeout(() => {
                if (startNowBtn) startNowBtn.click();
            }, 2000);
        });
    }

    // 只要點擊這個漂亮的透明覆蓋層，就直接開始播放
    if (startOverlay) {
        startOverlay.addEventListener("click", startWelcome);
    }

    // 網頁載入後，還是會偷偷嘗試自動播放一次，如果運氣好瀏覽器允許，就會直接播放！
    setTimeout(startWelcome, 500);
});