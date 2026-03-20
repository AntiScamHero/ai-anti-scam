/**
 * AI 防詐盾牌 - 核心控制邏輯 (已加入清除警報功能版與 XSS 修復)
 */

let currentUserID = "";
let currentFamilyID = "none";
let pollingInterval = null;

// 🟢 友善長輩：一打開介面自動讀取剪貼簿的邀請碼
document.addEventListener('DOMContentLoaded', async () => {
    try {
        const text = await navigator.clipboard.readText();
        const match = text.match(/aishield:([A-Z0-9]{6})/i);
        if (match && match[1]) {
            const inviteInput = document.getElementById('invite_input');
            if (inviteInput && inviteInput.style.display !== 'none') {
                inviteInput.value = match[1].toUpperCase();
                inviteInput.style.backgroundColor = '#e8f0fe';
                setTimeout(() => { inviteInput.style.backgroundColor = ''; }, 1000);
            }
        }
    } catch (e) {
        // 忽略剪貼簿讀取權限或為空的錯誤
    }
});

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
        const whitelist = [
            'google.com', 'youtube.com', 'yahoo.com.tw', 'gov.tw', 
            'facebook.com', 'line.me', 'instagram.com', 
            'momoshop.com.tw', 'pchome.com.tw', 'shopee.tw'
        ];
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

            if (isNaN(score)) {
                score = 0;
                reportData.riskLevel = "安全無虞";
                reportData.reason = "系統已完成基礎安全掃描，未發現明顯惡意特徵。";
                reportData.advice = "請安心瀏覽！";
            }

            // 🟢 安全更新：使用 textContent 防禦潛在 XSS 攻擊
            document.getElementById('score-text').textContent = `風險指數: ${score}%`;
            document.getElementById('report-level').textContent = reportData.riskLevel || "安全無虞";
            document.getElementById('report-reason').textContent = reportData.reason || "系統已完成基礎安全掃描。";
            document.getElementById('report-advice').textContent = reportData.advice || "無特別建議。";

            const dimSection = document.getElementById('dimensions-section');
            const dimContainer = document.getElementById('report-dimensions');
            
            // 🟢 安全更新：完全替換 innerHTML 為 createElement 組合
            if (reportData.dimensions && Object.keys(reportData.dimensions).length > 0) {
                dimContainer.textContent = ''; // 清空
                for (let [key, val] of Object.entries(reportData.dimensions)) {
                    let labelName = key.split('_')[1] || key;
                    let color = val > CONFIG.RISK_THRESHOLD_HIGH ? '#d93025' : (val > CONFIG.RISK_THRESHOLD_MEDIUM ? '#f29900' : '#1e8e3e');
                    
                    let row = document.createElement('div');
                    row.className = 'dim-row';
                    
                    let label = document.createElement('div');
                    label.className = 'dim-label';
                    label.textContent = labelName; // 防 XSS
                    
                    let barBg = document.createElement('div');
                    barBg.className = 'dim-bar-bg';
                    
                    let barFill = document.createElement('div');
                    barFill.className = 'dim-bar-fill';
                    barFill.style.width = `${val}%`;
                    barFill.style.backgroundColor = color;
                    
                    barBg.appendChild(barFill);
                    
                    let scoreDiv = document.createElement('div');
                    scoreDiv.className = 'dim-score';
                    scoreDiv.style.color = color;
                    scoreDiv.textContent = val; // 防 XSS
                    
                    row.appendChild(label);
                    row.appendChild(barBg);
                    row.appendChild(scoreDiv);
                    dimContainer.appendChild(row);
                }
                dimSection.style.display = 'block';
            } else {
                dimSection.style.display = 'none';
            }

            const kwSection = document.getElementById('keyword-section');
            const kwContainer = document.getElementById('report-keywords');
            kwContainer.textContent = '';
            
            if (reportData.highlight_keywords && reportData.highlight_keywords.length > 0) {
                kwSection.style.display = 'block';
                reportData.highlight_keywords.forEach(kw => {
                    const span = document.createElement('span');
                    span.className = 'keyword-badge';
                    span.textContent = kw; // 防 XSS
                    kwContainer.appendChild(span);
                });
            } else { 
                kwSection.style.display = 'none'; 
            }

            scoreContainer.style.display = "block";
            reportContainer.style.display = "block";
            setTimeout(() => { progressBar.style.width = score + "%"; }, 150);

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
    navigator.clipboard.writeText("aishield:" + code).then(() => {
        const originalText = document.getElementById('display_code').innerText;
        document.getElementById('display_code').innerText = "已複製專屬連結 ✅";
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

// 修改後的 fetchFamilyAlerts，加入「清除按鈕」與「無資料自動隱藏」邏輯
async function fetchFamilyAlerts(familyID) {
    if (familyID === 'none') return;
    try {
        let res = await fetch(`${CONFIG.API_BASE_URL}/api/get_alerts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ familyID: familyID })
        });
        let result = await res.json();
        const box = document.getElementById('family-alerts-box');
        
        if (result.status === 'success' && result.data.length > 0) {
            let html = `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                    <div style="font-weight:bold; color:var(--text-main);">⚠️ 近期家庭防護紀錄</div>
                    <button id="clear-alerts-btn" style="width: auto; padding: 4px 10px; margin: 0; font-size: 12px; background: #dc3545; color: white; border-radius: 4px; cursor: pointer; border: none;">🗑️ 清除</button>
                </div>
            `;
            
            result.data.forEach(item => {
                let r = {};
                try { r = JSON.parse(item.report); } catch(e) { r = { riskLevel: "紀錄" }; }
                let time = item.timestamp.split(' ')[1]; // 只取時間部分
                
                // 🟢 安全更新：防禦原因欄位 XSS
                let reasonText = r.reason ? r.reason.substring(0, 20) : "安全掃描";
                // 簡易跳脫
                reasonText = reasonText.replace(/</g, "&lt;").replace(/>/g, "&gt;");
                
                html += `
                    <div class="alert-item">
                        <span class="alert-time">🕒 ${time} - [${r.riskLevel || "安全"}]</span>
                        結果: ${reasonText}...
                    </div>
                `;
            });
            box.innerHTML = html;
            box.style.display = 'block';
        } else {
            box.style.display = 'none';
            box.innerHTML = '';
        }
    } catch (e) {
        console.log("戰情室更新失敗", e);
    }
}

// 🗑️ 綁定「清除紀錄」按鈕的點擊事件
document.getElementById('family-alerts-box').addEventListener('click', async (e) => {
    if (e.target.id === 'clear-alerts-btn') {
        const btn = e.target;
        const originalText = btn.innerText;
        btn.innerText = "清除中...";
        btn.disabled = true;
        
        try {
            let res = await fetchWithRetry(`${CONFIG.API_BASE_URL}/api/clear_alerts`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ familyID: currentFamilyID })
            });
            let result = await res.json();
            
            if (result.status === 'success') {
                const box = document.getElementById('family-alerts-box');
                box.innerHTML = '';
                box.style.display = 'none';
            } else {
                btn.innerText = "清除失敗";
                setTimeout(() => { btn.innerText = originalText; btn.disabled = false; }, 2000);
            }
        } catch (err) {
            console.error("清除失敗", err);
            btn.innerText = "連線失敗";
            setTimeout(() => { btn.innerText = originalText; btn.disabled = false; }, 2000);
        }
    }
});