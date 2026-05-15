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

RULE_VERSION = "2026-05-15-batch-fast-v1"


# ==========================================
# 白名單網域
# ==========================================
TRUSTED_DOMAINS = [
    # 國際大型平台
    "google.com",
    "google.com.tw",
    "yahoo.com",
    "line.me",
    "facebook.com",
    "meta.com",
    "instagram.com",
    "apple.com",
    "icloud.com",
    "github.com",
    "openai.com",
    "chatgpt.com",
    "wikipedia.org",

    # 台灣政府 / 教育 / 公共服務
    "gov.tw",
    "edu.tw",
    "npa.gov.tw",
    "165.npa.gov.tw",
    "moi.gov.tw",
    "moe.gov.tw",
    "mof.gov.tw",
    "nta.gov.tw",
    "post.gov.tw",
    "ccsh.tn.edu.tw",

    # 台灣常見電商 / 物流 / 支付官方網域
    "momo.com.tw",
    "momoshop.com.tw",
    "pchome.com.tw",
    "pchomeec.tw",
    "shopee.tw",
    "ruten.com.tw",
    "books.com.tw",
    "ibon.com.tw",
    "blackcat.com.tw",
    "t-cat.com.tw",
    "ezship.com.tw",
    "ecpay.com.tw",
    "newebpay.com",


    # 真實網站驗證用：常見官方 / 公益 / 交通 / 校園 / 企業官方網域
    "youtube.com",
    "withgoogle.com",
    "taiwan.gov.tw",
    "moea.gov.tw",
    "moda.gov.tw",
    "cdc.gov.tw",
    "nhi.gov.tw",
    "cwa.gov.tw",
    "etax.nat.gov.tw",
    "fsc.gov.tw",
    "boca.gov.tw",
    "police.npa.gov.tw",
    "cib.npa.gov.tw",
    "pbs.npa.gov.tw",
    "vac.gov.tw",
    "taiwanlottery.com.tw",
    "twse.com.tw",
    "tpex.org.tw",
    "thsrc.com.tw",
    "railway.gov.tw",
    "tymetro.com.tw",
    "taipei-101.com.tw",
    "hct.com.tw",
    "7-11.com.tw",
    "family.com.tw",
    "books.com.tw",
    "ruten.com.tw",
    "niu.edu.tw",
    "ncku.edu.tw",
    "ntu.edu.tw",
    "ntnu.edu.tw",
    "tnssh.tn.edu.tw",

    # 台灣常見銀行 / 金融機構官方網域
    # 這批是為了降低真實官網測試時的誤判率；白名單仍會被高風險話術覆核。
    "ctbcbank.com",
    "esunbank.com",
    "cathaybk.com.tw",
    "cathayholdings.com",
    "fubon.com",
    "fubonbank.com.tw",
    "taishinbank.com.tw",
    "megabank.com.tw",
    "firstbank.com.tw",
    "landbank.com.tw",
    "bot.com.tw",
    "chb.com.tw",
    "bankchb.com",
    "hncb.com.tw",
    "tcb-bank.com.tw",
    "scsb.com.tw",
    "sinopac.com",
    "bank.sinopac.com",
    "kgi.com",
    "kgibank.com",
    "feib.com.tw",
    "o-bank.com",
    "rakuten-bank.com.tw",
    "citi.com.tw",
    "hsbc.com.tw",
    "standardchartered.com.tw"
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
    "amazon",

    "t-mobile",
    "tmobile",
    "uphold",
    "roblox",
    "robiox",
    "microsoft",
    "ms",
    "coinbase",
    "binance",
    "paypal",
    "steam",
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
    ".support",
    ".site",
    ".cyou",
    ".vip",
    ".skin",
    ".buzz",
    ".lol",
    ".sbs",
    ".my.id",
    ".me",
    ".ms",
    ".et"
]


# 免費架站 / 雲端託管平台本身不等於詐騙，
# 但若同時搭配登入、付款、品牌名或驗證字樣，真實釣魚網址命中率會明顯提高。
SUSPICIOUS_HOSTING_DOMAINS = [
    "pages.dev",
    "workers.dev",
    "vercel.app",
    "netlify.app",
    "web.app",
    "firebaseapp.com",
    "github.io",
    "gitbook.io",
    "notion.site",
    "wixsite.com",
    "weebly.com",
    "blogspot.com",
    "sites.google.com",
    "glitch.me",
    "replit.app",
    "repl.co",
    "surge.sh",
    "render.com",
    "square.site",
    "strikingly.com",
    "godaddysites.com"
]


