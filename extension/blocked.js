document.addEventListener('DOMContentLoaded', async function() {
    const urlParams = new URLSearchParams(window.location.search);
    const reason = urlParams.get('reason');
    const dnaString = urlParams.get('scamDNA') || "未知套路,高度風險";
    const scamDNA = dnaString.split(',');

    const originalUrlDisplay = document.getElementById('target-url');
    const originalUrl = urlParams.get('original_url');
    if (originalUrlDisplay && originalUrl) {
        originalUrlDisplay.textContent = originalUrl;
    }

    const reasonBox = document.getElementById('reason-box');
    if (reasonBox) {
        reasonBox.textContent = reason ? reason : "偵測到高度危險的惡意隱藏特徵";
    }

    const dnaBox = document.getElementById('dna-box');
    if (dnaBox) {
        scamDNA.forEach(dna => {
            let cleanedDna = dna.replace(/[\[\]"]/g, '').trim(); 
            if (cleanedDna !== "") {
                const span = document.createElement('span');
                span.className = 'dna-tag';
                span.innerText = `⚠️ ${cleanedDna}`;
                dnaBox.appendChild(span);
            }
        });
    }

    const audio = document.getElementById('warning-audio');
    if (audio) {
        audio.play().catch(() => {
            document.body.addEventListener('click', () => {
                if (audio.paused) audio.play().catch(e => console.log(e));
            }, { once: true });
        });
    }

    // 🔥 彈出視窗邏輯設定
    const desktopModal = document.getElementById('desktop-modal');
    const closeModalBtn = document.getElementById('close-modal-btn');
    const modalPhoneNumber = document.getElementById('modal-phone-number');

    if (closeModalBtn) {
        closeModalBtn.addEventListener('click', () => {
            desktopModal.style.display = 'none';
        });
    }

    // 共用的電話按鈕設定函數
    function setupCallAction(number, buttonText) {
        const callBtn = document.getElementById('call-btn');
        if (!callBtn) return;

        callBtn.innerHTML = buttonText;
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

        if (isMobile) {
            // 手機版：保留 tel 連結，直接用手機打
            callBtn.href = `tel:${number}`;
            callBtn.onclick = null; // 清除點擊事件
        } else {
            // 電腦版：移除 href，改為觸發我們的自訂彈出視窗
            callBtn.removeAttribute('href');
            callBtn.onclick = (e) => {
                e.preventDefault(); // 阻止任何預設跳轉
                modalPhoneNumber.innerText = number; // 把號碼塞進視窗裡
                desktopModal.style.display = 'flex'; // 顯示視窗
            };
        }
    }

    // 4. 【核心功能】：跨世代語音守護
    try {
        const storage = await chrome.storage.local.get(['familyID']);
        const familyID = storage.familyID || 'none';

        const response = await fetch(`${CONFIG.API_BASE_URL}/api/get_contact`, {
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
    } catch (err) {
        console.error("無法取得聯絡資訊", err);
        setupCallAction("165", "📞 撥打 165 反詐騙專線");
    }

    // 5. 安全離開邏輯
    const leaveBtn = document.getElementById('manual-leave-btn');
    if (leaveBtn) {
        leaveBtn.addEventListener('click', () => {
            window.location.replace("https://www.google.com");
        });
    }

    // 6. 30 秒強制冷靜期
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
            
            if (originalUrl) {
                sessionStorage.setItem('temp_whitelist_' + originalUrl, 'true');
                window.location.replace(originalUrl);
            } else {
                alert("無法取得原始網址，請手動返回或關閉分頁。");
            }
        });
    }

    // 7. 誤判回報邏輯
    const reportBtn = document.getElementById('report-false-btn');
    if (reportBtn) {
        reportBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            reportBtn.innerText = "⏳ 傳送中...";
            try {
                await fetch(`${CONFIG.API_BASE_URL}/api/report_false_positive`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url: originalUrl || window.location.href, reported_reason: reason })
                });
                reportBtn.innerText = "✅ 感謝回報！我們將會派員人工審核此網域。";
                reportBtn.style.color = "#34c759";
                reportBtn.style.pointerEvents = "none";
            } catch (err) {
                reportBtn.innerText = "❌ 回報失敗，請確認網路連線。";
            }
        });
    }
});