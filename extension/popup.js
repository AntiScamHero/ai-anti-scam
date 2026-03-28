/**
 * AI 防詐盾牌 - 核心控制邏輯 (直接跳轉安全網頁版 + 強制變色)
 */

let currentUserID = "";
let currentFamilyID = "none";
let pollingInterval = null;

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const text = await navigator.clipboard.readText();
        const match = text.match(/aishield:([A-Z0-9]{6})/i);
        if (match && match[1]) {
            const inviteInput = document.getElementById('invite_input');
            const btnJoin = document.getElementById('btn_join_family');
            
            if (inviteInput && inviteInput.style.display !== 'none') {
                inviteInput.value = match[1].toUpperCase();
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
    } catch (e) { }
});

async function fetchWithRetry(url, options, maxRetries = 5) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            const response = await fetch(url, options);
            if (response.ok) return response;
            throw new Error(`HTTP error: ${response.status}`);
        } catch (err) {
            if (err.name === 'AbortError') throw err; 
            if (i === maxRetries - 1) throw err;
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
    }
}

function maskSensitiveData(text) {
    if (!text) return "";
    return text
        .replace(/(?:\d{4}[-\s]?){3}\d{4}/g, "[信用卡號已隱藏]")
        .replace(/[A-Z][12]\d{8}/i, "[身分證已隱藏]")
        .replace(/09\d{2}[-\s]?\d{3}[-\s]?\d{3}/g, "[手機號碼已隱藏]")
        .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[Email已隱藏]");
}

chrome.storage.local.get(['userID', 'familyID'], (result) => {
    currentUserID = result.userID || "USER_" + Math.random().toString(36).substr(2, 9).toUpperCase();
    chrome.storage.local.set({ userID: currentUserID });
    if (result.familyID && result.familyID !== "none") {
        currentFamilyID = result.familyID;
        updateUIAsBound(currentFamilyID);
        startFamilyAlertsPolling(currentFamilyID);
    }
});