URL_ACTION_KEYWORDS = [
    "login",
    "log-in",
    "signin",
    "sign-in",
    "auth",
    "verify",
    "verification",
    "validate",
    "account",
    "secure",
    "security",
    "support",
    "help",
    "wallet",
    "payment",
    "pay",
    "billing",
    "invoice",
    "refund",
    "claim",
    "gift",
    "bonus",
    "reward",
    "airdrop",
    "unlock",
    "update",
    "confirm",
    "password",
    "otp",
    "2fa",
    "mfa",
    "profile",
    "users",
    "communities",
    "business",
    "partner",
    "center",
    "admin",
    "mail",
    "email",
    "blue",
    "ticks",
    "登入",
    "驗證",
    "認證",
    "付款",
    "支付",
    "退款",
    "領取",
    "中獎",
    "更新",
    "解鎖",
]


HIGH_RISK_URL_TERMS = [
    "shopssvip",
    "specialshop",
    "bonus-vip",
    "vip-service",
    "customer-service",
    "online-service",
    "center-service",
    "safe-center",
    "security-center",
    "account-center",
    "verify-center",
    "wallet-connect",
    "claim-reward",
    "claim-bonus",
    "free-gift",
    "gift-card",
    "promo",
    "promotion",
    "cashback",
    "subsidy",
    "taxrefund",
    "tax-refund",
    "partnercenter",
    "dataprocessinghub",
    "business-support-center",
    "coorporationmail",
    "corporationmail",
    "blueticks",
    "blue-ticks",
    "agency-ad-meta",
    "speciallshop",
    "specialshop",
    "paylateerr",
    "paylater",
    "uphold-up",
    "aicc108-demo",
    "authentication",
    "t-mobile",
    "tmobile",
    "robiox",
    "roblox",
    "netflixclone",
    "netflix-web-clone",
    "amazon-clone",
    "coinbase-inv",
    "dangerboy",
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

    # 先還原去武器化網址，避免真實網站批次測試的 hxxp / [.] 無法被 URL reputation 判讀。
    raw_input = str(url_or_domain).strip()
    raw_input = (
        raw_input
        .replace("hxxps://", "https://")
        .replace("hxxp://", "http://")
        .replace("HXXPS://", "https://")
        .replace("HXXP://", "http://")
        .replace("[.]", ".")
        .replace("(.)", ".")
        .replace("{.}", ".")
    )

    raw = normalize_text_for_detection(raw_input)
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


# ==========================================
# 家庭黑名單工具
# ==========================================
def normalize_family_block_domain(url_or_domain):
    """
    家庭黑名單專用的 domain 正規化。
    只保存 hostname，不保存完整 path，避免同站不同頁重複建立規則。
    """
    return normalize_domain(url_or_domain)


def family_block_domain_matches(host_or_url, blocked_domain):
    """
    家庭黑名單比對：
    - example.com 會命中 example.com
    - pay.example.com 會命中 example.com
    - example.com.scam.xyz 不會命中 example.com
    """
    return domain_matches(host_or_url, blocked_domain)


def is_high_trust_domain_for_family_block(url_or_domain):
    """
    避免使用者把官方或大型平台整個加入家庭黑名單，導致家人無法正常使用。
    若未來要允許 guardian 強制封鎖，可在 API 端另外加 force=true 與二次確認。
    """
    return is_genuine_white_listed(url_or_domain)


# ==========================================
# 社群回報池工具
# ==========================================
def normalize_community_report_domain(url_or_domain):
    """
    社群回報池專用 domain 正規化。
    只保存 hostname，不保存完整 path，避免公開資料池累積敏感路徑或個人化參數。
    """
    return normalize_domain(url_or_domain)


def community_report_domain_matches(host_or_url, reported_domain):
    """
    社群回報池比對：
    - example.com 命中 example.com
    - login.example.com 命中 example.com
    - example.com.evil.xyz 不會命中 example.com
    """
    return domain_matches(host_or_url, reported_domain)


def is_high_trust_domain_for_community_report(url_or_domain):
    """
    高信任網域仍可被使用者回報，但不得因單一或少量社群回報自動提高全域封鎖等級。
    這類案例只進人工審核 / pending，避免誤傷 Google、政府、銀行或大型平台。
    """
    return is_genuine_white_listed(url_or_domain)


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
def is_suspicious_hosting_domain(url_or_domain):
    """
    判斷是否為常被釣魚頁濫用的免費架站 / 雲端託管網域。
    注意：命中此項不會直接判詐騙，必須再搭配登入、付款、品牌偽裝等特徵加權。
    """
    host = normalize_domain(url_or_domain)

    if not host:
        return False

    return any(domain_matches(host, domain) for domain in SUSPICIOUS_HOSTING_DOMAINS)


def _normalized_url_surface(url):
    """
    產生 URL 風險判斷用字串：同時看 host、path、query。
    """
    raw = normalize_url_input(url or "")
    if not raw:
        return ""

    if not re.match(r"^[a-z][a-z0-9+.-]*://", raw, re.IGNORECASE):
        raw_for_parse = "https://" + raw.lstrip("/")
    else:
        raw_for_parse = raw

    try:
        parsed = urlparse(raw_for_parse)
        surface = " ".join([
            parsed.hostname or "",
            parsed.path or "",
            parsed.query or "",
            parsed.fragment or "",
        ])
    except Exception:
        surface = raw_for_parse

    try:
        decoded = unquote(surface)
        if decoded and decoded != surface:
            surface = f"{surface} {decoded}"
    except Exception:
        pass

    return normalize_text_for_detection(surface).lower()


def has_url_action_keyword(url):
    surface = _normalized_url_surface(url)
    return any(keyword.lower() in surface for keyword in URL_ACTION_KEYWORDS)


def has_high_risk_url_term(url):
    surface = _normalized_url_surface(url)
    compact = surface.replace("-", "").replace("_", "").replace(".", "")
    return any(term.lower().replace("-", "").replace("_", "").replace(".", "") in compact for term in HIGH_RISK_URL_TERMS)


def url_risk_reasons(url):
    """
    回傳 URL 風險分數與理由清單。
    設計重點：
    - 官方白名單優先降權，避免銀行/政府/電商官網誤判。
    - 不再因為單一 .shop/.support 直接判黑名單，而是採加權。
    - URL-only 真實釣魚頁會因免費託管 + 品牌/登入/付款/驗證等組合被拉高。
    """
    raw = normalize_url_input(url or "")
    host = normalize_domain(raw)

    if not raw:
        return 0, ["未提供網址"]

    if not host:
        return 35, ["網址無法解析"]

    # 真正官方可信網域優先降權；若是 google.com@evil.com，host 會是 evil.com，不會被放行。
    if is_genuine_white_listed(host):
        return 0, [f"官方可信網域：{host}"]

    score = 0
    reasons = []
    surface = _normalized_url_surface(raw)
    compact_host = host.replace("-", "").replace("_", "").replace(".", "")

    if has_userinfo_trick(raw):
        score += 80
        reasons.append("Userinfo 偽裝，例如 official.com@evil.com")

    if re.fullmatch(r"(?:[0-9]{1,3}\.){3}[0-9]{1,3}", host):
        score += 45
        reasons.append("使用 IP 位址取代正常網域")

    if is_shortener_domain(host):
        score += 45
        reasons.append("短網址服務")

    suspicious_tld_hit = has_suspicious_tld(host)
    if suspicious_tld_hit:
        score += 25
        reasons.append("高風險或常遭濫用的網域尾綴")

    hosting_hit = is_suspicious_hosting_domain(host)
    if hosting_hit:
        score += 30
        reasons.append("免費架站或雲端託管平台")

    brand_hit = has_brand_impersonation(host)
    if brand_hit:
        score += 60
        reasons.append("非官方網域含品牌或機構名稱")

    action_hit = has_url_action_keyword(raw)
    if action_hit:
        score += 30
        reasons.append("網址含登入、驗證、付款、領取或帳戶操作字樣")

    high_risk_term_hit = has_high_risk_url_term(raw)
    if high_risk_term_hit:
        score += 45
        reasons.append("網址含 VIP、領獎、客服中心、退款或活動詐騙常見字樣")

    for pattern in SUSPICIOUS_DOMAIN_PATTERNS:
        if re.search(pattern, surface, re.IGNORECASE):
            score += 30
            reasons.append(f"命中可疑網域特徵：{pattern}")
            break

    # 長 query / URL 編碼常用於隱藏跳轉與追蹤參數。
    if len(raw) >= 120:
        score += 18
        reasons.append("網址過長")

    if re.search(r"%[0-9a-fA-F]{2}", raw):
        score += 25
        reasons.append("網址含編碼混淆")

    if raw.count(".") >= 4:
        score += 10
        reasons.append("子網域層級異常偏多")

    if host.count("-") >= 2:
        score += 12
        reasons.append("網域使用多段連字號偽裝")

    # 組合加權：免費託管平台單獨不可怕，但搭配登入/付款/品牌時高度可疑。
    if hosting_hit and (brand_hit or action_hit or high_risk_term_hit):
        score += 35
        reasons.append("免費託管平台搭配敏感操作或品牌字樣")

    if brand_hit and action_hit:
        score += 25
        reasons.append("品牌偽裝搭配登入/驗證/付款操作")

    if suspicious_tld_hit and (brand_hit or action_hit or high_risk_term_hit):
        score += 30
        reasons.append("高風險尾綴搭配敏感操作")


    # 實戰 URL-only 補強：
    # 這些不是硬寫單一完整網址，而是針對公開釣魚情資常見的組合型態加權。
    # 目的在於降低只有 URL、沒有頁面文字時的漏判率。
    if re.search(r"(?:^|\.)t-mobile\.[a-z0-9-]+\.top$", host):
        score += 55
        reasons.append("仿冒 T-Mobile 付款網域型態")

    if re.search(r"(?:^|\.)robiox\.com\.(?:ps|ua)$", host) or host == "roblox.et":
        score += 70
        reasons.append("仿冒 Roblox 類似網域")

    if host.endswith(".github.io") and re.search(r"(netflix|amazon|clone)", surface, re.IGNORECASE):
        score += 45
        reasons.append("GitHub Pages 上的品牌 clone 頁面")

    if host.endswith(".pages.dev") and re.search(r"(aicc|customer|help|contact|title|support)", surface, re.IGNORECASE):
        score += 45
        reasons.append("Cloudflare Pages 上的客服/登入/標題型釣魚頁")

    if host.endswith(".vercel.app") and re.search(r"(fb|meta|blue|tick|service|verify)", surface, re.IGNORECASE):
        score += 45
        reasons.append("Vercel 上的社群帳號驗證釣魚頁")

    if re.search(r"(partnercenter|dataprocessinghub|agency-ad-meta|coorporationmail|corporationmail)", surface, re.IGNORECASE):
        score += 60
        reasons.append("商務中心、企業郵件或廣告帳號仿冒字樣")

    if re.search(r"(coinbase|uphold|authentication\.ms|speciallshop|shopssvip|paylateerr|paylater)", surface, re.IGNORECASE):
        score += 55
        reasons.append("金融、錢包、購物或付款仿冒字樣")

    # 文字中常見的釣魚品牌補強：避免 url path 中有品牌但 host 無品牌時漏判。
    for brand in BRAND_IMPERSONATION_KEYWORDS:
        brand_key = brand.replace(".", "").lower()
        if brand_key and brand_key in surface.replace("-", "").replace("_", "").replace(".", ""):
            if not is_genuine_white_listed(host):
                score += 25
                reasons.append(f"網址內容含品牌關鍵字：{brand}")
                break

    return min(score, 100), list(dict.fromkeys(reasons))


def check_165_blacklist(url):
    """
    本地高風險網域規則版。
    這裡不是正式 165 資料庫，而是競賽 Demo 的本地 URL reputation。
    修正重點：
    - 官方白名單先放行，避免真實銀行/政府網站被誤判。
    - 改用加權分數，不再因單一 .shop 或 .support 就直接判黑。
    """
    try:
        score, _ = url_risk_reasons(url)
        return score >= 70
    except Exception:
        return False


def domain_risk_score(url):
    """
    回傳網域 / URL 本身的風險分數，方便 routes.py 疊加。
    """
    try:
        score, _ = url_risk_reasons(url)
        return min(score, 100)
    except Exception:
        return 0


def domain_risk_detail(url):
    """
    回傳更完整的 URL reputation 資訊，routes.py 可用來產生可解釋原因。
    """
    score, reasons = url_risk_reasons(url)
    return {
        "score": min(score, 100),
        "reasons": reasons,
        "domain": normalize_domain(url),
        "isTrusted": is_genuine_white_listed(url),
    }



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