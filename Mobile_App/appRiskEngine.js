/*
 * 小守護防詐系統｜本機風險引擎
 * - 離線可用
 * - 支援家庭安全名單 / 使用者白名單
 * - 支援 appEvidenceSync.js 下載的動態詐騙特徵碼
 * - QA 強化：長文截斷、內網放行、動態規則上限、純字串比對避免 ReDoS
 */
(() => {
  const SAFE_LIST_KEYS = ["familySafeList", "aiShieldFamilySafeList", "userWhitelistDomains", "temporaryWhitelistDomains"];
  const DYNAMIC_RULE_KEY = "aiShieldDynamicScamRules";
  const MAX_ANALYZE_LENGTH = Number(window.CONFIG?.MAX_ANALYZE_LENGTH || 5000) || 5000;
  const MAX_DYNAMIC_RULES = Number(window.CONFIG?.MAX_DYNAMIC_RULES || 300) || 300;
  const MAX_DYNAMIC_KEYWORD_LENGTH = Number(window.CONFIG?.MAX_DYNAMIC_KEYWORD_LENGTH || 80) || 80;
  const MIN_DYNAMIC_KEYWORD_LENGTH = Number(window.CONFIG?.MIN_DYNAMIC_KEYWORD_LENGTH || 2) || 2;

  const GLOBAL_SAFE_DOMAINS = [
    "cmoney.tw",
    "finance.yahoo.com",
    "yahoo.com.tw",
    "tw.stock.yahoo.com",
    "megabank.com.tw",
    "ctbcbank.com",
    "cathaybk.com.tw",
    "fubon.com",
    "fbs.com.tw",
    "yuanta.com.tw",
    "esunbank.com",
    "gov.tw",
    "165.npa.gov.tw",
    "npa.gov.tw"
  ];

  const SCAM_RULES = [
    { label: "包裹與物流補繳詐騙", score: 55, words: ["包裹配送失敗", "補繳運費", "物流補繳", "海關扣留", "通關費", "重新配送", "逾期退回", "信用卡資料", "簡訊驗證碼", "CVV"] },
    { label: "假投資與老師帶單", score: 60, words: ["老師帶單", "飆股", "保證獲利", "穩賺不賠", "投資群組", "VIP群", "VIP飆股群", "內線消息", "主力內線", "尾盤拉抬", "尾盤策略", "當沖穩賺", "申購抽籤必中", "代操帳戶", "保本高收益", "會員名額有限", "限時進場", "USDT", "USDT入金", "加密貨幣套利", "出金保證金", "解凍費", "00981A", "00403A", "00405A", "00999A"] },
    { label: "假檢警與帳戶監管", score: 60, words: ["涉嫌洗錢", "監管帳戶", "法院通知", "檢察官", "警察局", "帳戶凍結", "不得告知家人", "偵查不公開"] },
    { label: "假客服解除分期", score: 50, words: ["解除分期", "ATM操作", "訂單異常", "重複扣款", "客服中心", "誤設會員", "退款驗證"] },
    { label: "水電與燃料費催繳詐騙", score: 45, words: ["水費逾期", "電費未繳", "欠費停水", "欠費斷電", "燃料費逾期", "eTag扣款失敗", "監理所通知", "瓦斯費逾期"] },
    { label: "假社福與點數兌換", score: 40, words: ["敬老津貼發放", "防疫補貼", "點數即將到期", "免費領取福利金", "補助金發放", "健保補助", "紓困補助"] },
    { label: "假冒知名金融機構", score: 40, words: ["元大證券線上開戶", "國泰APP升級", "國泰 App 升級", "富邦VIP專線", "台新帳戶驗證", "中信安全認證", "玉山金融驗證"] },
    { label: "釣魚頁面高壓操作", score: 35, words: ["立即處理", "逾時失效", "限時驗證", "輸入身分證", "輸入卡號", "輸入驗證碼", "帳號將停用"] },
    { label: "短網址與跳轉連結", score: 20, words: ["bit.ly", "reurl.cc", "tinyurl.com", "is.gd", "cutt.ly", "shorturl.at", "t.co/"] },
    { label: "驗證碼保密詐騙", score: 50, words: ["不要告訴家人", "不要跟家人說", "不得告知家人", "不要告訴任何人", "驗證碼", "OTP", "簡訊碼"] }
  ];

  let dynamicRulesCache = null;
  let dynamicRulesCacheRaw = "";

  function toText(value = "") { return String(value || "").trim(); }

  function normalizeSource(text = "", url = "") {
    return `${String(text || "").slice(0, MAX_ANALYZE_LENGTH)}\n${String(url || "").slice(0, 1200)}`
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeHost(value = "") {
    const raw = toText(value);
    if (!raw) return "";
    try {
      const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
      return new URL(withScheme).hostname.replace(/^www\./i, "").toLowerCase();
    } catch (e) {
      return raw.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0].split("?")[0].split("#")[0].toLowerCase();
    }
  }

  function isLocalNet(urlOrHost = "") {
    const host = normalizeHost(urlOrHost);
    if (!host) return false;
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") return true;
    if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
    if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
    if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
    return false;
  }

  function safeLocalStorageGet(key, fallback = "[]") {
    try { return localStorage.getItem(key) || fallback; } catch (e) { return fallback; }
  }

  function safeLocalStorageSet(key, value) {
    try { localStorage.setItem(key, value); return true; } catch (e) { return false; }
  }

  function loadJsonArray(key) {
    try {
      const data = JSON.parse(safeLocalStorageGet(key, "[]"));
      return Array.isArray(data) ? data : [];
    } catch (e) { return []; }
  }

  function getSafeList() {
    const set = new Set(GLOBAL_SAFE_DOMAINS.map(normalizeHost).filter(Boolean));
    SAFE_LIST_KEYS.forEach(key => {
      loadJsonArray(key).forEach(item => {
        if (typeof item === "string") set.add(normalizeHost(item));
        else if (item && typeof item === "object") set.add(normalizeHost(item.domain || item.url || item.host || ""));
      });
    });
    return Array.from(set).filter(Boolean);
  }

  function isSafeListed(urlOrText = "") {
    const host = normalizeHost(urlOrText);
    if (!host) return false;
    if (isLocalNet(host)) return true;
    return getSafeList().some(domain => host === domain || host.endsWith(`.${domain}`));
  }

  function addSafeDomain(urlOrDomain = "") {
    const domain = normalizeHost(urlOrDomain);
    if (!domain) return "";
    const current = getSafeList().filter(item => !GLOBAL_SAFE_DOMAINS.includes(item));
    const next = Array.from(new Set([...current, domain]));
    safeLocalStorageSet("familySafeList", JSON.stringify(next));
    safeLocalStorageSet("aiShieldFamilySafeList", JSON.stringify(next));
    safeLocalStorageSet("userWhitelistDomains", JSON.stringify(next));
    return domain;
  }

  function normalizeDynamicKeyword(value = "") {
    const keyword = String(value || "").trim();
    if (keyword.length < MIN_DYNAMIC_KEYWORD_LENGTH) return "";
    if (keyword.length > MAX_DYNAMIC_KEYWORD_LENGTH) return keyword.slice(0, MAX_DYNAMIC_KEYWORD_LENGTH);
    return keyword;
  }

  function getDynamicRules() {
    const raw = safeLocalStorageGet(DYNAMIC_RULE_KEY, "[]");
    if (dynamicRulesCache && dynamicRulesCacheRaw === raw) return dynamicRulesCache;

    let parsed = [];
    try {
      const value = JSON.parse(raw);
      parsed = Array.isArray(value) ? value : [];
    } catch (e) {
      parsed = [];
    }

    dynamicRulesCache = parsed.slice(0, MAX_DYNAMIC_RULES).map(rule => {
      const keyword = normalizeDynamicKeyword(rule?.keyword || rule?.pattern || rule?.text || "");
      if (!keyword) return null;
      return {
        label: String(rule.category || rule.label || "最新詐騙特徵"),
        score: Number(rule.weight || rule.score || 8) || 8,
        words: [keyword]
      };
    }).filter(Boolean);
    dynamicRulesCacheRaw = raw;
    return dynamicRulesCache;
  }

  function hasInvestmentTickerOnly(source = "") {
    const tickers = ["00981a", "00403a", "00405a", "00999a"];
    const hasTicker = tickers.some(ticker => source.includes(ticker));
    if (!hasTicker) return false;
    const scamWords = ["老師帶單", "保證獲利", "穩賺", "加入群組", "vip", "內線", "代操", "匯款", "儲值", "usdt"];
    return !scamWords.some(word => source.includes(word));
  }
  function hasSuspiciousOfficialLookalike(url = "") {
    const host = normalizeHost(url);
    if (!host) return false;
    if (isSafeListed(host)) return false;

    const officialTokens = ["gov.tw", "165", "npa", "post", "cht", "mohw", "nhia", "fsc", "esun", "cathay", "fubon", "ctbc", "yuanta"];
    const hasOfficialToken = officialTokens.some(token => host.includes(token.replace(/\./g, "")) || host.includes(token));
    const hasGovLookalike = /(^|[.-])(gov|g0v)([.-]|$)/i.test(host) || /(^|[.-])(tw[-.]?gov|gov[-.]?tw)([.-]|$)/i.test(host) || host.includes("govtw") || host.includes("twgov");
    const hasCredentialOrPaymentWord = /(^|[.-])(login|verify|auth|pay|payment|safe|secure|security|support|service|account)([.-]|$)/i.test(host);
    const riskyTld = /\.(top|xyz|shop|click|site|online|icu|bond|vip|cyou|buzz|live)$/i.test(host);
    const suspiciousShape = riskyTld || host.split(".").length >= 4 || host.includes("-") || hasCredentialOrPaymentWord;
    return (hasOfficialToken || hasGovLookalike) && suspiciousShape;
  }

  function hasSuspiciousPaymentOrCredentialDomain(url = "") {
    const host = normalizeHost(url);
    if (!host) return false;
    if (isSafeListed(host)) return false;

    const hasPaymentOrCredentialWord = /(^|[.-])(pay|payment|verify|login|auth|secure|security|account|service|support)([.-]|$)/i.test(host);
    const riskyTldOrShape = /\.(top|xyz|shop|click|site|online|icu|bond|vip|cyou|buzz|live)$/i.test(host) || host.split(".").length >= 4 || host.includes("-");
    return hasPaymentOrCredentialWord && riskyTldOrShape;
  }

  function hasHighRiskCombination(source = "") {
    const hasOtp = /驗證碼|otp|簡訊碼|認證碼/i.test(source);
    const hasSecrecy = /不要告訴|不得告知|保密|偵查不公開|不要跟家人說/i.test(source);
    const hasPayment = /信用卡|卡號|cvv|轉帳|匯款|儲值|usdt|補繳|繳費|付款|pay|payment/i.test(source);
    const hasPressure = /立即|限時|逾期|凍結|停用|失效|最後通知|馬上|立刻/i.test(source);
    const hasCredentialAction = /驗證|認證|登入|login|verify|auth|account|secure/i.test(source);
    const hasInvestmentTrap = /投資群組|老師帶單|保證獲利|穩賺|內線|vip|飆股|主力|尾盤|當沖|申購|抽籤|代操|保本|高收益/i.test(source) && /匯款|儲值|usdt|入金|加密貨幣|加入群組|下載app|會員|名額|保證金|解凍費/i.test(source);
    const hasStockScamCombo = (/老師|主力|內線|尾盤|飆股|vip/i.test(source) && /保證|穩賺|獲利|名額|群組|帶單/i.test(source)) || (/usdt|加密貨幣|入金/i.test(source) && /出金|保證金|解凍|套利|高收益/i.test(source));

    return (hasOtp && hasSecrecy) || (hasPayment && hasPressure) || (hasCredentialAction && hasPressure && /\.(top|xyz|shop|click|site|online|icu|bond|vip|cyou|buzz|live)|gov|pay|login|verify/i.test(source)) || hasInvestmentTrap || hasStockScamCombo;
  }

  function analyzeText(text = "", options = {}) {
    const url = options.url || "";
    if (url && isLocalNet(url)) {
      return { score: 0, level: "低風險", kind: "safe", reason: "此網址屬於家中或本機設備。", scamDNA: ["本地設備"], advice: "可正常使用，仍請確認這是您熟悉的設備。", safeListed: true };
    }
    if (url && isSafeListed(url)) {
      return { score: 0, level: "低風險", kind: "safe", reason: "此網域已列入安全名單。", scamDNA: ["安全名單"], advice: "可正常瀏覽，仍請保持基本警覺。", safeListed: true };
    }

    const source = normalizeSource(text, url);
    const matched = [];
    let score = 0;

    if (url && hasSuspiciousOfficialLookalike(url)) {
      matched.push({ label: "疑似官方網址仿冒", hits: [normalizeHost(url)] });
      score += 55;
    }

    if (url && hasSuspiciousPaymentOrCredentialDomain(url)) {
      matched.push({ label: "疑似假繳費或驗證網址", hits: [normalizeHost(url)] });
      score += 35;
    }

    if (hasHighRiskCombination(source)) {
      matched.push({ label: "高風險組合話術", hits: ["高壓操作與敏感資料"] });
      score += 45;
    }

    [...SCAM_RULES, ...getDynamicRules()].forEach(rule => {
      const words = Array.isArray(rule.words) ? rule.words : [];
      const hits = words.filter(word => {
        const normalizedWord = normalizeDynamicKeyword(word).toLowerCase();
        if (!normalizedWord) return false;
        if (hasInvestmentTickerOnly(source) && /^[0-9]{5}[a-z]?$/.test(normalizedWord)) return false;
        return source.includes(normalizedWord);
      });
      if (hits.length) {
        matched.push({ label: rule.label, hits });
        score += Number(rule.score || 0);
      }
    });

    score = Math.max(0, Math.min(100, score));
    const level = score >= 70 ? "高風險" : score >= 40 ? "中風險" : "低風險";
    const kind = score >= 70 ? "high" : score >= 40 ? "mid" : "low";
    const labels = matched.map(item => item.label);
    return {
      score,
      level,
      kind,
      reason: labels.length ? `命中風險特徵：${Array.from(new Set(labels)).join("、")}。` : "未命中明顯高風險特徵。",
      scamDNA: Array.from(new Set(labels)).slice(0, 8),
      advice: score >= 70 ? "請立即停止操作，不要輸入個資、信用卡、驗證碼或匯款，先問家人確認。" : score >= 40 ? "這則內容有可疑訊號，建議先問家人或查官方來源。" : "目前看起來風險較低，但仍請保持警覺。",
      matchedRules: matched
    };
  }

  function analyzeUrl(url = "", text = "") {
    return analyzeText(text || url, { url });
  }

  window.AppRiskEngine = Object.freeze({
    SCAM_RULES,
    GLOBAL_SAFE_DOMAINS,
    getSafeList,
    isLocalNet,
    isSafeListed,
    addSafeDomain,
    getDynamicRules,
    analyzeText,
    analyzeUrl
  });
})();
