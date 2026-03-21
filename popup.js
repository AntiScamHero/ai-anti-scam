/**
 * AI 防詐盾牌 - 核心控制邏輯 (完整展開版 + 人性化視覺回饋)
 */

let currentUserID = "";
let currentFamilyID = "none";
let pollingInterval = null;

// 🟢 人性化友善長輩：一打開介面自動讀取剪貼簿的邀請碼，並給予強烈視覺提示
document.addEventListener('DOMContentLoaded', async () => {
    try {
        const text = await navigator.clipboard.readText();
        const match = text.match(/aishield:([A-Z0-9]{6})/i);
        if (match && match[1]) {
            const inviteInput = document.getElementById('invite_input');
            const btnJoin = document.getElementById('btn_join_family');
            
            // 只有在「尚未綁定」(輸入框還在) 的情況下，才觸發視覺魔法
            if (inviteInput && inviteInput.style.display !== 'none') {
                inviteInput.value = match[1].toUpperCase();
                // 加上明顯的視覺變化
                inviteInput.style.border = "2px solid #1a73e8";
                inviteInput.style.backgroundColor = "#e8f0fe";
                
                if (btnJoin) {
                    btnJoin.innerText = "🚀 發現代碼！點我立即綁定";
                    btnJoin.style.background = "linear-gradient(135deg, #1a73e8 0%, #0d47a1 100%)";
                    btnJoin.style.color = "white";
                    btnJoin.style.fontWeight = "bold";
                    btnJoin.style.boxShadow = "0 4px 15px rgba(26, 115, 232, 0.5)";
                }
            }
        }
    } catch (e) {
        // 忽略剪貼簿讀取權限或為空的錯誤
    }
});

