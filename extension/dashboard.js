// dashboard.js - 戰情室專用邏輯

window.CONFIG = window.CONFIG || {
    API_BASE_URL: "http://127.0.0.1:5000",
    RISK_THRESHOLD_HIGH: 70,
    RISK_THRESHOLD_MEDIUM: 40
};

setInterval(() => { document.getElementById('clock').innerText = new Date().toLocaleTimeString('zh-TW', { hour12: false }); }, 1000);

let socket = null;
let ratioChartInstance = null;
let trendChartInstance = null;
let isFetching = false;

function animateValue(obj, start, end, duration) {
    let startTimestamp = null;
    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        const easeOut = 1 - Math.pow(1 - progress, 3);
        obj.innerText = Math.floor(easeOut * (end - start) + start);
        if (progress < 1) {
            window.requestAnimationFrame(step);
        } else {
            obj.innerText = end;
            obj.classList.remove('pop-effect');
            void obj.offsetWidth; 
            obj.classList.add('pop-effect');
        }
    };
    window.requestAnimationFrame(step);
}

window.onload = () => {
    Chart.defaults.color = '#8b949e';
    Chart.defaults.font.size = 14;

    const urlParams = new URLSearchParams(window.location.search);
    let familyID = urlParams.get('familyID');

    if (!familyID) {
        familyID = localStorage.getItem('savedFamilyID');
    }

    const isAutoMonitorOn = localStorage.getItem('autoMonitor') === 'true';

    if (familyID) {
        document.getElementById('family-id-input').value = familyID;
        if (urlParams.has('familyID') || isAutoMonitorOn) {
            localStorage.setItem('savedFamilyID', familyID); 
            localStorage.setItem('autoMonitor', 'true');     
            startMonitoring(familyID);
        }
    }
};

function initSocket(familyID) {
    if (!socket) {
        socket = io(CONFIG.API_BASE_URL);

        socket.on('connect', () => {
            document.getElementById('connection-status').className = "status-badge status-connected";
            document.getElementById('connection-status').innerHTML = `<span class="live-indicator"></span>即時防護中 (代碼: ${familyID})`;
            socket.emit('join_family_room', { familyID: familyID });
        });

        socket.on('disconnect', () => {
            document.getElementById('connection-status').className = "status-badge";
            document.getElementById('connection-status').innerText = `⚠️ 連線中斷，重試中...`;
        });

        // 🚨 升級重點：結合圖表更新與高風險紅色脈衝特效
        socket.on('new_scan_result', (data) => {
            console.log("收到新掃描數據:", data);
            fetchLogs(familyID, true); 
            
            // 如果分數大於等於 80，觸發戰情室紅色警報！
            if (data.riskScore >= 80) {
                triggerRedAlert(data.reason);
            }
        });

        socket.on('emergency_alert', (data) => {
            showEmergencyBanner(data.url, data.reason);
        });

        // 🪄 監聽神蹟重置廣播
        socket.on('demo_reset_triggered', function() {
            console.log("🔄 收到神蹟重置指令，畫面即將重新載入...");
            window.location.reload();
        });

    } else {
        socket.emit('join_family_room', { familyID: familyID });
    }
}

function showEmergencyBanner(url, reason) {
    const banner = document.getElementById('emergency-banner');
    const detail = document.getElementById('emergency-detail');
    detail.textContent = `網域：${url.substring(0, 40)}... | 攔截原因：${reason}`;
    banner.style.display = "block";
    setTimeout(() => { banner.style.display = "none"; }, 8000);
}

document.getElementById('btn-manual').addEventListener('click', () => {
    const familyID = document.getElementById('family-id-input').value.trim().toUpperCase();
    if(!familyID) return alert("請輸入 6 碼邀請碼");
    fetchLogs(familyID, false);
});

document.getElementById('btn-start').addEventListener('click', () => {
    const familyID = document.getElementById('family-id-input').value.trim().toUpperCase();
    if(!familyID) return alert("請輸入 6 碼邀請碼");
    localStorage.setItem('savedFamilyID', familyID); 
    localStorage.setItem('autoMonitor', 'true');     
    startMonitoring(familyID);
});

document.getElementById('btn-stop').addEventListener('click', stopMonitoring);

function startMonitoring(familyID) {
    document.getElementById('family-id-input').disabled = true;
    document.getElementById('btn-start').style.display = "none";
    document.getElementById('btn-stop').style.display = "inline-block";
    initSocket(familyID);
    fetchLogs(familyID, false); 
}

function stopMonitoring() {
    localStorage.setItem('autoMonitor', 'false');
    if (socket) { socket.disconnect(); socket = null; }
    document.getElementById('connection-status').className = "status-badge";
    document.getElementById('connection-status').innerText = `🔴 已斷開連線`;
    document.getElementById('family-id-input').disabled = false;
    document.getElementById('btn-start').style.display = "inline-block";
    document.getElementById('btn-stop').style.display = "none";
}

