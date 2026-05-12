# routes.py
# AI 防詐盾牌 - Flask API 路由模組（保留原功能優化版）
#
# 功能：
# 1. /scan：核心掃描 API
# 2. /api/auth/install：安裝身分與短效 token
# 3. /api/create_family：建立家庭防護群組
# 4. /api/join_family：加入家庭防護群組
# 5. /api/get_alerts：讀取家庭戰情紀錄
# 6. /api/clear_alerts：清空家庭戰情紀錄
# 7. /api/submit_evidence：前端攔截證據摘要
# 8. /api/get_evidence：讀取證據快照
# 9. /api/report_false_positive：誤判回報與白名單修正
# 10. /api/whitelist/check：分層白名單查詢
# 11. /api/simulate_scam：防詐演練串流
# 12. /callback：LINE Webhook
#
# 注意：
# - 正式上線建議 REQUIRE_EXTENSION_SECRET=false，改用短效 Bearer token。
# - Demo 可維持不強制驗證，避免 Chrome Extension 前端硬放固定密鑰。
# - 白名單不是免死金牌；白名單網站若出現匯款、驗證碼、解除分期、保證獲利等高風險話術，仍會覆核。

import base64
import datetime
import hashlib
import hmac
import html
import json
import os
import random
import re
import string
import time
import urllib.parse
from urllib.parse import urlparse

import requests
from dotenv import load_dotenv
from firebase_admin import db
from flask import Blueprint, Response, jsonify, request
from werkzeug.exceptions import HTTPException

from linebot.v3 import WebhookHandler
from linebot.v3.exceptions import InvalidSignatureError
from linebot.v3.messaging import (
    ApiClient,
    ButtonsTemplate,
    Configuration,
    MessagingApi,
    PostbackAction,
    PushMessageRequest,
    ReplyMessageRequest,
    TemplateMessage,
    TextMessage,
)
from linebot.v3.webhooks import MessageEvent, PostbackEvent, TextMessageContent

from ai_service import analyze_risk_with_ai, stream_scam_simulation
from extensions import firebase_initialized, limiter, socketio
from security import (
    TRUSTED_DOMAINS,
    check_165_blacklist,
    hash_url,
    has_high_risk_whitelist_override,
    is_genuine_white_listed,
    mask_sensitive_data,
    normalize_domain,
    safe_domain_key,
)

try:
    from security import domain_risk_score, expand_detection_text
except Exception:
    domain_risk_score = None
    expand_detection_text = None

from scamdna_engine import analyze_with_scamdna, is_scamdna_safe_context, should_trust_official_without_block

load_dotenv()

api_bp = Blueprint("api", __name__)

last_alert_time = {}
last_line_alert_time = {}

# ==========================================
# 第一名競賽優化：統一評分 / Demo 保底 / 可解釋輸出
# ==========================================
DEMO_MODE = str(os.getenv("AI_SHIELD_DEMO_MODE", "false")).strip().lower() in {"1", "true", "yes", "on"}
SCORING_VERSION = "first-place-v1"
SCORE_WEIGHTS = {"rules": 0.60, "behavior": 0.20, "ai": 0.20}


def explain_from_report(report, max_items=5):
    if not isinstance(report, dict):
        return []

    existing = report.get("explain") or report.get("explanation") or []
    if isinstance(existing, str):
        existing = [existing]
    items = [str(x).strip() for x in existing if str(x).strip()] if isinstance(existing, list) else []

    reason = str(report.get("reason") or "").strip()
    if reason:
        for part in re.split(r"[；;。\n]+", reason):
            part = part.strip()
            if part and part not in items:
                items.append(part)

    dna = report.get("scamDNA") or []
    if isinstance(dna, str):
        dna = [dna]
    if dna:
        tag_line = "命中心理詐騙 DNA：" + "、".join([str(x) for x in dna[:3]])
        if tag_line not in items:
            items.insert(0, tag_line)

    return items[:max_items] or ["未發現明顯高風險訊號。"]


def merge_component_reports(*reports):
    candidates = []
    for name, report in reports:
        if isinstance(report, dict):
            normalized = normalize_report_dict(report)
            candidates.append((name, normalized))

    if not candidates:
        return normalize_report_dict({
            "riskScore": 0,
            "riskLevel": "低風險",
            "scamDNA": ["無"],
            "reason": "沒有可用的分析結果。",
            "advice": "請重新掃描或補充更多文字 / 網址資訊。",
        })

    winning_name, winning = max(candidates, key=lambda item: clamp_score(item[1].get("riskScore")))
    component_scores = {name: clamp_score(report.get("riskScore")) for name, report in candidates}

    explain = []
    for name, report in sorted(candidates, key=lambda item: clamp_score(item[1].get("riskScore")), reverse=True):
        if clamp_score(report.get("riskScore")) <= 0:
            continue
        for item in explain_from_report(report, 3):
            line = f"{name}：{item}"
            if line not in explain:
                explain.append(line)
            if len(explain) >= 6:
                break
        if len(explain) >= 6:
            break

    final = {
        **winning,
        "riskScore": clamp_score(winning.get("riskScore")),
        "riskLevel": score_to_level(clamp_score(winning.get("riskScore"))),
        "componentScores": component_scores,
        "scoringContract": {
            "version": SCORING_VERSION,
            "finalScoreRule": "final_score = max(frontend_hint, ScamDNA, URL/domain rules, text rules, AI)",
            "weightsForExplanation": SCORE_WEIGHTS,
            "thresholds": {"low": "0-39", "medium": "40-69", "high": "70-100"},
        },
        "winningEngine": winning_name,
        "explain": explain or explain_from_report(winning),
    }
    return final


def get_demo_report_if_enabled(data):
    if not DEMO_MODE and not get_bool(data.get("demoMode"), False):
        return None

    text = str(data.get("text") or "")
    url = str(data.get("url") or "")
    scenario = str(data.get("demoScenario") or "parcel").lower()

    if scenario in {"safe", "official"}:
        return {
            "riskScore": 8,
            "riskLevel": "低風險",
            "scamDNA": ["無"],
            "reason": "Demo 模式：官方或一般資訊頁，未要求驗證碼、信用卡或匯款。",
            "advice": "可正常瀏覽；若後續要求輸入敏感資料請重新掃描。",
            "explain": ["Demo 保底資料：低風險安全頁", "沒有危險操作要求"],
        }

    demo_reason = "Demo 模式：偵測到假包裹 / 付款驗證 / 限時壓力等高風險組合。"
    if "投資" in text or "USDT" in text or scenario == "investment":
        demo_reason = "Demo 模式：偵測到保證獲利、加 LINE、虛擬貨幣或老師帶單等投資詐騙特徵。"

    return {
        "riskScore": 96,
        "riskLevel": "高風險",
        "scamDNA": ["限時壓力", "偽裝官方", "規避查緝"],
        "reason": demo_reason,
        "advice": "請立即停止操作，不要輸入信用卡、驗證碼或帳密；建議先打電話給家人或官方客服確認。",
        "explain": [
            "Demo 保底資料：即使現場網路或 Azure 異常，也能穩定展示完整流程",
            "偵測到限時壓力與付款 / 驗證話術",
            "系統會在輸入個資前攔截並通知家屬",
        ],
        "demoMode": True,
        "demoOriginalUrl": url,
    }


# ==========================================
# API 安全設定（競賽封版）
# ==========================================
def env_bool(key, default=False):
    value = os.getenv(key)

    if value is None:
        return default

    return value.strip().lower() in {"1", "true", "yes", "y", "on"}


def get_app_env():
    return os.getenv("AI_SHIELD_ENV", os.getenv("FLASK_ENV", "competition")).strip().lower()


def is_production_like():
    return get_app_env() in {"production", "prod", "release"}


APP_ENV = get_app_env()
IS_PRODUCTION_LIKE = is_production_like()
IS_COMPETITION_MODE = APP_ENV in {"competition", "contest", "competition-demo"}
DEBUG_ERRORS = env_bool("DEBUG_ERRORS", not IS_PRODUCTION_LIKE)

API_SECRET = os.getenv("EXTENSION_SECRET", "").strip()

# 舊版固定 X-Extension-Secret 僅保留相容；競賽/正式版預設改用短效 Bearer token。
REQUIRE_EXTENSION_SECRET = env_bool("REQUIRE_EXTENSION_SECRET", False)

# 競賽與正式環境預設啟用 accessToken，避免家庭資料與戰情室 API 裸奔。
REQUIRE_ACCESS_TOKEN = env_bool("REQUIRE_ACCESS_TOKEN", IS_COMPETITION_MODE or IS_PRODUCTION_LIKE)
REQUIRE_GUARDIAN_FOR_CLEAR_ALERTS = env_bool(
    "REQUIRE_GUARDIAN_FOR_CLEAR_ALERTS",
    IS_COMPETITION_MODE or IS_PRODUCTION_LIKE,
)
ALLOW_ANONYMOUS_INSTALL = env_bool(
    "ALLOW_ANONYMOUS_INSTALL",
    False if REQUIRE_ACCESS_TOKEN else not IS_PRODUCTION_LIKE,
)

raw_token_secret = (
    os.getenv("AI_SHIELD_TOKEN_SECRET")
    or os.getenv("SECRET_KEY")
    or API_SECRET
    or ""
).strip()

if raw_token_secret:
    TOKEN_SECRET = raw_token_secret
elif IS_PRODUCTION_LIKE:
    raise RuntimeError("正式環境請設定 AI_SHIELD_TOKEN_SECRET 或 SECRET_KEY。")
elif REQUIRE_ACCESS_TOKEN:
    TOKEN_SECRET = hashlib.sha256(os.urandom(32)).hexdigest()
    print("⚠️ 未設定 AI_SHIELD_TOKEN_SECRET；目前使用單次啟動臨時 token secret。", flush=True)
else:
    TOKEN_SECRET = "ai-shield-demo-token-secret"

ACCESS_TOKEN_TTL_SECONDS = int(os.getenv("ACCESS_TOKEN_TTL_SECONDS", "7200"))
MAX_INSTALL_ID_LENGTH = int(os.getenv("MAX_INSTALL_ID_LENGTH", "96"))


PUBLIC_PATHS = {
    "/",
    "/callback",
    "/test_line",
    "/api/auth/install",
}


# ==========================================
# LINE 設定
# ==========================================
LINE_CHANNEL_ACCESS_TOKEN = os.getenv("LINE_CHANNEL_ACCESS_TOKEN", "")
LINE_CHANNEL_SECRET = os.getenv("LINE_CHANNEL_SECRET", "")
ADMIN_LINE_ID = os.getenv("ADMIN_LINE_ID", os.getenv("LINE_USER_ID", ""))
LINE_USER_ID = os.getenv("LINE_USER_ID", "")
LINE_PUSH_ENABLED = env_bool("LINE_PUSH_ENABLED", False)

configuration = Configuration(access_token=LINE_CHANNEL_ACCESS_TOKEN)
handler = WebhookHandler(LINE_CHANNEL_SECRET or "demo_channel_secret")


# ==========================================
# 共用工具
# ==========================================
def get_tw_time():
    return (
        datetime.datetime.utcnow() + datetime.timedelta(hours=8)
    ).strftime("%Y-%m-%d %H:%M:%S")


