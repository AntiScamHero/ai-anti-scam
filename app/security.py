# security.py
# AI 防詐盾牌 - 安全工具模組（保留原功能優化版）
#
# 功能：
# 1. URL / Domain 正規化
# 2. 白名單精準比對
# 3. 白名單高風險覆寫判斷
# 4. 個資遮蔽：手機、身分證、信用卡、Email、銀行帳號、加密貨幣地址
# 5. 釣魚網域 / 偽裝網域 / 短網址 / Userinfo 攻擊判斷
# 6. 產生安全 Firebase key 與 URL hash
#
# 注意：
# 白名單不是免死金牌。
# 如果白名單網站內出現匯款、驗證碼、保證獲利、解除分期等高風險話術，
# 後端 routes.py 應重新提高風險，而不是直接放行。

import base64
import hashlib
import re
from urllib.parse import unquote, urlparse


# ==========================================
# 白名單網域
# ==========================================
TRUSTED_DOMAINS = [
    "google.com",
    "yahoo.com",
    "gov.tw",
    "line.me",
    "facebook.com",
    "apple.com",
    "momo.com.tw",
    "momoshop.com.tw",
    "pchome.com.tw",
    "shopee.tw",
    "github.com",
    "openai.com",
    "chatgpt.com",
    "wikipedia.org",
    "ccsh.tn.edu.tw"
]


# ==========================================
# 白名單高風險覆寫
# ==========================================
HIGH_RISK_WHITELIST_OVERRIDE_PATTERNS = [
    r"保證獲利",
    r"穩賺不賠",
    r"無風險.*投資",
    r"保本保息",
    r"固定配息",
    r"月報酬",
    r"日獲利",
    r"內線消息",
    r"內部消息",
    r"飆股",
    r"明牌",
    r"老師帶單",
    r"VIP.*群",
    r"加賴",
    r"加LINE",
    r"加\s*LINE",
    r"加\s*賴",
    r"解凍金",
    r"保證金",
    r"手續費",
    r"通關費",
    r"稅金.*領取",
    r"中獎.*領取",
    r"限時.*領取",
    r"逾期.*放棄",
    r"殺豬盤",
    r"不准報警",
    r"不能.*告訴.*家人",
    r"不能.*告訴.*銀行",
    r"斷手斷腳",
    r"你.*涉嫌",
    r"洗錢",
    r"法院公證人",
    r"偵查不公開",
    r"監管帳戶",
    r"解除分期",
    r"取消分期",
    r"ATM.*取消",
    r"ATM.*解除",
    r"輸入.*身分證",
    r"輸入.*信用卡",
    r"輸入.*驗證碼",
    r"提供.*驗證碼",
    r"提款卡.*密碼",
    r"寄.*提款卡",
    r"下載.*APK",
    r"下載.*APP",
    r"請匯款",
    r"匯到指定",
    r"指定帳戶",
    r"虛擬貨幣",
    r"USDT",
    r"BTC",
    r"ETH"
]


# ==========================================
# 可疑網域特徵
# ==========================================
SUSPICIOUS_DOMAIN_PATTERNS = [
    r"verify-login",
    r"login-verify",
    r"account-verify",
    r"id-verify",
    r"security-check",
    r"line-id",
    r"claim",
    r"bonus",
    r"lucky",
    r"money",
    r"reward",
    r"gift",
    r"coupon",
    r"gov-tw",
    r"govtw",
    r"tax-refund",
    r"subsidy",
    r"refund",
    r"police",
    r"npa",
    r"court",
    r"prosecutor",
    r"banking",
    r"bank-login",
    r"secure-banking",
    r"ctbc",
    r"fubon",
    r"taishin",
    r"cathay",
    r"esun",
    r"apple-id",
    r"icloud-verify",
    r"system-update",
    r"update-system",
    r"parcel",
    r"delivery",
    r"shipping",
    r"payment",
    r"pay",
    r"security"
]


# ==========================================
# 高風險品牌偽裝關鍵字
# ==========================================
BRAND_IMPERSONATION_KEYWORDS = [
    "google",
    "yahoo",
    "line",
    "facebook",
    "meta",
    "instagram",
    "apple",
    "icloud",
    "momo",
    "pchome",
    "shopee",
    "gov",
    "police",
    "npa",
    "tax",
    "bank",
    "ctbc",
    "fubon",
    "taishin",
    "cathay",
    "esun",
    "post",
    "parcel",
    "netflix",
    "spotify",
    "amazon"
]


