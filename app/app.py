import os
import logging
from flask import Flask
from extensions import socketio, limiter, firebase_initialized
from routes import api_bp
# 如果你有用到跨域請求，可以取消下面這行的註解
# from flask_cors import CORS

def create_app():
    app = Flask(__name__)
    
    # 基本安全設定
    app.config['SECRET_KEY'] = os.getenv("SECRET_KEY", "ai_shield_secure_2026")
    # CORS(app) 

    # 🟢 啟用基礎日誌：若 LINE 推播失敗，終端機會明確告訴你原因
    logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
    app.logger.setLevel(logging.INFO)

    # 初始化擴充套件
    limiter.init_app(app)
    
    # 註冊藍圖 (API 路由)
    app.register_blueprint(api_bp)
    
    # 初始化 SocketIO (支援戰情室即時連線)
    socketio.init_app(app, cors_allowed_origins="*")
    
    return app

# 建立應用程式實例
app = create_app()

if __name__ == "__main__":
    # 從環境變數取得 Port，預設 5000
    port = int(os.environ.get("PORT", 5000))
    
    app.logger.info(f"🚀 AI 防詐盾牌伺服器啟動中... Port: {port}")
    if firebase_initialized:
        app.logger.info("✅ Firebase 已連線 (100%免費版)")
    else:
        app.logger.warning("⚠️ Firebase 未連線，請確認金鑰設定")
        
    # 🟢 關閉 debug 模式，確保發生錯誤時系統仍能優雅回傳 500 JSON，不會讓網頁噴出一堆可怕的程式碼
    socketio.run(app, host='0.0.0.0', port=port, debug=False, allow_unsafe_werkzeug=True)