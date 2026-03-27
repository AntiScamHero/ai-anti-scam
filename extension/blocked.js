// ===== blocked.js =====
document.addEventListener('DOMContentLoaded', async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const dataString = urlParams.get('data');
    const targetUrlRaw = urlParams.get('url') || urlParams.get('original_url') || '';
    
    // 🛡️ 防呆：安全的 URL 解碼
    let decodedTargetUrl = '';
    try { 
        decodedTargetUrl = decodeURIComponent(targetUrlRaw); 
    } catch(e) { 
        decodedTargetUrl = targetUrlRaw; 
        console.warn("URL 解碼失敗，使用原始 URL", e);
    }

    let riskScore = "99"; 
    // 💡 UX 升級：移除複雜的分數與原因，直接給予最高級別警告
    let reason = "🚨 警告！這是一個極度危險的詐騙網頁，請立刻離開，千萬不要相信！"; 
    let advice = "請勿輸入任何個人資料或密碼。";
    let scamDNA = [];

    // 1. 智慧解碼
    if (dataString) {
        try {
            const data = JSON.parse(decodeURIComponent(dataString));
            let rawScore = parseInt(data.riskScore);
            // 🛡️ 強制將顯示的分數上限鎖定在 100 分
            if (!isNaN(rawScore)) {
                riskScore = rawScore > 100 ? "100" : rawScore.toString();
            } else {
                riskScore = data.riskScore || riskScore;
            }
            advice = data.advice || advice;
            scamDNA = data.scamDNA || [];
        } catch (e) { console.error("資料解析失敗", e); }
    } else {
        const dnaString = urlParams.get('scamDNA') || "";
        scamDNA = dnaString ? dnaString.split(',') : ["前端極速攔截"];
    }

    // 2. 渲染 UI 畫面
    const scoreEl = document.getElementById('score');
    if(scoreEl) scoreEl.innerText = riskScore;
    
    const reasonEl = document.getElementById('reason');
    if(reasonEl) {
        reasonEl.innerText = reason;
        reasonEl.style.color = "#ff4d4f"; 
        reasonEl.style.fontWeight = "bold";
        reasonEl.style.fontSize = "18px";
    }
    
    const adviceEl = document.getElementById('advice');
    if(adviceEl) adviceEl.innerText = "💡 專家建議：" + advice;

    // 隱藏不必要的特徵標籤，畫面更乾淨
    const targetDnaBox = document.getElementById('dna-box') || document.getElementById('tags-container');
    if (targetDnaBox) targetDnaBox.style.display = 'none';

    const targetUrlEl = document.getElementById('target-url');
    if (targetUrlEl && decodedTargetUrl) {
        targetUrlEl.innerText = decodedTargetUrl;
    }

    // ==========================================
    // 💬 多重宇宙劇本庫：隨機抽取詐騙對話神還原
    // ==========================================
    const allScenarios = window.allScenarios || []; 
    const chatScript = allScenarios.length > 0 
        ? allScenarios[Math.floor(Math.random() * allScenarios.length)]
        : []; 

    let currentChatIdx = 0;
    const btnNextMsg = document.getElementById('btn-next-msg');
    const chatContainer = document.getElementById('chat-history');

    function renderNextMessage() {
        if (!btnNextMsg || !chatContainer) return;
        if (currentChatIdx >= chatScript.length) return;

        const msg = chatScript[currentChatIdx];
        const wrapper = document.createElement('div');
        
        if (msg.role === 'scammer') wrapper.className = 'msg-wrapper msg-left';
        else if (msg.role === 'victim') wrapper.className = 'msg-wrapper msg-right';
        else wrapper.className = 'msg-wrapper msg-center';

        if (msg.name) {
            const nameEl = document.createElement('div');
            nameEl.className = 'msg-name';
            nameEl.innerText = msg.name;
            wrapper.appendChild(nameEl);
        }

        const bubble = document.createElement('div');
        bubble.className = `msg-bubble bubble-${msg.role}`;
        bubble.innerText = msg.text;
        wrapper.appendChild(bubble);

        chatContainer.appendChild(wrapper);
        
        // 平滑滾動到底部
        setTimeout(() => {
            chatContainer.scrollTo({ top: chatContainer.scrollHeight, behavior: 'smooth' });
        }, 50);

        currentChatIdx++;

        if (currentChatIdx >= chatScript.length) {
            btnNextMsg.innerText = '✅ 觀看完畢！請保持警覺，切勿輕信。';
            btnNextMsg.disabled = true;
        }
    }

    if (btnNextMsg && chatScript.length > 0) {
        btnNextMsg.addEventListener('click', renderNextMessage);
        // 自動顯示第一句話
        renderNextMessage();
    }

    // 3. 🟢 單純跳轉到安全網頁 (Google) + 倒數自動跳離
    const safeLeaveAction = () => { window.location.replace("https://www.google.com.tw"); };
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
        closeModalBtn.addEventListener('click', () => { desktopModal.style.display = 'none'; });
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
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            chrome.storage.local.get(['familyID'], async function(result) {
                const familyID = result.familyID || 'none';
                const apiUrl = (typeof window.CONFIG !== 'undefined' && window.CONFIG.API_BASE_URL) 
                    ? window.CONFIG.API_BASE_URL : 'https://ai-anti-scam.onrender.com';
                
                try {
                    const response = await fetch(`${apiUrl}/api/get_contact`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ familyID: familyID })
                    });
                    const data = await response.json();
                    
                    if (data.status === 'success' && data.contact) {
                        setupCallAction(data.contact, `📞 立即聯繫家人確認`);
                    } else {
                        setupCallAction("165", "📞 撥打 165 反詐騙專線");
                    }
                } catch(e) {
                    setupCallAction("165", "📞 撥打 165 反詐騙專線");
                }
            });
        } else {
            setupCallAction("165", "📞 撥打 165 反詐騙專線");
        }
    } catch (err) {
        console.error("無法取得聯絡資訊", err);
        setupCallAction("165", "📞 撥打 165 反詐騙專線");
    }

    // 5. 強制冷靜期邏輯 + 🔒 密碼解鎖防呆升級
    const bypassBtn = document.getElementById('bypass-btn');
    const passwordArea = document.getElementById('password-area');
    const verifyPinBtn = document.getElementById('verify-pin-btn');
    const cancelPinBtn = document.getElementById('cancel-pin-btn');
    const pinInput = document.getElementById('guardian-pin');
    const pinError = document.getElementById('pin-error');

    if (bypassBtn) {
        bypassBtn.disabled = true;
        let timeLeft = 30;
        bypassBtn.addEventListener('mousedown', stopAutoLeave);

        const timer = setInterval(() => {
            timeLeft--;
            if (bypassBtn.style.display !== 'none') {
                bypassBtn.innerText = `強制冷靜期... 請先深呼吸 (剩餘 ${timeLeft} 秒)`;
            }
            if (timeLeft <= 0) {
                clearInterval(timer);
                bypassBtn.disabled = false;
                if (bypassBtn.style.display !== 'none') {
                    bypassBtn.innerText = "解鎖防護網 (需要家人密碼)";
                    bypassBtn.style.color = "#ff4444";
                }
            }
        }, 1000);

        bypassBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (bypassBtn.disabled) return; 
            bypassBtn.style.display = 'none';
            if (passwordArea) passwordArea.style.display = 'block';
            if (pinInput) pinInput.focus();
        });

        if (cancelPinBtn) {
            cancelPinBtn.addEventListener('click', () => {
                passwordArea.style.display = 'none';
                bypassBtn.style.display = 'block';
                pinInput.value = '';
                pinError.style.display = 'none';
                if (timeLeft <= 0) bypassBtn.innerText = "解鎖防護網 (需要家人密碼)";
            });
        }

        if (pinInput) {
            pinInput.addEventListener('input', (e) => {
                e.target.value = e.target.value.replace(/\D/g, ''); 
            });
            pinInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') verifyPinBtn.click();
            });
        }

        if (verifyPinBtn) {
            verifyPinBtn.addEventListener('click', async () => {
                let correctPIN = "1234";
                if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                    try {
                        const storage = await chrome.storage.local.get(['guardianPIN']);
                        if (storage.guardianPIN) correctPIN = storage.guardianPIN.toString().slice(0, 4);
                    } catch (e) { console.error("無法讀取 PIN", e); }
                }

                if (pinInput.value === correctPIN) {
                    pinError.style.display = 'none';
                    if (decodedTargetUrl) {
                        sessionStorage.setItem('temp_whitelist_' + decodedTargetUrl, 'true');
                        window.location.replace(decodedTargetUrl);
                    } else { alert("無法取得原始網址，請手動返回或跳轉。"); }
                } else {
                    pinError.style.display = 'block';
                    pinInput.value = '';
                    pinInput.focus();
                }
            });
        }
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
                    ? window.CONFIG.API_BASE_URL : 'https://ai-anti-scam.onrender.com';
                await fetch(`${apiUrl}/api/report_false_positive`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url: decodedTargetUrl || window.location.href, reported_reason: reason })
                });
                reportBtn.innerText = "✅ 感謝回報！我們將派員審核。";
                reportBtn.style.color = "#34c759";
                reportBtn.style.pointerEvents = "none";
            } catch (err) { reportBtn.innerText = "❌ 回報失敗，請確認網路。"; }
        });
    }

    // 7. WebSocket 接收家人推播
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(['familyID'], function(result) {
            const familyID = result.familyID || 'none';
            if (familyID !== 'none' && typeof io !== 'undefined') {
                try {
                    const socketUrl = (typeof window.CONFIG !== 'undefined' && window.CONFIG.API_BASE_URL) 
                        ? window.CONFIG.API_BASE_URL : 'https://ai-anti-scam.onrender.com';
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

    // 8. 語音播放模組
    const audioZh = document.getElementById('hero-audio-zh');
    const audioTw = document.getElementById('hero-audio-tw');
    const voiceBubble = document.getElementById('voice-bubble');

    function playVoiceAlert() {
        if (!audioZh || !audioTw) return;
        
        audioZh.pause(); audioZh.currentTime = 0;
        audioTw.pause(); audioTw.currentTime = 0;
        
        audioZh.onended = function() {
            let playTwPromise = audioTw.play();
            if (playTwPromise !== undefined) {
                playTwPromise.catch(e => console.warn("💡 台語連播被阻擋:", e));
            }
        };

        let playZhPromise = audioZh.play();
        if (playZhPromise !== undefined) {
            playZhPromise.then(() => {
                console.log("🔊 成功開始播放語音！");
                if (voiceBubble) voiceBubble.style.animation = "none"; 
            }).catch(error => {
                console.warn("💡 瀏覽器阻擋自動播放，等待全螢幕點擊解鎖...");
                if (voiceBubble) voiceBubble.style.animation = "flash-bubble 2s infinite"; 
            });
        }
    }

    setTimeout(playVoiceAlert, 500);

    const unlockAudio = function() {
        playVoiceAlert();
        document.removeEventListener('click', unlockAudio);
        document.removeEventListener('touchstart', unlockAudio);
    };
    
    document.addEventListener('click', unlockAudio);
    document.addEventListener('touchstart', unlockAudio);

    const robotImg = document.querySelector('.robot-img');
    if (voiceBubble) voiceBubble.addEventListener('click', playVoiceAlert);
    if (robotImg) robotImg.addEventListener('click', playVoiceAlert);
});