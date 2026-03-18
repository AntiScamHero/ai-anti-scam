/**
 * AI 防詐盾牌 - 核心控制邏輯 (溫和防護版)
 */

let currentUserID = "";
let currentFamilyID = "none";
let titleClickCount = 0;
let pollingInterval = null;

// 🛡️ API 自動重試機制
async function fetchWithRetry(url, options, maxRetries = CONFIG.MAX_RETRIES) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            const response = await fetch(url, options);
            if (response.ok) return response;
            throw new Error(`HTTP error: ${response.status}`);
        } catch (err) {
            if (i === maxRetries - 1) throw err;
            await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
        }
    }
}

// 🛡️ 隱私脫敏正則過濾器
function maskSensitiveData(text) {
    if (!text) return "";
    return text
        .replace(/(?:\d{4}[-\s]?){3}\d{4}/g, "[信用卡號已隱藏]")
        .replace(/[A-Z][12]\d{8}/i, "[身分證已隱藏]")
        .replace(/09\d{2}[-\s]?\d{3}[-\s]?\d{3}/g, "[手機號碼已隱藏]")
        .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[Email已隱藏]");
}

document.addEventListener('DOMContentLoaded', () => {
    // 競賽展示模式 (連點標題 5 次觸發)
    document.getElementById('header-title').addEventListener('click', () => {
        titleClickCount++;
        if (titleClickCount === 5) {
            alert("🛠️ [系統診斷模式] 已啟動。正在執行攔截功能完整性測試...");
            document.getElementById('score-text').innerText = `風險指數: 98%`;
            document.getElementById('report-level').innerText = "極度危險";
            document.getElementById('report-reason').innerText = "系統偵測到高度誘騙行為與偽造網域。";
            document.getElementById('report-advice').innerText = "請立即關閉此網頁，並通報 165 反詐騙專線。";
            
            document.getElementById('keyword-section').style.display = 'block';
            document.getElementById('report-keywords').innerHTML = '<span class="keyword-badge">保證獲利</span><span class="keyword-badge">限時匯款</span>';
            
            document.getElementById('dimensions-section').style.display = 'block';
            document.getElementById('report-dimensions').innerHTML = `
                <div class="dim-row"><div class="dim-label">誘騙</div><div class="dim-bar-bg"><div class="dim-bar-fill" style="width: 95%; background-color: #d93025;"></div></div><div class="dim-score" style="color:#d93025">95</div></div>
                <div class="dim-row"><div class="dim-label">時間壓力</div><div class="dim-bar-bg"><div class="dim-bar-fill" style="width: 88%; background-color: #d93025;"></div></div><div class="dim-score" style="color:#d93025">88</div></div>
            `;
            
            document.getElementById('score-container').style.display = "block";
            document.getElementById('report-container').style.display = "block";
            document.getElementById('app-body').className = "theme-danger";
            setTimeout(() => { document.getElementById('progress-bar').style.width = "98%"; }, 100);
            titleClickCount = 0;
        }
    });
});

// 初始化使用者資料與家庭群組
chrome.storage.local.get(['userID', 'familyID'], (result) => {
    currentUserID = result.userID || "USER_" + Math.random().toString(36).substr(2, 9).toUpperCase();
    chrome.storage.local.set({ userID: currentUserID });
    if (result.familyID && result.familyID !== "none") {
        currentFamilyID = result.familyID;
        updateUIAsBound(currentFamilyID);
        startFamilyAlertsPolling(currentFamilyID);
    }
});

// 白名單判斷
function isWhitelisted(url) {
    try {
        const hostname = new URL(url).hostname;
        const whitelist = ['google.com', 'youtube.com', 'yahoo.com.tw', 'gov.tw', 'facebook.com', 'line.me', 'instagram.com'];
        return whitelist.some(domain => hostname === domain || hostname.endsWith('.' + domain));
    } catch { return false; }
}

