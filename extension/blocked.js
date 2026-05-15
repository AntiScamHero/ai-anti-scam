// ===== blocked.js =====
// AI 防詐盾牌 - 攔截頁邏輯（保留原功能優化版）
// 功能：
// 1. 顯示風險分數與攔截原因
// 2. 支援 30 分鐘暫時放行
// 3. 支援家人 PIN 解鎖後加入個人白名單
// 4. 支援誤判回報到後端
// 5. 支援 Socket.IO 家人緊急通知
// 6. 支援詐騙情境還原聊天室
// 7. 支援短效 Authorization Bearer token，不再依賴前端固定密鑰
// 8. 支援確認詐騙後加入家庭黑名單

document.addEventListener('DOMContentLoaded', async () => {
    // ==========================================
    // URL 參數解析
    // ==========================================
    const urlParams = new URLSearchParams(window.location.search);

    function parseBlockedPayload() {
        const rawData = urlParams.get('data');
        const legacyUrl = urlParams.get('url') || urlParams.get('original_url') || '';
        const legacyReason = urlParams.get('reason') || '';

        if (!rawData) {
            return {
                riskScore: '99',
                riskLevel: '極度危險',
                reason: legacyReason || '系統偵測到高風險異常行為。',
                advice: '請勿輸入任何個資、信用卡、驗證碼，也不要依照對方指示匯款。',
                scamDNA: [],
                originalUrl: legacyUrl
            };
        }

        try {
            return JSON.parse(rawData);
        } catch (err1) {
            try {
                return JSON.parse(decodeURIComponent(rawData));
            } catch (err2) {
                console.error('blocked.html data 解析失敗', err1, err2);
                return {
                    riskScore: '99',
                    riskLevel: '解析失敗',
                    reason: '攔截資料格式錯誤，無法解析。',
                    advice: '請回上一頁，並將此錯誤截圖回報。',
                    scamDNA: [],
                    originalUrl: legacyUrl
                };
            }
        }
    }

    const parsedPayload = parseBlockedPayload();
    let decodedTargetUrl = parsedPayload.originalUrl || parsedPayload.url || '';

    try {
        decodedTargetUrl = decodeURIComponent(decodedTargetUrl);
    } catch (e) {}

    let riskScore = '99';
    const rawScore = parseInt(parsedPayload.riskScore, 10);
    if (!isNaN(rawScore)) {
        riskScore = rawScore > 100 ? '100' : String(Math.max(0, rawScore));
    } else if (parsedPayload.riskScore) {
        riskScore = String(parsedPayload.riskScore);
    }

    let internalReason = parsedPayload.reason || '系統偵測到高風險異常行為。';
    let adviceText = parsedPayload.advice || '請勿輸入任何個資、信用卡、驗證碼，也不要依照對方指示匯款。';
    let riskLevel = parsedPayload.riskLevel || '極度危險';
    let scamDNA = Array.isArray(parsedPayload.scamDNA) ? parsedPayload.scamDNA : [];

    function normalizeExplainItems(payload) {
        const rawExplain = payload?.explain || payload?.explanation || payload?.evidence || [];
        let items = [];

        if (Array.isArray(rawExplain)) {
            items = rawExplain.map(item => String(item || '').trim()).filter(Boolean);
        } else if (typeof rawExplain === 'string' && rawExplain.trim()) {
            items = rawExplain.split(/[；;。\n]+/).map(item => item.trim()).filter(Boolean);
        }

        if (items.length === 0 && scamDNA.length > 0) {
            items = scamDNA.slice(0, 4).map(item => `命中「${item}」風險特徵。`);
        }

        if (items.length === 0 && internalReason) {
            items = String(internalReason).split(/[；;。\n]+/).map(item => item.trim()).filter(Boolean);
        }

        if (items.length === 0) {
            items = [
                '這個頁面出現高風險詐騙特徵。',
                '可能誘導輸入個資、驗證碼、信用卡或匯款資料。',
                '建議先離開頁面，並請家人或 165 協助確認。'
            ];
        }

        return Array.from(new Set(items)).slice(0, 5);
    }

    const explainItems = normalizeExplainItems(parsedPayload);

    function normalizeReferences(payload) {
        const rawRefs = payload?.references || payload?.officialReferences || payload?.official_references || [];
        if (!Array.isArray(rawRefs)) return [];
        return rawRefs.map(ref => {
            if (!ref) return '';
            if (typeof ref === 'string') return ref.trim();
            const title = ref.title || ref.name || ref.source || '官方資料';
            const note = ref.note || ref.summary || ref.url || '';
            return note ? `${title}：${note}` : title;
        }).filter(Boolean).slice(0, 5);
    }

    function getEngineLabel(payload) {
        const source = String(payload?.source || payload?.winningEngine || payload?.engine || '').toLowerCase();

        if (source.includes('edge') || source.includes('offline')) return '判定來源：Edge AI 離線防護';
        if (source.includes('scamdna')) return '判定來源：ScamDNA 規則引擎';
        if (source.includes('content')) return '判定來源：瀏覽器即時防護';
        if (source.includes('background')) return '判定來源：背景巡邏掃描';
        if (source.includes('azure') || source.includes('llm') || source.includes('ai')) return '判定來源：雲端 AI 分析';

        return '判定來源：AI 防詐引擎';
    }

    // ==========================================
    // 常數設定
    // ==========================================
    const USER_WHITELIST_KEY = 'userWhitelistDomains';
    const TEMP_WHITELIST_KEY = 'temporaryWhitelistDomains';
    const TEMP_ALLOW_MINUTES = 30;
    const COOLDOWN_SECONDS = 30;

    const AUTO_TRUSTED_DOMAINS = [
        'ccsh.tn.edu.tw',
        'wikipedia.org',
        'gov.tw',
        'fsc.gov.tw',
        'moneywise.fsc.gov.tw',
        '165.npa.gov.tw',
        'npa.gov.tw',
        'mohw.gov.tw',
        'nhia.gov.tw',
        'edu.tw'
    ];

    // ==========================================
    // DOM 快取
    // ==========================================
    const scoreEl = document.getElementById('score');
    const targetUrlEl = document.getElementById('target-url');
    const originalUrlEl = document.getElementById('original-url');
    const reasonBox = document.getElementById('reason-box');
    const dnaBox = document.getElementById('dna-box');
    const tagsContainer = document.getElementById('tags-container');
    const adviceEl = document.getElementById('advice');

    const detailUrlEl = document.getElementById('detail-url');
    const detailDomainEl = document.getElementById('detail-domain');
    const detailSourceEl = document.getElementById('detail-source');
    const detailRiskLevelEl = document.getElementById('detail-risk-level');
    const detailReasonEl = document.getElementById('detail-reason');
    const detailScamDnaEl = document.getElementById('detail-scam-dna');
    const detailEvidenceStatusEl = document.getElementById('detail-evidence-status');
    const detailSyncStatusEl = document.getElementById('detail-sync-status');
    const detailTimestampEl = document.getElementById('detail-timestamp');
    const detailSyncNoteEl = document.getElementById('detail-sync-note');

    const communityStatusPillEl = document.getElementById('community-status-pill');
    const communityStatusDomainEl = document.getElementById('community-status-domain');
    const communityStatusCountEl = document.getElementById('community-status-count');
    const communityStatusReviewEl = document.getElementById('community-status-review');
    const communityStatusActionEl = document.getElementById('community-status-action');
    const communityStatusNoteEl = document.getElementById('community-status-note');
    const communityStatusRefreshBtn = document.getElementById('community-status-refresh-btn');

    const manualLeaveBtn = document.getElementById('manual-leave-btn');
    const closeBtn = document.getElementById('close-btn');
    const continueOnceBtn = document.getElementById('continue-once-btn');
    const reportFalseBtn = document.getElementById('report-false-btn');
    const bypassBtn = document.getElementById('bypass-btn');
    const familyBlockBtn = ensureFamilyBlockButton();
    const communityReportBtn = ensureCommunityReportButton();

    const passwordArea = document.getElementById('password-area');
    const guardianPinInput = document.getElementById('guardian-pin');
    const verifyPinBtn = document.getElementById('verify-pin-btn');
    const pinError = document.getElementById('pin-error');
    const cancelPinBtn = document.getElementById('cancel-pin-btn');

    const callBtn = document.getElementById('call-btn');
    const desktopModal = document.getElementById('desktop-modal');
    const closeModalBtn = document.getElementById('close-modal-btn');
    const modalPhoneNumber = document.getElementById('modal-phone-number');

    const familyBroadcast = document.getElementById('family-broadcast');
    const broadcastMessage = document.getElementById('broadcast-message');

    const chatHistoryEl = document.getElementById('chat-history');
    const chatStatusEl = document.getElementById('chat-status');
    const aiSourcePill = document.getElementById('ai-source-pill');
    const scenarioToggleBtn = document.getElementById('scenario-toggle');
    const scenarioPanel = document.getElementById('scenario-panel');
    const detailToggleBtn = document.getElementById('detail-toggle-btn');
    const progressiveDetail = document.getElementById('progressive-detail');
    const advancedActionsToggle = document.getElementById('advanced-actions-toggle');
    const advancedActionsPanel = document.getElementById('advanced-actions-panel');
    const mainMascot = document.getElementById('main-mascot');
    let scenarioReplayStarted = false;


    function appendTextBlock(parent, className, text) {
        const div = document.createElement('div');
        if (className) div.className = className;
        div.textContent = String(text || '');
        parent.appendChild(div);
        return div;
    }

    function normalizeTimestamp(value) {
        if (!value) return new Date().toLocaleString('zh-TW', { hour12: false });

        try {
            const date = typeof value === 'number' ? new Date(value) : new Date(String(value));
            if (!Number.isNaN(date.getTime())) {
                return date.toLocaleString('zh-TW', { hour12: false });
            }
        } catch (e) {}

        return String(value);
    }

    function buildEvidenceStatusText(payload) {
        if (payload?.screenshot_saved || payload?.screenshotSaved) return '已保存完整截圖與摘要';
        if (payload?.evidenceID || payload?.evidenceId) return `已建立證據摘要（ID：${payload.evidenceID || payload.evidenceId}）`;
        return '已保存攔截摘要；未保存完整截圖';
    }

    function createDetailTag(text) {
        const tag = document.createElement('span');
        tag.className = 'detail-tag';
        tag.textContent = String(text || '未知特徵');
        return tag;
    }

    function renderInterceptDetail(identity = null) {
        const familyID = String(
            parsedPayload.familyID ||
            parsedPayload.familyId ||
            identity?.familyID ||
            'none'
        ).toUpperCase();

        const domain = normalizeHost(decodedTargetUrl) || '無法解析';
        const sourceLabel = getEngineLabel(parsedPayload).replace('判定來源：', '');

        setText(detailUrlEl, decodedTargetUrl || '未知網址');
        setText(detailDomainEl, domain);
        setText(detailSourceEl, sourceLabel);
        setText(detailRiskLevelEl, riskLevel || '高風險');
        setText(detailReasonEl, internalReason || '系統偵測到高風險異常行為。');
        setText(detailEvidenceStatusEl, buildEvidenceStatusText(parsedPayload));
        setText(detailTimestampEl, normalizeTimestamp(parsedPayload.timestamp || Date.now()));

        if (detailScamDnaEl) {
            detailScamDnaEl.replaceChildren();
            if (scamDNA.length) {
                scamDNA.slice(0, 6).forEach(item => detailScamDnaEl.appendChild(createDetailTag(item)));
            } else {
                detailScamDnaEl.appendChild(createDetailTag('未提供明確標籤'));
            }
        }

        if (detailSyncStatusEl) {
            detailSyncStatusEl.textContent = familyID && familyID !== 'NONE' && familyID !== 'none'
                ? `已綁定家庭 ${familyID}`
                : '未綁定家庭';
        }

        if (detailSyncNoteEl) {
            detailSyncNoteEl.textContent = familyID && familyID !== 'NONE' && familyID !== 'none'
                ? `此筆攔截摘要會使用家庭代碼 ${familyID} 同步到家庭戰情室；若即時推播未連線，戰情室仍會透過資料更新讀取紀錄。`
                : '目前未綁定家庭代碼，因此只會顯示本機攔截資訊。若要讓家人一起看到紀錄，請先在 Popup 綁定家庭。';
        }
    }

    function renderAiConsultant() {
        const list = document.getElementById('ai-consultant-list');
        const summary = document.getElementById('ai-consultant-summary');
        const toggleBtn = document.getElementById('ai-consultant-toggle');
        const detail = document.getElementById('ai-consultant-detail');

        if (aiSourcePill) {
            aiSourcePill.textContent = getEngineLabel(parsedPayload);
        }

        if (!list && !summary && !toggleBtn && !detail) return;

        const safeExplain = Array.isArray(explainItems) && explainItems.length
            ? explainItems
            : normalizeExplainItems(parsedPayload);

        if (summary) {
            summary.textContent = '自動診斷完成：我發現以下高風險訊號。';
        }

        if (list) {
            list.replaceChildren();
            safeExplain.slice(0, 4).forEach(item => {
                const li = document.createElement('li');
                li.textContent = item;
                list.appendChild(li);
            });
        }

        if (toggleBtn && detail) {
            toggleBtn.addEventListener('click', () => {
                detail.replaceChildren();

                appendTextBlock(detail, 'ai-consultant-detail-title', '我看到的可疑特徵');
                safeExplain.forEach((item, index) => {
                    appendTextBlock(detail, 'ai-consultant-detail-section', `${index + 1}. ${item}`);
                });

                if (scamDNA.length) {
                    appendTextBlock(detail, 'ai-consultant-detail-title', '可能使用的心理操縱手法');
                    appendTextBlock(detail, 'ai-consultant-detail-section', scamDNA.join('、'));
                }

                appendTextBlock(detail, 'ai-consultant-detail-title', '我的建議');
                appendTextBlock(detail, 'ai-consultant-detail-section', adviceText);

                detail.style.display = 'block';
                toggleBtn.style.display = 'none';
            });
        }
    }

    function renderOfficialCitations() {
        const box = document.getElementById('official-citations');
        const list = document.getElementById('official-citations-list');
        if (!box || !list) return;

        const refs = normalizeReferences(parsedPayload);
        list.replaceChildren();

        if (!refs.length) {
            box.style.display = 'none';
            return;
        }

        refs.forEach(item => {
            const li = document.createElement('li');
            li.textContent = item;
            list.appendChild(li);
        });
        box.style.display = 'block';
    }

    // ==========================================
    // 基本畫面更新
    // ==========================================
    setText(scoreEl, riskScore);
    setText(targetUrlEl, decodedTargetUrl || '未知網址');
    setText(originalUrlEl, decodedTargetUrl || '');

    if (reasonBox) {
        reasonBox.textContent = internalReason;
        reasonBox.setAttribute('aria-label', internalReason);
    }

    if (dnaBox) {
        dnaBox.textContent = scamDNA.length ? scamDNA.join('、') : '未知套路';
        dnaBox.setAttribute('aria-label', dnaBox.textContent);
    }

    if (adviceEl) {
        adviceEl.textContent = adviceText;
        adviceEl.setAttribute('aria-label', adviceText);
    }

    if (tagsContainer && scamDNA.length) {
        tagsContainer.textContent = scamDNA.join('、');
        tagsContainer.setAttribute('aria-label', tagsContainer.textContent);
    }

    renderAiConsultant();
    renderOfficialCitations();
    renderInterceptDetail();

    // ==========================================
    // 共用工具
    // ==========================================
    function setText(el, text) {
        if (el) el.textContent = String(text || '');
    }

    function showElement(el, display = 'block') {
        if (el) el.style.display = display;
    }

    function hideElement(el) {
        if (el) el.style.display = 'none';
    }

    function hasChromeStorage() {
        return typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
    }

    function hasChromeTabs() {
        return typeof chrome !== 'undefined' && chrome.tabs;
    }

    function getConfigValue(key, fallback) {
        try {
            if (window.CONFIG && window.CONFIG[key] !== undefined) {
                return window.CONFIG[key];
            }
        } catch (e) {}

        return fallback;
    }

    function getApiBaseUrl() {
        return getConfigValue('API_BASE_URL', 'https://ai-anti-scam.onrender.com');
    }

    function getAccessTokenStorageKey() {
        return getConfigValue('ACCESS_TOKEN_STORAGE_KEY', 'aiShieldAccessToken');
    }

    function getInstallIdStorageKey() {
        return getConfigValue('INSTALL_ID_STORAGE_KEY', 'aiShieldInstallId');
    }

    function getTokenExpiresAtStorageKey() {
        return getConfigValue('TOKEN_EXPIRES_AT_STORAGE_KEY', 'aiShieldTokenExpiresAt');
    }

    function isAuthRequired() {
        return Boolean(getConfigValue('REQUIRE_AUTH_TOKEN', true));
    }

    async function getCurrentIdentity() {
        const fallback = {
            userID: 'anonymous',
            familyID: 'none',
            installID: '',
            accessToken: ''
        };

        if (!hasChromeStorage()) {
            return fallback;
        }

        try {
            const tokenKey = getAccessTokenStorageKey();
            const installKey = getInstallIdStorageKey();

            const storage = await chrome.storage.local.get([
                'userID',
                'familyID',
                tokenKey,
                installKey,
                'aiShieldTokenExpiresAt'
            ]);

            return {
                userID: storage.userID || 'anonymous',
                familyID: storage.familyID || 'none',
                installID: storage[installKey] || '',
                accessToken: storage[tokenKey] || '',
                expiresAt: Number(storage.aiShieldTokenExpiresAt || 0)
            };
        } catch (e) {
            return fallback;
        }
    }

    async function ensureAccessToken() {
        if (!hasChromeStorage()) return '';

        const tokenKey = getAccessTokenStorageKey();
        const installKey = getInstallIdStorageKey();
        const expiresKey = getTokenExpiresAtStorageKey();

        try {
            const storage = await chrome.storage.local.get(['userID', 'familyID', tokenKey, installKey, expiresKey]);

            let installID = storage[installKey];
            if (!installID) {
                installID = 'ins_' + (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
                await chrome.storage.local.set({ [installKey]: installID });
            }

            let userID = storage.userID;
            if (!userID) {
                userID = 'USER_' + Math.random().toString(36).slice(2, 11).toUpperCase();
                await chrome.storage.local.set({ userID });
            }

            const token = storage[tokenKey] || '';
            const expiresAt = Number(storage[expiresKey] || 0) * 1000;
            const refreshWindow = Number(getConfigValue('TOKEN_REFRESH_WINDOW_MS', 300000));

            if (token && expiresAt - Date.now() > refreshWindow) {
                return token;
            }

            const response = await fetch(`${getApiBaseUrl()}/api/auth/install`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ installID, userID, familyID: storage.familyID || 'none' })
            });

            let data = {};
            try { data = await response.json(); } catch (e) {}

            if (response.ok && data.accessToken) {
                await chrome.storage.local.set({
                    [tokenKey]: data.accessToken,
                    [expiresKey]: data.expiresAt || 0,
                    userID: data.userID || userID,
                    familyID: data.familyID || storage.familyID || 'none'
                });

                return data.accessToken;
            }

            console.warn('攔截頁取得短效 token 失敗：', data.message || response.status);
        } catch (e) {
            console.warn('攔截頁取得短效 token 失敗，請確認 API 是否可用。', e);
        }

        return '';
    }

    async function getApiHeaders() {
        const headers = { 'Content-Type': 'application/json' };
        const token = await ensureAccessToken();

        if (token) headers.Authorization = `Bearer ${token}`;

        if (!token && isAuthRequired()) {
            throw new Error('尚未取得短效 accessToken，請確認後端 API 是否可用。');
        }

        return headers;
    }

    function toAbsoluteHttpUrl(rawUrl) {
        if (!rawUrl) return '';

        const trimmed = String(rawUrl).trim();

        if (/^https?:\/\//i.test(trimmed)) return trimmed;
        if (/^(chrome|chrome-extension|edge|about|file):/i.test(trimmed)) return trimmed;

        return 'https://' + trimmed.replace(/^\/+/, '');
    }

    function normalizeHost(rawUrl) {
        try {
            const host = new URL(toAbsoluteHttpUrl(rawUrl)).hostname.toLowerCase();
            return host.replace(/^www\./, '');
        } catch (e) {
            return '';
        }
    }

    function domainMatchesHost(host, domain) {
        if (!host || !domain) return false;

        const cleanDomain = String(domain || '').toLowerCase().replace(/^www\./, '');
        return host === cleanDomain || host.endsWith('.' + cleanDomain);
    }

    function isAutoTrustedUrl(rawUrl) {
        const host = normalizeHost(rawUrl);
        if (!host) return false;

        return AUTO_TRUSTED_DOMAINS.some(domain => domainMatchesHost(host, domain));
    }

    function sanitizeDisplayText(text, maxLength = 300) {
        const value = String(text || '').replace(/\s+/g, ' ').trim();

        if (value.length <= maxLength) return value;

        return value.slice(0, maxLength) + '...';
    }

    function showToast(message, type = 'info') {
        const oldToast = document.getElementById('ai-shield-toast');
        if (oldToast) oldToast.remove();

        const toast = document.createElement('div');
        toast.id = 'ai-shield-toast';
        toast.textContent = String(message || '');

        const bgColor = type === 'success'
            ? 'rgba(0, 200, 81, 0.95)'
            : type === 'error'
                ? 'rgba(255, 68, 68, 0.95)'
                : 'rgba(51, 181, 229, 0.95)';

        toast.style.cssText = `
            position: fixed;
            left: 50%;
            bottom: 28px;
            transform: translateX(-50%);
            max-width: 90vw;
            padding: 14px 20px;
            background: ${bgColor};
            color: #fff;
            font-size: 16px;
            font-weight: 700;
            line-height: 1.5;
            border-radius: 999px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.35);
            z-index: 2147483647;
            text-align: center;
        `;

        document.body.appendChild(toast);

        setTimeout(() => {
            toast.remove();
        }, 3000);
    }



    // ==========================================
    // 社群回報狀態工具
    // ==========================================
    function normalizeCommunityStatusLabel(status) {
        const value = String(status || 'none').toLowerCase();
        const map = {
            none: '尚無回報',
            pending: '已收件｜待累積',
            watching: '觀察名單',
            community_flagged: '社群高風險觀察',
            approved: '社群確認高風險',
            rejected: '已駁回'
        };
        return map[value] || status || '未知';
    }

    function normalizeCommunityActionLabel(action) {
        const value = String(action || 'none').toLowerCase();
        const map = {
            none: '無動作',
            collecting: '收集中',
            watchlist: '提高關注',
            raise_risk: '提高風險權重',
            confirmed: '可直接高風險攔截',
            manual_review_only: '高信任網域｜僅人工審核'
        };
        return map[value] || action || '未知';
    }

    function setCommunityStatusClass(el, state) {
        if (!el) return;
        el.classList.remove('warn', 'danger');
        if (state) el.classList.add(state);
    }

    function renderCommunityStatus(data = {}, fallbackDomain = '') {
        const domain = data.domain || fallbackDomain || normalizeHost(decodedTargetUrl) || '--';
        const reportCount = Number(data.reportCount || 0);
        const reviewStatus = data.reviewStatus || 'none';
        const autoAction = data.autoAction || 'none';
        const highTrust = Boolean(data.highTrustDomain);
        const isReported = Boolean(data.isReported || reportCount > 0);

        setText(communityStatusDomainEl, domain);
        setText(communityStatusCountEl, `${reportCount} 次`);
        setText(communityStatusReviewEl, normalizeCommunityStatusLabel(reviewStatus));
        setText(communityStatusActionEl, normalizeCommunityActionLabel(autoAction));

        const dangerState = reviewStatus === 'approved' || reviewStatus === 'community_flagged';
        const warnState = reviewStatus === 'watching' || highTrust;
        setCommunityStatusClass(communityStatusReviewEl, dangerState ? 'danger' : warnState ? 'warn' : '');
        setCommunityStatusClass(communityStatusActionEl, dangerState ? 'danger' : warnState ? 'warn' : '');

        if (communityStatusPillEl) {
            communityStatusPillEl.textContent = isReported ? `已累積 ${reportCount} 次` : '尚無社群回報';
        }

        if (communityStatusNoteEl) {
            if (!isReported) {
                communityStatusNoteEl.textContent = '目前社群資料庫尚未累積此網域的回報。若你確認這是詐騙，可按下方「回報這是詐騙到社群防詐資料庫」。';
            } else if (highTrust) {
                communityStatusNoteEl.textContent = `此網域屬高信任網域或大型平台，已進入人工審核保護流程；目前累積 ${reportCount} 次回報，不會因單一回報直接封鎖。`;
            } else {
                communityStatusNoteEl.textContent = `目前狀態：${normalizeCommunityStatusLabel(reviewStatus)}；系統動作：${normalizeCommunityActionLabel(autoAction)}。多人回報與高風險分數達門檻後，才會提高全域風險判斷。`;
            }
        }
    }

    function renderCommunityStatusError(message) {
        const domain = normalizeHost(decodedTargetUrl) || '--';
        setText(communityStatusDomainEl, domain);
        setText(communityStatusCountEl, '--');
        setText(communityStatusReviewEl, '查詢失敗');
        setText(communityStatusActionEl, '--');
        setCommunityStatusClass(communityStatusReviewEl, 'warn');
        if (communityStatusPillEl) communityStatusPillEl.textContent = '查詢失敗';
        if (communityStatusNoteEl) communityStatusNoteEl.textContent = `社群狀態查詢失敗：${message || '請稍後再試'}。這不影響目前攔截結果。`;
    }

    async function fetchCommunityStatus(rawUrl) {
        const host = normalizeHost(rawUrl);
        if (!host) {
            renderCommunityStatusError('無法解析網址主機名稱');
            return null;
        }

        if (communityStatusPillEl) communityStatusPillEl.textContent = '查詢中';
        if (communityStatusNoteEl) communityStatusNoteEl.textContent = '系統正在查詢此網域是否已存在於社群防詐回報池。';

        try {
            const response = await fetch(`${getApiBaseUrl()}/api/community/domain_status`, {
                method: 'POST',
                headers: await getApiHeaders(),
                body: JSON.stringify({ url: rawUrl, domain: host })
            });

            let data = {};
            try { data = await response.json(); } catch (e) {}

            if (!response.ok || data.status !== 'success') {
                throw new Error(data.message || `社群狀態查詢失敗 (${response.status})`);
            }

            renderCommunityStatus(data, host);
            return data;
        } catch (e) {
            renderCommunityStatusError(e.message);
            return null;
        }
    }

    // ==========================================
    // 家庭黑名單工具
    // ==========================================
    function ensureFamilyBlockButton() {
        const existing = document.getElementById('family-block-btn');
        if (existing) return existing;

        const panel = document.querySelector('.false-positive-actions') || document.getElementById('cooldown-box');
        if (!panel) return null;

        const btn = document.createElement('button');
        btn.id = 'family-block-btn';
        btn.type = 'button';
        btn.className = 'btn-text';
        btn.textContent = '確認這是詐騙，加入家庭黑名單';
        btn.style.color = 'var(--red-dark)';
        btn.style.fontSize = '18px';
        btn.style.fontWeight = '1000';
        btn.style.marginTop = '12px';

        const hint = document.createElement('div');
        hint.id = 'family-block-hint';
        hint.textContent = '加入後，同一家庭再次遇到此網域時會優先攔截。';
        hint.style.cssText = 'margin-top:6px;color:#8a5200;font-size:14px;line-height:1.5;font-weight:800;';

        panel.appendChild(btn);
        panel.appendChild(hint);
        return btn;
    }

    function ensureCommunityReportButton() {
        const existing = document.getElementById('community-report-btn');
        if (existing) return existing;

        const panel = document.querySelector('.false-positive-actions') || document.getElementById('cooldown-box');
        if (!panel) return null;

        const btn = document.createElement('button');
        btn.id = 'community-report-btn';
        btn.type = 'button';
        btn.className = 'btn-text';
        btn.textContent = '回報這是詐騙到社群防詐資料庫';
        btn.style.color = '#8a2be2';
        btn.style.fontSize = '18px';
        btn.style.fontWeight = '1000';
        btn.style.marginTop = '12px';

        const hint = document.createElement('div');
        hint.id = 'community-report-hint';
        hint.textContent = '送出後會進入社群回報池；系統會累積多方回報，達門檻後提高全域風險，不會因單一回報直接封鎖。';
        hint.style.cssText = 'margin-top:6px;color:#5d3a7a;font-size:14px;line-height:1.5;font-weight:800;';

        panel.appendChild(btn);
        panel.appendChild(hint);
        return btn;
    }

    async function saveLocalFamilyBlockDomain(host, familyID, payload = {}) {
        if (!host || !hasChromeStorage()) return;

        try {
            const storage = await chrome.storage.local.get(['familyBlockedDomains']);
            const root = storage.familyBlockedDomains && typeof storage.familyBlockedDomains === 'object'
                ? storage.familyBlockedDomains
                : {};

            const fid = String(familyID || 'none').toUpperCase();
            const familyMap = root[fid] && typeof root[fid] === 'object' ? root[fid] : {};

            familyMap[host] = {
                domain: host,
                familyID: fid,
                url: decodedTargetUrl,
                reason: internalReason,
                riskScore: parseInt(riskScore, 10) || 99,
                riskLevel,
                scamDNA,
                updatedAt: new Date().toISOString(),
                ...payload
            };

            root[fid] = familyMap;
            await chrome.storage.local.set({ familyBlockedDomains: root });
        } catch (e) {
            console.warn('本機家庭黑名單暫存失敗：', e);
        }
    }

    async function addFamilyBlockedDomain(rawUrl) {
        const host = normalizeHost(rawUrl);
        if (!host) throw new Error('無法解析網址主機名稱');

        const identity = await getCurrentIdentity();
        const familyID = String(identity.familyID || 'none').toUpperCase();

        if (!familyID || familyID === 'NONE') {
            throw new Error('尚未綁定家庭群組，無法加入家庭黑名單。');
        }

        const payload = {
            url: rawUrl,
            originalUrl: rawUrl,
            domain: host,
            userID: identity.userID,
            familyID,
            riskScore: parseInt(riskScore, 10) || 99,
            riskLevel,
            ai_reason: internalReason,
            reason: internalReason,
            reported_reason: '使用者在攔截頁確認此網站為詐騙，加入家庭黑名單',
            scamDNA,
            action_type: 'blocked_page_confirmed_scam'
        };

        const response = await fetch(`${getApiBaseUrl()}/api/family/block_domain`, {
            method: 'POST',
            headers: await getApiHeaders(),
            body: JSON.stringify(payload)
        });

        let data = {};
        try { data = await response.json(); } catch (e) {}

        if (!response.ok || data.status !== 'success') {
            throw new Error(data.message || `後端加入家庭黑名單失敗 (${response.status})`);
        }

        await saveLocalFamilyBlockDomain(host, familyID, data.blocklist || payload);
        return data;
    }

    async function handleAddFamilyBlockDomain() {
        if (!decodedTargetUrl) {
            showToast('找不到原始網址，無法加入家庭黑名單。', 'error');
            return;
        }

        const ok = window.confirm('確定要把這個網域加入「家庭黑名單」嗎？\n\n加入後，同一家庭的成員再次遇到此網域，系統會優先攔截。');
        if (!ok) return;

        if (familyBlockBtn) {
            familyBlockBtn.disabled = true;
            familyBlockBtn.textContent = '正在加入家庭黑名單...';
            familyBlockBtn.style.opacity = '0.68';
        }

        try {
            const data = await addFamilyBlockedDomain(decodedTargetUrl);
            const domain = data.domain || normalizeHost(decodedTargetUrl);
            showToast(`已加入家庭黑名單：${domain}`, 'success');

            if (detailSyncNoteEl) {
                detailSyncNoteEl.textContent = `此網域 ${domain} 已加入家庭黑名單；家人之後再次遇到會被優先攔截。`;
            }

            if (familyBlockBtn) {
                familyBlockBtn.textContent = '已加入家庭黑名單';
                familyBlockBtn.disabled = true;
                familyBlockBtn.style.opacity = '0.78';
            }
        } catch (e) {
            const host = normalizeHost(decodedTargetUrl);
            const identity = await getCurrentIdentity().catch(() => ({ familyID: 'none' }));

            // 後端暫時不可用時，至少保留本機標記；但不宣稱已同步給家人。
            if (host && identity.familyID && String(identity.familyID).toUpperCase() !== 'NONE') {
                await saveLocalFamilyBlockDomain(host, identity.familyID, {
                    syncStatus: 'local_only',
                    syncError: e.message
                });
                showToast(`已先本機標記 ${host}；後端同步失敗：${e.message}`, 'error');
            } else {
                showToast(`加入家庭黑名單失敗：${e.message}`, 'error');
            }

            if (familyBlockBtn) {
                familyBlockBtn.disabled = false;
                familyBlockBtn.textContent = '確認這是詐騙，加入家庭黑名單';
                familyBlockBtn.style.opacity = '1';
            }
        }
    }

    async function saveLocalCommunityReportDomain(host, payload = {}) {
        if (!host || !hasChromeStorage()) return;

        try {
            const storage = await chrome.storage.local.get(['communityReportedDomains']);
            const root = storage.communityReportedDomains && typeof storage.communityReportedDomains === 'object'
                ? storage.communityReportedDomains
                : {};

            root[host] = {
                domain: host,
                url: decodedTargetUrl,
                reason: internalReason,
                riskScore: parseInt(riskScore, 10) || 99,
                riskLevel,
                scamDNA,
                updatedAt: new Date().toISOString(),
                ...payload
            };

            await chrome.storage.local.set({ communityReportedDomains: root });
        } catch (e) {
            console.warn('本機社群回報暫存失敗：', e);
        }
    }

    async function reportCommunityScam(rawUrl) {
        const host = normalizeHost(rawUrl);
        if (!host) throw new Error('無法解析網址主機名稱');

        const identity = await getCurrentIdentity();
        const familyID = String(identity.familyID || 'none').toUpperCase();

        const payload = {
            url: rawUrl,
            originalUrl: rawUrl,
            domain: host,
            userID: identity.userID,
            familyID,
            riskScore: parseInt(riskScore, 10) || 99,
            riskLevel,
            ai_reason: internalReason,
            reason: internalReason,
            reported_reason: '使用者在攔截頁確認此網站疑似詐騙，送入社群防詐回報池',
            scamDNA,
            action_type: 'blocked_page_report_scam'
        };

        const response = await fetch(`${getApiBaseUrl()}/api/report_scam`, {
            method: 'POST',
            headers: await getApiHeaders(),
            body: JSON.stringify(payload)
        });

        let data = {};
        try { data = await response.json(); } catch (e) {}

        if (!response.ok || data.status !== 'success') {
            throw new Error(data.message || `社群回報失敗 (${response.status})`);
        }

        await saveLocalCommunityReportDomain(host, data.communityReport || payload);
        return data;
    }

    async function handleReportCommunityScam() {
        if (!decodedTargetUrl) {
            showToast('找不到原始網址，無法送出社群回報。', 'error');
            return;
        }

        const ok = window.confirm('確定要把這個網站回報到「社群防詐資料庫」嗎？\n\n系統會累積多方回報，達門檻後提高全域風險；不會因單一回報直接封鎖全平台。');
        if (!ok) return;

        if (communityReportBtn) {
            communityReportBtn.disabled = true;
            communityReportBtn.textContent = '正在送出社群回報...';
            communityReportBtn.style.opacity = '0.68';
        }

        try {
            const data = await reportCommunityScam(decodedTargetUrl);
            const domain = data.domain || normalizeHost(decodedTargetUrl);
            showToast(`已送入社群防詐資料庫：${domain}`, 'success');
            renderCommunityStatus({
                status: 'success',
                domain,
                isReported: true,
                reportCount: data.reportCount || 1,
                reviewStatus: data.reviewStatus || 'pending',
                autoAction: data.autoAction || 'collecting',
                highTrustDomain: Boolean(data.highTrustDomain)
            }, domain);

            if (detailSyncNoteEl) {
                detailSyncNoteEl.textContent = `此網域 ${domain} 已送入社群防詐資料庫；目前累積 ${data.reportCount || 1} 次回報，狀態：${data.reviewStatus || 'pending'}。`;
            }

            if (communityReportBtn) {
                communityReportBtn.textContent = `已回報社群資料庫｜累積 ${data.reportCount || 1} 次`;
                communityReportBtn.disabled = true;
                communityReportBtn.style.opacity = '0.78';
            }
        } catch (e) {
            const host = normalizeHost(decodedTargetUrl);

            if (host) {
                await saveLocalCommunityReportDomain(host, {
                    syncStatus: 'local_only',
                    syncError: e.message
                });
                showToast(`已先本機暫存社群回報；後端同步失敗：${e.message}`, 'error');
            } else {
                showToast(`社群回報失敗：${e.message}`, 'error');
            }

            if (communityReportBtn) {
                communityReportBtn.disabled = false;
                communityReportBtn.textContent = '回報這是詐騙到社群防詐資料庫';
                communityReportBtn.style.opacity = '1';
            }
        }
    }

    // ==========================================
    // 白名單工具
    // ==========================================
    async function addTemporaryWhitelist(rawUrl, minutes = TEMP_ALLOW_MINUTES) {
        const host = normalizeHost(rawUrl);
        if (!host) throw new Error('無法解析網址主機名稱');

        if (!hasChromeStorage()) {
            sessionStorage.setItem('temp_whitelist_' + toAbsoluteHttpUrl(rawUrl), 'true');
            return host;
        }

        const storage = await chrome.storage.local.get([TEMP_WHITELIST_KEY]);
        const map = storage[TEMP_WHITELIST_KEY] || {};
        const now = Date.now();

        for (const [domain, expiresAt] of Object.entries(map)) {
            if (Number(expiresAt) <= now) {
                delete map[domain];
            }
        }

        map[host] = now + minutes * 60 * 1000;

        await chrome.storage.local.set({
            [TEMP_WHITELIST_KEY]: map
        });

        return host;
    }

    async function addPermanentWhitelist(rawUrl) {
        const host = normalizeHost(rawUrl);
        if (!host) throw new Error('無法解析網址主機名稱');

        if (!hasChromeStorage()) {
            sessionStorage.setItem('temp_whitelist_' + toAbsoluteHttpUrl(rawUrl), 'true');
            return host;
        }

        const storage = await chrome.storage.local.get([USER_WHITELIST_KEY]);
        const list = Array.isArray(storage[USER_WHITELIST_KEY])
            ? storage[USER_WHITELIST_KEY]
            : [];

        const normalizedList = list
            .map(item => String(item || '').toLowerCase().replace(/^www\./, ''))
            .filter(Boolean);

        if (!normalizedList.includes(host)) {
            normalizedList.push(host);
        }

        await chrome.storage.local.set({
            [USER_WHITELIST_KEY]: normalizedList
        });

        return host;
    }

    async function reportFalsePositive(rawUrl, scope = 'personal') {
        const host = normalizeHost(rawUrl);
        const identity = await getCurrentIdentity();

        if (!host) {
            throw new Error('無法解析網址主機名稱');
        }

        const payload = {
            url: rawUrl,
            domain: host,
            userID: identity.userID,
            familyID: identity.familyID,
            riskScore: parseInt(riskScore, 10) || 99,
            riskLevel,
            ai_reason: internalReason,
            reported_reason: '使用者在攔截頁回報此網站為誤判',
            scope,
            whitelist_scope: scope,
            action_type: 'blocked_page_false_positive'
        };

        const response = await fetch(`${getApiBaseUrl()}/api/report_false_positive`, {
            method: 'POST',
            headers: await getApiHeaders(),
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`後端回報失敗 (${response.status})`);
        }

        return await response.json();
    }

    async function checkServerWhitelist(rawUrl) {
        const host = normalizeHost(rawUrl);
        const identity = await getCurrentIdentity();

        if (!host) {
            return {
                isWhitelisted: false
            };
        }

        try {
            const response = await fetch(`${getApiBaseUrl()}/api/whitelist/check`, {
                method: 'POST',
                headers: await getApiHeaders(),
                body: JSON.stringify({
                    url: rawUrl,
                    domain: host,
                    userID: identity.userID,
                    familyID: identity.familyID
                })
            });

            if (!response.ok) {
                return {
                    isWhitelisted: false
                };
            }

            return await response.json();
        } catch (e) {
            return {
                isWhitelisted: false
            };
        }
    }

    // ==========================================
    // 導航工具
    // ==========================================
    async function navigateToOriginalUrl() {
        const target = toAbsoluteHttpUrl(decodedTargetUrl);

        if (!target) {
            showToast('找不到原始網址，無法返回。', 'error');
            return;
        }

        if (hasChromeTabs()) {
            try {
                const tabs = await chrome.tabs.query({
                    active: true,
                    currentWindow: true
                });

                if (tabs && tabs[0] && tabs[0].id) {
                    await chrome.tabs.update(tabs[0].id, {
                        url: target
                    });
                    return;
                }
            } catch (e) {
                // fallback to location
            }
        }

        window.location.href = target;
    }

    function navigateToSafePage() {
        window.location.href = 'https://www.google.com.tw';
    }

    function closeCurrentTabOrSafePage() {
        if (hasChromeTabs()) {
            chrome.tabs.query({
                active: true,
                currentWindow: true
            }, tabs => {
                if (tabs && tabs[0] && tabs[0].id) {
                    chrome.tabs.remove(tabs[0].id, () => {
                        if (chrome.runtime.lastError) {
                            navigateToSafePage();
                        }
                    });
                } else {
                    navigateToSafePage();
                }
            });
            return;
        }

        navigateToSafePage();
    }

    // ==========================================
    // 按鈕流程：安全離開 / 暫時放行 / PIN 白名單
    // ==========================================
    async function handleTemporaryAllow() {
        if (!decodedTargetUrl) {
            showToast('找不到原始網址，無法暫時放行。', 'error');
            return;
        }

        try {
            const host = await addTemporaryWhitelist(decodedTargetUrl, TEMP_ALLOW_MINUTES);
            showToast(`已暫時放行 ${host}，有效 ${TEMP_ALLOW_MINUTES} 分鐘。`, 'success');

            setTimeout(() => {
                navigateToOriginalUrl();
            }, 700);
        } catch (e) {
            showToast(`暫時放行失敗：${e.message}`, 'error');
        }
    }

    function openPinArea() {
        if (!passwordArea) return;

        showElement(passwordArea);
        hideElement(pinError);

        if (guardianPinInput) {
            guardianPinInput.value = '';
            guardianPinInput.focus();
        }
    }

    function closePinArea() {
        hideElement(passwordArea);
        hideElement(pinError);

        if (guardianPinInput) {
            guardianPinInput.value = '';
        }
    }

    async function getGuardianPin() {
        if (!hasChromeStorage()) {
            return getConfigValue('DEFAULT_GUARDIAN_PIN', '1650');
        }

        try {
            const storage = await chrome.storage.local.get(['guardianPin', 'familyGuardianPin']);
            return String(
                storage.guardianPin ||
                storage.familyGuardianPin ||
                getConfigValue('DEFAULT_GUARDIAN_PIN', '1650')
            );
        } catch (e) {
            return getConfigValue('DEFAULT_GUARDIAN_PIN', '1650');
        }
    }

    async function handleVerifyPinAndWhitelist() {
        if (!decodedTargetUrl) {
            showToast('找不到原始網址，無法加入白名單。', 'error');
            return;
        }

        const inputPin = String(guardianPinInput?.value || '').trim();
        const expectedPin = await getGuardianPin();

        if (!inputPin || inputPin !== expectedPin) {
            showElement(pinError);
            return;
        }

        try {
            const host = await addPermanentWhitelist(decodedTargetUrl);

            try {
                await reportFalsePositive(decodedTargetUrl, 'personal');
            } catch (reportError) {
                console.warn('後端誤判回報失敗，但本機白名單已生效：', reportError);
            }

            showToast(`已由家人密碼確認，加入個人白名單：${host}`, 'success');

            setTimeout(() => {
                navigateToOriginalUrl();
            }, 900);
        } catch (e) {
            showToast(`加入白名單失敗：${e.message}`, 'error');
        }
    }

    async function handleReportFamilyWhitelist() {
        if (!decodedTargetUrl) {
            showToast('找不到原始網址，無法回報。', 'error');
            return;
        }

        try {
            await reportFalsePositive(decodedTargetUrl, 'family');
            showToast('已送出誤判回報，等待家庭管理員或後台確認。', 'success');
        } catch (e) {
            showToast(`回報失敗：${e.message}`, 'error');
        }
    }

    // ==========================================
    // 冷靜期倒數
    // ==========================================
    function startCooldown() {
        if (!bypassBtn) return;

        let remaining = COOLDOWN_SECONDS;
        bypassBtn.disabled = true;
        bypassBtn.textContent = `強制冷靜期... 請先深呼吸 (剩餘 ${remaining} 秒)`;
        bypassBtn.style.opacity = '0.65';
        bypassBtn.style.cursor = 'not-allowed';

        const timer = setInterval(() => {
            remaining -= 1;

            if (remaining > 0) {
                bypassBtn.textContent = `強制冷靜期... 請先深呼吸 (剩餘 ${remaining} 秒)`;
                return;
            }

            clearInterval(timer);
            bypassBtn.disabled = false;
            bypassBtn.textContent = '我仍要繼續，但我知道這可能有風險';
            bypassBtn.style.opacity = '1';
            bypassBtn.style.cursor = 'pointer';
        }, 1000);
    }

    // ==========================================
    // 165 撥號：桌機顯示 modal，手機直接 tel:
    // ==========================================
    function isLikelyMobile() {
        return /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent || '');
    }

    function handleCall165(e) {
        if (isLikelyMobile()) return;

        e.preventDefault();

        if (modalPhoneNumber) {
            modalPhoneNumber.textContent = '165';
        }

        showElement(desktopModal, 'flex');
    }

    // ==========================================
    // 家人即時通知 Socket.IO
    // ==========================================
    async function setupFamilySocket() {
        if (typeof io === 'undefined') return;

        const identity = await getCurrentIdentity();
        const familyID = String(identity.familyID || 'none').toUpperCase();

        if (!familyID || familyID === 'NONE') return;

        try {
            const socket = io(getApiBaseUrl(), {
                transports: ['websocket', 'polling'],
                reconnection: true,
                reconnectionAttempts: 5,
                timeout: 6000
            });

            socket.on('connect', async () => {
                const token = await ensureAccessToken();

                socket.emit('join_family_room', {
                    familyID,
                    userID: identity.userID,
                    accessToken: token
                });
            });

            socket.on('family_urgent_broadcast', payload => {
                const msg = payload?.message || '馬上停止動作！我現在打給你！';

                if (broadcastMessage) {
                    broadcastMessage.textContent = `「${msg}」`;
                }

                showElement(familyBroadcast);
                showToast('收到家人的緊急提醒，請先停止操作。', 'error');
            });

            socket.on('emergency_alert', payload => {
                const msg = payload?.reason || '家庭防護網發出緊急提醒。';

                if (broadcastMessage) {
                    broadcastMessage.textContent = `「${msg}」`;
                }

                showElement(familyBroadcast);
            });

            socket.on('community_report_updated', payload => {
                const currentHost = normalizeHost(decodedTargetUrl);
                const reportedDomain = normalizeHost(payload?.domain || '');
                if (!currentHost || !reportedDomain || !domainMatchesHost(currentHost, reportedDomain)) return;

                renderCommunityStatus({
                    status: 'success',
                    domain: payload.domain || currentHost,
                    isReported: true,
                    reportCount: payload.reportCount || 1,
                    reviewStatus: payload.reviewStatus || 'pending',
                    autoAction: payload.autoAction || 'collecting',
                    highTrustDomain: Boolean(payload.highTrustDomain)
                }, currentHost);
            });
        } catch (e) {
            console.warn('Socket.IO 連線失敗：', e);
        }
    }

    // ==========================================
    // 詐騙情境還原聊天室
    // ==========================================
    function pickScenarioIndex() {
        const combined = `${internalReason} ${scamDNA.join(' ')}`;

        if (/投資|飆股|保證獲利|內線|股票|USDT|BTC|加密貨幣/i.test(combined)) return 0;
        if (/警察|檢察官|法院|洗錢|監管|偵查/i.test(combined)) return 1;
        if (/分期|ATM|購物|客服|解除/i.test(combined)) return 2;
        if (/包裹|海關|交友|軍醫|通關/i.test(combined)) return 3;
        if (/親友|借錢|車禍|手術/i.test(combined)) return 5;
        if (/水費|電費|瓦斯|停水|斷電|欠費/i.test(combined)) return 6;
        if (/中獎|BMW|獎金|領取/i.test(combined)) return 10;

        return Math.floor(Math.random() * Math.min(6, window.allScenarios?.length || 1));
    }

    function createAvatar(step) {
        const avatar = document.createElement('div');
        avatar.className = 'msg-avatar';

        if (step.role === 'victim') {
            avatar.classList.add('avatar-victim');
            avatar.textContent = '👤';
            return avatar;
        }

        if (step.role === 'system') {
            avatar.classList.add('avatar-scammer');

            const img = document.createElement('img');
            img.src = 'ling.png';
            img.alt = '情報女警小玲';
            img.className = 'msg-avatar img-avatar';

            return img;
        }

        avatar.classList.add('avatar-scammer');
        avatar.textContent = '🎭';
        return avatar;
    }

    function appendChatMessage(step) {
        if (!chatHistoryEl || !step) return;

        const row = document.createElement('div');
        row.className = 'msg-row ' + (step.role === 'victim' ? 'right' : 'left');

        const avatar = createAvatar(step);

        const content = document.createElement('div');
        content.className = 'msg-content';

        const name = document.createElement('div');
        name.className = 'msg-name';
        name.textContent = step.name || (step.role === 'victim' ? '我' : '可疑對方');

        const bubble = document.createElement('div');
        bubble.className = 'msg-bubble';

        if (step.role === 'victim') {
            bubble.classList.add('bubble-victim');
        } else if (step.role === 'system') {
            bubble.classList.add('bubble-system');
        } else {
            bubble.classList.add('bubble-scammer');
        }

        bubble.textContent = step.text || '';

        content.appendChild(name);
        content.appendChild(bubble);
        row.appendChild(avatar);
        row.appendChild(content);

        chatHistoryEl.appendChild(row);
        chatHistoryEl.scrollTop = chatHistoryEl.scrollHeight;
    }

    function playScenarioReplay() {
        if (!chatHistoryEl || !Array.isArray(window.allScenarios) || window.allScenarios.length === 0) {
            if (chatStatusEl) {
                chatStatusEl.textContent = '無劇本資料';
            }
            return;
        }

        const scenario = window.allScenarios[pickScenarioIndex()] || window.allScenarios[0];

        chatHistoryEl.textContent = '';

        if (chatStatusEl) {
            chatStatusEl.textContent = '播放中';
        }

        let index = 0;

        const playNext = () => {
            if (index >= scenario.length) {
                if (chatStatusEl) {
                    chatStatusEl.textContent = '還原完成';
                }
                return;
            }

            appendChatMessage(scenario[index]);
            index += 1;

            setTimeout(playNext, index === 1 ? 500 : 1300);
        };

        playNext();
    }


    function setupMascotFallback() {
        if (!mainMascot) return;

        const replaceWithFallback = () => {
            if (!mainMascot.isConnected) return;

            const fallback = document.createElement('div');
            fallback.className = 'robot-img';
            fallback.setAttribute('role', 'img');
            fallback.setAttribute('aria-label', 'AI 防詐盾牌');
            fallback.style.cssText = `
                width:min(320px,82vw);
                min-height:260px;
                display:grid;
                place-items:center;
                border-radius:32px;
                background:linear-gradient(135deg, rgba(35,136,255,.12), rgba(34,197,94,.12));
                font-size:96px;
                box-shadow:0 20px 40px rgba(35,136,255,.16);
                animation:none;
                margin-top:22px;
            `;
            fallback.textContent = '🛡️';
            mainMascot.replaceWith(fallback);
        };

        mainMascot.addEventListener('error', replaceWithFallback, { once: true });

        setTimeout(() => {
            if (!mainMascot.complete || mainMascot.naturalWidth === 0) {
                replaceWithFallback();
            }
        }, 800);
    }

    function toggleProgressiveDetail() {
        if (!detailToggleBtn || !progressiveDetail) return;

        const isOpen = progressiveDetail.classList.toggle('open');
        progressiveDetail.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
        detailToggleBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        detailToggleBtn.textContent = isOpen ? '收起詳細原因' : '查看詳細原因';
    }

    function toggleAdvancedActions() {
        if (!advancedActionsToggle || !advancedActionsPanel) return;

        const isCollapsed = advancedActionsPanel.classList.toggle('collapsed');
        const isOpen = !isCollapsed;

        advancedActionsToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        advancedActionsToggle.textContent = isOpen
            ? '收起進階處理'
            : '我確定要進階處理 / 誤判放行';
    }


    function toggleScenarioPanel() {
        if (!scenarioPanel || !scenarioToggleBtn) return;
        const isOpen = scenarioPanel.classList.toggle('open');
        scenarioToggleBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');

        if (isOpen) {
            if (!scenarioReplayStarted) {
                scenarioReplayStarted = true;
                playScenarioReplay();
            } else if (chatStatusEl && chatStatusEl.textContent === '尚未展開') {
                chatStatusEl.textContent = '已展開';
            }
        } else if (chatStatusEl) {
            chatStatusEl.textContent = '已收合';
        }
    }

    // ==========================================
    // 綁定事件
    // ==========================================
    if (scenarioToggleBtn) {
        scenarioToggleBtn.addEventListener('click', toggleScenarioPanel);
        scenarioToggleBtn.setAttribute('aria-expanded', 'false');
    }

    if (detailToggleBtn) {
        detailToggleBtn.addEventListener('click', toggleProgressiveDetail);
        detailToggleBtn.setAttribute('aria-expanded', 'false');
    }

    if (advancedActionsToggle) {
        advancedActionsToggle.addEventListener('click', toggleAdvancedActions);
        advancedActionsToggle.setAttribute('aria-expanded', 'false');
    }

    if (manualLeaveBtn) {
        let countdown = 5;
        manualLeaveBtn.textContent = `聽從建議，安全離開此網頁 (${countdown} 秒後自動撤離)`;

        const autoEvacuateTimer = setInterval(() => {
            countdown -= 1;
            
            if (countdown > 0) {
                manualLeaveBtn.textContent = `聽從建議，安全離開此網頁 (${countdown} 秒後自動撤離)`;
            } else {
                clearInterval(autoEvacuateTimer);
                navigateToSafePage();
            }
        }, 1000);

        manualLeaveBtn.addEventListener('click', () => {
            clearInterval(autoEvacuateTimer);
            navigateToSafePage();
        });
    }

    if (closeBtn) {
        closeBtn.addEventListener('click', closeCurrentTabOrSafePage);
    }

    if (continueOnceBtn) {
        continueOnceBtn.addEventListener('click', handleTemporaryAllow);
    }

    if (reportFalseBtn) {
        reportFalseBtn.addEventListener('click', openPinArea);
    }

    if (bypassBtn) {
        bypassBtn.addEventListener('click', handleTemporaryAllow);
    }

    if (familyBlockBtn) {
        familyBlockBtn.addEventListener('click', handleAddFamilyBlockDomain);
    }

    if (communityReportBtn) {
        communityReportBtn.addEventListener('click', handleReportCommunityScam);
    }

    if (communityStatusRefreshBtn) {
        communityStatusRefreshBtn.addEventListener('click', () => fetchCommunityStatus(decodedTargetUrl));
    }

    if (verifyPinBtn) {
        verifyPinBtn.addEventListener('click', handleVerifyPinAndWhitelist);
    }

    if (guardianPinInput) {
        guardianPinInput.addEventListener('keydown', e => {
            if (e.key === 'Enter') {
                handleVerifyPinAndWhitelist();
            }
        });
    }

    if (cancelPinBtn) {
        cancelPinBtn.addEventListener('click', closePinArea);
    }

    if (callBtn) {
        callBtn.addEventListener('click', handleCall165);
    }

    if (closeModalBtn) {
        closeModalBtn.addEventListener('click', () => {
            hideElement(desktopModal);
        });
    }

    if (desktopModal) {
        desktopModal.addEventListener('click', e => {
            if (e.target === desktopModal) {
                hideElement(desktopModal);
            }
        });
    }

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            hideElement(desktopModal);
            closePinArea();
        }
    });

    // ==========================================
    // 自動可信網域處理
    // 用於比賽 Demo：學校網站或 Wikipedia 被誤判時，可快速放行。
    // ==========================================
    if (decodedTargetUrl && isAutoTrustedUrl(decodedTargetUrl)) {
        try {
            await addPermanentWhitelist(decodedTargetUrl);

            const host = normalizeHost(decodedTargetUrl);

            showToast(`偵測到可信網域 ${host}，已加入個人白名單。`, 'success');
        } catch (e) {
            console.warn('自動可信網域寫入失敗：', e);
        }
    }

    // ==========================================
    // 後端白名單提示
    // ==========================================
    if (decodedTargetUrl) {
        try {
            const serverWhitelist = await checkServerWhitelist(decodedTargetUrl);

            if (serverWhitelist && serverWhitelist.isWhitelisted) {
                const match = serverWhitelist.match || {};
                const scope = match.scope || 'unknown';

                showToast(`此網域已存在於 ${scope} 白名單，可選擇返回原網站。`, 'success');
            }
        } catch (e) {
            console.warn('後端白名單檢查失敗：', e);
        }
    }

    // ==========================================
    // 初始化
    // ==========================================
    startCooldown();
    setupMascotFallback();
    if (chatStatusEl) chatStatusEl.textContent = '尚未展開';
    try {
        const identityForDetail = await getCurrentIdentity();
        renderInterceptDetail(identityForDetail);
    } catch (e) {
        renderInterceptDetail();
    }
    fetchCommunityStatus(decodedTargetUrl);
    setupFamilySocket();

    console.log('🛡️ blocked.js 已啟動', {
        riskScore,
        riskLevel,
        scamDNA,
        target: sanitizeDisplayText(decodedTargetUrl, 120)
    });
});