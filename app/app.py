# app.py
# AI 防詐盾牌 - Flask / Socket.IO 入口
# 修正版重點：
# 1. 正確註冊 routes.py 的 api_bp，避免 /api/auth/install 變成 404。
# 2. 加入 ProxyFix，讓 Render / 反向代理後方仍可取得真實來源資訊。
# 3. 補健康檢查路由，供 Render Health Check 使用。

import os

from dotenv import load_dotenv
from flask import Flask, jsonify, request
from flask_cors import CORS
from werkzeug.middleware.proxy_fix import ProxyFix

load_dotenv()


def create_app():
    app = Flask(__name__)

    # Render / Nginx / Cloudflare 等反向代理環境：信任第一層 proxy header。
    app.wsgi_app = ProxyFix(
        app.wsgi_app,
        x_for=1,
        x_proto=1,
        x_host=1,
        x_prefix=1,
    )

    CORS(app, resources={r"/*": {"origins": "*"}})

    # extensions.py 內通常會建立 socketio / limiter / firebase。
    # 這裡只做初始化，不改變原本的 routes.py 邏輯。
    try:
        from extensions import limiter, socketio

        try:
            limiter.init_app(app)
        except Exception:
            pass

        try:
            socketio.init_app(app, cors_allowed_origins="*")
        except Exception:
            pass

    except Exception as exc:
        print(f"⚠️ extensions 初始化略過：{exc}", flush=True)

    # 關鍵修正：一定要註冊 routes.py 的 Blueprint。
    # routes.py 裡的路由已經包含 /scan、/api/auth/install、/api/create_family 等完整路徑，
    # 所以這裡不可再加 url_prefix='/api'，否則會變成 /api/api/auth/install。
    try:
        from routes import api_bp
        app.register_blueprint(api_bp)
        print("✅ routes.py api_bp 已註冊：/scan、/api/auth/install、家庭 API 可用", flush=True)
    except Exception as exc:
        print(f"❌ routes.py api_bp 註冊失敗：{exc}", flush=True)
        raise

    @app.route("/health", methods=["GET", "HEAD"])
    @app.route("/healthz", methods=["GET", "HEAD"])
    @app.route("/api/health", methods=["GET", "HEAD"])
    def app_health_check():
        if request.method == "HEAD":
            return "", 200
        return jsonify({
            "status": "success",
            "message": "OK",
            "service": "AI 防詐盾牌 API",
        }), 200

    return app


app = create_app()


if __name__ == "__main__":
    port = int(os.getenv("PORT", "5000"))
    debug = os.getenv("FLASK_DEBUG", "false").lower() in {"1", "true", "yes", "on"}

    try:
        from extensions import socketio
        socketio.run(app, host="0.0.0.0", port=port, debug=debug)
    except Exception:
        app.run(host="0.0.0.0", port=port, debug=debug)
