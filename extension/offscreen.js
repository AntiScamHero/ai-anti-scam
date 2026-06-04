const audio = document.getElementById("bg-audio");

if (audio) {
    audio.src = chrome.runtime.getURL("assets/audio/welcome-audio.mp3");
    audio.preload = "auto";
    audio.volume = 1;
    audio.load();
}

function playWelcomeAudio() {
    if (!audio) return;

    audio.pause();
    audio.currentTime = 0;
    audio.volume = 1;

    audio.play()
        .then(() => {
            chrome.runtime.sendMessage({
                action: "WELCOME_AUDIO_STARTED"
            });
        })
        .catch((error) => {
            chrome.runtime.sendMessage({
                action: "WELCOME_AUDIO_FAILED",
                message: error?.message || String(error)
            });
            console.log("後台歡迎音訊播放失敗：", error);
        });
}

function stopWelcomeAudio() {
    if (!audio) return;

    audio.pause();
    audio.currentTime = 0;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (!request || typeof request !== "object") return false;

    if (request.action === "AUDIO_CONTROL") {
        if (request.play) {
            playWelcomeAudio();
        } else {
            stopWelcomeAudio();
        }

        if (sendResponse) {
            sendResponse({
                status: "success",
                ok: true
            });
        }

        return true;
    }

    if (request.action === "PING_OFFSCREEN_AUDIO") {
        if (sendResponse) {
            sendResponse({
                status: "ready",
                ok: true
            });
        }
        return true;
    }

    return false;
});

chrome.runtime.sendMessage({
    action: "WELCOME_OFFSCREEN_READY"
});
