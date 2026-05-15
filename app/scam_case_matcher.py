# scam_case_matcher.py
# AI 防詐盾牌 - 本地詐騙案例與 URL 特徵比對器
#
# 本檔保留原本 scam_cases.json 關鍵字比對功能，並新增 URL-only 情境的輕量判斷。
# 目的：
# - 當測試資料只有真實網址、頁面文字不足時，不要全部依賴 AI。
# - 讓假登入、假客服、假領獎、免費架站釣魚頁能先被本地規則拉高風險。
# - 不把官方銀行 / 政府 / 大型平台官網誤判成詐騙。

import json
import os
import re
from functools import lru_cache
from typing import Any, Dict, List, Optional
from urllib.parse import unquote, urlparse


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CASE_DB_PATH = os.path.join(BASE_DIR, "scam_cases.json")


TRUSTED_HINT_DOMAINS = [
    "gov.tw",
    "edu.tw",
    "google.com",
    "google.com.tw",
    "line.me",
    "apple.com",
    "facebook.com",
    "momo.com.tw",
    "momoshop.com.tw",
    "pchome.com.tw",
    "shopee.tw",
    "post.gov.tw",
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
    "ctbcbank.com",
    "esunbank.com",
    "cathaybk.com.tw",
    "fubon.com",
    "fubonbank.com.tw",
    "taishinbank.com.tw",
    "megabank.com.tw",
    "firstbank.com.tw",
    "landbank.com.tw",
    "bot.com.tw",
    "hncb.com.tw",
    "tcb-bank.com.tw",
    "sinopac.com",
]


SUSPICIOUS_HOSTING_DOMAINS = [
    "pages.dev",
    "workers.dev",
    "vercel.app",
    "netlify.app",
    "web.app",
    "firebaseapp.com",
    "github.io",
    "notion.site",
    "wixsite.com",
    "weebly.com",
    "glitch.me",
    "replit.app",
    "surge.sh",
    "square.site",
    "strikingly.com",
    "godaddysites.com",
]


URL_ACTION_KEYWORDS = [
    "login", "signin", "auth", "verify", "account", "secure", "security",
    "support", "help", "payment", "pay", "billing", "refund", "claim",
    "gift", "bonus", "reward", "airdrop", "unlock", "update", "password",
    "otp", "wallet", "profile", "users", "communities", "business", "partner", "center", "mail", "email", "登入", "驗證", "認證", "付款", "退款", "領取", "解鎖",
]


BRAND_KEYWORDS = [
    "google", "line", "facebook", "meta", "instagram", "apple", "icloud",
    "momo", "pchome", "shopee", "gov", "police", "tax", "post", "bank",
    "ctbc", "fubon", "taishin", "cathay", "esun", "netflix", "amazon",
    "coinbase", "binance", "paypal", "roblox", "robiox", "steam", "t-mobile", "tmobile", "microsoft", "ms", "uphold",
]


@lru_cache(maxsize=1)
def load_scam_cases() -> List[Dict[str, Any]]:
    """
    載入本地詐騙案例庫。
    使用快取避免每次 API 請求都重新讀取 JSON。
    """

    if not os.path.exists(CASE_DB_PATH):
        print(f"[ScamCaseMatcher] 找不到詐騙案例庫：{CASE_DB_PATH}")
        return []

    try:
        with open(CASE_DB_PATH, "r", encoding="utf-8") as file:
            data = json.load(file)

        if not isinstance(data, list):
            print("[ScamCaseMatcher] scam_cases.json 格式錯誤，最外層必須是 list。")
            return []

        return data

    except Exception as error:
        print(f"[ScamCaseMatcher] 讀取詐騙案例庫失敗：{error}")
        return []


def normalize_text(text: str) -> str:
    """
    簡單正規化：
    - 移除多餘空白
    - 統一大小寫
    """
    if not isinstance(text, str):
        return ""

    return text.strip().replace(" ", "").lower()


def normalize_host(value: str) -> str:
    if not isinstance(value, str) or not value.strip():
        return ""

    raw = value.strip()
    raw = raw.replace("hxxps://", "https://").replace("hxxp://", "http://").replace("[.]", ".")
    raw = raw.replace("。", ".").replace("．", ".")

    try:
        raw = unquote(raw)
    except Exception:
        pass

    if not re.match(r"^[a-z][a-z0-9+.-]*://", raw, re.IGNORECASE):
        raw = "https://" + raw.lstrip("/")

    try:
        host = urlparse(raw).hostname or ""
        host = host.lower().strip(".")
        if host.startswith("www."):
            host = host[4:]
        return host
    except Exception:
        return ""


def domain_matches(host: str, domain: str) -> bool:
    host = normalize_host(host)
    domain = normalize_host(domain)
    return bool(host and domain and (host == domain or host.endswith("." + domain)))


def is_trusted_url(value: str) -> bool:
    host = normalize_host(value)
    return any(domain_matches(host, domain) for domain in TRUSTED_HINT_DOMAINS)


