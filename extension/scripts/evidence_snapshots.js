const EVIDENCE_SNAPSHOT_STORAGE_KEY = "aiShieldEvidenceSnapshots";
let records = [];

function formatTime(isoString) {
    try {
        return new Date(isoString).toLocaleString("zh-TW", {
            year: "numeric", month: "2-digit", day: "2-digit",
            hour: "2-digit", minute: "2-digit", second: "2-digit"
        });
    } catch (e) {
        return isoString || "";
    }
}

function safeFileName(text = "evidence") {
    return String(text || "evidence")
        .replace(/^https?:\/\//i, "")
        .replace(/[\\/:*?"<>|#%&{}$!'@+`=]/g, "_")
        .replace(/\s+/g, "_")
        .slice(0, 80) || "evidence";
}

function loadImageElement(dataUrl) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("快照圖片讀取失敗"));
        img.src = dataUrl;
    });
}

function drawWrappedText(ctx, text, x, y, maxWidth, lineHeight, maxLines = 3) {
    const chars = String(text || "").split("");
    let line = "";
    let lines = 0;

    for (const ch of chars) {
        const testLine = line + ch;
        if (ctx.measureText(testLine).width > maxWidth && line) {
            ctx.fillText(line, x, y);
            line = ch;
            y += lineHeight;
            lines += 1;
            if (lines >= maxLines) {
                ctx.fillText(`${line.slice(0, 24)}...`, x, y);
                return y + lineHeight;
            }
        } else {
            line = testLine;
        }
    }

    if (line) {
        ctx.fillText(line, x, y);
        y += lineHeight;
    }

    return y;
}

async function buildExportImage(record, masked = false) {
    const img = await loadImageElement(record.imageData);
    const maxWidth = 1200;
    const scale = Math.min(1, maxWidth / img.naturalWidth);
    const shotWidth = Math.max(720, Math.round(img.naturalWidth * scale));
    const shotHeight = Math.round(img.naturalHeight * scale);
    const headerHeight = 230;

    const canvas = document.createElement("canvas");
    canvas.width = shotWidth;
    canvas.height = headerHeight + shotHeight;
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = masked ? "#fff7ed" : "#eff6ff";
    ctx.fillRect(0, 0, canvas.width, headerHeight);

    ctx.fillStyle = "#0f172a";
    ctx.font = "bold 34px Microsoft JhengHei, sans-serif";
    ctx.fillText(masked ? "AI 防詐盾牌｜遮罩版證據快照" : "AI 防詐盾牌｜報案版證據快照", 34, 52);

    ctx.font = "bold 22px Microsoft JhengHei, sans-serif";
    ctx.fillStyle = masked ? "#b45309" : "#1d4ed8";
    ctx.fillText(`風險分數：${Number(record.riskScore || 0)}｜風險等級：${record.riskLevel || "未標示"}`, 34, 92);

    ctx.font = "18px Microsoft JhengHei, sans-serif";
    ctx.fillStyle = "#334155";
    let y = 126;
    y = drawWrappedText(ctx, `保存時間：${formatTime(record.capturedAt)}`, 34, y, canvas.width - 68, 24, 1);
    y = drawWrappedText(ctx, `網址：${record.url || "未取得網址"}`, 34, y, canvas.width - 68, 24, 2);
    y = drawWrappedText(ctx, `AI 判斷：${record.reason || "尚無風險原因文字"}`, 34, y, canvas.width - 68, 24, 2);

    if (masked) {
        ctx.save();
        ctx.filter = "blur(8px)";
        ctx.drawImage(img, 0, headerHeight, shotWidth, shotHeight);
        ctx.restore();
        ctx.fillStyle = "rgba(255,255,255,.42)";
        ctx.fillRect(0, headerHeight, shotWidth, shotHeight);
        ctx.fillStyle = "rgba(15,23,42,.76)";
        ctx.fillRect(0, headerHeight + Math.round(shotHeight * 0.38), shotWidth, 96);
        ctx.fillStyle = "#fff";
        ctx.font = "bold 28px Microsoft JhengHei, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("遮罩版：完整畫面已模糊處理，避免個資外流", shotWidth / 2, headerHeight + Math.round(shotHeight * 0.38) + 58);
        ctx.textAlign = "left";
    } else {
        ctx.drawImage(img, 0, headerHeight, shotWidth, shotHeight);
    }

    return canvas.toDataURL("image/jpeg", .9);
}

