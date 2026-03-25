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

    // 1. 智慧解碼 (支援 JSON 資料結構，同時相容前端直接傳字串)
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

    // 渲染標籤
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

    // 渲染被攔截的網址
    const targetUrlEl = document.getElementById('target-url');
    if (targetUrlEl && targetUrl) {
        targetUrlEl.innerText = decodeURIComponent(targetUrl);
    }

    // ==========================================
    // 🚨 升級重點：動態情境防詐字卡配對系統
    // ==========================================
    const tipsDB = {
        "金錢誘惑": "股市群組常有自稱「名師」帶盤，若對方要求匯出資金到個人帳戶，或推薦不知名投資平台，100% 是詐騙！投資理財請尋求合法管道。",
        "投資": "穩賺不賠的投資？那他為什麼不自己賺就好？高報酬必定伴隨高風險，看到「保證獲利」四個字絕對是詐騙！",
        "限時壓力": "網購平台或銀行「絕對不會」打電話要求您去 ATM 或使用網銀操作「解除分期付款」、「升級 VIP」或「取消訂單」。",
        "權威誘導": "警察、檢察官或健保局「絕對不會」加您的 LINE 辦案，也不會要求您匯款或派人面交收取「監管資金」。",
        "親情勒索": "收到親友傳 LINE 說急需借錢？現在 AI 聲音和臉部造假技術氾濫（Deepfake），匯款前請務必「打電話」與本人確認！",
        "沉沒成本": "對方說要先繳「保證金」、「稅金」、「手續費」或「解凍金」才能把錢領出來？這是詐騙無底洞，千萬別再匯出任何一毛錢！",
        "釣魚": "收到包裹異常、水電費未繳的簡訊？請勿點擊不明短網址，更「絕對不能」在裡面輸入信用卡號或帳號密碼。",
        "交友": "從未見面的網友突然說要寄送貴重禮物或跨國包裹給您，但卡在海關需要代墊「清關費」？這是典型的跨國交友詐騙！",
        "黑名單": "此網站已被 165 警政署通報為危險網站。詐騙集團常會假冒知名品牌外觀，請直接關閉網頁以策安全。",
        "default": "網路資訊真真假假，遇到要求匯款、索取密碼或身分證件的情境，請務必冷靜求證，切勿衝動行事！"
    };

    // 將 DNA 與攔截原因合併，作為配對字串
    const searchString = (scamDNA.join(',') + reason).toLowerCase();
    let matchedTip = tipsDB["default"];

    // 尋找最符合當前情境的防詐常識
    for (const [key, tip] of Object.entries(tipsDB)) {
        if (key !== "default" && searchString.includes(key.toLowerCase())) {
            matchedTip = tip;
            break; 
        }
    }

    // 將文案塞入 HTML
    const dynamicTipEl = document.getElementById('dynamic-tip');
    if (dynamicTipEl) {
        dynamicTipEl.innerText = matchedTip;
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
});