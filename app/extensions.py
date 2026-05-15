# extensions.py
# AI 防詐盾牌 - Flask 擴充模組初始化
#
# 競賽封版重點：
# 1. Demo / competition / production 模式清楚分離。
# 2. production 不允許 CORS 來源與 Firebase 憑證未設定卻假裝正常。
# 3. Rate limit 儲存後端可透過環境變數切換，避免正式部署只靠記憶體。

import base64
import json
import os
from typing import Any, Dict, List, Union

import firebase_admin
from firebase_admin import credentials
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from flask_socketio import SocketIO


# ==========================================
# 環境變數解析
# ==========================================
def get_app_env() -> str:
    return os.getenv("AI_SHIELD_ENV", os.getenv("FLASK_ENV", "competition")).strip().lower()


def is_production_like() -> bool:
    return get_app_env() in {"production", "prod", "release"}


def parse_bool_env(key: str, default: bool = False) -> bool:
    value = os.getenv(key)

    if value is None:
        return default

    return value.strip().lower() in {"1", "true", "yes", "y", "on"}


def parse_default_limits() -> List[str]:
    """
    DEFAULT_RATE_LIMITS 範例：
    5000 per day,1000 per hour
    """
    raw = os.getenv("DEFAULT_RATE_LIMITS", "5000 per day,1000 per hour")
    return [item.strip() for item in raw.split(",") if item.strip()]


def parse_socket_origins() -> Union[str, List[str]]:
    """
    ALLOWED_ORIGINS 範例：
    chrome-extension://你的ExtensionID,https://你的正式網站,http://127.0.0.1:5500
    """
    raw = os.getenv("ALLOWED_ORIGINS", "").strip()

    if not raw:
        if is_production_like():
            raise RuntimeError("正式環境請設定 ALLOWED_ORIGINS，且不要使用 *。")
        return "*"

    if raw == "*":
        if is_production_like():
            raise RuntimeError("正式環境不允許 ALLOWED_ORIGINS=*。")
        return "*"

    origins = [item.strip() for item in raw.split(",") if item.strip()]
    if not origins:
        if is_production_like():
            raise RuntimeError("ALLOWED_ORIGINS 格式錯誤，正式環境必須至少設定一個來源。")
        return "*"

    return origins


def get_socket_async_mode():
    """
    Flask-SocketIO async_mode：
    - 競賽 / 本機測試強制使用 threading，確保 /scan 併發測試可由 Werkzeug 多執行緒處理。
    - 即使系統環境殘留 SOCKETIO_ASYNC_MODE=eventlet/gevent，competition/development 也會覆寫成 threading。
    - production 若真的要使用 eventlet/gevent，需同時設定 AI_SHIELD_ALLOW_GREENLET_SERVER=true。
    """
    raw = os.getenv("SOCKETIO_ASYNC_MODE", "").strip().lower()

    if not is_production_like():
        if raw in {"eventlet", "gevent", "gevent_uwsgi"} and not parse_bool_env("AI_SHIELD_ALLOW_GREENLET_SERVER", False):
            print(
                f"⚠️ 本機/競賽模式偵測到 SOCKETIO_ASYNC_MODE={raw}，已改用 threading 以通過併發測試。",
                flush=True,
            )
        return "threading"

    if raw:
        return raw

    return "threading"


def get_rate_limit_storage_uri() -> str:
    storage_uri = os.getenv("RATELIMIT_STORAGE_URI", "memory://").strip() or "memory://"

    if storage_uri == "memory://" and is_production_like():
        print(
            "⚠️ 正式環境目前使用 memory:// Rate Limit。建議改用 Redis，例如 RATELIMIT_STORAGE_URI=redis://...",
            flush=True,
        )

    return storage_uri


# ==========================================
# Flask-Limiter
# ==========================================
limiter = Limiter(
    key_func=get_remote_address,
    default_limits=parse_default_limits(),
    storage_uri=get_rate_limit_storage_uri(),
)


# ==========================================
# Flask-SocketIO
# ==========================================
socketio = SocketIO(
    cors_allowed_origins=parse_socket_origins(),
    async_mode=get_socket_async_mode(),
    ping_timeout=int(os.getenv("SOCKETIO_PING_TIMEOUT", "30")),
    ping_interval=int(os.getenv("SOCKETIO_PING_INTERVAL", "15")),
    logger=parse_bool_env("SOCKETIO_LOGGER", False),
    engineio_logger=parse_bool_env("SOCKETIO_ENGINEIO_LOGGER", False),
)


# ==========================================
# Firebase 初始化
# ==========================================
firebase_initialized = False