async function fetchLogs(familyID, isRealtimeUpdate = false) {
    if (isFetching) return;
    isFetching = true;
    try {
        const res = await fetch(`${CONFIG.API_BASE_URL}/api/get_alerts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ familyID: familyID })
        });
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        const data = await res.json();

        if (data.data && data.data.length > 0) {
            updateDashboard(data.data, isRealtimeUpdate);
        } else {
            // 如果清空了，要重置儀表板
            if(isRealtimeUpdate === false && data.data && data.data.length === 0){
                updateDashboard([], false);
            }
        }
    } catch (err) {
        console.error("API 連線失敗", err);
    } finally {
        isFetching = false;
    }
}

function updateDashboard(records, isRealtimeUpdate) {
    const tbody = document.getElementById('log-table-body');
    tbody.innerHTML = ""; 
    
    // 如果沒有資料（通常是被上帝模式清空後），直接歸零
    if (records.length === 0) {
        document.getElementById('stat-total').innerText = "0";
        document.getElementById('stat-safe').innerText = "0";
        document.getElementById('stat-danger').innerText = "0";
        drawRatioChart(0, 0);
        drawTrendChart([], []);
        return;
    }

    // 🌟 戰情室也套用 50 分過濾器
    let sanitizedRecords = records.map(record => {
        let rec = { ...record };
        let report = {};
        try { report = typeof rec.report === 'string' ? JSON.parse(rec.report) : rec.report; } catch(e) { report = { riskScore: 0, reason: "解析失敗" }; }
        
        let score = parseInt(report.riskScore || report.RiskScore || report.risk_score) || 0;
        // 強制套用 50 分以下安全濾鏡
        if (score < 50) {
            report.riskScore = 0;
            report.reason = "✅ 系統未發現明顯惡意特徵，安全放行。";
            if(report.scamDNA) report.scamDNA = [];
        } else {
            report.riskScore = score;
        }
        rec.report = report;
        return rec;
    });
    
    let safeCount = 0, dangerCount = 0, labels = [], scores = [];
    let chartRecords = [...sanitizedRecords].reverse();

    chartRecords.forEach(record => {
        let score = record.report.riskScore;
        if (score >= window.CONFIG.RISK_THRESHOLD_HIGH) dangerCount++; else safeCount++;
        labels.push(record.timestamp.split(' ')[1]);
        scores.push(score);
    });

    const totalEl = document.getElementById('stat-total');
    const safeEl = document.getElementById('stat-safe');
    const dangerEl = document.getElementById('stat-danger');

    if (parseInt(totalEl.innerText) !== sanitizedRecords.length) animateValue(totalEl, parseInt(totalEl.innerText), sanitizedRecords.length, 1000);
    if (parseInt(safeEl.innerText) !== safeCount) animateValue(safeEl, parseInt(safeEl.innerText), safeCount, 1000);
    if (parseInt(dangerEl.innerText) !== dangerCount) animateValue(dangerEl, parseInt(dangerEl.innerText), dangerCount, 1000);

    drawRatioChart(safeCount, dangerCount);
    drawTrendChart(labels, scores);

    sanitizedRecords.forEach((record, index) => {
        let report = record.report;
        let score = report.riskScore;
        
        let dna = (report.scamDNA && report.scamDNA.length > 0) ? `[${report.scamDNA.join(', ')}] ` : "";
        let reason = dna + (report.reason || "系統記錄此特徵");
        
        let riskClass = score >= window.CONFIG.RISK_THRESHOLD_HIGH ? 'risk-high' : (score >= window.CONFIG.RISK_THRESHOLD_MEDIUM ? 'risk-warn' : 'risk-safe');
        let statusBadge = score >= window.CONFIG.RISK_THRESHOLD_HIGH ? '🛑 強制攔截' : '✅ 安全放行';

        let tr = document.createElement('tr');
        if (isRealtimeUpdate && index === 0) tr.className = "new-row-highlight";

        let tdTime = document.createElement('td');
        tdTime.style.cssText = "font-family:monospace; color:#8b949e;";
        tdTime.textContent = record.timestamp.split(' ')[1];

        let tdUrl = document.createElement('td');
        tdUrl.style.cssText = "max-width:250px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;";
        tdUrl.textContent = record.url;

        let tdScore = document.createElement('td');
        tdScore.className = riskClass;
        tdScore.innerHTML = `<span style="font-size:22px;">${score}</span> / 100`; 

        let tdReason = document.createElement('td');
        tdReason.style.cssText = "max-width:350px; line-height: 1.5; color:#c9d1d9;";
        tdReason.textContent = reason;

        let tdStatus = document.createElement('td');
        tdStatus.className = riskClass;
        tdStatus.textContent = statusBadge;

        tr.append(tdTime, tdUrl, tdScore, tdReason, tdStatus);
        tbody.appendChild(tr);
    });
}

function drawRatioChart(safe, danger) {
    const ctx = document.getElementById('ratioChart').getContext('2d');
    if(ratioChartInstance) ratioChartInstance.destroy();
    ratioChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['安全放行', '危險攔截'],
            datasets: [{ data: [safe, danger], backgroundColor: ['#00C851', '#FF4444'], borderWidth: 0, hoverOffset: 10 }]
        },
        options: { 
            responsive: true, 
            cutout: '65%',
            plugins: { 
                legend: { position: 'bottom', labels: { color: '#fff', font: { size: 16, weight: 'bold' }, padding: 20 } } 
            }, 
            animation: { duration: 1000, easing: 'easeOutQuart' } 
        }
    });
}

function drawTrendChart(labels, data) {
    const ctx = document.getElementById('trendChart').getContext('2d');
    
    let gradient = ctx.createLinearGradient(0, 0, 0, 300);
    gradient.addColorStop(0, 'rgba(51, 181, 229, 0.6)');
    gradient.addColorStop(1, 'rgba(51, 181, 229, 0.05)');

    if(trendChartInstance) trendChartInstance.destroy();
    trendChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{ 
                label: '風險指數', 
                data: data, 
                borderColor: '#33b5e5', 
                backgroundColor: gradient, 
                borderWidth: 4, 
                fill: true, 
                tension: 0.4, 
                pointBackgroundColor: '#fff',
                pointBorderColor: '#33b5e5',
                pointBorderWidth: 2,
                pointRadius: 4,
                pointHoverRadius: 8
            }]
        },
        options: { 
            responsive: true, 
            animation: { duration: 1000, easing: 'easeOutQuart' },
            scales: { 
                y: { beginAtZero: true, max: 100, grid: { color: '#30363d' }, ticks: { color: '#fff', font: { size: 14 } } },
                x: { grid: { display: false }, ticks: { color: '#8b949e', font: { size: 14 } } }
            },
            plugins: { legend: { display: false } }
        }
    });
}

function triggerRedAlert(reason) {
    // 畫面邊框閃爍紅光
    document.body.style.transition = "box-shadow 0.2s";
    document.body.style.boxShadow = "inset 0 0 100px rgba(255, 0, 0, 0.8)";
    
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        oscillator.type = 'square';
        oscillator.frequency.setValueAtTime(800, audioCtx.currentTime); 
        gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime); 
        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        oscillator.start();
        setTimeout(() => oscillator.stop(), 200); 
    } catch(e) { console.log("音效播放被阻擋"); }

    setTimeout(() => {
        document.body.style.boxShadow = "none";
    }, 500);
}

// ==========================================
// 🪄 隱藏版彩蛋：上帝模式觸發器 (連按標題 5 次觸發)
// ==========================================
let secretClickCount = 0;
let clickTimer = null;

// 監聽畫面上所有 h1 標籤，如果沒有 h1 則預設監聽 body
const dashboardTitle = document.querySelector('h1') || document.body; 

dashboardTitle.addEventListener('click', () => {
    secretClickCount++;
    clearTimeout(clickTimer);
    
    // 如果連續點擊 5 次
    if (secretClickCount >= 5) {
        secretClickCount = 0;
        if (confirm("⚠️ 【上帝模式】確定要啟動神蹟重置，清空所有 Demo 數據嗎？")) {
            triggerDemoReset();
        }
    }
    
    // 1秒內沒連按就歸零
    clickTimer = setTimeout(() => { secretClickCount = 0; }, 1000); 
});

async function triggerDemoReset() {
    try {
        // 讀取設定的 URL
        const apiUrl = (typeof window.CONFIG !== 'undefined' && window.CONFIG.API_BASE_URL) ? window.CONFIG.API_BASE_URL : 'http://127.0.0.1:5000';
        
        // 取得當前的 familyID，若無則預設為 demo_family
        const familyID = document.getElementById('family-id-input')?.value || localStorage.getItem('savedFamilyID') || "demo_family"; 

        const res = await fetch(`${apiUrl}/api/reset_demo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ familyID: familyID })
        });
        
        const data = await res.json();
        if (data.status === 'success') {
            alert(data.message);
            // 本地重整
            window.location.reload(); 
        } else {
            alert("重置發生錯誤：" + data.message);
        }
    } catch (e) {
        console.error("重置失敗:", e);
        alert("重置失敗，請檢查後端連線。");
    }
}