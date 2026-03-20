document.addEventListener('DOMContentLoaded', async function() {
    const urlParams = new URLSearchParams(window.location.search);
    const reason = urlParams.get('reason');

    const reasonBox = document.getElementById('reason-box');
    if (reasonBox) {
        reasonBox.textContent = reason ? reason : "偵測到高度危險內容";
    }

    // 🌟 【核心功能】：跨世代語音守護 - 動態聯絡按鈕
    const callBtn = document.getElementById('call-btn');
    if (callBtn) {
        try {
            // 1. 從 Chrome 擴充功能中抓取這台電腦綁定的 familyID
            const storage = await chrome.storage.local.get(['familyID']);
            const familyID = storage.familyID || 'none';

            // 2. 向後端詢問守護者 (子女) 的專屬聯絡方式
            const response = await fetch(`${CONFIG.API_BASE_URL}/api/get_contact`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ familyID: familyID })
            });
            
            const data = await response.json();
            
            // 3. 判斷並動態改變按鈕
            if (data.status === 'success' && data.contact) {
                // 情境 A：成功抓到子女電話或 LINE (按鈕維持綠色)
                callBtn.href = data.contact;
            } else {
                // 情境 B：未綁定家庭，或子女還沒設定電話 -> 觸發 165 防呆機制
                callBtn.href = "tel:165";
                callBtn.innerHTML = "📞 撥打 165 反詐騙專線";
                callBtn.style.backgroundColor = "#ff9800"; // 變成橘色警告色
                callBtn.style.boxShadow = "0 8px 25px rgba(255, 152, 0, 0.6)";
            }
        } catch (err) {
            console.error("無法取得聯絡資訊", err);
            // 網路錯誤時的最終保底防線
            callBtn.href = "tel:165";
            callBtn.innerHTML = "📞 撥打 165 反詐騙專線";
            callBtn.style.backgroundColor = "#ff9800";
            callBtn.style.boxShadow = "0 8px 25px rgba(255, 152, 0, 0.6)";
        }
    }

    // ================= 以下為原本的離開與回報邏輯 =================
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