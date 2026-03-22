// ===== blocked.js =====
document.addEventListener('DOMContentLoaded', async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const dataString = urlParams.get('data');
    const targetUrl = urlParams.get('url') || urlParams.get('original_url');
    
    let riskScore = "--";
    let reason = "系統偵測到高風險異常行為。";
    let advice = "請勿輸入任何個人資料或密碼。";
    let scamDNA = [];

    // 1. 智慧解碼 (支援 JSON 資料結構，同時相容舊版直接傳參數)
    if (dataString) {
        try {
            const data = JSON.parse(decodeURIComponent(dataString));
            riskScore = data.riskScore || "--";
            reason = data.reason || reason;
            advice = data.advice || advice;
            scamDNA = data.scamDNA || [];
        } catch (e) {
            console.error("資料解析失敗", e);
        }
    } else {
        reason = urlParams.get('reason') || reason;
        const dnaString = urlParams.get('scamDNA') || "";
        scamDNA = dnaString ? dnaString.split(',') : ["未知套路"];
    }

    // 2. 渲染 UI 畫面
    const scoreEl = document.getElementById('score');
    if(scoreEl) scoreEl.innerText = riskScore;
    
    const reasonEl = document.getElementById('reason');
    if(reasonEl) reasonEl.innerText = reason;
    
    const adviceEl = document.getElementById('advice');
    if(adviceEl) adviceEl.innerText = "💡 專家建議：" + advice;

    const tagsContainer = document.getElementById('tags-container');
    if (tagsContainer && scamDNA.length > 0) {
        scamDNA.forEach(tagText => {
            let cleanedDna = tagText.replace(/[\[\]"]/g, '').trim(); 
            if (cleanedDna !== "") {
                const span = document.createElement('span');
                span.className = 'tag';
                span.innerText = "#" + cleanedDna;
                tagsContainer.appendChild(span);
            }
        });
    }

    const originalUrlEl = document.getElementById('original-url');
    if (originalUrlEl && targetUrl) {
        originalUrlEl.innerText = "原網址: " + decodeURIComponent(targetUrl);
    }

    // 3. 安全關閉分頁邏輯
    const closeBtn = document.getElementById('close-btn');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            try {
                if (chrome && chrome.tabs) {
                    chrome.tabs.getCurrent(function(tab) {
                        if (tab) { chrome.tabs.remove(tab.id); } 
                        else { window.location.replace("https://www.google.com"); }
                    });
                } else {
                    window.location.replace("https://www.google.com");
                }
            } catch(e) { window.location.replace("https://www.google.com"); }
        });
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
                if(modalPhoneNumber) modalPhoneNumber.innerText = number; 
                if(desktopModal) desktopModal.style.display = 'flex'; 
            };
        }
    }

    try {
        if (typeof chrome !== 'undefined' && chrome.storage) {
            const storage = await chrome.storage.local.get(['familyID']);
            const familyID = storage.familyID || 'none';
            const apiUrl = (typeof window.CONFIG !== 'undefined') ? window.CONFIG.API_BASE_URL : 'http://127.0.0.1:5000';
            
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
        const timer = setInterval(() => {
            timeLeft--;
            bypassBtn.innerText = `強制冷靜期... 請先深呼吸 (剩餘 ${timeLeft} 秒)`;
            
            if (timeLeft <= 0) {
                clearInterval(timer);
                bypassBtn.disabled = false;
                bypassBtn.innerText = "我已與家人確認，仍要繼續前往 (極不建議)";
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
                alert("無法取得原始網址，請手動返回或關閉分頁。");
            }
        });
    }

    // 6. 誤判回報邏輯
    const reportBtn = document.getElementById('report-false-btn');
    if (reportBtn) {
        reportBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            reportBtn.innerText = "⏳ 傳送中...";
            try {
                const apiUrl = (typeof window.CONFIG !== 'undefined') ? window.CONFIG.API_BASE_URL : 'http://127.0.0.1:5000';
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

    // 7. 靈魂拷問邏輯 (打斷被洗腦狀態)
    const checkboxes = document.querySelectorAll('.soul-question');
    const wakeUpBtn = document.getElementById('wake-up-btn');
    
    if (checkboxes.length > 0 && wakeUpBtn) {
        checkboxes.forEach(box => {
            box.addEventListener('change', () => {
                const anyChecked = Array.from(checkboxes).some(cb => cb.checked);
                wakeUpBtn.style.display = anyChecked ? 'block' : 'none';
            });
        });

        wakeUpBtn.addEventListener('click', () => {
            const closeBtn = document.getElementById('close-btn');
            if(closeBtn) closeBtn.click();
            else window.location.replace("https://www.google.com");
        });
    }

    // 8. WebSocket 接收家人推播
    if (typeof chrome !== 'undefined' && chrome.storage) {
        chrome.storage.local.get(['familyID'], function(result) {
            const familyID = result.familyID || 'none';
            if (familyID !== 'none' && typeof io !== 'undefined') {
                try {
                    const socketUrl = (typeof window.CONFIG !== 'undefined' && window.CONFIG.API_BASE_URL) ? window.CONFIG.API_BASE_URL : 'http://127.0.0.1:5000';
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