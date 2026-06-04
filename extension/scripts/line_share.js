function normalizeFamilyCode(value) {
    const code = String(value || "")
        .trim()
        .toUpperCase()
        .replace(/^AISHIELD:/, "")
        .replace(/^FAM-/, "")
        .replace(/[^A-Z0-9]/g, "")
        .slice(0, 6);

    return /^[A-Z0-9]{6}$/.test(code) ? code : "";
}

function getCodeFromUrl() {
    const params = new URLSearchParams(location.search);
    return normalizeFamilyCode(params.get("code") || params.get("familyID") || params.get("familyCode"));
}

function buildInviteMessage(code) {
    return [
        `AI防詐盾牌家庭守護邀請碼：${code}`,
        `請打開 AI 防詐盾牌，在「更多設定與展示工具」輸入這 6 碼即可加入家庭守護。`,
        `備用格式：aishield:${code}`
    ].join("\n");
}

async function copyText(text, silent = false) {
    try {
        await navigator.clipboard.writeText(text);
        if (!silent) alert("已複製，可以貼到 LINE 聊天室。");
    } catch (e) {
        const textarea = document.getElementById("message");
        textarea.focus();
        textarea.select();
        document.execCommand("copy");
        if (!silent) alert("已選取邀請訊息，請複製後貼到 LINE。");
    }
}

document.addEventListener("DOMContentLoaded", async () => {
    const code = getCodeFromUrl();
    const message = code ? buildInviteMessage(code) : "找不到有效家庭邀請碼。";

    const codeEl = document.getElementById("code");
    const messageEl = document.getElementById("message");
    const copyBtn = document.getElementById("copy-message");
    const lineLink = document.getElementById("open-line");
    const closeBtn = document.getElementById("close-page");

    codeEl.textContent = code || "------";
    messageEl.value = message;
    lineLink.href = `line://msg/text/${encodeURIComponent(message)}`;

    copyBtn.addEventListener("click", () => copyText(message));
    closeBtn.addEventListener("click", () => window.close());

    if (code) await copyText(message, true);
});
