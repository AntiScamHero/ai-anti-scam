// ===== blocked.js =====
document.addEventListener('DOMContentLoaded', async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const dataString = urlParams.get('data');
    const targetUrl = urlParams.get('url') || urlParams.get('original_url') || '';
    
    // 預設為前端極速攔截的分數與特徵
    let riskScore = "99"; 
    let reason = "系統偵測到高風險異常行為。";
    let advice = "請勿輸入任何個人資料或密碼。";
    let scamDNA = [];

    // 1. 智慧解碼
    if (dataString) {
        try {
            const data = JSON.parse(decodeURIComponent(dataString));
            riskScore = data.riskScore || riskScore;
            reason = data.reason || reason;
            advice = data.advice || advice;
            scamDNA = data.scamDNA || [];
        } catch (e) {
            console.error("資料解析失敗", e);
        }
    } else {
        reason = urlParams.get('reason') || reason;
        const dnaString = urlParams.get('scamDNA') || "";
        scamDNA = dnaString ? dnaString.split(',') : ["前端極速攔截"];
    }

    // 2. 渲染 UI 畫面
    const scoreEl = document.getElementById('score');
    if(scoreEl) scoreEl.innerText = riskScore;
    
    const reasonEl = document.getElementById('reason');
    if(reasonEl) reasonEl.innerText = reason;
    
    const adviceEl = document.getElementById('advice');
    if(adviceEl) adviceEl.innerText = "💡 專家建議：" + advice;

    const targetDnaBox = document.getElementById('dna-box') || document.getElementById('tags-container');
    if (targetDnaBox && scamDNA.length > 0) {
        scamDNA.forEach(tagText => {
            let cleanedDna = tagText.replace(/[\[\]"]/g, '').trim(); 
            if (cleanedDna !== "") {
                const span = document.createElement('span');
                span.className = 'dna-tag';
                span.innerText = "#" + cleanedDna;
                span.style.cssText = "background-color: #ff4444; color: white; padding: 5px 10px; border-radius: 4px; font-size: 14px; font-weight: bold; margin: 0 5px;";
                targetDnaBox.appendChild(span);
            }
        });
    }

    const targetUrlEl = document.getElementById('target-url');
    if (targetUrlEl && targetUrl) {
        targetUrlEl.innerText = decodeURIComponent(targetUrl);
    }

    // ==========================================
    // 🚨 升級版：隨機輪播防詐常識系統
    // ==========================================
    const tipsDB = [
        "【投資警示】股市群組常有自稱「名師」帶盤。若您正考慮將 1,000,000 至 1,500,000 元的本金匯入對方指定的帳戶或未知名 APP，請立刻停止！合法投顧絕對不會代操資金，這 100% 是詐騙！",
        "【獲利陷阱】穩賺不賠的投資通常就是最貴的教訓。看到「保證獲利」、「內線消息」請務必提高警覺！",
        "【匯款叮嚀】若對方要求使用虛擬貨幣匯款，或到超商購買點數來繳交「保證金」，請立刻撥打 165 求證。",
        "【網購詐騙】銀行與電商平台「絕對不會」打電話要求您操作 ATM 或網銀來「解除分期付款」或「取消升級」。",
        "【假冒官員】警察、檢察官不會在電話中辦案，更不會要求您「監管帳戶」或面交現款，這全是詐騙劇本。",
        "【深偽警告】接到親友借錢電話？現在 AI 聲音和臉部造假技術極其逼真，請務必掛斷電話後回撥本人確認。",
        "【出金套路】詐騙平台會以「手續費」、「解凍金」或「稅金」為由拒絕出金，這只是想騙你更多錢，別再匯了！",
        "【釣魚連結】簡訊裡的「包裹異常」、「電費逾期」連結多為釣魚網站，點入後千萬不可輸入信用卡號或簡訊驗證碼。",
        "【情感詐騙】未見面的網友自稱戰地醫生或海外高管，說要寄送禮物但卡在海關需代墊費？這是典型的殺豬盤！",
        "【全民防詐】網路資訊真真假假，遇到要求匯款、索取密碼或證件的情境，請務必冷靜「一聽、二掛、三查證」！"
    ];

    const dynamicTipEl = document.getElementById('dynamic-tip');
    if (dynamicTipEl) {
        const randomIndex = Math.floor(Math.random() * tipsDB.length);
        dynamicTipEl.innerText = tipsDB[randomIndex];
    }

    // 3. 🟢 單純跳轉到安全網頁 (Google) + 倒數自動跳離
    const safeLeaveAction = () => {
        window.location.replace("https://www.google.com.tw");
    };

    let autoLeaveInterval = null;

    const stopAutoLeave = () => {
        if (autoLeaveInterval) {
            clearInterval(autoLeaveInterval);
            const manualLeaveBtn = document.getElementById('manual-leave-btn');
            if (manualLeaveBtn) manualLeaveBtn.innerText = "聽從建議，安全離開此網頁";
        }
    };

    const manualLeaveBtn = document.getElementById('manual-leave-btn');
    if (manualLeaveBtn) {
        manualLeaveBtn.addEventListener('click', safeLeaveAction);
        
        let autoLeaveTimer = 15;
        manualLeaveBtn.innerText = `安全離開 (${autoLeaveTimer} 秒後自動跳離)`;
        
        autoLeaveInterval = setInterval(() => {
            autoLeaveTimer--;
            if (autoLeaveTimer > 0) {
                manualLeaveBtn.innerText = `安全離開 (${autoLeaveTimer} 秒後自動跳離)`;
            } else {
                clearInterval(autoLeaveInterval);
                manualLeaveBtn.innerText = "正在自動為您跳轉至安全網頁...";
                safeLeaveAction();
            }
        }, 1000);
    }

    // 4. 緊急聯絡人 / 165 撥號模組
    const desktopModal = document.getElementById('desktop-modal');
    const closeModalBtn = document.getElementById('close-modal-btn');
    const modalPhoneNumber = document.getElementById('modal-phone-number');

    if (closeModalBtn && desktopModal) {
        closeModalBtn.addEventListener('click', () => {
            desktopModal.style.display = 'none';
        });
    }

    function setupCallAction(number, buttonText) {
        const callBtn = document.getElementById('call-btn');
        if (!callBtn) return;
        callBtn.innerHTML = buttonText;
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

        if (isMobile) {
            callBtn.href = `tel:${number}`;
            callBtn.onclick = null; 
        } else {
            callBtn.removeAttribute('href');
            callBtn.onclick = (e) => {
                e.preventDefault(); 
                stopAutoLeave(); 
                if(modalPhoneNumber) modalPhoneNumber.innerText = number; 
                if(desktopModal) desktopModal.style.display = 'flex'; 
            };
        }
    }

    try {
        if (typeof chrome !== 'undefined' && chrome.storage) {
            const storage = await chrome.storage.local.get(['familyID']);
            const familyID = storage.familyID || 'none';
            
            const apiUrl = (typeof window.CONFIG !== 'undefined' && window.CONFIG.API_BASE_URL) 
                ? window.CONFIG.API_BASE_URL 
                : 'https://ai-anti-scam.onrender.com';
            
            const response = await fetch(`${apiUrl}/api/get_contact`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ familyID: familyID })
            });
            const data = await response.json();
            
            if (data.status === 'success' && data.contact) {
                setupCallAction(data.contact, `📞 立即聯繫家人確認`);
            } else {
                setupCallAction("165", "📞 撥打 165 反詐騙專線");
            }
        } else {
            setupCallAction("165", "📞 撥打 165 反詐騙專線");
        }
    } catch (err) {
        console.error("無法取得聯絡資訊", err);
        setupCallAction("165", "📞 撥打 165 反詐騙專線");
    }

    // 5. 強制冷靜期邏輯
    const bypassBtn = document.getElementById('bypass-btn');
    if (bypassBtn) {
        bypassBtn.disabled = true;
        let timeLeft = 30;
        
        bypassBtn.addEventListener('mousedown', stopAutoLeave);

        const timer = setInterval(() => {
            timeLeft--;
            bypassBtn.innerText = `強制冷靜期... 請先深呼吸 (剩餘 ${timeLeft} 秒)`;
            
            if (timeLeft <= 0) {
                clearInterval(timer);
                bypassBtn.disabled = false;
                bypassBtn.innerText = "我已了解風險，堅持前往危險網頁 (極不建議)";
                bypassBtn.style.color = "#ff4444";
            }
        }, 1000);

        bypassBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (bypassBtn.disabled) return; 
            if (targetUrl) {
                sessionStorage.setItem('temp_whitelist_' + decodeURIComponent(targetUrl), 'true');
                window.location.replace(decodeURIComponent(targetUrl));
            } else {
                alert("無法取得原始網址，請手動返回或跳轉。");
            }
        });
    }

    // 6. 誤判回報邏輯
    const reportBtn = document.getElementById('report-false-btn');
    if (reportBtn) {
        reportBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            stopAutoLeave(); 
            reportBtn.innerText = "⏳ 傳送中...";
            try {
                const apiUrl = (typeof window.CONFIG !== 'undefined' && window.CONFIG.API_BASE_URL) 
                    ? window.CONFIG.API_BASE_URL 
                    : 'https://ai-anti-scam.onrender.com';
                    
                await fetch(`${apiUrl}/api/report_false_positive`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url: decodeURIComponent(targetUrl) || window.location.href, reported_reason: reason })
                });
                reportBtn.innerText = "✅ 感謝回報！我們將會派員人工審核此網域。";
                reportBtn.style.color = "#34c759";
                reportBtn.style.pointerEvents = "none";
            } catch (err) {
                reportBtn.innerText = "❌ 回報失敗，請確認網路連線。";
            }
        });
    }

    // 7. WebSocket 接收家人推播
    if (typeof chrome !== 'undefined' && chrome.storage) {
        chrome.storage.local.get(['familyID'], function(result) {
            const familyID = result.familyID || 'none';
            if (familyID !== 'none' && typeof io !== 'undefined') {
                try {
                    const socketUrl = (typeof window.CONFIG !== 'undefined' && window.CONFIG.API_BASE_URL) 
                        ? window.CONFIG.API_BASE_URL 
                        : 'https://ai-anti-scam.onrender.com';
                        
                    const socket = io(socketUrl);
                    socket.emit('join_family_room', { familyID: familyID });
                    
                    socket.on('family_urgent_broadcast', (data) => {
                        const broadcastEl = document.getElementById('family-broadcast');
                        const msgEl = document.getElementById('broadcast-message');
                        if (broadcastEl && msgEl) {
                            broadcastEl.style.display = 'block';
                            msgEl.innerText = `「${data.message}」`;
                            try {
                                const audio = new Audio('https://actions.google.com/sounds/v1/alarms/beep_short.ogg');
                                audio.play().catch(e => console.log("音效播放被阻擋", e));
                            } catch(e) {}
                        }
                    });
                } catch(e) { console.error("WebSocket 連線失敗", e); }
            }
        });
    }

    // ==========================================
    // 🔊 8. 語音播放模組 (整合雙語接力與全螢幕解鎖)
    // ==========================================
    const audioZh = document.getElementById('hero-audio-zh');
    const audioTw = document.getElementById('hero-audio-tw');
    const voiceBubble = document.getElementById('voice-bubble');

    function playVoiceAlert() {
        if (!audioZh || !audioTw) return;
        
        // 暫停並重置
        audioZh.pause(); audioZh.currentTime = 0;
        audioTw.pause(); audioTw.currentTime = 0;
        
        // 國語播完接台語
        audioZh.onended = function() {
            let playTwPromise = audioTw.play();
            if (playTwPromise !== undefined) {
                playTwPromise.catch(e => console.warn("💡 台語連播被阻擋:", e));
            }
        };

        // 播放國語
        let playZhPromise = audioZh.play();
        if (playZhPromise !== undefined) {
            playZhPromise.then(() => {
                console.log("🔊 成功開始播放語音！");
                if (voiceBubble) voiceBubble.style.animation = "none"; // 播放成功即取消閃爍
            }).catch(error => {
                console.warn("💡 瀏覽器阻擋自動播放，等待全螢幕點擊解鎖...");
                if (voiceBubble) voiceBubble.style.animation = "flash-bubble 2s infinite"; // 提示點擊
            });
        }
    }

    // 嘗試自動播放
    setTimeout(playVoiceAlert, 500);

    // 全螢幕點擊解鎖機制 (點擊畫面上任何一個角落都會觸發)
    const unlockAudio = function() {
        playVoiceAlert();
        document.removeEventListener('click', unlockAudio);
        document.removeEventListener('touchstart', unlockAudio);
    };
    
    document.addEventListener('click', unlockAudio);
    document.addEventListener('touchstart', unlockAudio);

    // 氣泡和機器人圖片也可主動點擊重播
    const robotImg = document.querySelector('.robot-img');
    if (voiceBubble) voiceBubble.addEventListener('click', playVoiceAlert);
    if (robotImg) robotImg.addEventListener('click', playVoiceAlert);
});