function downloadDataUrl(dataUrl, filename) {
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
}

async function exportRecord(record, masked = false) {
    if (!record?.imageData) {
        alert("這筆紀錄沒有快照圖片。");
        return;
    }

    const dataUrl = await buildExportImage(record, masked);
    const prefix = masked ? "AI防詐盾牌_遮罩版快照" : "AI防詐盾牌_報案版快照";
    downloadDataUrl(dataUrl, `${prefix}_${safeFileName(record.url)}_${Date.now()}.jpg`);
}

function openDashboard() {
    chrome.tabs.create({ url: chrome.runtime.getURL("pages/dashboard.html") });
}

function renderSnapshots() {
    const list = document.getElementById("snapshot-list");
    const count = document.getElementById("snapshot-count");

    if (count) count.textContent = `${records.length} 筆`;
    if (!list) return;

    list.replaceChildren();

    if (!records.length) {
        const empty = document.createElement("div");
        empty.className = "empty";
        empty.textContent = "目前尚未保存任何證據快照。請回到可疑頁面，用 Popup 掃描高風險內容，系統會自動保存。";
        list.appendChild(empty);
        return;
    }

    records.forEach(record => {
        const card = document.createElement("article");
        card.className = "snapshot-card";

        const img = document.createElement("img");
        img.src = record.imageData;
        img.alt = "證據快照";

        const body = document.createElement("div");
        body.className = "snapshot-body";

        const riskLine = document.createElement("div");
        riskLine.className = "risk-line";

        const score = document.createElement("div");
        score.className = "risk-score";
        score.textContent = `${Number(record.riskScore || 0)} 分`;

        const level = document.createElement("div");
        level.className = "risk-level";
        level.textContent = record.riskLevel || "未標示";

        riskLine.append(score, level);

        const meta = document.createElement("div");
        meta.className = "meta";
        meta.textContent = `時間：${formatTime(record.capturedAt)}｜網址：${record.url || "未取得網址"}`;

        const reason = document.createElement("div");
        reason.className = "reason";
        reason.textContent = record.reason || "尚無 AI 判斷原因。";

        const actions = document.createElement("div");
        actions.className = "snapshot-actions";

        const fullBtn = document.createElement("button");
        fullBtn.className = "btn-green";
        fullBtn.type = "button";
        fullBtn.textContent = "報案版";
        fullBtn.addEventListener("click", () => exportRecord(record, false));

        const maskedBtn = document.createElement("button");
        maskedBtn.className = "btn-gray";
        maskedBtn.type = "button";
        maskedBtn.textContent = "遮罩版";
        maskedBtn.addEventListener("click", () => exportRecord(record, true));

        actions.append(fullBtn, maskedBtn);
        body.append(riskLine, meta, reason, actions);
        card.append(img, body);
        list.appendChild(card);
    });
}

async function loadSnapshots() {
    const storage = await chrome.storage.local.get([EVIDENCE_SNAPSHOT_STORAGE_KEY]);
    records = Array.isArray(storage[EVIDENCE_SNAPSHOT_STORAGE_KEY])
        ? storage[EVIDENCE_SNAPSHOT_STORAGE_KEY]
        : [];
    renderSnapshots();
}

async function clearSnapshots() {
    if (!confirm("確定要清除本機保存的證據快照嗎？")) return;
    await chrome.storage.local.remove([EVIDENCE_SNAPSHOT_STORAGE_KEY]);
    records = [];
    renderSnapshots();
}

document.addEventListener("DOMContentLoaded", async () => {
    document.getElementById("btn-open-dashboard")?.addEventListener("click", openDashboard);
    document.getElementById("btn-clear")?.addEventListener("click", clearSnapshots);

    document.getElementById("btn-export-latest")?.addEventListener("click", () => {
        if (!records[0]) return alert("目前沒有快照可以匯出。");
        exportRecord(records[0], false);
    });

    document.getElementById("btn-export-latest-masked")?.addEventListener("click", () => {
        if (!records[0]) return alert("目前沒有快照可以匯出。");
        exportRecord(records[0], true);
    });

    await loadSnapshots();
});
