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
    // 🚨 升級版：多則防詐常識顯示系統
    // ==========================================
    const tipsDB = {
        "投資": "【投資警示】股市群組常有自稱「名師」帶盤。合法投顧絕對不會要求您將本金匯入個人帳戶或未知名 APP，這 100% 是詐騙！",
        "飆股": "【獲利陷阱】穩賺不賠的投資通常就是最貴的教訓。看到「保證獲利」、「內線消息」請務必提高警覺！",
        "金錢誘惑": "【匯款叮嚀】若對方要求使用虛擬貨幣匯款，或到超商購買點數來繳交「保證金」，請立刻撥打 165 求證。",
        "限時壓力": "【網購詐騙】銀行與電商平台「絕對不會」打電話要求您操作 ATM 或網銀來「解除分期付款」或「取消升級」。",
        "權威誘導": "【假冒官員】警察、檢察官不會在電話中辦案，更不會要求您「監管帳戶」或面交現款，這全是詐騙劇本。",
        "親情勒索": "【深偽警告】接到親友借錢電話？現在 AI 聲音和臉部造假技術（Deepfake）極其逼真，請務必掛斷電話後回撥本人確認。",
        "沉沒成本": "【出金套路】詐騙平台會以「手續費」、「解凍金」或「稅金」為由拒絕出金，這只是想騙你更多錢，別再匯了！",
        "釣魚": "【連結莫點】簡訊裡的「包裹異常」、「電費逾期」連結多為釣魚網站，點入後千萬不可輸入信用卡號或簡訊驗證碼。",
        "交友": "【情感詐騙】未見面的網友自稱戰地醫生或海外高管，說要寄送禮物但卡在海關需代墊費？這是典型的殺豬盤！",
        "個資": "【隱私保護】不要在不明網站輸入您的身分證號、銀行帳號或手機門號，這些資料會被賣給詐騙集團進行後續騷擾。",
        "default": "【全民防詐】網路資訊真真假假，遇到要求匯款、索取密碼或證件的情境，請務必冷靜「一聽、二掛、三查證」！"
    };

    const searchString = (scamDNA.join(',') + reason).toLowerCase();
    const container = document.getElementById('tips-container');
    
    if (container) {
        container.innerHTML = ''; // 清空載入中文字
        
        let shownTips = [];
        
        // 1. 先抓出最相關的 (根據關鍵字比對)
        for (const [key, tip] of Object.entries(tipsDB)) {
            if (key !== "default" && searchString.includes(key.toLowerCase())) {
                shownTips.push(tip);
            }
        }
        
        // 2. 如果相關的太少，補上 default 或隨機幾條，湊滿 3 條
        const allKeys = Object.keys(tipsDB).filter(k => k !== 'default');
        while (shownTips.length < 3) {
            const randomKey = allKeys[Math.floor(Math.random() * allKeys.length)];
            const randomTip = tipsDB[randomKey];
            if (!shownTips.includes(randomTip)) {
                shownTips.push(randomTip);
            }
        }

        // 3. 限制最多顯示 4 條，避免畫面太擠
        shownTips.slice(0, 4).forEach(tipText => {
            const tipDiv = document.createElement('div');
            tipDiv.style.cssText = "color: #ffeb3b; font-size: 15px; line-height: 1.6; margin-bottom: 12px; padding-left: 10px; border-left: 3px solid #ffeb3b;";
            tipDiv.innerText = tipText;
            container.appendChild(tipDiv);
        });
    }
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