def get_bool(value, default=False):
    if value is None:
        return default

    if isinstance(value, bool):
        return value

    return str(value).strip().lower() in ["1", "true", "yes", "y", "on"]


def now_epoch():
    return int(time.time())


def json_dumps(data):
    return json.dumps(data, ensure_ascii=False)


def safe_int(value, default=0):
    try:
        return int(value)
    except Exception:
        return default


def clamp_score(value):
    return max(0, min(100, safe_int(value, 0)))


def get_domain_from_url(url):
    return normalize_domain(url)


def safe_url_for_line(url):
    domain = normalize_domain(url)

    if domain:
        return domain

    return str(url or "")[:40]


def safe_truncate(value, limit=300):
    text = "" if value is None else str(value)

    if len(text) <= limit:
        return text

    return text[:limit] + "..."


def make_report_response(report_dict, masked_text="", status_code=200):
    normalized = normalize_report_dict(report_dict)

    payload = {
        **normalized,
        "report": json_dumps(normalized),
        "masked_text": masked_text,
    }

    return jsonify(payload), status_code


def normalize_report_dict(report):
    if not isinstance(report, dict):
        report = {}

    score = clamp_score(
        report.get("riskScore")
        or report.get("RiskScore")
        or report.get("risk_score")
        or 0
    )

    # 第一名封版：全系統統一風險分級，避免「中高風險 / 極度危險 / 安全無虞」混用。
    # 對外簡報、Dashboard、blocked 頁全部用：低風險 / 中風險 / 高風險。
    risk_level = score_to_level(score)
    scam_dna = report.get("scamDNA") or ["未知套路"]

    if isinstance(scam_dna, str):
        scam_dna = [item.strip() for item in re.split(r"[,，、\s]+", scam_dna) if item.strip()]

    if not isinstance(scam_dna, list) or not scam_dna:
        scam_dna = ["未知套路"]

    base_reason = safe_truncate(report.get("reason") or "未提供原因", 220)
    base_advice = safe_truncate(report.get("advice") or "請保持警覺。", 260)
    normalized_base = {
        "riskScore": score,
        "riskLevel": risk_level,
        "scamDNA": scam_dna[:5],
        "reason": base_reason,
        "advice": base_advice,
        "explain": explain_from_report({**report, "riskScore": score, "scamDNA": scam_dna[:5], "reason": base_reason}),
        **{
            key: value
            for key, value in report.items()
            if key not in ["riskScore", "RiskScore", "risk_score", "riskLevel", "scamDNA", "reason", "advice", "explain", "explanation"]
        },
    }
    return normalized_base


def score_to_level(score):
    """
    第四輪修正：
    統一 /scan 主流程與 ScamDNA 測試端點的風險分級。
    - 70 分以上：高風險
    - 40~69 分：中風險
    - 39 分以下：低風險

    這個修正可避免 42 分這種可疑案例被顯示成低風險，
    也讓測試報告、blocked 頁、Dashboard 的風險等級一致。
    """
    score = clamp_score(score)

    if score >= 70:
        return "高風險"

    if score >= 40:
        return "中風險"

    return "低風險"


def generate_invite_code(length=6):
    alphabet = string.ascii_uppercase + string.digits
    return "".join(random.choice(alphabet) for _ in range(length))


def get_json_body():
    if not request.is_json:
        return {}

    try:
        data = request.get_json(silent=True) or {}
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def public_error(message="伺服器暫時無法處理，請稍後再試。", status_code=500, **extra):
    payload = {
        "status": "fail" if status_code < 500 else "error",
        "message": message,
    }
    payload.update(extra)
    return jsonify(payload), status_code


def is_safe_public_id(value, min_len=1, max_len=96):
    text = str(value or "").strip()
    if not text or len(text) < min_len or len(text) > max_len:
        return False
    return bool(re.fullmatch(r"[A-Za-z0-9._:@\-]+", text))


def normalize_install_id(value):
    install_id = str(value or "").strip()

    if not install_id and ALLOW_ANONYMOUS_INSTALL:
        return f"ins_{hashlib.sha256(os.urandom(16)).hexdigest()[:16]}"

    if not is_safe_public_id(install_id, min_len=6, max_len=MAX_INSTALL_ID_LENGTH):
        return ""

    return install_id


def normalize_user_id_for_auth(value):
    user_id = str(value or "").strip()

    if not user_id and ALLOW_ANONYMOUS_INSTALL:
        return "USER_" + "".join(random.choice(string.ascii_uppercase + string.digits) for _ in range(9))

    if not is_safe_public_id(user_id, min_len=3, max_len=96):
        return ""

    return user_id


def normalize_family_id_for_auth(value):
    family_id = str(value or "none").strip().upper()

    if not family_id:
        return "none"

    if family_id == "NONE":
        return "none"

    if not re.fullmatch(r"[A-Z0-9]{4,16}", family_id):
        return ""

    return family_id


def b64url_encode(raw_bytes):
    return base64.urlsafe_b64encode(raw_bytes).decode("utf-8").rstrip("=")


def b64url_decode(text):
    padded = text + "=" * (-len(text) % 4)
    return base64.urlsafe_b64decode(padded.encode("utf-8"))


# ==========================================
# 短效 Token
# ==========================================
def sign_token_payload(payload_part):
    signature = hmac.new(
        TOKEN_SECRET.encode("utf-8"),
        payload_part.encode("utf-8"),
        hashlib.sha256,
    ).digest()

    return b64url_encode(signature)


def create_access_token(user_id, family_id="none", install_id=""):
    exp = now_epoch() + ACCESS_TOKEN_TTL_SECONDS

    payload = {
        "userID": str(user_id or "anonymous"),
        "familyID": str(family_id or "none"),
        "installID": str(install_id or ""),
        "exp": exp,
        "nonce": hashlib.sha256(os.urandom(16)).hexdigest()[:16],
    }

    payload_part = b64url_encode(json.dumps(payload, ensure_ascii=False).encode("utf-8"))
    signature_part = sign_token_payload(payload_part)

    return f"{payload_part}.{signature_part}", exp


def verify_access_token(token):
    if not token or "." not in token:
        return None

    try:
        payload_part, signature_part = token.split(".", 1)
        expected_signature = sign_token_payload(payload_part)

        if not hmac.compare_digest(signature_part, expected_signature):
            return None

        payload = json.loads(b64url_decode(payload_part).decode("utf-8"))

        if safe_int(payload.get("exp"), 0) < now_epoch():
            return None

        return payload

    except Exception:
        return None


def get_bearer_payload():
    auth_header = request.headers.get("Authorization", "")

    if not auth_header.lower().startswith("bearer "):
        return None

    token = auth_header.split(" ", 1)[1].strip()
    return verify_access_token(token)


def get_request_identity(data=None):
    data = data or {}
    token_payload = get_bearer_payload() or {}

    user_id = (
        token_payload.get("userID")
        or data.get("userID")
        or data.get("uid")
        or "anonymous"
    )

    family_id = (
        token_payload.get("familyID")
        or data.get("familyID")
        or "none"
    )

    install_id = (
        token_payload.get("installID")
        or data.get("installID")
        or ""
    )

    return {
        "userID": str(user_id or "anonymous"),
        "familyID": str(family_id or "none"),
        "installID": str(install_id or ""),
        "tokenPayload": token_payload,
    }


def verify_access_token_value(token, silent=False):
    """
    app.py 相容用函式。
    回傳格式同 verify_access_token()，並額外補 uid 欄位，避免舊版 app.py 用 ctx.get("uid") 時拿不到使用者。
    """
    payload = verify_access_token(token)

    if not payload:
        if not silent:
            print("🚫 accessToken 驗證失敗或已過期", flush=True)
        return None

    payload["uid"] = payload.get("userID") or payload.get("uid")
    return payload


def normalize_family_id(value):
    return str(value or "none").strip().upper()


def user_is_guardian(user_id, family_id):
    if not firebase_initialized:
        return False

    uid = str(user_id or "").strip()
    fid = normalize_family_id(family_id)

    if not uid or not fid or fid == "NONE":
        return False

    try:
        family_data = db.reference(f"families/{fid}").get()

        if not isinstance(family_data, dict):
            return False

        return str(family_data.get("guardianUID") or "") == uid

    except Exception as exc:
        print(f"⚠️ 檢查 guardian 權限失敗：{exc}", flush=True)
        return False


def user_can_access_family(user_id, family_id):
    """
    app.py 與 family API 共用的家庭權限檢查。
    合法條件：
    1. user 是該家庭 guardian；或
    2. user 存在 families/{familyID}/members/{userID}；或
    3. users/{userID}/familyID 等於該 familyID。
    """
    if not firebase_initialized:
        return False

    uid = str(user_id or "").strip()
    fid = normalize_family_id(family_id)

    if not uid or not fid or fid == "NONE":
        return False

    try:
        family_data = db.reference(f"families/{fid}").get()

        if isinstance(family_data, dict):
            if str(family_data.get("guardianUID") or "") == uid:
                return True

            members = family_data.get("members") or {}
            if isinstance(members, dict) and uid in members:
                return True

        user_data = db.reference(f"users/{uid}").get()

        if isinstance(user_data, dict):
            return normalize_family_id(user_data.get("familyID")) == fid

    except Exception as exc:
        print(f"⚠️ 檢查 family 權限失敗：{exc}", flush=True)

    return False


def authorize_family_access(family_id, identity=None, require_guardian=False):
    """
    家庭資料存取授權。
    - Demo 模式 REQUIRE_ACCESS_TOKEN=false：維持原本 familyID 行為。
    - 正式模式 REQUIRE_ACCESS_TOKEN=true：必須有有效 token，且 token familyID 與 request familyID 相同，並確認該 user 屬於家庭。
    """
    fid = normalize_family_id(family_id)

    if not fid or fid == "NONE":
        return False, (jsonify({"status": "fail", "message": "缺少 familyID"}), 400)

    if not REQUIRE_ACCESS_TOKEN:
        return True, None

    identity = identity or get_request_identity({})
    token_payload = identity.get("tokenPayload") or {}

    if not token_payload:
        return False, (jsonify({"status": "fail", "message": "缺少或無效的 accessToken"}), 401)

    token_family_id = normalize_family_id(token_payload.get("familyID"))
    user_id = str(token_payload.get("userID") or token_payload.get("uid") or identity.get("userID") or "").strip()

    if token_family_id != fid:
        return False, (jsonify({"status": "fail", "message": "accessToken familyID 不符"}), 403)

    if not user_can_access_family(user_id, fid):
        return False, (jsonify({"status": "fail", "message": "使用者不屬於此家庭"}), 403)

    if require_guardian and not user_is_guardian(user_id, fid):
        return False, (jsonify({"status": "fail", "message": "此操作僅限家庭守護者"}), 403)

    return True, None


@api_bp.before_app_request
def check_extension_secret():
    if request.path in PUBLIC_PATHS or request.method == "OPTIONS":
        return None

    if request.path.startswith("/socket.io/"):
        return None

    if not REQUIRE_EXTENSION_SECRET:
        return None

    token_payload = get_bearer_payload()
    if token_payload:
        return None

    provided_secret = request.headers.get("X-Extension-Secret", "")

    if API_SECRET and provided_secret == API_SECRET:
        return None

    client_ip = request.remote_addr
    print(
        f"🚨 阻擋非法 API 請求，來源 IP：{client_ip}，原因：缺少或錯誤的授權",
        flush=True,
    )

    return jsonify({
        "status": "error",
        "message": "Access Denied: 偵測到未經授權的 API 呼叫。",
    }), 403