SHORTENER_DOMAINS = [
    "bit.ly",
    "tinyurl.com",
    "reurl.cc",
    "shorturl.at",
    "is.gd",
    "t.co",
    "goo.gl",
    "ow.ly",
    "cutt.ly",
    "buff.ly",
    "rb.gy"
]


SUSPICIOUS_TLDS = [
    ".xyz",
    ".top",
    ".click",
    ".claim",
    ".cc",
    ".biz",
    ".info",
    ".monster",
    ".shop",
    ".icu",
    ".live",
    ".work",
    ".support"
]


ZERO_WIDTH_REGEX = re.compile(r"[\u200B\u200C\u200D\uFEFF]")


# ==========================================
# 字元正規化
# ==========================================
def to_half_width(text):
    """
    將全形英數與常見全形符號轉成半形。
    """
    if not text:
        return ""

    table = str.maketrans(
        "０１２３４５６７８９"
        "ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺ"
        "ａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ"
        "：／．＠－＿",
        "0123456789"
        "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
        "abcdefghijklmnopqrstuvwxyz"
        ":/.@-_"
    )

    return str(text).translate(table)


def clean_invisible_chars(text):
    if not text:
        return ""

    return ZERO_WIDTH_REGEX.sub("", str(text))


def normalize_text_for_detection(text):
    """
    給規則偵測用的文字正規化：
    - 全形轉半形
    - 去零寬字元
    - 統一大小寫
    """
    if not text:
        return ""

    value = to_half_width(str(text))
    value = clean_invisible_chars(value)
    return value


# ==========================================
# URL / Domain 正規化
# ==========================================
def normalize_url_input(url_or_domain):
    """
    將輸入的 URL / domain 做基本正規化。
    可處理：
    - URL encoding
    - 全形網址
    - 中文句點
    - 零寬字元
    - 反斜線
    """
    if not url_or_domain:
        return ""

    raw = normalize_text_for_detection(str(url_or_domain).strip())
    raw = raw.replace("。", ".")
    raw = raw.replace("．", ".")
    raw = raw.replace("\\", "/")

    try:
        decoded = unquote(raw)
        if decoded and decoded != raw:
            raw = decoded
    except Exception:
        pass

    return raw.strip()


def normalize_domain(url_or_domain):
    """
    將 URL 或 domain 正規化成 hostname。
    可處理：
    - https://www.example.com/path
    - www.example.com
    - example.com
    - 中文句點「。」
    - 全形網址
    - URL encoding
    - IDN / punycode
    - Userinfo 偽裝，例如 https://google.com@evil.com
    """
    if not url_or_domain:
        return ""

    raw = normalize_url_input(url_or_domain).lower()

    if not raw:
        return ""

    if not re.match(r"^[a-z][a-z0-9+.-]*://", raw):
        raw = "https://" + raw.lstrip("/")

    try:
        parsed = urlparse(raw)
        host = parsed.hostname or ""
        host = host.strip(".").lower()

        if host.startswith("www."):
            host = host[4:]

        try:
            host = host.encode("idna").decode("ascii")
        except Exception:
            pass

        return host

    except Exception:
        return ""


def get_registered_like_parts(host):
    """
    簡易切割 domain parts。
    不取代 publicsuffix list，但可供本專案規則判斷使用。
    """
    host = normalize_domain(host)

    if not host:
        return []

    return [part for part in host.split(".") if part]


def domain_matches(host, domain):
    """
    精準白名單比對：
    - google.com 命中 google.com
    - mail.google.com 命中 google.com
    - google.com.scam.xyz 不會命中 google.com
    """
    host = normalize_domain(host)
    domain = normalize_domain(domain)

    if not host or not domain:
        return False

    return host == domain or host.endswith("." + domain)


def is_shortener_domain(url_or_domain):
    host = normalize_domain(url_or_domain)

    if not host:
        return False

    return any(domain_matches(host, domain) for domain in SHORTENER_DOMAINS)


def has_suspicious_tld(url_or_domain):
    host = normalize_domain(url_or_domain)

    if not host:
        return False

    return any(host.endswith(tld) for tld in SUSPICIOUS_TLDS)


def has_userinfo_trick(url_or_domain):
    """
    偵測 https://google.com@evil.com 這種 Userinfo 偽裝。
    """
    if not url_or_domain:
        return False

    raw = normalize_url_input(url_or_domain)

    if not re.match(r"^[a-z][a-z0-9+.-]*://", raw, re.IGNORECASE):
        raw = "https://" + raw.lstrip("/")

    try:
        parsed = urlparse(raw)
        return bool(parsed.username or parsed.password)
    except Exception:
        return False