// 🛡️ API 自動重試機制 (加入 AbortError 逾時不重試邏輯)
async function fetchWithRetry(url, options, maxRetries = typeof CONFIG !== 'undefined' ? CONFIG.MAX_RETRIES : 3) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            const response = await fetch(url, options);
            if (response.ok) return response;
            throw new Error(`HTTP error: ${response.status}`);
        } catch (err) {
            if (err.name === 'AbortError') throw err; // 逾時立刻中斷，不浪費時間重試
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

// ==========================================
// 主掃描按鈕邏輯
// ==========================================
const scanBtnElement = document.getElementById('scan-btn');
if (scanBtnElement) {
    scanBtnElement.addEventListener('click', async () => {
        const scanBtn = document.getElementById('scan-btn');
        const appBody = document.getElementById('app-body');
        const headerTitle = document.getElementById('header-title');
        const loadingDiv = document.getElementById('loading');
        const scoreContainer = document.getElementById('score-container');
        const reportContainer = document.getElementById('report-container');
        const progressBar = document.getElementById('progress-bar');
        const dimSection = document.getElementById('dimensions-section');
        const kwSection = document.getElementById('keyword-section');

        // 初始化畫面狀態 (已展開)
        if (appBody) appBody.className = "";
        if (headerTitle) headerTitle.innerText = "🛡️ 深度分析中...";
        if (scanBtn) {
            scanBtn.innerText = "掃描分析中...";
            scanBtn.disabled = true;
        }
        if (loadingDiv) loadingDiv.style.display = "block";
        if (scoreContainer) scoreContainer.style.display = "none";
        if (reportContainer) reportContainer.style.display = "none";
        if (progressBar) progressBar.style.width = "0%";
        if (dimSection) dimSection.style.display = "none";
        if (kwSection) kwSection.style.display = "none";

        try {
            let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

            if (isWhitelisted(tab.url)) {
                if (loadingDiv) loadingDiv.style.display = "none";
                if (document.getElementById('score-text')) document.getElementById('score-text').innerText = `風險指數: 0%`;
                if (document.getElementById('report-level')) document.getElementById('report-level').innerText = "安全無虞";
                if (document.getElementById('report-reason')) document.getElementById('report-reason').innerText = "此為系統內建的受信任大型網站 (白名單)。";
                if (document.getElementById('report-advice')) document.getElementById('report-advice').innerText = "請放心瀏覽！";
                
                if (scoreContainer) scoreContainer.style.display = "block";
                if (reportContainer) reportContainer.style.display = "block";
                if (appBody) appBody.className = "theme-safe";
                if (headerTitle) headerTitle.innerText = "✅ 檢測通過：安全網頁";
                setTimeout(() => { if (progressBar) progressBar.style.width = "0%"; }, 150);
                resetBtn(scanBtn);
                return;
            }

            let pageText = "";
            try {
                // 🚀 第一刀：極速萃取法 (只抓標題與前 800 字)
                const inject = await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    func: () => {
                        const title = document.title;
                        const bodyText = (document.documentElement.innerText || document.documentElement.textContent || "")
                            .replace(/\s+/g, ' ')
                            .substring(0, 800);
                        return `[標題]:${title} [內文]:${bodyText}`;
                    }
                });
                pageText = inject[0]?.result || "";
            } catch (err) { console.warn("抓取文字失敗:", err); }

            let safePageText = maskSensitiveData(pageText);

            // ⚠️ 建立 10 秒強制逾時機制
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000); 

            try {
                const apiBase = typeof CONFIG !== 'undefined' ? CONFIG.API_BASE_URL : '';
                let response = await fetchWithRetry(`${apiBase}/scan`, {
                    method: 'POST', 
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url: tab.url, text: safePageText, userID: currentUserID, familyID: currentFamilyID }),
                    signal: controller.signal // 綁定逾時中斷器
                });
                clearTimeout(timeoutId); // 成功回傳則取消逾時倒數
                
                let data = await response.json();
                if (loadingDiv) loadingDiv.style.display = "none";

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

                // 🌟 核心修改：嚴格的防驚嚇濾鏡 (低於 50 分強制歸零並改寫文字)
                if (score < 50) {
                    score = 0; 
                    reportData.riskLevel = "安全無虞";
                    reportData.reason = "✅ 系統未發現明顯惡意特徵，屬於一般正常網頁。";
                    reportData.advice = "無潛在威脅，請放心瀏覽！";
                    // 清除後端可能傳來的錯誤標籤
                    if(reportData.dimensions) reportData.dimensions = {}; 
                    if(reportData.highlight_keywords) reportData.highlight_keywords = [];
                }

                // 🟢 安全更新：使用 textContent 防禦潛在 XSS 攻擊
                if (document.getElementById('score-text')) document.getElementById('score-text').textContent = `風險指數: ${score}%`;
                if (document.getElementById('report-level')) document.getElementById('report-level').textContent = reportData.riskLevel || "安全無虞";
                if (document.getElementById('report-reason')) document.getElementById('report-reason').textContent = reportData.reason || "系統已完成基礎安全掃描。";
                if (document.getElementById('report-advice')) document.getElementById('report-advice').textContent = reportData.advice || "無特別建議。";

                const dimContainer = document.getElementById('report-dimensions');
                
                // 🟢 安全更新：完全替換 innerHTML 為 createElement 組合
                if (dimSection && dimContainer && reportData.dimensions && Object.keys(reportData.dimensions).length > 0) {
                    dimContainer.textContent = ''; // 清空
                    for (let [key, val] of Object.entries(reportData.dimensions)) {
                        let labelName = key.split('_')[1] || key;
                        let thresholdHigh = typeof CONFIG !== 'undefined' ? CONFIG.RISK_THRESHOLD_HIGH : 70;
                        let thresholdMedium = typeof CONFIG !== 'undefined' ? CONFIG.RISK_THRESHOLD_MEDIUM : 30;
                        let color = val > thresholdHigh ? '#d93025' : (val > thresholdMedium ? '#f29900' : '#1e8e3e');
                        
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
                } else if (dimSection) {
                    dimSection.style.display = 'none';
                }

                const kwContainer = document.getElementById('report-keywords');
                if (kwContainer) {
                    kwContainer.textContent = '';
                    if (reportData.highlight_keywords && reportData.highlight_keywords.length > 0) {
                        if (kwSection) kwSection.style.display = 'block';
                        reportData.highlight_keywords.forEach(kw => {
                            const span = document.createElement('span');
                            span.className = 'keyword-badge';
                            span.textContent = kw; // 防 XSS
                            kwContainer.appendChild(span);
                        });
                    } else if (kwSection) { 
                        kwSection.style.display = 'none'; 
                    }
                }

                if (scoreContainer) scoreContainer.style.display = "block";
                if (reportContainer) reportContainer.style.display = "block";
                setTimeout(() => { if (progressBar) progressBar.style.width = score + "%"; }, 150);

                let thresholdHigh = typeof CONFIG !== 'undefined' ? CONFIG.RISK_THRESHOLD_HIGH : 70;

                if (score < 30) {
                    if (appBody) appBody.className = "theme-safe";
                    if (headerTitle) headerTitle.innerText = "✅ 檢測通過：安全網頁";
                } else if (score >= thresholdHigh) {
                    if (appBody) appBody.className = "theme-danger";
                    if (headerTitle) headerTitle.innerText = "❌ 極度危險！請立即離開！";
                } else {
                    if (appBody) appBody.className = "theme-warning";
                    if (headerTitle) headerTitle.innerText = "⚠️ 警告：請提高警覺";
                }

            } catch (err) {
                if (loadingDiv) loadingDiv.style.display = "none";
                if (reportContainer) reportContainer.style.display = "block";
                
                // 處理 AbortError 逾時與一般錯誤
                let isTimeout = err.name === 'AbortError';
                let titleHtml = isTimeout ? '⏳ <b>分析逾時</b>' : '🔌 <b>系統整理中</b>';
                let descHtml = isTimeout 
                    ? '網頁過於龐大或網路連線不穩。建議您手動確認此網頁來源是否安全。' 
                    : '防詐盾牌正在與雲端同步資料，請稍後再試。';

                if (document.getElementById('report-reason')) {
                    document.getElementById('report-reason').innerHTML = `
                        ${titleHtml}<br>${descHtml}
                        <br><br>
                        <button id="retry-btn" style="background:#5f6368; padding:8px; width:auto; font-size:14px; box-shadow:none; color:white; border:none; border-radius:4px; cursor:pointer;">🔄 重新掃描</button>
                    `;
                }
                if (kwSection) kwSection.style.display = 'none';
                if (dimSection) dimSection.style.display = 'none';
                
                setTimeout(() => {
                    const retryBtn = document.getElementById('retry-btn');
                    if (retryBtn) retryBtn.onclick = () => {
                        const mainScanBtn = document.getElementById('scan-btn');
                        if (mainScanBtn) mainScanBtn.click();
                    };
                }, 100);
            } finally { resetBtn(scanBtn); }
        } catch (err) { console.error("掃描錯誤", err); resetBtn(scanBtn); }
    });
}