@api_bp.app_errorhandler(HTTPException)
def handle_http_exception(e):
    response = e.get_response()

    response.data = json.dumps({
        "status": "error",
        "riskScore": 99 if e.code == 429 else 10,
        "riskLevel": "系統攔截",
        "reason": f"防護機制觸發 ({e.name})",
        "advice": "請稍後再試。",
        "report": "{}",
    }, ensure_ascii=False)

    response.content_type = "application/json"

    return response


@api_bp.app_errorhandler(Exception)
def handle_exception(e):
    error_id = hashlib.sha256(f"{time.time()}:{repr(e)}".encode("utf-8")).hexdigest()[:10]
    print(f"❌ [全域錯誤攔截] error_id={error_id} error={repr(e)}", flush=True)

    payload = {
        "status": "error",
        "message": "伺服器內部錯誤，請稍後再試。",
        "errorID": error_id,
    }

    if DEBUG_ERRORS:
        payload["details"] = str(e)

    return jsonify(payload), 500


# ==========================================
# 白名單
# ==========================================
def get_whitelist_match(domain, user_id="anonymous", family_id="none"):
    """
    分層白名單：
    1. official：內建可信網域
    2. personal：個人白名單
    3. family：家庭白名單
    4. global：全域白名單
    5. legacy_global：相容舊版 trusted_domains
    """
    if not domain:
        return None

    if is_genuine_white_listed(domain):
        return {
            "scope": "official",
            "domain": domain,
            "source": "builtin_trusted_domains",
        }

    if not firebase_initialized:
        return None

    key = safe_domain_key(domain)
    checks = []

    if user_id and user_id != "anonymous":
        checks.append(("personal", f"whitelists/personal/{user_id}/{key}"))

    if family_id and family_id != "none":
        checks.append(("family", f"whitelists/family/{family_id}/{key}"))

    checks.append(("global", f"whitelists/global/{key}"))
    checks.append(("legacy_global", f"trusted_domains/{key}"))
    checks.append(("legacy_global", f"trusted_domains/{domain.replace('.', '_dot_')}"))

    for scope, path in checks:
        try:
            item = db.reference(path).get()

            if item is True:
                return {
                    "scope": scope,
                    "domain": domain,
                    "source": path,
                    "data": {"legacy": True},
                }

            if item and isinstance(item, dict):
                status = item.get("status", "active")
                review_status = item.get("review_status", item.get("reviewStatus", "approved"))

                if status == "active" and review_status in ["approved", "auto", None]:
                    return {
                        "scope": scope,
                        "domain": item.get("domain", domain),
                        "source": path,
                        "data": item,
                    }

        except Exception as e:
            print(f"⚠️ 讀取白名單失敗 {path}: {e}", flush=True)

    return None


def write_whitelist(
    domain,
    scope="personal",
    user_id="anonymous",
    family_id="none",
    source="false_positive_report",
    review_status="approved",
):
    if not firebase_initialized:
        return False, "Firebase 未連線"

    domain = normalize_domain(domain)

    if not domain:
        return False, "無法解析網域"

    key = safe_domain_key(domain)
    now = get_tw_time()

    payload = {
        "domain": domain,
        "scope": scope,
        "source": source,
        "status": "active",
        "review_status": review_status,
        "created_at": now,
        "updated_at": now,
        "createdByUserID": user_id,
        "familyID": family_id if family_id != "none" else None,
    }

    if scope == "personal":
        if not user_id or user_id == "anonymous":
            return False, "個人白名單缺少 userID"
        path = f"whitelists/personal/{user_id}/{key}"

    elif scope == "family":
        if not family_id or family_id == "none":
            return False, "家庭白名單缺少 familyID"
        path = f"whitelists/family/{family_id}/{key}"

    elif scope == "global":
        path = f"whitelists/global/{key}"

    else:
        return False, "不支援的白名單範圍"

    db.reference(path).set(payload)

    return True, payload


# ==========================================
# 證據保全
# ==========================================
def minimal_evidence_payload(
    url,
    family_id,
    reason,
    screenshot_base64="",
    allow_full_screenshot=False,
):
    """
    隱私修正版：
    預設不保存完整 Base64 截圖，只保存摘要。
    若真的要保存完整截圖，前端必須明確傳 allow_screenshot_save=true。
    """
    domain = normalize_domain(url)

    return {
        "url_hash": hash_url(url),
        "domain": domain,
        "url_preview": str(url or "")[:120],
        "evidence_image_url": "",
        "screenshot_base64": screenshot_base64 if allow_full_screenshot else "",
        "screenshot_saved": bool(screenshot_base64 and allow_full_screenshot),
        "familyID": family_id,
        "timestamp": get_tw_time(),
        "reason": mask_sensitive_data(reason or "")[:300],
    }


def check_google_safe_browsing(url):
    api_key = os.getenv("GOOGLE_SAFE_BROWSING_API_KEY")

    if not api_key or not url:
        return False

    endpoint = f"https://safebrowsing.googleapis.com/v4/threatMatches:find?key={api_key}"

    payload = {
        "client": {
            "clientId": "ai-anti-fraud-shield",
            "clientVersion": "1.0.0",
        },
        "threatInfo": {
            "threatTypes": [
                "MALWARE",
                "SOCIAL_ENGINEERING",
                "UNWANTED_SOFTWARE",
                "POTENTIALLY_HARMFUL_APPLICATION",
            ],
            "platformTypes": ["ANY_PLATFORM"],
            "threatEntryTypes": ["URL"],
            "threatEntries": [{"url": url}],
        },
    }

    try:
        response = requests.post(endpoint, json=payload, timeout=3)

        if response.status_code == 200:
            data = response.json()
            return "matches" in data

    except Exception as e:
        print(f"⚠️ Google API 檢查超時或失敗: {e}", flush=True)

    return False


def write_scan_history(
    url,
    report_dict,
    user_id="anonymous",
    family_id="none",
    evidence_id="",
    masked_text="",
):
    if not firebase_initialized:
        return

    try:
        report_dict = normalize_report_dict(report_dict)
        risk_score = clamp_score(report_dict.get("riskScore"))
        timestamp = get_tw_time()
        domain = normalize_domain(url)

        db.reference("scan_history").push({
            "url": url,
            "url_hash": hash_url(url),
            "domain": domain,
            "report": json_dumps(report_dict),
            "userID": user_id,
            "familyID": family_id,
            "timestamp": timestamp,
            "evidenceID": evidence_id,
            "masked_text_preview": safe_truncate(masked_text, 300),
        })

        socketio.emit(
            "new_scan_result",
            {
                "url": url,
                "domain": domain,
                "riskScore": risk_score,
                "reason": report_dict.get("reason", ""),
                "scamDNA": report_dict.get("scamDNA", []),
                "timestamp": timestamp,
                "evidenceID": evidence_id,
            },
            room=family_id,
        )

    except Exception as e:
        print(f"⚠️ 寫入掃描紀錄失敗: {e}", flush=True)


def cache_url_report(url, report_dict):
    if not firebase_initialized or not url:
        return

    try:
        safe_url_key = re.sub(r"[^a-zA-Z0-9_-]", "_", url)[:120]
        db.reference(f"url_cache/{safe_url_key}").set(json_dumps(report_dict))

    except Exception as e:
        print(f"⚠️ URL 快取寫入失敗: {e}", flush=True)


def maybe_send_line_alert(family_id, url, report_dict):
    if not LINE_PUSH_ENABLED:
        print("🔕 [推播關閉] LINE_PUSH_ENABLED=false，略過 LINE 推播。", flush=True)
        return

    if not firebase_initialized:
        return

    if family_id == "none":
        return

    risk_score = clamp_score(report_dict.get("riskScore"))

    if risk_score < 70:
        print(f"🟢 [安全略過] 危險指數 {risk_score} 分，不發送 LINE 推播", flush=True)
        return

    safe_url_key = re.sub(r"[^a-zA-Z0-9_-]", "_", url or "no_url")[:120]
    current_time = time.time()

    if safe_url_key in last_line_alert_time and current_time - last_line_alert_time[safe_url_key] <= 30:
        print(f"🤫 [推播冷卻中] 危險指數 {risk_score} 分，暫停推播。", flush=True)
        return

    send_dynamic_line_alert(
        family_id=family_id,
        url=url,
        reason=report_dict.get("reason", ""),
        risk_score=risk_score,
        scam_dna=report_dict.get("scamDNA", ["危險"]),
    )

    last_line_alert_time[safe_url_key] = current_time


def log_threat_to_db(
    report_dict,
    target_url,
    user_id="anonymous",
    family_id="none",
    evidence_id="",
    masked_text="",
    debounced=False,
):
    report_dict = normalize_report_dict(report_dict)

    if not debounced:
        write_scan_history(
            url=target_url,
            report_dict=report_dict,
            user_id=user_id,
            family_id=family_id,
            evidence_id=evidence_id,
            masked_text=masked_text,
        )

    cache_url_report(target_url, report_dict)
    maybe_send_line_alert(family_id, target_url, report_dict)


# ==========================================
# LINE 推播
# ==========================================
def get_dynamic_advice(scam_dna_list):
    dna_str = ",".join(scam_dna_list) if isinstance(scam_dna_list, list) else str(scam_dna_list)

    if "金錢誘惑" in dna_str or "投資" in dna_str:
        return "『最近是不是有看到什麼好康的中獎或投資機會呀？要不要幫你看看？』"

    if "限時壓力" in dna_str or "恐懼訴求" in dna_str:
        return "『最近是不是有收到什麼包裹卡關、海外網購出問題、或是帳戶要被凍結的緊急通知？別慌，那通常是騙人的喔！』"

    if "權威誘導" in dna_str:
        return "『剛剛是不是有收到自稱海關、警察或法院的訊息？他們不會隨便傳網址叫人點喔，我們先求證一下。』"

    if "親情勒索" in dna_str:
        return "『最近有沒有收到誰說急需用錢的訊息？現在 AI 詐騙很多，匯款前記得先通個電話確認喔！』"

    if "沉沒成本" in dna_str:
        return "『是不是為了拿回之前的錢，對方又叫你匯手續費？這通常是無底洞，我們一起踩煞車好嗎？』"

    return "『剛剛上網有沒有遇到什麼奇怪的畫面，或是要求輸入密碼的網頁呀？』"