KEY_PATH = os.getenv("FIREBASE_KEY_PATH", "config/serviceAccountKey.json")

# development / competition 可沿用原 Demo 資料庫網址；production 必須從環境變數設定，避免正式版硬寫專案資源。
DEFAULT_DEMO_DATABASE_URL = "https://antifraud-ai-94d72-default-rtdb.asia-southeast1.firebasedatabase.app"
DATABASE_URL = os.getenv("FIREBASE_DATABASE_URL", "" if is_production_like() else DEFAULT_DEMO_DATABASE_URL).strip()


def load_firebase_credentials_from_json_env() -> Dict[str, Any]:
    """
    支援 Render / Railway / Docker 這類雲端平台：
    FIREBASE_CREDENTIALS_JSON='{"type":"service_account",...}'
    """
    raw = os.getenv("FIREBASE_CREDENTIALS_JSON", "").strip()

    if not raw:
        return {}

    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        print(f"⚠️ FIREBASE_CREDENTIALS_JSON 不是有效 JSON：{exc}", flush=True)
        return {}


def load_firebase_credentials_from_base64_env() -> Dict[str, Any]:
    """
    支援把 service account JSON 用 base64 存進環境變數：
    FIREBASE_CREDENTIALS_BASE64=xxxxx
    """
    raw = os.getenv("FIREBASE_CREDENTIALS_BASE64", "").strip()

    if not raw:
        return {}

    try:
        decoded = base64.b64decode(raw).decode("utf-8")
        return json.loads(decoded)
    except Exception as exc:
        print(f"⚠️ FIREBASE_CREDENTIALS_BASE64 解碼失敗：{exc}", flush=True)
        return {}


def build_firebase_credential():
    """
    Firebase 憑證載入優先順序：
    1. FIREBASE_CREDENTIALS_JSON
    2. FIREBASE_CREDENTIALS_BASE64
    3. FIREBASE_KEY_PATH 指向的 JSON 檔案
    """
    json_env_cred = load_firebase_credentials_from_json_env()

    if json_env_cred:
        print("🔐 使用 FIREBASE_CREDENTIALS_JSON 初始化 Firebase。", flush=True)
        return credentials.Certificate(json_env_cred)

    base64_env_cred = load_firebase_credentials_from_base64_env()

    if base64_env_cred:
        print("🔐 使用 FIREBASE_CREDENTIALS_BASE64 初始化 Firebase。", flush=True)
        return credentials.Certificate(base64_env_cred)

    if os.path.exists(KEY_PATH):
        print(f"🔐 使用本機 Firebase 憑證檔初始化：{KEY_PATH}", flush=True)
        return credentials.Certificate(KEY_PATH)

    return None


def initialize_firebase() -> bool:
    """
    初始化 Firebase Admin。
    - demo / competition：找不到憑證時允許系統啟動，但家庭、證據與戰情室 API 會回報 Firebase 未連線。
    - production：找不到 DATABASE_URL 或憑證時直接中止，避免正式版假裝已啟用資料保護。
    """
    if firebase_admin._apps:
        print("✅ Firebase 已初始化。", flush=True)
        return True

    if not DATABASE_URL:
        message = "FIREBASE_DATABASE_URL 未設定，Firebase 未啟用。"
        if is_production_like():
            raise RuntimeError(f"正式環境錯誤：{message}")
        print(f"⚠️ {message}", flush=True)
        return False

    cred = build_firebase_credential()

    if not cred:
        message = "找不到 Firebase 憑證，可使用 serviceAccountKey.json、FIREBASE_CREDENTIALS_JSON 或 FIREBASE_CREDENTIALS_BASE64。"
        if is_production_like():
            raise RuntimeError(f"正式環境錯誤：{message}")
        print(f"⚠️ {message}", flush=True)
        return False

    try:
        firebase_admin.initialize_app(
            cred,
            {
                "databaseURL": DATABASE_URL,
            },
        )

        print("✅ Firebase 初始化成功：已啟用 Realtime Database。", flush=True)
        return True

    except ValueError as exc:
        if firebase_admin._apps:
            print("✅ Firebase 已由其他模組初始化。", flush=True)
            return True

        if is_production_like():
            raise RuntimeError(f"正式環境 Firebase 初始化失敗：{exc}") from exc

        print(f"⚠️ Firebase 初始化 ValueError：{exc}", flush=True)
        return False

    except Exception as exc:
        if is_production_like():
            raise RuntimeError(f"正式環境 Firebase 啟動異常：{repr(exc)}") from exc

        print(f"⚠️ Firebase 啟動異常：{repr(exc)}", flush=True)
        return False


firebase_initialized = initialize_firebase()
