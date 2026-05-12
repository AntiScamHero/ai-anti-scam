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

    const manualLeaveBtn = document.getElementById('manual-leave-btn');
    const closeBtn = document.getElementById('close-btn');
    const continueOnceBtn = document.getElementById('continue-once-btn');
    const reportFalseBtn = document.getElementById('report-false-btn');
    const bypassBtn = document.getElementById('bypass-btn');

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
    let scenarioReplayStarted = false;


    function appendTextBlock(parent, className, text) {
        const div = document.createElement('div');
        if (className) div.className = className;
        div.textContent = String(text || '');
        parent.appendChild(div);
        return div;
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
        window.location.href = 'https://www.google.com';
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

    if (manualLeaveBtn) {
        manualLeaveBtn.addEventListener('click', navigateToSafePage);
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
    if (chatStatusEl) chatStatusEl.textContent = '尚未展開';
    setupFamilySocket();

    console.log('🛡️ blocked.js 已啟動', {
        riskScore,
        riskLevel,
        scamDNA,
        target: sanitizeDisplayText(decodedTargetUrl, 120)
    });
});