def send_dynamic_line_alert(family_id, url, reason, risk_score=100, scam_dna=None):
    print(f"📡 [LINE推播啟動] 目標家庭: {family_id}, 危險指數: {risk_score}", flush=True)

    if not firebase_initialized or family_id == "none":
        print(f"⚠️ [推播取消] Firebase 未連線或未綁定 family_id ({family_id})", flush=True)
        return

    if not LINE_CHANNEL_ACCESS_TOKEN:
        print("⚠️ [推播取消] LINE_CHANNEL_ACCESS_TOKEN 未設定", flush=True)
        return

    if scam_dna is None:
        scam_dna = ["未知套路"]

    try:
        family_node = db.reference(f"families/{family_id}").get()
        guardian_uid = family_node.get("guardianUID") if family_node else None

        target_line_id = LINE_USER_ID

        if guardian_uid:
            user_node = db.reference(f"users/{guardian_uid}").get()

            if user_node and user_node.get("line_id"):
                target_line_id = user_node.get("line_id")

        if not target_line_id:
            print("⚠️ [推播失敗] 找不到 LINE_ID", flush=True)
            return

        dna_tags = "、".join(scam_dna)
        care_message = get_dynamic_advice(scam_dna)

        msg = (
            "💞【AI 防詐盾牌 - 親情守護通知】\n"
            "您的親友剛剛遇到了一個高風險網頁！\n\n"
            "🛡️ 系統已成功為其暫時攔截。\n"
            f"🚨 威脅分析：此網頁疑似使用了「{dna_tags}」的心理操縱術 "
            f"(危險指數：{risk_score}分)。\n"
            f"🔍 攔截原因：{safe_truncate(reason, 60)}\n\n"
            "💡 溫柔陪伴指南：\n"
            "當事者現在可能感到慌張。建議您撥個電話關心，請【避免責備】，"
            "可以用這句話當作開頭：\n"
            f"{care_message}\n\n"
            f"🔗 風險網域：{safe_url_for_line(url)}"
        )

        with ApiClient(configuration) as api_client:
            line_bot_api = MessagingApi(api_client)
            line_bot_api.push_message(
                PushMessageRequest(
                    to=target_line_id,
                    messages=[TextMessage(text=msg)],
                )
            )

        print("✅ [LINE推播成功] 已發送緊急通知至綁定帳號！", flush=True)

    except Exception as e:
        print(f"❌ [LINE推播異常] 動態推播發生錯誤: {e}", flush=True)


# ==========================================
# 本地規則
# ==========================================
def decode_obfuscation_locally(text):
    if not text:
        return ""

    raw = str(text)
    parts = [raw]

    try:
        if "%" in raw:
            decoded = urllib.parse.unquote(raw)
            if decoded and decoded != raw:
                parts.append(decoded)
    except Exception:
        pass

    try:
        if "&" in raw:
            unescaped = html.unescape(raw)
            if unescaped and unescaped != raw:
                parts.append(unescaped)
    except Exception:
        pass

    def decode_base64_safe(value):
        try:
            compact = re.sub(r"\s+", "", value)
            compact = compact.replace("-", "+").replace("_", "/")
            compact += "=" * (-len(compact) % 4)

            decoded_bytes = base64.b64decode(compact)
            decoded_str = decoded_bytes.decode("utf-8", errors="ignore")
            decoded_str = urllib.parse.unquote(decoded_str)

            if re.search(r"[\u4e00-\u9fa5]", decoded_str) or len(re.sub(r"[^\w\s]", "", decoded_str)) > 4:
                return decoded_str

        except Exception:
            return ""

        return ""

    for b64 in re.findall(r"[A-Za-z0-9+/=\-_]{16,}", raw):
        decoded = decode_base64_safe(b64)

        if decoded:
            parts.append(decoded)

    reversed_text = raw[::-1]
    if any(word in reversed_text for word in ["中獎", "領取", "點擊", "匯款", "驗證", "獎金"]):
        parts.append(reversed_text)

    return " ".join(dict.fromkeys(parts))


def extract_urls_from_text(text):
    if not text:
        return []

    urls = re.findall(r"(?:https?://|www\.)[^\s<>'\"，。]+", text)

    cleaned = []
    for url in urls:
        cleaned_url = url.rstrip(").,，。；;]")
        if cleaned_url not in cleaned:
            cleaned.append(cleaned_url)

    return cleaned


def check_direct_url_anomaly(target_url):
    if not target_url:
        return None

    if "@" in target_url:
        return {
            "riskScore": 95,
            "riskLevel": "極度危險",
            "scamDNA": ["域名欺騙"],
            "reason": "偵測到 Userinfo 繞過欺騙。",
            "advice": "請勿點擊或輸入任何資料。",
        }

    if re.search(r"[а-яА-Я]", target_url):
        return {
            "riskScore": 95,
            "riskLevel": "極度危險",
            "scamDNA": ["域名欺騙"],
            "reason": "偵測到同形異義字欺騙。",
            "advice": "請勿點擊或輸入任何資料。",
        }

    if re.search(r"[\u200B-\u200D\uFEFF]", target_url):
        return {
            "riskScore": 95,
            "riskLevel": "極度危險",
            "scamDNA": ["域名欺騙"],
            "reason": "偵測到隱藏的零寬字元欺騙。",
            "advice": "請勿點擊或輸入任何資料。",
        }

    if re.search(r"[\uff01-\uff5e]", target_url):
        return {
            "riskScore": 90,
            "riskLevel": "極度危險",
            "scamDNA": ["域名欺騙"],
            "reason": "偵測到異常的全形字元偽裝網址。",
            "advice": "請勿點擊或輸入任何資料。",
        }

    if "。" in target_url:
        return {
            "riskScore": 90,
            "riskLevel": "極度危險",
            "scamDNA": ["域名欺騙"],
            "reason": "偵測到使用中文句號偽裝的惡意連結。",
            "advice": "請勿點擊或輸入任何資料。",
        }

    decoded_url = urllib.parse.unquote(target_url)
    decoded_lower = decoded_url.lower()

    if decoded_url != target_url and re.search(r"https?://", decoded_lower):
        return {
            "riskScore": 80,
            "riskLevel": "極度危險",
            "scamDNA": ["規避查緝"],
            "reason": "偵測到 URL 編碼隱藏真實連結。",
            "advice": "請勿點擊被編碼或看不清楚真實網域的連結。",
        }

    try:
        parsed = urlparse(target_url if target_url.startswith("http") else "http://" + target_url)
        if parsed.port and parsed.port not in [80, 443] and re.search(r"login|bank|verify|account|登入|銀行|驗證", decoded_lower, re.IGNORECASE):
            return {
                "riskScore": 70,
                "riskLevel": "中高風險",
                "scamDNA": ["偽裝官方"],
                "reason": "偵測到非標準連接埠搭配登入或銀行字樣。",
                "advice": "請改由官方 App 或官網自行登入，不要透過此連結操作。",
            }
    except Exception:
        pass

    return None


def check_image_risk(image_url, raw_text):
    if not image_url:
        return None

    img_lower = image_url.lower()
    decoded_img = urllib.parse.unquote(img_lower)

    if not image_url.startswith("http") and not image_url.startswith("data:"):
        return {
            "riskScore": 65,
            "riskLevel": "中高風險",
            "scamDNA": ["異常圖片"],
            "reason": "偵測到無效或惡意的圖片 URL 格式。",
            "advice": "請勿點擊圖片或掃描其中 QR Code。",
        }

    if any(ext in img_lower for ext in [".svg", ".webp", ".bmp", ".tiff", ".gif"]) or "image/svg" in img_lower:
        return {
            "riskScore": 65,
            "riskLevel": "中高風險",
            "scamDNA": ["異常格式"],
            "reason": "使用罕見或易藏惡意腳本的圖片格式。",
            "advice": "請勿下載或開啟不明圖片。",
        }

    suspicious_img_kws = [
        "qr", "qrcode", "barcode", "win", "prize", "lottery", "base64",
        "promo", "award", "bonus", "text", "gift", "scam", "free",
        "中獎", "保證獲利", "匯款", "付款", "領獎",
    ]

    if any(kw in decoded_img for kw in suspicious_img_kws):
        return {
            "riskScore": 85,
            "riskLevel": "極度危險",
            "scamDNA": ["圖片誘惑/QR"],
            "reason": "偵測到可疑 QR Code 或圖片誘惑特徵。",
            "advice": "請勿掃描 QR Code，也不要輸入付款或個資。",
        }

    if raw_text and len(raw_text.strip()) > 0:
        return {
            "riskScore": 80,
            "riskLevel": "極度危險",
            "scamDNA": ["多模態夾擊"],
            "reason": "偵測到圖文夾雜的混合規避手法。",
            "advice": "請先停止操作並查證來源。",
        }

    return {
        "riskScore": 75,
        "riskLevel": "中高風險",
        "scamDNA": ["可疑圖片內容"],
        "reason": "圖片內容無法完整確認，已啟用保守防護。",
        "advice": "請勿掃描陌生 QR Code 或下載圖片中的檔案。",
    }


def check_url_blacklists_and_spoofing(url_list):
    for raw_url in url_list:
        if not raw_url:
            continue

        parse_url = raw_url if raw_url.startswith("http") else "http://" + raw_url

        if is_genuine_white_listed(parse_url):
            continue

        if check_165_blacklist(parse_url):
            return {
                "riskScore": 100,
                "riskLevel": "極度危險",
                "scamDNA": ["黑名單警示"],
                "reason": "🚨 165 官方資料庫比對成功或本地高風險規則命中：此為已知詐騙網站。",
                "advice": "請立即關閉網頁，不要輸入任何資料。",
            }

        if check_google_safe_browsing(parse_url):
            return {
                "riskScore": 100,
                "riskLevel": "極度危險",
                "scamDNA": ["Google黑名單警示"],
                "reason": "🚨 Google 官方安全大腦攔截：此為高風險惡意或釣魚網站。",
                "advice": "請立即關閉網頁。",
            }

        try:
            host = urlparse(parse_url.lower().strip()).hostname or ""

            if re.match(r"^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$", host):
                return {
                    "riskScore": 85,
                    "riskLevel": "極度危險",
                    "scamDNA": ["IP位址欺騙"],
                    "reason": "使用 IP 位址取代正常網域名稱，這是常見隱藏真實身分的釣魚手法。",
                    "advice": "請勿點擊或輸入任何資料。",
                }

            for domain in TRUSTED_DOMAINS:
                clean_domain = normalize_domain(domain)

                if clean_domain and clean_domain in host and not host.endswith("." + clean_domain) and host != clean_domain:
                    return {
                        "riskScore": 100,
                        "riskLevel": "極度危險",
                        "scamDNA": ["偽裝官方"],
                        "reason": f"偽裝網域，試圖欺騙使用者以為是 {clean_domain}。",
                        "advice": "請勿點擊或輸入任何資料。",
                    }

            suspicious_patterns = [
                r"g[0o]{1,2}gle",
                r"yaho[0o]",
                r"faceb[0o]{2}k",
                r"app[1l]e",
                r"1ine",
                r"gov[-_]?tw",
                r"bank[-_]?login",
                r"verify[-_]?login",
                r"account[-_]?verify",
                r"security[-_]?check",
            ]

            if any(re.search(pattern, host, re.IGNORECASE) for pattern in suspicious_patterns):
                return {
                    "riskScore": 90,
                    "riskLevel": "極度危險",
                    "scamDNA": ["偽裝官方"],
                    "reason": "偵測到高度相似的品牌或官方網域偽裝。",
                    "advice": "請改從官方 App 或官方網站自行查詢。",
                }

        except Exception:
            continue

    return None