function resetBtn(btn) {
    if (!btn) return;
    btn.disabled = false;
    btn.innerText = "即時掃描當前網頁";
    const headerTitle = document.getElementById('header-title');
    if (headerTitle && headerTitle.innerText === "🛡️ 深度分析中...") {
        headerTitle.innerText = "🛡️ AI 防詐盾牌";
    }
}

// ==========================================
// 家庭群組邏輯 (建立、加入、即時戰情室)
// ==========================================

const btnCreateFamily = document.getElementById('btn_create_family');
if (btnCreateFamily) {
    btnCreateFamily.addEventListener('click', async () => {
        // 🌟 核心修改：加入防呆確認視窗
        if (!confirm("⚠️ 確定要建立一個『全新』的家庭防護群組嗎？\n\n(若您只是想加入別人的群組，請按取消，並在下方輸入對方的 6 碼代號)")) {
            return; // 使用者按取消就停止動作
        }

        const btn = document.getElementById('btn_create_family');
        btn.innerText = "建立中...";
        try {
            const apiBase = typeof CONFIG !== 'undefined' ? CONFIG.API_BASE_URL : '';
            let res = await fetchWithRetry(`${apiBase}/api/create_family`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ uid: currentUserID })
            });
            let result = await res.json();
            if (result.status === 'success') {
                if (document.getElementById('display_code')) document.getElementById('display_code').innerText = result.inviteCode;
                if (document.getElementById('code_box')) document.getElementById('code_box').style.display = 'block';
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
}

const btnJoinFamily = document.getElementById('btn_join_family');
if (btnJoinFamily) {
    btnJoinFamily.addEventListener('click', async () => {
        const inviteInput = document.getElementById('invite_input');
        if (!inviteInput) return;
        const code = inviteInput.value.trim().toUpperCase();
        if (code.length !== 6) return alert("請輸入完整的 6 位數邀請碼！");
        
        const btn = document.getElementById('btn_join_family');
        btn.innerText = "綁定中...";
        try {
            const apiBase = typeof CONFIG !== 'undefined' ? CONFIG.API_BASE_URL : '';
            let res = await fetchWithRetry(`${apiBase}/api/join_family`, {
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
                inviteInput.disabled = true;
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
}

const codeBox = document.getElementById('code_box');
if (codeBox) {
    codeBox.addEventListener('click', function() {
        const displayCode = document.getElementById('display_code');
        if (!displayCode) return;
        const code = displayCode.innerText;
        navigator.clipboard.writeText("aishield:" + code).then(() => {
            const originalText = displayCode.innerText;
            displayCode.innerText = "已複製專屬連結 ✅";
            setTimeout(() => { displayCode.innerText = originalText; }, 1500);
        });
    });
}

function updateUIAsBound(familyID) {
    const statusText = document.getElementById('bind-status');
    if (statusText) {
        statusText.innerText = `狀態：已綁定家庭 (${familyID})`;
        statusText.style.color = '#1e8e3e';
        statusText.style.fontWeight = 'bold';
    }
    
    const inviteInput = document.getElementById('invite_input');
    if (inviteInput) inviteInput.style.display = 'none';
    
    const btnJoinFamily = document.getElementById('btn_join_family');
    if (btnJoinFamily) btnJoinFamily.style.display = 'none';

    // 🌟 核心升級：動態產生「一鍵開啟戰情室」按鈕
    let goDashBtn = document.getElementById('go-dashboard-btn');
    if (!goDashBtn) {
        goDashBtn = document.createElement('button');
        goDashBtn.id = 'go-dashboard-btn';
        // 使用非常亮眼的橘色漸層，吸引守護者點擊
        goDashBtn.style.background = 'linear-gradient(135deg, #FFBB33 0%, #FF8800 100%)';
        goDashBtn.style.marginTop = '10px';
        goDashBtn.style.width = '100%';
        goDashBtn.style.padding = '12px';
        goDashBtn.style.color = 'white';
        goDashBtn.style.border = 'none';
        goDashBtn.style.borderRadius = '8px';
        goDashBtn.style.fontSize = '16px';
        goDashBtn.style.fontWeight = 'bold';
        goDashBtn.style.cursor = 'pointer';
        
        const familyContainer = document.getElementById('family-container');
        if (familyContainer) familyContainer.appendChild(goDashBtn);
    }
    
    if (goDashBtn) {
        goDashBtn.innerText = "📊 開啟大螢幕戰情室";
        goDashBtn.onclick = () => {
            // 使用 chrome.runtime.getURL 打開套件內的 dashboard.html，並把代碼塞進網址裡
            const dashUrl = chrome.runtime.getURL(`dashboard.html?familyID=${familyID}`);
            chrome.tabs.create({ url: dashUrl });
        };
    }
}

// ==========================================
// 戰情室輪詢與紀錄清除功能
// ==========================================

function startFamilyAlertsPolling(familyID) {
    if (pollingInterval) clearInterval(pollingInterval);
    fetchFamilyAlerts(familyID); 
    const intervalMs = typeof CONFIG !== 'undefined' && CONFIG.POLLING_INTERVAL_MS ? CONFIG.POLLING_INTERVAL_MS : 5000;
    pollingInterval = setInterval(() => { fetchFamilyAlerts(familyID); }, intervalMs);
} 

async function fetchFamilyAlerts(familyID) {
    if (familyID === 'none') return;
    try {
        const apiBase = typeof CONFIG !== 'undefined' ? CONFIG.API_BASE_URL : '';
        let res = await fetch(`${apiBase}/api/get_alerts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ familyID: familyID })
        });
        let result = await res.json();
        const box = document.getElementById('family-alerts-box');
        if (!box) return; // 安全檢查
        
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
                let time = item.timestamp ? item.timestamp.split(' ')[1] : ''; 
                
                // 這裡也加上簡單的顯示防護 (< 50 分強制顯示安全)
                let score = parseInt(r.riskScore || r.RiskScore || r.risk_score) || 0;
                let reasonText = (score < 50) ? "安全放行" : (r.reason ? r.reason.substring(0, 20) : "安全掃描");
                reasonText = reasonText.replace(/</g, "&lt;").replace(/>/g, "&gt;");
                let riskText = (score < 50) ? "安全無虞" : (r.riskLevel || "未知");
                
                html += `
                    <div class="alert-item">
                        <span class="alert-time">🕒 ${time} - [${riskText}]</span>
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

const familyAlertsBox = document.getElementById('family-alerts-box');
if (familyAlertsBox) {
    familyAlertsBox.addEventListener('click', async (e) => {
        if (e.target.id === 'clear-alerts-btn') {
            const btn = e.target;
            const originalText = btn.innerText;
            btn.innerText = "清除中...";
            btn.disabled = true;
            
            try {
                const apiBase = typeof CONFIG !== 'undefined' ? CONFIG.API_BASE_URL : '';
                let res = await fetchWithRetry(`${apiBase}/api/clear_alerts`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ familyID: currentFamilyID })
                });
                let result = await res.json();
                
                if (result.status === 'success') {
                    const box = document.getElementById('family-alerts-box');
                    if (box) {
                        box.innerHTML = '';
                        box.style.display = 'none';
                    }
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
}