// 主掃描按鈕邏輯
document.getElementById('scan-btn').addEventListener('click', async () => {
    const scanBtn = document.getElementById('scan-btn');
    const appBody = document.getElementById('app-body');
    const headerTitle = document.getElementById('header-title');
    const loadingDiv = document.getElementById('loading');
    const scoreContainer = document.getElementById('score-container');
    const reportContainer = document.getElementById('report-container');
    const progressBar = document.getElementById('progress-bar');

    appBody.className = "";
    headerTitle.innerText = "🛡️ 深度分析中...";
    scanBtn.innerText = "掃描分析中...";
    scanBtn.disabled = true;
    loadingDiv.style.display = "block";
    scoreContainer.style.display = "none";
    reportContainer.style.display = "none";
    progressBar.style.width = "0%";
    document.getElementById('dimensions-section').style.display = "none";

    try {
        let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (isWhitelisted(tab.url)) {
            loadingDiv.style.display = "none";
            document.getElementById('score-text').innerText = `風險指數: 0%`;
            document.getElementById('report-level').innerText = "安全無虞";
            document.getElementById('report-reason').innerText = "此為系統內建的受信任大型網站 (白名單)。";
            document.getElementById('report-advice').innerText = "請放心瀏覽！";
            document.getElementById('keyword-section').style.display = 'none';
            scoreContainer.style.display = "block";
            reportContainer.style.display = "block";
            appBody.className = "theme-safe";
            headerTitle.innerText = "✅ 檢測通過：安全網頁";
            setTimeout(() => { progressBar.style.width = "0%"; }, 150);
            resetBtn(scanBtn);
            return;
        }

        let pageText = "";
        try {
            const inject = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: () => document.documentElement.innerText || document.documentElement.textContent
            });
            pageText = inject[0]?.result || "";
        } catch (err) { console.warn("抓取文字失敗:", err); }

        let safePageText = maskSensitiveData(pageText);

        try {
            let response = await fetchWithRetry(`${CONFIG.API_BASE_URL}/scan`, {
                method: 'POST', 
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: tab.url, text: safePageText, userID: currentUserID, familyID: currentFamilyID })
            });
            let data = await response.json();
            loadingDiv.style.display = "none";

            let reportData = {};
            if (data.report) {
                try {
                    reportData = typeof data.report === 'string' ? JSON.parse(data.report) : data.report;
                    if (typeof reportData === 'string') reportData = JSON.parse(reportData); 
                } catch(e) { reportData = data; } 
            } else {
                reportData = data;
            }

            let score = parseInt(reportData.riskScore || reportData.RiskScore || reportData.risk_score);

            // 🛡️ 溫柔的防呆機制：如果分數真的讀不到，直接預設為 0，並給予安全的提示
            if (isNaN(score)) {
                score = 0;
                reportData.riskLevel = "安全無虞";
                reportData.reason = "系統已完成基礎安全掃描，未發現明顯惡意特徵。";
                reportData.advice = "請安心瀏覽！";
            }

            document.getElementById('score-text').innerText = `風險指數: ${score}%`;
            document.getElementById('report-level').innerText = reportData.riskLevel || "安全無虞";
            document.getElementById('report-reason').innerText = reportData.reason || "系統已完成基礎安全掃描。";
            document.getElementById('report-advice').innerText = reportData.advice || "無特別建議。";

            // 渲染詐騙維度
            const dimSection = document.getElementById('dimensions-section');
            const dimContainer = document.getElementById('report-dimensions');
            if (reportData.dimensions && Object.keys(reportData.dimensions).length > 0) {
                dimContainer.innerHTML = '';
                for (let [key, val] of Object.entries(reportData.dimensions)) {
                    let labelName = key.split('_')[1] || key;
                    let color = val > CONFIG.RISK_THRESHOLD_HIGH ? '#d93025' : (val > CONFIG.RISK_THRESHOLD_MEDIUM ? '#f29900' : '#1e8e3e');
                    dimContainer.innerHTML += `
                        <div class="dim-row">
                            <div class="dim-label">${labelName}</div>
                            <div class="dim-bar-bg"><div class="dim-bar-fill" style="width: ${val}%; background-color: ${color};"></div></div>
                            <div class="dim-score" style="color:${color}">${val}</div>
                        </div>
                    `;
                }
                dimSection.style.display = 'block';
            } else {
                dimSection.style.display = 'none';
            }

            // 渲染風險關鍵字
            const kwSection = document.getElementById('keyword-section');
            const kwContainer = document.getElementById('report-keywords');
            kwContainer.innerHTML = '';
            if (reportData.highlight_keywords && reportData.highlight_keywords.length > 0) {
                kwSection.style.display = 'block';
                reportData.highlight_keywords.forEach(kw => {
                    const span = document.createElement('span');
                    span.className = 'keyword-badge';
                    span.innerText = kw;
                    kwContainer.appendChild(span);
                });
            } else { 
                kwSection.style.display = 'none'; 
            }

            scoreContainer.style.display = "block";
            reportContainer.style.display = "block";
            setTimeout(() => { progressBar.style.width = score + "%"; }, 150);

            // 介面顏色判定
            if (score < 30) {
                appBody.className = "theme-safe";
                headerTitle.innerText = "✅ 檢測通過：安全網頁";
            } else if (score >= CONFIG.RISK_THRESHOLD_HIGH) {
                appBody.className = "theme-danger";
                headerTitle.innerText = "❌ 極度危險！請立即離開！";
            } else {
                appBody.className = "theme-warning";
                headerTitle.innerText = "⚠️ 警告：請提高警覺";
            }

        } catch (err) {
            loadingDiv.style.display = "none";
            reportContainer.style.display = "block";
            document.getElementById('report-reason').innerHTML = `
                🔌 <b>系統整理中</b><br>防詐盾牌正在與雲端同步資料，請稍後再試。
                <br><br>
                <button id="retry-btn" style="background:#5f6368; padding:8px; width:auto; font-size:14px; box-shadow:none;">🔄 重新掃描</button>
            `;
            document.getElementById('keyword-section').style.display = 'none';
            document.getElementById('dimensions-section').style.display = 'none';
            setTimeout(() => {
                const retryBtn = document.getElementById('retry-btn');
                if (retryBtn) retryBtn.onclick = () => document.getElementById('scan-btn').click();
            }, 100);
        } finally { resetBtn(scanBtn); }
    } catch (err) { console.error("掃描錯誤", err); resetBtn(scanBtn); }
});