def has_brand_impersonation(url_or_domain):
    """
    偵測品牌字樣出現在非官方網域。
    例如：
    - google-security-login.xyz
    - apple-id-verify.com
    - gov-tw-subsidy.info
    """
    host = normalize_domain(url_or_domain)

    if not host:
        return False

    if is_genuine_white_listed(host):
        return False

    compact_host = host.replace("-", "").replace("_", "").replace(".", "")

    for brand in BRAND_IMPERSONATION_KEYWORDS:
        if brand.replace(".", "") in compact_host:
            return True

    return False


def safe_domain_key(domain):
    """
    Firebase key 安全化。
    """
    domain = normalize_domain(domain)

    if not domain:
        return "unknown"

    return re.sub(r"[^a-zA-Z0-9_-]", "_", domain)[:160]


def hash_url(url):
    if not url:
        return ""

    return hashlib.sha256(
        str(url).strip().encode("utf-8", errors="ignore")
    ).hexdigest()


# ==========================================
# 個資遮蔽
# ==========================================
def mask_sensitive_data(text):
    """
    個資脫敏：
    - 手機
    - 身分證
    - 信用卡
    - Email
    - 銀行帳號
    - BTC / ETH 錢包地址
    - 全形數字 / 字母
    - 零寬字元
    """
    if not text:
        return ""

    cleaned_text = normalize_text_for_detection(str(text))

    noise = r"[\s\.\-•\*\_\|/\\:()\[\]{}📞☎️💳✉️]*"

    # 手機號碼：0912-345-678 / 0 9 1 2 ...
    phone_regex = re.compile(
        r"0" + noise + r"9" + noise + r"(?:\d" + noise + r"){8}"
    )
    cleaned_text = phone_regex.sub("[手機號碼已隱藏]", cleaned_text)

    # 身分證：A123456789 / A.1.2...
    id_regex = re.compile(
        r"[A-Za-z]" + noise + r"[12]" + noise + r"(?:\d" + noise + r"){8}"
    )

    def id_replacer(match):
        start_idx = match.start()
        context_before = cleaned_text[max(0, start_idx - 12):start_idx]

        safe_context_keywords = [
            "型號",
            "編號",
            "序號",
            "代碼",
            "訂單",
            "商品",
            "產品",
            "ID"
        ]

        if any(keyword in context_before for keyword in safe_context_keywords):
            return match.group(0)

        return "[身分證已隱藏]"

    cleaned_text = id_regex.sub(id_replacer, cleaned_text)

    # 信用卡：13-19 位較常見，保守遮蔽 13-19 位連續或混合符號
    cc_regex = re.compile(r"(?:\d" + noise + r"){12,18}\d")
    cleaned_text = cc_regex.sub("[信用卡號已隱藏]", cleaned_text)

    # Email
    email_regex = re.compile(
        r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}"
    )
    cleaned_text = email_regex.sub("[Email已隱藏]", cleaned_text)

    # 中文數字手機：零九一二三四五六七八
    cn_phone_regex = re.compile(r"零九[〇零一二三四五六七八九]{6,}")
    cleaned_text = cn_phone_regex.sub("[手機號碼已隱藏]", cleaned_text)

    # 銀行帳號：常見格式 012-3456789-01、822-1234567890
    bank_account_regex = re.compile(
        r"\b\d{3}" + noise + r"(?:\d" + noise + r"){6,14}\d\b"
    )

    def bank_replacer(match):
        value = match.group(0)
        digits = re.sub(r"\D", "", value)

        # 避免把短日期或一般年份誤判，至少 9 碼才遮
        if len(digits) >= 9:
            return "[銀行帳號已隱藏]"

        return value

    cleaned_text = bank_account_regex.sub(bank_replacer, cleaned_text)

    # BTC address
    btc_regex = re.compile(r"\b(?:bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}\b", re.IGNORECASE)
    cleaned_text = btc_regex.sub("[加密貨幣地址已隱藏]", cleaned_text)

    # ETH address
    eth_regex = re.compile(r"\b0x[a-fA-F0-9]{40}\b")
    cleaned_text = eth_regex.sub("[加密貨幣地址已隱藏]", cleaned_text)

    return cleaned_text


# ==========================================
# 白名單判斷
# ==========================================
def is_genuine_white_listed(url):
    """
    檢查是否為真實白名單網域。
    注意：這只檢查網域，不代表內容完全安全。
    """
    host = normalize_domain(url)

    if not host:
        return False

    return any(domain_matches(host, domain) for domain in TRUSTED_DOMAINS)


