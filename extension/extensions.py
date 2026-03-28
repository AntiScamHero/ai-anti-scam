import os
import firebase_admin
from firebase_admin import credentials
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from flask_socketio import SocketIO

# 1. 準備好 Limiter (防禦流量攻擊的工具)
limiter = Limiter(
    key_func=get_remote_address,
    default_limits=["10000 per day", "5000 per hour"],
    storage_uri="memory://"
)

# 2. 準備好 SocketIO (即時戰情室連線工具)
socketio = SocketIO(cors_allowed_origins="*")

# 3. 準備好 Firebase (雲端資料庫連線 - 100%免費版)
firebase_initialized = False
KEY_PATH = os.getenv("FIREBASE_KEY_PATH", "serviceAccountKey.json")

try:
    if os.path.exists(KEY_PATH) and not firebase_admin._apps:
        cred = credentials.Certificate(KEY_PATH)
        firebase_admin.initialize_app(cred, {
            'databaseURL': 'https://antifraud-ai-94d72-default-rtdb.asia-southeast1.firebasedatabase.app'
            # 🛑 已經將需要付費的 storageBucket 完全移除！
        })
        firebase_initialized = True
        print("✅ Firebase 初始化成功 (已啟動 100% 免費純文字截圖模式)！", flush=True)
    elif firebase_admin._apps:
        firebase_initialized = True
    else:
        print("⚠️ 找不到 serviceAccountKey.json，Firebase 啟動失敗", flush=True)
except Exception as e:
    print(f"⚠️ Firebase 啟動異常：{repr(e)}", flush=True)