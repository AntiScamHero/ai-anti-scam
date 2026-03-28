import os
import sys
import io
from flask import Flask
from flask_cors import CORS
from flask_socketio import join_room

# 1️⃣ 引入我們寫好的擴充套件
from extensions import limiter, socketio
# 2️⃣ 引入剛剛那份幾百行的「計算紙」藍圖
from routes import api_bp

os.environ["PYTHONUTF8"] = "1"
os.environ["PYTHONIOENCODING"] = "utf-8"
if sys.stdout.encoding != 'utf-8': 
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
if sys.stderr.encoding != 'utf-8': 
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

# 建立主程式
app = Flask(__name__)
app.config['JSON_AS_ASCII'] = False
CORS(app, resources={r"/*": {"origins": "*"}})

# 綁定擴充套件
limiter.init_app(app)
socketio.init_app(app)

# 註冊我們分出去的幾百行 API 藍圖
app.register_blueprint(api_bp)

# SocketIO 的連線邏輯 (必須綁在主程式層級)
@socketio.on('join_family_room')
def handle_join_family_room(data):
    family_id = data.get('familyID')
    if family_id:
        join_room(family_id)
        print(f"💻 戰情室已連線並加入房間: {family_id}", flush=True)

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print("\n" + "="*50)
    print("🚀 系統啟動中...")
    print(f"👉 請打開瀏覽器點擊這個連結測試：http://127.0.0.1:{port}/")
    print("="*50 + "\n", flush=True)
    
    socketio.run(app, host='0.0.0.0', port=port, debug=True, allow_unsafe_werkzeug=True)