def normalize_text_for_rules(text):
    """將混淆、簡體、同音字與符號分隔還原成規則好判讀的文字。"""
    raw = str(text or "")
    variants = [raw]

    try:
        unquoted = urllib.parse.unquote(raw)
        if unquoted and unquoted != raw:
            variants.append(unquoted)
    except Exception:
        pass

    reversed_text = raw[::-1]
    if any(word in reversed_text for word in ["中獎", "領取", "點擊", "匯款", "驗證", "獎金", "通知"]):
        variants.append(reversed_text)

    combined = "\n".join(variants)
    combined = re.sub(r"[\u200B-\u200D\uFEFF]", "", combined)

    table = str.maketrans(
        {
            "奖": "獎", "领": "領", "取": "取", "点": "點", "击": "擊", "击": "擊",
            "缴": "繳", "费": "費", "冻": "凍", "结": "結", "账": "帳", "户": "戶",
            "当": "當", "选": "選", "请": "請", "填": "填", "写": "寫",
            "领": "領", "税": "稅", "证": "證", "码": "碼",
            "撃": "擊",
        }
    )
    combined = combined.translate(table)

    replacements = {
        "中奖了": "中獎了",
        "中奖": "中獎",
        "领取": "領取",
        "点击": "點擊",
        "当選": "當選",
        "当选": "當選",
        "點機": "點擊",
        "仲獎": "中獎",
        "領娶": "領取",
        "伱": "你",
        "巳": "已",
        "撃": "擊",
    }
    for old, new in replacements.items():
        combined = combined.replace(old, new)

    # 中•獎•通•知、您•獲•得 這類符號分隔手法：額外加入一份去符號版本。
    compact = re.sub(r"[\s·•・‧\-_.:：,，。；;!！?？\[\]{}()（）/\\|]+", "", combined)
    return combined + "\n" + compact


def rule_based_text_detection(text):
    if not text:
        return None

    normalized = normalize_text_for_rules(text)

    patterns = [
        (r"在我車上|綁架|斷手斷腳|不准報警|不准報案", 100, "恐懼訴求", "偵測到人身威脅或假綁架話術。"),
        (r"偵查不公開|監管帳戶|法院公證人|洗錢|涉嫌|通緝", 95, "權威誘導", "偵測到假檢警或司法機關詐騙話術。"),
        (r"解除分期|取消分期|ATM.*解除|ATM.*取消|重複扣款", 95, "限時壓力", "偵測到假客服解除分期或 ATM 操作詐騙。"),
        (r"保證獲利|穩賺不賠|飆股|內線消息|內部消息|老師帶單|VIP.*群|老師.*投資|跟著老師.*賺", 95, "金錢誘惑", "偵測到假投顧、殺豬盤或高獲利投資詐騙。"),
        (r"USDT|BTC|ETH|虛擬貨幣|量化交易|AI.*交易|月報酬|元宇宙.*土地|CBDC|央行數位貨幣|數位幣|NFT|gas\s*費", 90, "金錢誘惑", "偵測到虛擬貨幣、NFT、AI 投資或新型金融詐騙特徵。"),
        (r"中獎|領取獎金|領獎|恭喜您|Congratulations|prize|claim|bonus|當選|獲得.*萬|iPhone.*中獎", 90, "金錢誘惑", "偵測到假中獎或領獎詐騙。"),
        (r"加賴|加\s*LINE|line id|私訊.*客服|遊戲點數|買.*點數|幫我買", 88, "規避查緝", "偵測到導流至私訊、遊戲點數或通訊軟體的可疑行為。"),
        (r"包裹.*海關|通關費|保證金|包裹.*滯留|運費不足|取貨.*異常|地址錯誤|重新配送費|超商.*驗證", 86, "限時壓力", "偵測到包裹、超商取貨或海關費用詐騙。"),
        (r"驗證碼|提款卡.*密碼|網銀.*密碼|信用卡.*安全碼|CVV|信用卡.*盜刷|海外消費|信用卡.*到期|更新卡號|付款資訊|重新填寫信用卡|信用卡.*更新", 92, "規避查緝", "偵測到索取信用卡、敏感資訊或驗證碼。"),
        (r"下載.*APK|下載.*APP|安裝.*憑證|下載.*憑證.*APK|APK.*查看|APK", 92, "規避查緝", "偵測到誘導下載不明 App、憑證或 APK。"),
        (r"急需.*手術費|出車禍|換手機|不要告訴.*爸爸|不要告訴.*媽媽|聲音.*怪.*感冒|家人.*緊急匯款|急需.*\d+.*萬", 92, "親情勒索", "偵測到假親友急用錢或 AI 變聲詐騙。"),
        (r"LINE.*異地登入|LINE.*停權|Google.*鎖定|Google.*驗證|Facebook.*違規|Facebook.*刪除|帳號.*異常|帳號.*停權|帳號.*鎖定|帳號.*被鎖", 88, "偽裝官方", "偵測到假冒平台帳號安全通知。"),
        (r"台電|電費.*逾期|斷電|自來水|水費.*未繳|停止供水|瓦斯|停氣|瓦斯.*停供|ETC|通行費.*欠費|健保卡.*鎖卡", 88, "恐懼訴求", "偵測到假冒公用事業、ETC 或健保通知。"),
        (r"健保署|健保.*退費|健保費.*溢繳|勞保局|勞保.*補助|政府.*津貼|普發津貼|紓困補助|政府補助|疫苗.*預約|疫調通知|CDC|vax", 88, "偽裝官方", "偵測到假冒政府、健保、勞保或疫苗通知。"),
        (r"銀行帳戶.*凍結|帳戶.*凍結|解除凍結|銀行.*登入|登入.*銀行|非本人.*取消|退款.*銀行帳戶|訂單退款|申請退款|Amazon.*退款", 90, "權威誘導", "偵測到假冒銀行、帳戶凍結或退款詐騙。"),
        (r"Netflix.*過期|Netflix.*付款失敗|Spotify.*到期|會員.*今日到期|續費.*折|付款.*失敗", 78, "限時壓力", "偵測到假冒串流平台續費或付款通知。"),
        (r"掃描.*QR|QR\s*Code|qrcode|掃碼.*領取|掃描.*補助", 90, "圖片誘惑/QR", "偵測到 QR Code 誘導領獎或補助。"),
        (r"房東.*新帳戶|租金.*匯至|改帳戶|新帳戶.*租金", 90, "金錢誘惑", "偵測到假冒房東更改匯款帳戶。"),
        (r"貸款.*核准|先匯.*手續費|無需聯徵|最快.*撥款|小額付款|電信帳單.*小額付款|門號.*停用|停話|更新資料", 88, "金錢誘惑", "偵測到假貸款、電信小額付款或停話詐騙。"),
        (r"航空|中華航空|機票.*改簽|超賣.*改簽", 82, "偽裝官方", "偵測到假冒航空公司客服通知。"),
    ]

    matches = []

    for pattern, score, dna, reason in patterns:
        if re.search(pattern, normalized, re.IGNORECASE):
            matches.append((score, dna, reason))

    if not matches:
        return None

    best_score = max(item[0] for item in matches)
    dna_tags = []

    for _, dna, _ in matches:
        if dna not in dna_tags:
            dna_tags.append(dna)

    reasons = []
    for _, _, reason in matches[:3]:
        if reason not in reasons:
            reasons.append(reason)

    final_score = min(100, best_score + max(0, len(matches) - 1) * 3)

    return {
        "riskScore": final_score,
        "riskLevel": score_to_level(final_score),
        "scamDNA": dna_tags[:3],
        "reason": "；".join(reasons),
        "advice": "請停止操作，不要匯款、輸入驗證碼、信用卡、帳號密碼或下載不明 App。",
    }


LOW_INFORMATION_SAFE_DOMAINS = {
    "test.com",
    "safe.com",
    "localhost",
    "127.0.0.1",
}

LOW_INFORMATION_RISK_HINT_REGEX = re.compile(
    r"(登入|驗證|帳號|密碼|信用卡|匯款|轉帳|中獎|領取|獎金|補繳|欠費|逾期|停用|停權|凍結|解除|分期|"
    r"投資|保證|獲利|LINE|加賴|包裹|運費|QR|Code|APK|手術費|車禍|警察|法院|檢察官|洗錢|"
    r"login|verify|account|password|bank|card|claim|prize|gift|bonus|refund|payment|update)",
    re.IGNORECASE,
)


def is_low_information_safe_scan(target_url, raw_text, image_url, is_urgent=False):
    """
    低資訊量快速回應：
    - 目的：避免非常短、沒有風險線索的健康檢查/壓力測試內容進入 Azure OpenAI，造成併發測試被外部 API 延遲拖垮。
    - 條件保守：有圖片、有緊急事件、有風險字、有可疑網址都不走快速放行。
    """
    if image_url or is_urgent:
        return False

    raw = str(raw_text or "")
    compact = re.sub(r"\s+", "", raw)

    if not compact:
        return False

    # v9 修正：短字串也可能是混淆詐騙（繁簡混合、符號分隔、反轉文字）。
    # 先跑一次本地詐騙話術規則；有命中就不能走 0 分快速放行。
    try:
        if rule_based_text_detection(raw):
            return False
    except Exception:
        pass

    if len(compact) > 24:
        return False

    normalized_hint_text = normalize_text_for_rules(raw)
    if LOW_INFORMATION_RISK_HINT_REGEX.search(raw) or LOW_INFORMATION_RISK_HINT_REGEX.search(normalized_hint_text):
        return False

    domain = normalize_domain(target_url or "")

    if target_url and domain not in LOW_INFORMATION_SAFE_DOMAINS and not domain.endswith(".test"):
        return False

    # 純測試字串、短數字、短一般文字，不值得消耗 AI 請求。
    return True


# ==========================================
# 基本路由
# ==========================================
@api_bp.route("/", methods=["GET"])
def health_check():
    return jsonify({
        "status": "success",
        "message": "🟢 AI 防詐騙伺服器正常運作中！",
        "time": get_tw_time(),
        "env": APP_ENV,
        "authRequired": REQUIRE_ACCESS_TOKEN,
        "firebaseReady": firebase_initialized,
    })


@api_bp.route("/api/auth/install", methods=["POST"])
@limiter.limit("30 per minute")
def auth_install():
    if not request.is_json:
        return public_error("Content-Type 必須是 application/json。", 415)

    data = get_json_body()

    install_id = normalize_install_id(data.get("installID") or data.get("installId") or "")
    user_id = normalize_user_id_for_auth(data.get("userID") or data.get("uid") or "")
    family_id = normalize_family_id_for_auth(data.get("familyID") or "none")

    if not install_id:
        return public_error("installID 格式不合法。", 400)

    if not user_id:
        return public_error("userID 格式不合法。", 400)

    if family_id == "":
        return public_error("familyID 格式不合法。", 400)

    token, expires_at = create_access_token(
        user_id=user_id,
        family_id=family_id,
        install_id=install_id,
    )

    if firebase_initialized:
        try:
            db.reference(f"installs/{safe_domain_key(install_id)}").set({
                "installID": install_id,
                "userID": user_id,
                "familyID": family_id,
                "updated_at": get_tw_time(),
                "expiresAt": expires_at,
                "env": APP_ENV,
            })

            db.reference(f"users/{user_id}").update({
                "userID": user_id,
                "familyID": family_id,
                "last_seen": get_tw_time(),
            })

        except Exception as e:
            print(f"⚠️ 寫入安裝身分失敗：{repr(e)}", flush=True)

    return jsonify({
        "status": "success",
        "accessToken": token,
        "expiresAt": expires_at,
        "userID": user_id,
        "familyID": family_id,
        "installID": install_id,
        "authRequired": REQUIRE_ACCESS_TOKEN,
    })


