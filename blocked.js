document.addEventListener('DOMContentLoaded', function() {
    const urlParams = new URLSearchParams(window.location.search);
    const reason = urlParams.get('reason');

    const reasonBox = document.getElementById('reason-box');
    if (reasonBox) {
        reasonBox.textContent = reason ? reason : "偵測到高度危險內容";
    }

    const leaveBtn = document.getElementById('manual-leave-btn');
    
    let countdown = 3;
    if (leaveBtn) {
        leaveBtn.innerText = `✅ 自動安全離開 (${countdown}秒)`;
    }

    const timer = setInterval(() => {
        countdown--;
        if (leaveBtn) { leaveBtn.innerText = `✅ 自動安全離開 (${countdown}秒)`; }
        if (countdown <= 0) {
            clearInterval(timer);
            window.location.replace("https://www.google.com");
        }
    }, 1000);

    if (leaveBtn) {
        leaveBtn.addEventListener('click', () => {
            clearInterval(timer); 
            window.location.replace("https://www.google.com");
        });
    }

    // 🌟 處理誤判回報邏輯
    const reportBtn = document.getElementById('report-false-btn');
    if (reportBtn) {
        reportBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            reportBtn.innerText = "⏳ 傳送中...";
            try {
                // 🛡️ 使用 CONFIG
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

    const bypassBtn = document.getElementById('bypass-btn');
    if (bypassBtn) {
        bypassBtn.addEventListener('click', (e) => {
            e.preventDefault();
            clearInterval(timer);
            const originalUrl = urlParams.get('original_url'); 
            if (originalUrl) {
                sessionStorage.setItem('temp_whitelist_' + originalUrl, 'true');
                window.location.replace(originalUrl);
            } else {
                alert("無法取得原始網址，請手動返回或關閉分頁。");
            }
        });
    }
});