def has_high_risk_whitelist_override(text="", url=""):
    """
    白名單不是免死金牌。
    如果白名單網站內仍出現重大詐騙特徵，就必須重新警告。
    """
    combined = normalize_text_for_detection(f"{text or ''} {url or ''}")

    return any(
        re.search(pattern, combined, re.IGNORECASE)
        for pattern in HIGH_RISK_WHITELIST_OVERRIDE_PATTERNS
    )


# ==========================================
# 釣魚網域 / 黑名單特徵
# ==========================================
def check_165_blacklist(url):
    """
    本地高風險網域規則版。
    正式版可再接：
    - 165 官方公開資料
    - Google Safe Browsing
    - Cloudflare Radar / DNS reputation
    """
    if not url:
        return False

    try:
        raw = normalize_url_input(url)
        host = normalize_domain(raw)

        if not host:
            return True

        if has_userinfo_trick(raw):
            return True

        if is_shortener_domain(host):
            return True

        if has_suspicious_tld(host):
            return True

        if has_brand_impersonation(host):
            return True

        for pattern in SUSPICIOUS_DOMAIN_PATTERNS:
            if re.search(pattern, host, re.IGNORECASE):
                return True

        return False

    except Exception:
        return False


def domain_risk_score(url):
    """
    回傳網域本身的風險分數，方便 routes.py 疊加。
    """
    if not url:
        return 0

    score = 0
    host = normalize_domain(url)

    if not host:
        return 30

    if is_genuine_white_listed(host):
        return 0

    if has_userinfo_trick(url):
        score += 45

    if is_shortener_domain(host):
        score += 35

    if has_suspicious_tld(host):
        score += 25

    if has_brand_impersonation(host):
        score += 45

    if check_165_blacklist(url):
        score += 35

    if re.search(r"\d+\.\d+\.\d+\.\d+", host):
        score += 20

    return min(score, 100)


# ==========================================
# 編碼 / 混淆輔助
# ==========================================
def try_decode_base64_text(text):
    """
    嘗試解 Base64。
    只作為輔助，不保證每個 Base64 都是文字。
    """
    if not text:
        return ""

    value = str(text).strip()

    if len(value) < 12:
        return ""

    if not re.fullmatch(r"[A-Za-z0-9+/=\s]+", value):
        return ""

    try:
        padded = value + "=" * (-len(value) % 4)
        decoded = base64.b64decode(padded, validate=False)
        return decoded.decode("utf-8", errors="ignore")
    except Exception:
        return ""


def reverse_text_if_suspicious(text):
    """
    偵測反轉中文詐騙文字。
    例如：取領擊點請，萬001得獲您
    """
    if not text:
        return ""

    value = normalize_text_for_detection(text)

    reversed_text = value[::-1]

    risk_words = [
        "中獎",
        "領取",
        "點擊",
        "匯款",
        "驗證",
        "獎金",
        "保證獲利"
    ]

    if any(word in reversed_text for word in risk_words):
        return reversed_text

    return ""


def expand_detection_text(text):
    """
    給 AI 或規則判斷前使用：
    將原文、URL decode、Base64 decode、反轉文字整合。
    """
    if not text:
        return ""

    normalized = normalize_text_for_detection(text)
    variants = [normalized]

    try:
        decoded = unquote(normalized)
        if decoded and decoded != normalized:
            variants.append(decoded)
    except Exception:
        pass

    b64 = try_decode_base64_text(normalized)
    if b64:
        variants.append(b64)

    reversed_text = reverse_text_if_suspicious(normalized)
    if reversed_text:
        variants.append(reversed_text)

    return "\n".join(dict.fromkeys(variants))


# ==========================================
# 本機快速測試
# ==========================================
if __name__ == "__main__":
    samples = [
        "我的電話是 0912-345-678",
        "身分證 A123456789",
        "產品型號 A123456789",
        "卡號 4311-1111-2222-3333",
        "Email: test@gmail.com",
        "手機 ０９１２３４５６７８",
        "請匯款至 012-3456789-01",
        "https://www.google.com@evil.com",
        "https://security.google.com.scam-site.xyz",
        "https://apple-id-verify.xyz"
    ]

    for item in samples:
        print("=" * 60)
        print("原始：", item)
        print("host：", normalize_domain(item))
        print("遮蔽：", mask_sensitive_data(item))
        print("白名單：", is_genuine_white_listed(item))
        print("黑名單：", check_165_blacklist(item))
        print("domain_score：", domain_risk_score(item))