# ==========================================
# 證據 API
# ==========================================
@api_bp.route("/api/submit_evidence", methods=["POST"])
@limiter.limit("10 per minute")
def submit_evidence():
    if not firebase_initialized:
        return jsonify({"status": "fail", "message": "Firebase 未連線"}), 500

    data = get_json_body()
    identity = get_request_identity(data)

    demo_report = get_demo_report_if_enabled(data)
    if demo_report:
        return make_report_response(demo_report, mask_sensitive_data(str(data.get("text") or "")))

    url = str(data.get("url") or "未知網址")
    screenshot_base64 = data.get("screenshot_base64")

    if not screenshot_base64:
        return jsonify({"status": "fail", "message": "未提供圖片數據"}), 400

    try:
        family_id = normalize_family_id(data.get("familyID") or identity["familyID"] or "none")

        if family_id != "NONE":
            authorized, auth_response = authorize_family_access(family_id, identity)
            if not authorized:
                return auth_response

        reason = data.get("reported_reason") or data.get("reason") or "前端智慧攔截"

        url_key = re.sub(r"[^a-zA-Z0-9_-]", "_", url)[:120]
        current_time = time.time()

        if url_key in last_alert_time and current_time - last_alert_time[url_key] < 10:
            return jsonify({
                "status": "success",
                "message": "重複攔截，忽略快照",
            })

        last_alert_time[url_key] = current_time

        allow_full_screenshot = get_bool(data.get("allow_screenshot_save"), False)

        ref = db.reference("scam_evidence").push(
            minimal_evidence_payload(
                url=url,
                family_id=family_id,
                reason=reason,
                screenshot_base64=screenshot_base64,
                allow_full_screenshot=allow_full_screenshot,
            )
        )

        report_dict = {
            "riskScore": 99,
            "riskLevel": "極度危險",
            "reason": f"【前端緊急攔截】{reason}",
            "scamDNA": ["系統強制警示"],
            "advice": "防詐盾牌已在第一線為您阻擋此危險網頁，並完成證據保全。",
        }

        write_scan_history(
            url=url,
            report_dict=report_dict,
            user_id=identity["userID"] or "frontend_intercept",
            family_id=family_id,
            evidence_id=ref.key,
        )

        maybe_send_line_alert(family_id, url, report_dict)

        socketio.emit(
            "new_evidence_submitted",
            {
                "url": url,
                "evidenceID": ref.key,
                "timestamp": get_tw_time(),
            },
            room=family_id,
        )

        return jsonify({
            "status": "success",
            "message": "✅ 證據摘要已成功存檔",
            "evidenceID": ref.key,
            "image_url": "",
        })

    except Exception as e:
        print(f"❌ 證據入庫失敗：{e}", flush=True)
        return public_error("操作失敗，請稍後再試。", 500)


@api_bp.route("/api/get_evidence", methods=["POST"])
def get_evidence():
    if not firebase_initialized:
        return jsonify({"status": "fail", "message": "Firebase 未連線"}), 500

    data = get_json_body()
    identity = get_request_identity(data)

    demo_report = get_demo_report_if_enabled(data)
    if demo_report:
        return make_report_response(demo_report, mask_sensitive_data(str(data.get("text") or "")))

    requested_family_id = normalize_family_id(data.get("familyID") or identity["familyID"])
    evidence_id = data.get("evidenceID")

    if not evidence_id:
        return jsonify({"status": "fail", "message": "缺少 evidenceID"}), 400

    if not requested_family_id or requested_family_id == "NONE":
        return jsonify({"status": "fail", "message": "缺少 familyID"}), 400

    try:
        evidence = db.reference(f"scam_evidence/{evidence_id}").get()

        if not evidence or not isinstance(evidence, dict):
            return jsonify({
                "status": "fail",
                "message": "找不到對應的證據快照，可能已遭覆蓋或無權限存取。",
            }), 404

        evidence_family_id = normalize_family_id(evidence.get("familyID"))

        if evidence_family_id != requested_family_id:
            return jsonify({"status": "fail", "message": "無權限讀取此證據快照"}), 403

        authorized, auth_response = authorize_family_access(requested_family_id, identity)
        if not authorized:
            return auth_response

        return jsonify({
            "status": "success",
            "evidence_image_url": evidence.get("evidence_image_url", ""),
            "screenshot_base64": evidence.get("screenshot_base64", ""),
            "screenshot_saved": evidence.get("screenshot_saved", False),
            "url_preview": evidence.get("url_preview", ""),
            "reason": evidence.get("reason", ""),
        })

    except Exception as e:
        return public_error("操作失敗，請稍後再試。", 500)