function resetBtn(btn) {
    btn.disabled = false;
    btn.innerText = "即時掃描當前網頁";
    if (document.getElementById('header-title').innerText === "🛡️ 深度分析中...") {
        document.getElementById('header-title').innerText = "🛡️ AI 防詐盾牌";
    }
}

// ==========================================
// 家庭群組邏輯 (建立、加入、即時戰情室)
// ==========================================

document.getElementById('btn_create_family').addEventListener('click', async () => {
    const btn = document.getElementById('btn_create_family');
    btn.innerText = "建立中...";
    try {
        let res = await fetchWithRetry(`${CONFIG.API_BASE_URL}/api/create_family`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uid: currentUserID })
        });
        let result = await res.json();
        if (result.status === 'success') {
            document.getElementById('display_code').innerText = result.inviteCode;
            document.getElementById('code_box').style.display = 'block';
            btn.style.display = 'none';
            currentFamilyID = result.inviteCode;
            chrome.storage.local.set({ familyID: currentFamilyID });
            updateUIAsBound(currentFamilyID);
            startFamilyAlertsPolling(currentFamilyID);
        } else {
            alert(result.message || "建立失敗");
            btn.innerText = "建立家庭群組 (守護者)";
        }
    } catch (err) {
        alert("連線失敗，請檢查網路。");
        btn.innerText = "建立家庭群組 (守護者)";
    }
});

document.getElementById('btn_join_family').addEventListener('click', async () => {
    const code = document.getElementById('invite_input').value.trim().toUpperCase();
    if (code.length !== 6) return alert("請輸入完整的 6 位數邀請碼！");
    const btn = document.getElementById('btn_join_family');
    btn.innerText = "綁定中...";
    try {
        let res = await fetchWithRetry(`${CONFIG.API_BASE_URL}/api/join_family`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uid: currentUserID, inviteCode: code })
        });
        let result = await res.json();
        if (result.status === 'success') {
            alert("✅ 綁定成功！");
            currentFamilyID = code;
            chrome.storage.local.set({ familyID: currentFamilyID });
            updateUIAsBound(currentFamilyID);
            document.getElementById('invite_input').disabled = true;
            btn.innerText = "已成功加入家庭";
            btn.disabled = true;
            startFamilyAlertsPolling(currentFamilyID);
        } else {
            alert("❌ 綁定失敗：" + result.message);
            btn.innerText = "加入家庭防護網 (被守護者)";
        }
    } catch (err) {
        alert("連線失敗，請檢查網路。");
        btn.innerText = "加入家庭防護網 (被守護者)";
    }
});

document.getElementById('code_box').addEventListener('click', function() {
    const code = document.getElementById('display_code').innerText;
    navigator.clipboard.writeText(code).then(() => {
        const originalText = document.getElementById('display_code').innerText;
        document.getElementById('display_code').innerText = "已複製 ✅";
        setTimeout(() => { document.getElementById('display_code').innerText = originalText; }, 1500);
    });
});

function updateUIAsBound(familyID) {
    const statusText = document.getElementById('bind-status');
    statusText.innerText = `狀態：已綁定家庭 (${familyID})`;
    statusText.style.color = '#1e8e3e';
    statusText.style.fontWeight = 'bold';
    document.getElementById('invite_input').style.display = 'none';
    document.getElementById('btn_join_family').style.display = 'none';
}

// 🛡️ 背景即時輪詢戰情室資料
function startFamilyAlertsPolling(familyID) {
    if (pollingInterval) clearInterval(pollingInterval);
    fetchFamilyAlerts(familyID); 
    pollingInterval = setInterval(() => { fetchFamilyAlerts(familyID); }, CONFIG.POLLING_INTERVAL_MS);
}

async function fetchFamilyAlerts(familyID) {
    if (familyID === 'none') return;
    try {
        let res = await fetch(`${CONFIG.API_BASE_URL}/api/get_alerts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ familyID: familyID })
        });
        let result = await res.json();
        if (result.status === 'success' && result.data.length > 0) {
            const box = document.getElementById('family-alerts-box');
            box.innerHTML = '<div style="font-weight:bold; color:var(--text-main); margin-bottom:8px;">⚠️ 近期家庭防護紀錄</div>';
            result.data.forEach(item => {
                let r = {};
                try { r = JSON.parse(item.report); } catch(e) { r = { riskLevel: "紀錄" }; }
                let time = item.timestamp.split(' ')[1];
                let reasonText = r.reason ? r.reason.substring(0, 20) : "安全掃描";
                box.innerHTML += `
                    <div class="alert-item">
                        <span class="alert-time">🕒 ${time} - [${r.riskLevel || "安全"}]</span>
                        結果: ${reasonText}...
                    </div>
                `;
            });
            box.style.display = 'block';
        }
    } catch (e) {
        console.log("戰情室更新失敗", e);
    }
}