const scanBtnElement = document.getElementById('scan-btn');
if (scanBtnElement) {
    scanBtnElement.addEventListener('click', async () => {
        const scanBtn = document.getElementById('scan-btn');
        
        // 👇 如果已經是逃生狀態，允許手動點擊直接逃生！
        if (scanBtn.dataset.isEscape === "true") {
            try {
                let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                chrome.tabs.update(tab.id, { url: "https://www.google.com" });
                window.close();
            } catch(e) {}
            return;
        }

        const appBody = document.getElementById('app-body');
        const headerTitle = document.getElementById('header-title');
        const loadingDiv = document.getElementById('loading');
        const scoreContainer = document.getElementById('score-container');
        const reportContainer = document.getElementById('report-container');
        const progressBar = document.getElementById('progress-bar');
        const dimSection = document.getElementById('dimensions-section');
        const kwSection = document.getElementById('keyword-section');

        if (appBody) appBody.className = "";
        if (headerTitle) headerTitle.innerText = "🛡️ 深度分析中...";
        if (scanBtn) { scanBtn.innerText = "掃描分析中..."; scanBtn.disabled = true; }
        if (loadingDiv) loadingDiv.style.display = "block";
        if (scoreContainer) scoreContainer.style.display = "none";
        if (reportContainer) reportContainer.style.display = "none";
        if (progressBar) progressBar.style.width = "0%";
        if (dimSection) dimSection.style.display = "none";
        if (kwSection) kwSection.style.display = "none";

        try {
            let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

            if (!tab || !tab.id || tab.url.startsWith('chrome://') || tab.url.startsWith('edge://')) {
                if (loadingDiv) loadingDiv.style.display = "none";
                resetBtn(scanBtn);
                alert("⚠️ 系統安全限制：\n無法在「瀏覽器設定頁」或「空白新分頁」進行掃描與截圖！");
                return;
            }

            let pageText = "";
            try {
                const inject = await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    func: () => {
                        const title = document.title;
                        const bodyText = (document.documentElement.innerText || document.documentElement.textContent || "").replace(/\s+/g, ' ').substring(0, 800);
                        return `[標題]:${title} [內文]:${bodyText}`;
                    }
                });
                pageText = inject[0]?.result || "";
            } catch (err) { console.warn("抓取文字失敗:", err); }

            let safePageText = maskSensitiveData(pageText);
            
            let screenshotBase64 = null;
            try {
                await new Promise(resolve => setTimeout(resolve, 150));
                screenshotBase64 = await chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 30 });
            } catch (imgErr) {}

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 60000); 

            try {
                const apiBase = typeof CONFIG !== 'undefined' ? CONFIG.API_BASE_URL : '';
                let response = await fetchWithRetry(`${apiBase}/scan`, {
                    method: 'POST', 
                    headers: { 
                        'Content-Type': 'application/json', 
                        'X-Extension-Secret': typeof CONFIG !== 'undefined' ? CONFIG.EXTENSION_SECRET : 'ai_shield_secure_2026' 
                    },
                    body: JSON.stringify({ 
                        url: tab.url, 
                        text: safePageText, 
                        image: screenshotBase64,
                        userID: currentUserID, 
                        familyID: currentFamilyID 
                    }),
                    signal: controller.signal
                });
                clearTimeout(timeoutId); 
                
                const rawText = await response.text();
                let data = {};
                try { data = rawText ? JSON.parse(rawText) : {}; } catch (e) { data = { riskScore: 0 }; }
                
                if (loadingDiv) loadingDiv.style.display = "none";

                let reportData = data.report ? (typeof data.report === 'string' ? JSON.parse(data.report) : data.report) : data;
                if (typeof reportData === 'string') reportData = JSON.parse(reportData); 

                let score = parseInt(reportData.riskScore || reportData.RiskScore || reportData.risk_score) || 0;

                if (score < 50) {
                    score = 0; 
                    reportData.riskLevel = "安全無虞";
                    reportData.reason = "✅ 系統未發現明顯惡意特徵，屬於一般正常網頁。";
                    reportData.advice = "無潛在威脅，請放心瀏覽！";
                }

                if (document.getElementById('score-text')) document.getElementById('score-text').textContent = `風險指數: ${score}%`;
                if (document.getElementById('report-level')) document.getElementById('report-level').textContent = reportData.riskLevel || "安全無虞";
                if (document.getElementById('report-reason')) document.getElementById('report-reason').textContent = reportData.reason || "系統已完成基礎安全掃描。";
                if (document.getElementById('report-advice')) document.getElementById('report-advice').textContent = reportData.advice || "無特別建議。";

                if (scoreContainer) scoreContainer.style.display = "block";
                if (reportContainer) reportContainer.style.display = "block";
                setTimeout(() => { if (progressBar) progressBar.style.width = score + "%"; }, 150);

                let thresholdHigh = typeof CONFIG !== 'undefined' ? CONFIG.RISK_THRESHOLD_HIGH : 70;
                
                // 👇 【核心修改】直接跳轉全螢幕防護頁面，拔除倒數計時器
                if (score < 30) {
                    if (appBody) appBody.className = "theme-safe";
                    if (headerTitle) headerTitle.innerText = "✅ 檢測通過：安全網頁";
                } else if (score >= thresholdHigh) {
                    
                    // 🚨 手動掃描抓到詐騙：直接切換到全螢幕攔截頁面 (內建誤判按鈕)，並關閉小面板
                    let blockedUrl = chrome.runtime.getURL("blocked.html") + 
                                     "?reason=" + encodeURIComponent(reportData.reason || "系統深層掃描發現高度危險特徵！") + 
                                     "&original_url=" + encodeURIComponent(tab.url);
                    
                    chrome.tabs.update(tab.id, { url: blockedUrl }).catch(e => console.log("跳轉失敗:", e));
                    window.close(); // 自動關閉小面板，讓畫面保持乾淨
                    
                } else {
                    if (appBody) appBody.className = "theme-warning";
                    if (headerTitle) headerTitle.innerText = "⚠️ 警告：請提高警覺";
                }

            } catch (err) {
                if (loadingDiv) loadingDiv.style.display = "none";
                if (reportContainer) reportContainer.style.display = "block";
                resetBtn(scanBtn);
            }
        } catch (err) { console.error("掃描錯誤", err); resetBtn(scanBtn); }
    });
}

function resetBtn(btn) {
    if (!btn || btn.dataset.isEscape === "true") return; // 如果正在逃生倒數，不要重置它！
    
    btn.disabled = false;
    btn.innerText = "即時掃描當前網頁";
    btn.style.background = ""; 
    btn.style.color = "";
    btn.style.border = "";
    btn.style.boxShadow = "";
    const headerTitle = document.getElementById('header-title');
    if (headerTitle && headerTitle.innerText === "🛡️ 深度分析中...") headerTitle.innerText = "🛡️ AI 防詐盾牌";
}