# ==========================================
# 核心掃描 API
# ==========================================
@api_bp.route("/scan", methods=["POST"])
@limiter.limit("1000 per minute")
def scan_url():
    if not request.is_json:
        return public_error("Content-Type 必須是 application/json。", 415)

    data = get_json_body()
    identity = get_request_identity(data)

    demo_report = get_demo_report_if_enabled(data)
    if demo_report:
        return make_report_response(demo_report, mask_sensitive_data(str(data.get("text") or "")))

    target_url = str(data.get("url") or "")[:2000]
    raw_text = str(data.get("text") or "")[:5000]
    image_url = str(data.get("image_url") or "")[:2000]
    screenshot_base64 = data.get("image") or data.get("screenshot_base64")

    user_id = str(data.get("userID") or identity["userID"] or "anonymous")
    family_id = str(data.get("familyID") or identity["familyID"] or "none")
    is_urgent = get_bool(data.get("is_urgent"), False)
    frontend_risk_score = clamp_score(data.get("frontendRiskScore") or data.get("localRiskScore") or 0)
    frontend_risk_report = None
    if frontend_risk_score > 0:
        frontend_risk_report = {
            "riskScore": frontend_risk_score,
            "riskLevel": score_to_level(frontend_risk_score),
            "scamDNA": data.get("frontendRiskTags") or ["前端本地規則"],
            "reason": data.get("frontendReason") or "前端內容腳本已先偵測到可疑關鍵字、外連或頁面行為。",
            "advice": "請等待後端覆核；若達高風險門檻，系統會在輸入資料前攔截。",
        }

    safe_url_key = re.sub(r"[^a-zA-Z0-9_-]", "_", target_url or "no_url")[:120]
    current_time = time.time()
    is_debounced = safe_url_key in last_alert_time and current_time - last_alert_time[safe_url_key] < 10

    evidence_id = ""

    if screenshot_base64 and firebase_initialized and not is_debounced:
        try:
            allow_full_screenshot = get_bool(data.get("allow_screenshot_save"), False)

            ev_ref = db.reference("scam_evidence").push(
                minimal_evidence_payload(
                    url=target_url,
                    family_id=family_id,
                    reason="手動掃描快照",
                    screenshot_base64=screenshot_base64,
                    allow_full_screenshot=allow_full_screenshot,
                )
            )

            evidence_id = ev_ref.key
            last_alert_time[safe_url_key] = current_time

        except Exception as e:
            print(f"⚠️ 資料庫寫入證據失敗: {e}", flush=True)

    if not target_url and not image_url and not raw_text.strip():
        return jsonify({
            "status": "error",
            "riskScore": 0,
            "riskLevel": "參數異常",
            "reason": "未提供內容。",
            "masked_text": "",
        }), 200

    if is_low_information_safe_scan(target_url, raw_text, image_url, is_urgent=is_urgent):
        quick_report = {
            "riskScore": 0,
            "riskLevel": "安全無虞",
            "scamDNA": ["低資訊量快速檢查"],
            "reason": "內容過短且未包含明顯詐騙、個資或金流特徵，已由本地快速規則完成檢查。",
            "advice": "目前未發現明顯風險；若後續要求登入、匯款、驗證碼或信用卡資料，請重新掃描。",
        }
        return make_report_response(quick_report, mask_sensitive_data(raw_text))

    decoded_text = decode_obfuscation_locally(raw_text)
    decoded_url = decode_obfuscation_locally(target_url)
    combined_raw_text = f"{raw_text}\n{decoded_text}"

    if expand_detection_text:
        try:
            combined_raw_text += "\n" + expand_detection_text(raw_text)
            combined_raw_text += "\n" + expand_detection_text(target_url)
        except Exception:
            pass

    detection_text = "\n".join([combined_raw_text, decoded_url, target_url or "", image_url or ""])
    masked_text = mask_sensitive_data(detection_text)

    # ScamDNA 第三輪規則判斷：先做語境辨識與高齡詐騙特徵分析。
    # 這裡不取代 AI，而是作為本地可解釋防線，並用來降低正常防詐宣導的誤判。
    try:
        scamdna_report = normalize_report_dict(
            analyze_with_scamdna(
                text=masked_text,
                url=target_url,
                title=str(data.get("title") or ""),
            )
        )
    except Exception as exc:
        print(f"⚠️ ScamDNA 分析失敗，略過本地規則：{exc}", flush=True)
        scamdna_report = None

    # 官方可信網站 + 正常宣導語境：若未要求直接匯款、填帳密、加 LINE，先安全放行。
    if scamdna_report and should_trust_official_without_block(target_url, scamdna_report):
        official_safe_report = {
            **scamdna_report,
            "riskScore": 0,
            "riskLevel": "安全無虞",
            "scamDNA": ["官方可信網站"],
            "reason": "來源屬官方可信網域，且內容未要求直接危險操作，判定為正常資訊或防詐宣導。",
            "advice": "可正常瀏覽；若後續頁面要求輸入信用卡、驗證碼、帳密或匯款，請重新掃描。",
        }
        write_scan_history(
            url=target_url,
            report_dict=official_safe_report,
            user_id=user_id,
            family_id=family_id,
            masked_text=masked_text,
        )
        return make_report_response(official_safe_report, masked_text)

    # 正常防詐宣導 / 官方公告 / 家屬正常照護語境：避免被一般關鍵字規則誤判。
    if scamdna_report and is_scamdna_safe_context(scamdna_report) and scamdna_report.get("riskScore", 0) <= 25:
        safe_context_report = {
            **scamdna_report,
            "riskScore": 0,
            "riskLevel": "安全無虞",
            "scamDNA": ["安全語境降權"],
            "reason": scamdna_report.get("reason") or "判定為正常防詐宣導或一般照護通知，已降低誤判風險。",
            "advice": "目前未發現明顯詐騙特徵；若後續要求匯款、帳密、驗證碼或加 LINE，請重新掃描。",
        }
        write_scan_history(
            url=target_url,
            report_dict=safe_context_report,
            user_id=user_id,
            family_id=family_id,
            masked_text=masked_text,
        )
        return make_report_response(safe_context_report, masked_text)

    # ScamDNA 高分命中：已是明確詐騙型態，不必等待外部 AI。
    if scamdna_report and scamdna_report.get("riskScore", 0) >= 85:
        log_threat_to_db(
            scamdna_report,
            target_url=target_url,
            user_id=user_id,
            family_id=family_id,
            evidence_id=evidence_id,
            masked_text=masked_text,
            debounced=is_debounced,
        )
        return make_report_response(scamdna_report, masked_text)

    # 1. 圖片風險快速判斷
    image_report = check_image_risk(image_url, raw_text)

    if image_report and not screenshot_base64:
        log_threat_to_db(
            image_report,
            target_url=target_url or image_url,
            user_id=user_id,
            family_id=family_id,
            evidence_id=evidence_id,
            masked_text=masked_text,
            debounced=is_debounced,
        )

        return make_report_response(image_report, masked_text)

    # 2. URL 直接異常
    direct_url_report = check_direct_url_anomaly(target_url)

    if direct_url_report:
        log_threat_to_db(
            direct_url_report,
            target_url=target_url,
            user_id=user_id,
            family_id=family_id,
            evidence_id=evidence_id,
            masked_text=masked_text,
            debounced=is_debounced,
        )

        return make_report_response(direct_url_report, masked_text)

    # 3. 白名單放行，但高風險話術會覆核
    target_domain = get_domain_from_url(target_url)

    whitelist_match = get_whitelist_match(
        target_domain,
        user_id=user_id,
        family_id=family_id,
    )

    is_white_listed = bool(whitelist_match)

    whitelist_overridden = bool(
        is_white_listed and has_high_risk_whitelist_override(masked_text, target_url)
    )

    if is_white_listed and not is_urgent and not whitelist_overridden:
        scope_label = whitelist_match.get("scope", "unknown")

        report_dict = {
            "riskScore": 0,
            "riskLevel": "安全無虞",
            "scamDNA": ["白名單放行"],
            "reason": f"分層白名單放行：{scope_label}",
            "advice": "此網域已在可信任名單內；系統仍會持續監測是否出現新的高風險內容。",
            "whitelistScope": scope_label,
            "domain": target_domain,
        }

        write_scan_history(
            url=target_url,
            report_dict=report_dict,
            user_id=user_id,
            family_id=family_id,
            masked_text=masked_text,
        )

        return make_report_response(report_dict, masked_text)

    if whitelist_overridden:
        print(f"⚠️ 白名單覆核：{target_domain} 出現重大高風險特徵，取消直接放行。", flush=True)

    # 4. 黑名單 / 偽裝網域
    check_list = [target_url]
    check_list.extend(extract_urls_from_text(combined_raw_text))

    url_report = check_url_blacklists_and_spoofing(check_list)

    if url_report:
        log_threat_to_db(
            url_report,
            target_url=target_url,
            user_id=user_id,
            family_id=family_id,
            evidence_id=evidence_id,
            masked_text=masked_text,
            debounced=is_debounced,
        )

        return make_report_response(url_report, masked_text)

    # 5. 本地高風險話術
    text_rule_report = rule_based_text_detection(masked_text)

    # 如果 ScamDNA 已判定為安全語境，避免舊關鍵字規則把正常防詐宣導誤判成高風險。
    if text_rule_report and scamdna_report and is_scamdna_safe_context(scamdna_report) and scamdna_report.get("riskScore", 0) <= 25:
        text_rule_report = None

    if text_rule_report and text_rule_report.get("riskScore", 0) >= 85:
        log_threat_to_db(
            text_rule_report,
            target_url=target_url,
            user_id=user_id,
            family_id=family_id,
            evidence_id=evidence_id,
            masked_text=masked_text,
            debounced=is_debounced,
        )

        return make_report_response(text_rule_report, masked_text)

    # 6. AI 分析
    try:
        ai_report = analyze_risk_with_ai(
            target_url=target_url,
            web_text=masked_text,
            image_url=image_url,
            is_jailbreak_attempt=False,
        )

    except TypeError:
        ai_report = analyze_risk_with_ai(
            target_url,
            masked_text,
            image_url,
            False,
        )

    except Exception as e:
        print(f"⚠️ AI 分析失敗，改用本地規則：{e}", flush=True)
        ai_report = text_rule_report or {
            "riskScore": 25,
            "riskLevel": "低風險",
            "scamDNA": ["系統備用防線攔截"],
            "reason": "AI 暫時無法分析，已改用本地規則判斷。",
            "advice": "請保持警覺，遇到金錢、個資、驗證碼要求請先停止操作。",
        }

    ai_report = normalize_report_dict(ai_report)

    # ScamDNA 安全語境保護：AI 若因防詐宣導文字誤判高風險，使用 ScamDNA 的語境結果降權。
    if scamdna_report and is_scamdna_safe_context(scamdna_report) and scamdna_report.get("riskScore", 0) <= 25 and ai_report.get("riskScore", 0) >= 50:
        ai_report = {
            **ai_report,
            "riskScore": 0,
            "riskLevel": "安全無虞",
            "scamDNA": ["安全語境降權"],
            "reason": scamdna_report.get("reason") or "判定為正常防詐宣導或官方公告，已降低誤判風險。",
            "advice": "可正常瀏覽；若後續要求匯款、帳密、驗證碼或加 LINE，請重新掃描。",
        }

    # 7. 疊加 domain risk 與本地規則覆核
    if domain_risk_score:
        try:
            domain_score = domain_risk_score(target_url)
            if domain_score >= 60 and ai_report["riskScore"] < domain_score:
                ai_report["riskScore"] = min(100, domain_score)
                ai_report["riskLevel"] = score_to_level(ai_report["riskScore"])
                ai_report["reason"] = f"網域本身具有高風險特徵；{ai_report.get('reason', '')}".strip("；")
                ai_report["scamDNA"] = list(dict.fromkeys(ai_report.get("scamDNA", []) + ["偽裝官方"]))[:3]
        except Exception:
            pass

    if scamdna_report and scamdna_report.get("riskScore", 0) > ai_report.get("riskScore", 0):
        ai_report = {
            **ai_report,
            "riskScore": scamdna_report["riskScore"],
            "riskLevel": score_to_level(scamdna_report["riskScore"]),
            "reason": scamdna_report.get("reason") or ai_report.get("reason"),
            "advice": scamdna_report.get("advice") or ai_report.get("advice"),
            "scamDNA": list(dict.fromkeys(scamdna_report.get("scamDNA", []) + ai_report.get("scamDNA", [])))[:5],
        }

    if text_rule_report and text_rule_report.get("riskScore", 0) > ai_report.get("riskScore", 0):
        ai_report = {
            **ai_report,
            "riskScore": text_rule_report["riskScore"],
            "riskLevel": score_to_level(text_rule_report["riskScore"]),
            "reason": text_rule_report["reason"],
            "advice": text_rule_report["advice"],
            "scamDNA": list(dict.fromkeys(text_rule_report["scamDNA"] + ai_report.get("scamDNA", [])))[:3],
        }

    if whitelist_overridden and ai_report.get("riskScore", 0) < 80:
        ai_report["riskScore"] = 85
        ai_report["riskLevel"] = "極度危險"
        ai_report["reason"] = "白名單網站內仍出現重大詐騙話術，已啟動覆核攔截。"
        ai_report["scamDNA"] = list(dict.fromkeys(ai_report.get("scamDNA", []) + ["白名單覆核"]))[:3]

    ai_report = merge_component_reports(
        ("前端本地掃描", frontend_risk_report),
        ("ScamDNA", scamdna_report),
        ("文字規則", text_rule_report),
        ("Azure OpenAI", ai_report),
    )

    log_threat_to_db(
        ai_report,
        target_url=target_url,
        user_id=user_id,
        family_id=family_id,
        evidence_id=evidence_id,
        masked_text=masked_text,
        debounced=is_debounced,
    )

    return make_report_response(ai_report, masked_text)


# ==========================================
# 白名單 / 誤判 API
# ==========================================
@api_bp.route("/api/whitelist/check", methods=["POST"])
@limiter.limit("120 per minute")
def whitelist_check():
    data = get_json_body()
    identity = get_request_identity(data)

    demo_report = get_demo_report_if_enabled(data)
    if demo_report:
        return make_report_response(demo_report, mask_sensitive_data(str(data.get("text") or "")))

    url = data.get("url") or data.get("domain") or ""
    domain = normalize_domain(data.get("domain") or url)

    user_id = data.get("userID") or identity["userID"]
    family_id = data.get("familyID") or identity["familyID"]

    match = get_whitelist_match(domain, user_id=user_id, family_id=family_id)

    return jsonify({
        "status": "success",
        "isWhitelisted": bool(match),
        "domain": domain,
        "match": match,
    })


@api_bp.route("/api/report_false_positive", methods=["POST"])
@limiter.limit("60 per minute")
def report_false_positive():
    if not firebase_initialized:
        return jsonify({"status": "fail", "message": "Firebase 未連線"}), 500

    data = get_json_body()
    identity = get_request_identity(data)

    demo_report = get_demo_report_if_enabled(data)
    if demo_report:
        return make_report_response(demo_report, mask_sensitive_data(str(data.get("text") or "")))

    url = data.get("url") or ""
    domain = normalize_domain(data.get("domain") or url)

    if not domain:
        return jsonify({"status": "fail", "message": "無法解析網域"}), 400

    user_id = data.get("userID") or identity["userID"] or "anonymous"
    family_id = data.get("familyID") or identity["familyID"] or "none"
    scope = data.get("scope") or data.get("whitelist_scope") or "personal"

    if scope not in ["personal", "family", "global"]:
        scope = "personal"

    if scope == "family":
        authorized, auth_response = authorize_family_access(family_id, identity)
        if not authorized:
            return auth_response

    try:
        report_payload = {
            "url": url,
            "url_hash": hash_url(url),
            "domain": domain,
            "userID": user_id,
            "familyID": family_id,
            "riskScore": clamp_score(data.get("riskScore", 0)),
            "riskLevel": data.get("riskLevel", ""),
            "ai_reason": mask_sensitive_data(data.get("ai_reason", ""))[:500],
            "reported_reason": mask_sensitive_data(data.get("reported_reason", data.get("reason", "使用者回報誤判")))[:500],
            "scope": scope,
            "action_type": data.get("action_type", "false_positive_report"),
            "timestamp": get_tw_time(),
            "status": "submitted",
        }

        ref = db.reference("false_positive_reports").push(report_payload)

        # Demo / 個人白名單：直接核准。
        # 家庭與全域白名單正式版可改成 pending 審核。
        review_status = "approved" if scope in ["personal", "family"] else "pending"

        whitelist_written = False
        whitelist_payload = None
        whitelist_message = "已送出回報"

        if review_status == "approved":
            whitelist_written, whitelist_payload = write_whitelist(
                domain=domain,
                scope=scope,
                user_id=user_id,
                family_id=family_id,
                source="false_positive_report",
                review_status="approved",
            )

            whitelist_message = "已送出回報並加入白名單" if whitelist_written else str(whitelist_payload)

        return jsonify({
            "status": "success",
            "message": whitelist_message,
            "reportID": ref.key,
            "domain": domain,
            "scope": scope,
            "whitelistWritten": whitelist_written,
            "whitelist": whitelist_payload,
        })

    except Exception as e:
        return public_error("操作失敗，請稍後再試。", 500)


