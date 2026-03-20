document.addEventListener('DOMContentLoaded', async function() {
    const urlParams = new URLSearchParams(window.location.search);
    const reason = urlParams.get('reason');
    // 接收來自 AI 分析的 scamDNA，若無則給予預設值
    const dnaString = urlParams.get('scamDNA') || "未知套路,高度風險";
    const scamDNA = dnaString.split(',');

    // 1. 填入 AI 判斷理由
    const reasonBox = document.getElementById('reason-box');
    if (reasonBox) {
        reasonBox.textContent = reason ? reason : "偵測到高度危險的惡意隱藏特徵";
    }

    // 2. 動態生成詐騙 DNA 標籤
    const dnaBox = document.getElementById('dna-box');
    if (dnaBox) {
        scamDNA.forEach(dna => {
            let cleanedDna = dna.replace(/[\[\]"]/g, '').trim(); // 清理可能的陣列格式殘留
            if (cleanedDna !== "") {
                const span = document.createElement('span');
                span.className = 'dna-tag';
                span.innerText = `⚠️ ${cleanedDna}`;
                dnaBox.appendChild(span);
            }
        });
    }

    // 3. 語音伴讀功能 (長輩模式)
    const audio = document.getElementById('warning-audio');
    if (audio) {
        // 嘗試自動播放 (若被瀏覽器阻擋，則等使用者點擊畫面任何一處時播放)
        audio.play().catch(() => {
            document.body.addEventListener('click', () => {
                if (audio.paused) audio.play().catch(e => console.log(e));
            }, { once: true });
        });
    }

    // 🌟 4. 【核心功能】：跨世代語音守護 - 動態聯絡按鈕 (完美保留您的實作)
    const callBtn = document.getElementById('call-btn');
    if (callBtn) {
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
                // 成功抓到子女電話
                callBtn.href = data.contact;
                callBtn.innerHTML = "📞 立即聯繫家人確認";
            } else {
                // 未綁定或失敗，切換至 165
                callBtn.href = "tel:165";
                callBtn.innerHTML = "📞 撥打 165 反詐騙專線";
                callBtn.style.backgroundColor = "#ff9800";
                callBtn.style.boxShadow = "0 8px 25px rgba(255, 152, 0, 0.6)";
            }
        } catch (err) {
            console.error("無法取得聯絡資訊", err);
            callBtn.href = "tel:165";
            callBtn.innerHTML = "📞 撥打 165 反詐騙專線";
            callBtn.style.backgroundColor = "#ff9800";
            callBtn.style.boxShadow = "0 8px 25px rgba(255, 152, 0, 0.6)";
        }
    }

    // 5. 安全離開邏輯 (移除自動倒數，讓長輩有時間打電話)
    const leaveBtn = document.getElementById('manual-leave-btn');
    if (leaveBtn) {
        leaveBtn.addEventListener('click', () => {
            // 嘗試關閉分頁，若擴充功能權限不允許則導回 Google
            window.location.replace("https://www.google.com");
        });
    }

    // 🌟 6. 【全新升級】：30 秒強制冷靜期
    const bypassBtn = document.getElementById('bypass-btn');
    if (bypassBtn) {
        let timeLeft = 30;
        const timer = setInterval(() => {
            timeLeft--;
            bypassBtn.innerText = `強制冷靜期... 請先深呼吸 (剩餘 ${timeLeft} 秒)`;
            
            if (timeLeft <= 0) {
                clearInterval(timer);
                bypassBtn.disabled = false;
                bypassBtn.innerText = "我已與家人確認，仍要繼續前往 (極不建議)";
            }
        }, 1000);

        bypassBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (bypassBtn.disabled) return; // 雙重防護
            
            const originalUrl = urlParams.get('original_url'); 
            if (originalUrl) {
                sessionStorage.setItem('temp_whitelist_' + originalUrl, 'true');
                window.location.replace(originalUrl);
            } else {
                alert("無法取得原始網址，請手動返回或關閉分頁。");
            }
        });
    }

    // 7. 誤判回報邏輯 (完美保留)
    const reportBtn = document.getElementById('report-false-btn');
    if (reportBtn) {
        reportBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            reportBtn.innerText = "⏳ 傳送中...";
            try {
                await fetch(`${CONFIG.API_BASE_URL}/api/report_false_positive`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url: window.location.href, reported_reason: reason })
                });
                reportBtn.innerText = "✅ 感謝回報！我們將會派員人工審核此網域。";
                reportBtn.style.color = "#34c759";
                reportBtn.style.textDecoration = "none";
            } catch (err) {
                reportBtn.innerText = "❌ 回報失敗，請確認網路連線。";
            }
        });
    }
});