def score_url_only_risk(value: str) -> Optional[Dict[str, Any]]:
    """
    URL-only 風險輔助。
    這個函式不取代 security.py 的 domain_risk_score，只提供案例比對器可用的輕量結果。
    """
    if not isinstance(value, str) or not value.strip():
        return None

    host = normalize_host(value)
    if not host or is_trusted_url(host):
        return None

    surface = value.lower().replace("[.]", ".").replace("hxxp", "http")
    try:
        surface = unquote(surface)
    except Exception:
        pass

    compact = re.sub(r"[\s\-_.:/?=&%]+", "", surface)

    score = 0
    matched = []

    if "@" in value:
        score += 0.35
        matched.append("Userinfo 偽裝")

    if any(domain_matches(host, d) for d in SUSPICIOUS_HOSTING_DOMAINS):
        score += 0.25
        matched.append("免費架站/雲端託管")

    if any(host.endswith(tld) for tld in [".xyz", ".top", ".site", ".shop", ".vip", ".click", ".support", ".my.id"]):
        score += 0.15
        matched.append("高風險網域尾綴")

    if any(keyword in surface for keyword in URL_ACTION_KEYWORDS):
        score += 0.25
        matched.append("敏感操作字樣")

    brand_hits = [brand for brand in BRAND_KEYWORDS if brand in compact]
    if brand_hits:
        score += 0.30
        matched.append("品牌/機構字樣：" + "、".join(brand_hits[:3]))

    if len(value) >= 120:
        score += 0.10
        matched.append("網址過長")

    if re.search(r"%[0-9a-fA-F]{2}", value):
        score += 0.15
        matched.append("URL 編碼混淆")

    # 組合風險補強
    if "免費架站/雲端託管" in matched and ("敏感操作字樣" in matched or brand_hits):
        score += 0.20
        matched.append("託管平台搭配品牌/敏感操作")



    # 實戰 URL-only 補強：公開釣魚情資中常見的品牌 clone / 客服 / 付款型態。
    if re.search(r"(?:^|\.)t-mobile\.[a-z0-9-]+\.top$", host):
        score += 0.55
        matched.append("仿冒 T-Mobile 付款網域型態")

    if re.search(r"(?:^|\.)robiox\.com\.(?:ps|ua)$", host) or host == "roblox.et":
        score += 0.70
        matched.append("仿冒 Roblox 類似網域")

    if host.endswith(".github.io") and re.search(r"(netflix|amazon|clone)", surface, re.IGNORECASE):
        score += 0.45
        matched.append("GitHub Pages 品牌 clone 頁面")

    if host.endswith(".pages.dev") and re.search(r"(aicc|customer|help|contact|title|support)", surface, re.IGNORECASE):
        score += 0.45
        matched.append("Cloudflare Pages 客服/登入/標題型釣魚頁")

    if host.endswith(".vercel.app") and re.search(r"(fb|meta|blue|tick|service|verify)", surface, re.IGNORECASE):
        score += 0.45
        matched.append("Vercel 社群帳號驗證釣魚頁")

    if re.search(r"(partnercenter|dataprocessinghub|agency-ad-meta|coorporationmail|corporationmail)", surface, re.IGNORECASE):
        score += 0.60
        matched.append("商務中心、企業郵件或廣告帳號仿冒字樣")

    if re.search(r"(coinbase|uphold|authentication\.ms|speciallshop|shopssvip|paylateerr|paylater)", surface, re.IGNORECASE):
        score += 0.55
        matched.append("金融、錢包、購物或付款仿冒字樣")

    if score < 0.45 or len(matched) < 2:
        return None

    return {
        "case_id": "URL-RISK",
        "source_type": "URL-only 釣魚風險",
        "similarity_score": round(min(score, 1.0), 4),
        "matched_features": matched,
        "description": "網址本身具有釣魚頁常見特徵，雖然頁面文字不足，仍建議提高風險評估。",
        "match_count": len(matched),
        "total_keywords": 6,
    }


def find_similar_scam_case(user_text: str) -> Optional[Dict[str, Any]]:
    """
    輕量化案例比對 MVP：
    根據使用者輸入內容，比對本地詐騙案例庫中的關鍵特徵。

    回傳範例：
    {
        "case_id": "C003",
        "source_type": "假檢警 / 帳戶凍結詐騙",
        "similarity_score": 0.6364,
        "matched_features": ["偵查隊", "洗錢", "凍結", "帳戶", "檢察官", "監管", "保密"],
        "description": "...",
        "match_count": 7,
        "total_keywords": 11
    }
    """

    normalized_user_text = normalize_text(user_text)

    if not normalized_user_text:
        return None

    cases = load_scam_cases()

    best_match: Optional[Dict[str, Any]] = None
    highest_score = 0.0

    for case in cases:
        keywords = case.get("keywords", [])

        if not isinstance(keywords, list) or len(keywords) == 0:
            continue

        unique_keywords = []
        seen = set()

        for keyword in keywords:
            keyword_text = str(keyword).strip()
            normalized_keyword = normalize_text(keyword_text)

            if not normalized_keyword:
                continue

            if normalized_keyword in seen:
                continue

            seen.add(normalized_keyword)
            unique_keywords.append({
                "original": keyword_text,
                "normalized": normalized_keyword
            })

        if not unique_keywords:
            continue

        matched_features = [
            item["original"]
            for item in unique_keywords
            if item["normalized"] in normalized_user_text
        ]

        similarity_score = len(matched_features) / len(unique_keywords)

        if similarity_score > highest_score:
            highest_score = similarity_score
            best_match = {
                "case_id": case.get("id", ""),
                "source_type": case.get("type", ""),
                "similarity_score": round(similarity_score, 4),
                "matched_features": matched_features,
                "description": case.get("description", ""),
                "match_count": len(matched_features),
                "total_keywords": len(unique_keywords)
            }

    if best_match and best_match["match_count"] >= 2 and highest_score >= 0.15:
        return best_match

    # 原案例庫沒命中時，補一層 URL-only 風險判斷。
    return score_url_only_risk(user_text)


if __name__ == "__main__":
    samples = [
        "這裡是偵查隊，你的帳戶涉嫌洗錢即將凍結，請配合檢察官監管帳戶並保密。",
        "https://login-apple-verify.pages.dev/account",
        "https://www.esunbank.com/zh-tw/personal",
    ]

    for sample in samples:
        print("=" * 60)
        print(sample)
        print(find_similar_scam_case(sample))