# ==========================================
# 家庭 API
# ==========================================
@api_bp.route("/api/create_family", methods=["POST"])
@limiter.limit("30 per minute")
def create_family():
    if not firebase_initialized:
        return jsonify({"status": "fail", "message": "Firebase 未連線"}), 500

    data = get_json_body()
    identity = get_request_identity(data)

    demo_report = get_demo_report_if_enabled(data)
    if demo_report:
        return make_report_response(demo_report, mask_sensitive_data(str(data.get("text") or "")))

    if REQUIRE_ACCESS_TOKEN and not identity.get("tokenPayload"):
        return public_error("缺少或無效的 accessToken。", 401)

    raw_uid = data.get("uid") or data.get("userID") or identity["userID"] or ""

    if not isinstance(raw_uid, str):
        return jsonify({"status": "fail", "message": "uid 必須是字串"}), 400

    uid = raw_uid.strip()
    install_id = str(data.get("installID") or identity["installID"] or "").strip()

    if not uid:
        return jsonify({"status": "fail", "message": "缺少 uid"}), 400

    try:
        invite_code = generate_invite_code()

        for _ in range(12):
            existed = db.reference(f"families/{invite_code}").get()

            if not existed:
                break

            invite_code = generate_invite_code()

        family_payload = {
            "familyID": invite_code,
            "inviteCode": invite_code,
            "guardianUID": uid,
            "members": {
                uid: {
                    "role": "guardian",
                    "joined_at": get_tw_time(),
                    "installID": install_id,
                }
            },
            "created_at": get_tw_time(),
            "updated_at": get_tw_time(),
            "status": "active",
        }

        db.reference(f"families/{invite_code}").set(family_payload)
        db.reference(f"users/{uid}").update({
            "userID": uid,
            "familyID": invite_code,
            "role": "guardian",
            "updated_at": get_tw_time(),
        })

        token, expires_at = create_access_token(
            user_id=uid,
            family_id=invite_code,
            install_id=install_id,
        )

        return jsonify({
            "status": "success",
            "message": "家庭防護群組建立成功",
            "familyID": invite_code,
            "inviteCode": invite_code,
            "accessToken": token,
            "expiresAt": expires_at,
        })

    except Exception as e:
        return public_error("操作失敗，請稍後再試。", 500)


@api_bp.route("/api/join_family", methods=["POST"])
@limiter.limit("60 per minute")
def join_family():
    if not firebase_initialized:
        return jsonify({"status": "fail", "message": "Firebase 未連線"}), 500

    data = get_json_body()
    identity = get_request_identity(data)

    demo_report = get_demo_report_if_enabled(data)
    if demo_report:
        return make_report_response(demo_report, mask_sensitive_data(str(data.get("text") or "")))

    if REQUIRE_ACCESS_TOKEN and not identity.get("tokenPayload"):
        return public_error("缺少或無效的 accessToken。", 401)

    uid = str(data.get("uid") or data.get("userID") or identity["userID"] or "").strip()
    invite_code = str(data.get("inviteCode") or data.get("familyID") or "").strip().upper()
    install_id = str(data.get("installID") or identity["installID"] or "").strip()

    if not uid:
        return jsonify({"status": "fail", "message": "缺少 uid"}), 400

    if not re.fullmatch(r"[A-Z0-9]{6}", invite_code):
        return jsonify({"status": "fail", "message": "邀請碼格式錯誤"}), 400

    try:
        family_ref = db.reference(f"families/{invite_code}")
        family_data = family_ref.get()

        if not family_data:
            return jsonify({"status": "fail", "message": "找不到此家庭邀請碼"}), 404

        family_ref.child(f"members/{uid}").set({
            "role": "member",
            "joined_at": get_tw_time(),
            "installID": install_id,
        })

        family_ref.update({
            "updated_at": get_tw_time(),
        })

        db.reference(f"users/{uid}").update({
            "userID": uid,
            "familyID": invite_code,
            "role": "member",
            "updated_at": get_tw_time(),
        })

        token, expires_at = create_access_token(
            user_id=uid,
            family_id=invite_code,
            install_id=install_id,
        )

        return jsonify({
            "status": "success",
            "message": "已成功加入家庭防護網",
            "familyID": invite_code,
            "inviteCode": invite_code,
            "accessToken": token,
            "expiresAt": expires_at,
        })

    except Exception as e:
        return public_error("操作失敗，請稍後再試。", 500)


@api_bp.route("/api/get_alerts", methods=["POST"])
@limiter.limit("120 per minute")
def get_alerts():
    if not firebase_initialized:
        return jsonify({"status": "fail", "message": "Firebase 未連線"}), 500

    data = get_json_body()
    identity = get_request_identity(data)

    demo_report = get_demo_report_if_enabled(data)
    if demo_report:
        return make_report_response(demo_report, mask_sensitive_data(str(data.get("text") or "")))

    family_id = str(data.get("familyID") or identity["familyID"] or "none").strip().upper()

    if not family_id or family_id == "NONE":
        return jsonify({"status": "fail", "message": "缺少 familyID"}), 400

    authorized, auth_response = authorize_family_access(family_id, identity)
    if not authorized:
        return auth_response

    try:
        scan_history = db.reference("scan_history").order_by_child("familyID").equal_to(family_id).limit_to_last(50).get()

        records = []

        if isinstance(scan_history, dict):
            for key, item in scan_history.items():
                if not isinstance(item, dict):
                    continue

                item["id"] = key
                records.append(item)

        records.sort(key=lambda item: str(item.get("timestamp", "")), reverse=True)

        return jsonify({
            "status": "success",
            "familyID": family_id,
            "data": records,
            "count": len(records),
        })

    except Exception as e:
        return public_error("操作失敗，請稍後再試。", 500)


@api_bp.route("/api/clear_alerts", methods=["POST"])
@limiter.limit("20 per minute")
def clear_alerts():
    if not firebase_initialized:
        return jsonify({"status": "fail", "message": "Firebase 未連線"}), 500

    data = get_json_body()
    identity = get_request_identity(data)

    demo_report = get_demo_report_if_enabled(data)
    if demo_report:
        return make_report_response(demo_report, mask_sensitive_data(str(data.get("text") or "")))

    family_id = str(data.get("familyID") or identity["familyID"] or "none").strip().upper()

    if not family_id or family_id == "NONE":
        return jsonify({"status": "fail", "message": "缺少 familyID"}), 400

    authorized, auth_response = authorize_family_access(
        family_id,
        identity,
        require_guardian=REQUIRE_GUARDIAN_FOR_CLEAR_ALERTS
    )
    if not authorized:
        return auth_response

    try:
        scan_history = db.reference("scan_history").order_by_child("familyID").equal_to(family_id).get()

        deleted_count = 0

        if isinstance(scan_history, dict):
            for key in scan_history.keys():
                db.reference(f"scan_history/{key}").delete()
                deleted_count += 1

        socketio.emit(
            "demo_reset_triggered",
            {
                "familyID": family_id,
                "message": "戰情紀錄已清空",
                "timestamp": get_tw_time(),
            },
            room=family_id,
        )

        return jsonify({
            "status": "success",
            "message": "已清空戰情紀錄",
            "deleted": deleted_count,
        })

    except Exception as e:
        return public_error("操作失敗，請稍後再試。", 500)


# ==========================================
# 防詐演練串流
# ==========================================
@api_bp.route("/api/simulate_scam", methods=["POST"])
@limiter.limit("60 per minute")
def simulate_scam():
    data = get_json_body()

    user_message = str(data.get("message") or "")[:800]
    chat_history = data.get("history") or []
    scenario_type = str(data.get("scenario") or data.get("scenario_type") or "investment")

    if scenario_type not in ["investment", "ecommerce", "romance"]:
        scenario_type = "investment"

    def generate():
        try:
            for chunk in stream_scam_simulation(chat_history, scenario_type, user_message):
                yield f"data: {json.dumps({'text': chunk}, ensure_ascii=False)}\n\n"

            yield "data: [DONE]\n\n"

        except Exception as e:
            fallback_text = "⚠️ 演練服務暫時異常，請記住：遇到匯款、驗證碼、下載 App、操作 ATM，都要先停止並查證。"

            for char in fallback_text:
                yield f"data: {json.dumps({'text': char}, ensure_ascii=False)}\n\n"

            yield "data: [DONE]\n\n"

    return Response(generate(), mimetype="text/event-stream")


# ==========================================
# LINE Webhook
# ==========================================
@api_bp.route("/callback", methods=["POST"])
def line_callback():
    signature = request.headers.get("X-Line-Signature", "")
    body = request.get_data(as_text=True)

    try:
        handler.handle(body, signature)

    except InvalidSignatureError:
        return "Invalid signature", 400

    except Exception as e:
        print(f"❌ LINE callback error: {e}", flush=True)
        return "error", 500

    return "OK"


@handler.add(MessageEvent, message=TextMessageContent)
def handle_line_message(event):
    text = event.message.text.strip()

    if not LINE_CHANNEL_ACCESS_TOKEN:
        return

    reply_text = (
        "🛡️ AI 防詐盾牌已收到訊息。\n"
        "若要綁定家庭防護，請在瀏覽器擴充功能輸入家庭邀請碼。\n"
        "若遇到疑似詐騙，請先停止操作並撥打 165。"
    )

    try:
        if text.lower().startswith("bind ") or text.startswith("綁定"):
            parts = text.split()

            if len(parts) >= 2:
                family_id = parts[-1].strip().upper()

                if firebase_initialized and re.fullmatch(r"[A-Z0-9]{6}", family_id):
                    db.reference(f"line_bindings/{event.source.user_id}").set({
                        "familyID": family_id,
                        "line_id": event.source.user_id,
                        "updated_at": get_tw_time(),
                    })

                    reply_text = f"✅ 已收到綁定請求：{family_id}\n請回到瀏覽器擴充功能確認家庭防護狀態。"

        with ApiClient(configuration) as api_client:
            line_bot_api = MessagingApi(api_client)
            line_bot_api.reply_message(
                ReplyMessageRequest(
                    reply_token=event.reply_token,
                    messages=[TextMessage(text=reply_text)],
                )
            )

    except Exception as e:
        print(f"⚠️ LINE 回覆失敗：{e}", flush=True)


@handler.add(PostbackEvent)
def handle_line_postback(event):
    try:
        data = event.postback.data or ""

        if data.startswith("family_alert_ack"):
            reply_text = "✅ 已收到您的確認。請用溫和語氣關心家人，避免責備，先陪他一起查證。"
        else:
            reply_text = "🛡️ AI 防詐盾牌已收到您的操作。"

        with ApiClient(configuration) as api_client:
            line_bot_api = MessagingApi(api_client)
            line_bot_api.reply_message(
                ReplyMessageRequest(
                    reply_token=event.reply_token,
                    messages=[TextMessage(text=reply_text)],
                )
            )

    except Exception as e:
        print(f"⚠️ LINE Postback 處理失敗：{e}", flush=True)


@api_bp.route("/test_line", methods=["GET", "POST"])
def test_line():
    target = LINE_USER_ID or ADMIN_LINE_ID

    if not target:
        return jsonify({
            "status": "fail",
            "message": "LINE_USER_ID / ADMIN_LINE_ID 未設定",
        }), 400

    if not LINE_CHANNEL_ACCESS_TOKEN:
        return jsonify({
            "status": "fail",
            "message": "LINE_CHANNEL_ACCESS_TOKEN 未設定",
        }), 400

    try:
        with ApiClient(configuration) as api_client:
            line_bot_api = MessagingApi(api_client)
            line_bot_api.push_message(
                PushMessageRequest(
                    to=target,
                    messages=[
                        TextMessage(text="🛡️ AI 防詐盾牌測試推播成功！")
                    ],
                )
            )

        return jsonify({
            "status": "success",
            "message": "LINE 測試推播已送出",
        })

    except Exception as e:
        return jsonify({
            "status": "fail",
            "message": "LINE 測試推播失敗，請檢查 LINE_CHANNEL_ACCESS_TOKEN 與 LINE_USER_ID。",
        }), 500