// 下方是群組連線邏輯，維持原樣
const btnCreateFamily = document.getElementById('btn_create_family');
if (btnCreateFamily) {
    btnCreateFamily.addEventListener('click', async () => {
        if (!confirm("⚠️ 確定要建立一個『全新』的家庭防護群組嗎？\n\n(若您只是想加入別人的群組，請按取消，並在下方輸入對方的 6 碼代號)")) return; 
        const btn = document.getElementById('btn_create_family');
        const originalText = btn.innerText;
        btn.innerText = "建立中...";
        btn.disabled = true; 
        try {
            const apiBase = typeof CONFIG !== 'undefined' ? CONFIG.API_BASE_URL : '';
            let res = await fetchWithRetry(`${apiBase}/api/create_family`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Extension-Secret': typeof CONFIG !== 'undefined' ? CONFIG.EXTENSION_SECRET : 'ai_shield_secure_2026' },
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
                btn.innerText = originalText;
                btn.disabled = false;
            }
        } catch (err) { alert("連線失敗！"); btn.innerText = originalText; btn.disabled = false; }
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
        const originalText = btn.innerText;
        btn.innerText = "綁定中...";
        btn.disabled = true;
        try {
            const apiBase = typeof CONFIG !== 'undefined' ? CONFIG.API_BASE_URL : '';
            let res = await fetchWithRetry(`${apiBase}/api/join_family`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Extension-Secret': typeof CONFIG !== 'undefined' ? CONFIG.EXTENSION_SECRET : 'ai_shield_secure_2026' },
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
            } else {
                alert("❌ 綁定失敗：" + result.message);
                btn.innerText = "加入防護網 (被守護者)";
                btn.disabled = false;
            }
        } catch (err) { alert("連線失敗！"); btn.innerText = "加入防護網 (被守護者)"; btn.disabled = false; }
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
    }
    const inviteInput = document.getElementById('invite_input');
    if (inviteInput) inviteInput.style.display = 'none';
    const btnJoinFamily = document.getElementById('btn_join_family');
    if (btnJoinFamily) btnJoinFamily.style.display = 'none';
    let goDashBtn = document.getElementById('go-dashboard-btn');
    if (!goDashBtn) {
        goDashBtn = document.createElement('button');
        goDashBtn.id = 'go-dashboard-btn';
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
            chrome.tabs.create({ url: chrome.runtime.getURL(`dashboard.html?familyID=${familyID}`) });
        };
    }
}

function startFamilyAlertsPolling(familyID) {
    if (pollingInterval) clearInterval(pollingInterval);
    fetchFamilyAlerts(familyID); 
    pollingInterval = setInterval(() => { fetchFamilyAlerts(familyID); }, 5000);
} 

async function fetchFamilyAlerts(familyID) {
    if (familyID === 'none') return;
    try {
        const apiBase = typeof CONFIG !== 'undefined' ? CONFIG.API_BASE_URL : '';
        let res = await fetch(`${apiBase}/api/get_alerts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Extension-Secret': typeof CONFIG !== 'undefined' ? CONFIG.EXTENSION_SECRET : 'ai_shield_secure_2026' },
            body: JSON.stringify({ familyID: familyID })
        });
        let result = await res.json();
        const box = document.getElementById('family-alerts-box');
        if (!box) return; 
        
        if (result.status === 'success' && result.data.length > 0) {
            let html = `<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;"><div style="font-weight:bold;">⚠️ 近期家庭防護紀錄</div><button id="clear-alerts-btn" style="width: auto; padding: 4px 10px; margin: 0; font-size: 12px; background: #dc3545; color: white; border-radius: 4px; cursor: pointer; border: none;">🗑️ 清除</button></div>`;
            result.data.forEach(item => {
                let r = {};
                try { r = JSON.parse(item.report); } catch(e) { r = { riskLevel: "紀錄" }; }
                let time = item.timestamp ? item.timestamp.split(' ')[1] : ''; 
                let score = parseInt(r.riskScore || r.RiskScore || r.risk_score) || 0;
                let reasonText = (score < 50) ? "安全放行" : (r.reason ? r.reason.substring(0, 20) : "安全掃描");
                reasonText = reasonText.replace(/</g, "&lt;").replace(/>/g, "&gt;");
                let riskText = (score < 50) ? "安全無虞" : (r.riskLevel || "未知");
                html += `<div class="alert-item"><span class="alert-time">🕒 ${time} - [${riskText}]</span>結果: ${reasonText}...</div>`;
            });
            box.innerHTML = html;
            box.style.display = 'block';
        } else {
            box.style.display = 'none';
            box.innerHTML = '';
        }
    } catch (e) {}
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
                    headers: { 'Content-Type': 'application/json', 'X-Extension-Secret': typeof CONFIG !== 'undefined' ? CONFIG.EXTENSION_SECRET : 'ai_shield_secure_2026' },
                    body: JSON.stringify({ familyID: currentFamilyID })
                });
                let result = await res.json();
                if (result.status === 'success') {
                    const box = document.getElementById('family-alerts-box');
                    if (box) { box.innerHTML = ''; box.style.display = 'none'; }
                } else {
                    btn.innerText = "清除失敗";
                    setTimeout(() => { btn.innerText = originalText; btn.disabled = false; }, 2000);
                }
            } catch (err) {
                btn.innerText = "連線失敗";
                setTimeout(() => { btn.innerText = originalText; btn.disabled = false; }, 2000);
            }
        }
    });
}