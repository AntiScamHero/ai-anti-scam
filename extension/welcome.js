document.addEventListener("DOMContentLoaded", function () {
    
    const SAFE_START_URL = "https://www.google.com.tw";
    const TOTAL_SECONDS = 10;
    let remaining = TOTAL_SECONDS;
    let redirectTimer = null;
    let sloganTimer = null;
    let paused = false;

    const statusText = document.getElementById("status-text");
    const startBtn = document.getElementById("start-now-btn");
    const pauseBtn = document.getElementById("pause-auto-btn");
    const sloganText = document.getElementById("slogan-text");
    const familyStatusText = document.getElementById("family-status-text");

    const slogans = [
        "慢一點，就不容易被騙",
        "看到錢、密碼、驗證碼\n先停三秒",
        "穩賺不賠，通常有問題",
        "不確定，就先查證",
        "165 可以幫忙查證"
    ];
    let sloganIndex = 0;

    function setMultilineText(element, text) {
        if (!element) return;
        element.replaceChildren(); 
        
        String(text || "").split("\n").forEach((line, index) => {
            if (index > 0) {
                element.appendChild(document.createElement("br"));
            }
            element.appendChild(document.createTextNode(line));
        });
    }

    function rotateSlogan() {
        if (!sloganText || paused) return;
        
        sloganText.style.opacity = 0; 
        
        setTimeout(() => {
            sloganIndex = (sloganIndex + 1) % slogans.length;
            setMultilineText(sloganText, slogans[sloganIndex]);
            sloganText.style.opacity = 1; 
        }, 500); 
    }

    // --- 新增：靜默初始化家庭群組邏輯 ---
    async function autoSetupFamilyGroup() {
        try {
            // 1. 讀取 Storage 確認是否已經建立過
            const storageData = await new Promise(resolve => {
                if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
                    chrome.storage.local.get(["familyID", "accessToken"], resolve);
                } else {
                    resolve({
                        familyID: localStorage.getItem("familyID"),
                        accessToken: localStorage.getItem("accessToken")
                    });
                }
            });

            // 如果已經有 familyID，直接顯示成功並返回
            if (storageData.familyID) {
                updateFamilyUI("✅ 家庭守護已準備完成 (家人隨時可加入)", true);
                return;
            }

            // 2. 如果沒有，自動呼叫後端 API (這裡預留你的 fetch 結構)
            /*
            const installRes = await fetch('/api/auth/install', { method: 'POST' });
            const installData = await installRes.json();
            
            const familyRes = await fetch('/api/create_family', { 
                method: 'POST',
                headers: { 'Authorization': `Bearer ${installData.accessToken}` }
            });
            const familyData = await familyRes.json();
            */

            // TODO: 把上方註解解開並填入真實邏輯。以下為模擬延遲與寫入行為：
            await new Promise(r => setTimeout(r, 1200)); 
            const newFamilyID = "FAM-" + Math.random().toString(36).substring(2, 8).toUpperCase();
            const newAccessToken = "tok_" + Date.now();

            // 3. 寫入 Storage
            if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
                chrome.storage.local.set({
                    familyID: newFamilyID,
                    accessToken: newAccessToken
                });
            } else {
                localStorage.setItem("familyID", newFamilyID);
                localStorage.setItem("accessToken", newAccessToken);
            }

            updateFamilyUI("✅ 家庭守護已準備完成 (家人隨時可加入)", true);

        } catch (error) {
            console.error("家庭群組自動建立失敗:", error);
            // 即使失敗，也要給長輩一個安心的提示，不要跳紅字報錯
            updateFamilyUI("✅ 基本防護已啟動 (家庭守護可稍後由家人設定)", true);
        }
    }

    function updateFamilyUI(message, isSuccess) {
        if (!familyStatusText) return;
        familyStatusText.textContent = message;
        if (isSuccess) {
            familyStatusText.classList.add("success");
        }
    }
    // ------------------------------------

    function setStorageFlag() {
        try {
            if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
                chrome.storage.local.set({
                    aiShieldWelcomeCompleted: true,
                    aiShieldElderFriendlyMode: true,
                    aiShieldProtectionMode: "active",
                    aiShieldProtectionModeStartedAt: new Date().toISOString()
                });
            } else {
                localStorage.setItem("aiShieldWelcomeCompleted", "true");
                localStorage.setItem("aiShieldProtectionMode", "active");
            }
        } catch (e) {
            console.log("Storage API 未載入");
        }
    }

    function enterProtectionMode() {
        if (redirectTimer) clearInterval(redirectTimer);
        if (sloganTimer) clearInterval(sloganTimer);
        setStorageFlag();
        window.location.replace(SAFE_START_URL);
    }

    function renderCountdown() {
        if (statusText) {
            statusText.textContent = `${remaining} 秒後會自動進入安全上網模式`;
        }
    }

    function startTimers() {
        setMultilineText(sloganText, slogans[sloganIndex]);
        renderCountdown();
        
        sloganTimer = setInterval(rotateSlogan, 3500);
        
        redirectTimer = setInterval(() => {
            if (paused) return;
            
            remaining -= 1;
            renderCountdown();
            
            if (remaining <= 0) {
                enterProtectionMode();
            }
        }, 1000);
    }

    if (startBtn) {
        startBtn.addEventListener("click", enterProtectionMode);
    }

    if (pauseBtn) {
        pauseBtn.addEventListener("click", () => {
            paused = true;
            if (redirectTimer) clearInterval(redirectTimer);
            if (sloganTimer) clearInterval(sloganTimer); 
            
            if (statusText) {
                statusText.textContent = "自動進入已暫停，您可以隨時點擊開始";
                statusText.style.background = "rgba(16, 42, 67, 0.08)";
                statusText.style.borderColor = "transparent";
                statusText.style.color = "var(--ink)";
            }
            pauseBtn.textContent = "已暫停自動進入";
            pauseBtn.disabled = true;
            pauseBtn.style.opacity = "0.5";
            pauseBtn.style.cursor = "not-allowed";
        });
    }

    // 啟動頁面邏輯
    startTimers();
    // 啟動靜默 API 背景任務
    autoSetupFamilyGroup();
});