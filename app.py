import sys
import io
import os
import re
import json
import datetime
import random
import string
import threading
from dotenv import load_dotenv

# ==========================================
# ⚙️ 系統與環境設定
# ==========================================
os.environ["PYTHONUTF8"] = "1"
os.environ["PYTHONIOENCODING"] = "utf-8"

if sys.stdout.encoding != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
if sys.stderr.encoding != 'utf-8':
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

os.environ.pop('HTTP_PROXY', None)
os.environ.pop('HTTPS_PROXY', None)
os.environ.pop('http_proxy', None)
os.environ.pop('https_proxy', None)

from flask import Flask, request, jsonify
from flask_cors import CORS
import firebase_admin
from firebase_admin import credentials, db 
from openai import AzureOpenAI
from linebot import LineBotApi, WebhookHandler
from linebot.exceptions import InvalidSignatureError
from linebot.models import MessageEvent, TextMessage, TextSendMessage

load_dotenv()

app = Flask(__name__)
app.config['JSON_AS_ASCII'] = False
CORS(app, resources={r"/*": {"origins": "*"}})

def get_tw_time():
    return (datetime.datetime.utcnow() + datetime.timedelta(hours=8)).strftime("%Y-%m-%d %H:%M:%S")

# ==========================================
# 🔑 金鑰與第三方服務初始化
# ==========================================
LINE_CHANNEL_ACCESS_TOKEN = os.getenv("LINE_CHANNEL_ACCESS_TOKEN")
LINE_CHANNEL_SECRET = os.getenv("LINE_CHANNEL_SECRET")
LINE_USER_ID = os.getenv("LINE_USER_ID")

line_bot_api = LineBotApi(LINE_CHANNEL_ACCESS_TOKEN)
handler = WebhookHandler(LINE_CHANNEL_SECRET)

KEY_PATH = os.getenv("FIREBASE_KEY_PATH", "/etc/secrets/serviceAccountKey.json")
firebase_initialized = False

try:
    if os.path.exists(KEY_PATH) and not firebase_admin._apps:
        cred = credentials.Certificate(KEY_PATH)
        firebase_admin.initialize_app(cred, {
            'databaseURL': 'https://antifraud-ai-94d72-default-rtdb.asia-southeast1.firebasedatabase.app'
        })
        firebase_initialized = True
        print("✅ Firebase 連線成功")
    elif firebase_admin._apps:
        firebase_initialized = True
except Exception as e:
    print(f"⚠️ Firebase 啟動失敗：{repr(e)}")

client = AzureOpenAI(
    api_version="2025-01-01-preview",
    azure_endpoint=os.getenv("AZURE_ENDPOINT"),
    api_key=os.getenv("AZURE_API_KEY"),
)

def clean_json_text(text):
    text = text.strip()
    text = re.sub(r'^```json\s*|```$', '', text, flags=re.MULTILINE)
    return text.strip()

# ==========================================
# 🟢 LINE Bot 路由與邏輯
# ==========================================
@app.route("/callback", methods=['POST'])
def callback():
    signature = request.headers.get('X-Line-Signature', '')
    body = request.get_data(as_text=True)
    try:
        handler.handle(body, signature)
    except InvalidSignatureError:
        return jsonify({"status": "error"}), 400
    return 'OK'

@handler.add(MessageEvent, message=TextMessage)
def handle_message(event):
    if not firebase_initialized:
        line_bot_api.reply_message(event.reply_token, TextSendMessage(text="⚠️ 系統資料庫維護中"))
        return
        
    user_msg = event.message.text
    line_user_id = event.source.user_id 

    if "戰情" in user_msg or "回報" in user_msg:
        try:
            users_ref = db.reference('users').get()
            my_family_id = None
            if users_ref:
                for uid, u_data in users_ref.items():
                    if isinstance(u_data, dict) and u_data.get('line_id') == line_user_id:
                        my_family_id = u_data.get('familyID')
                        break
            
            if not my_family_id or my_family_id == 'none':
                line_bot_api.reply_message(event.reply_token, TextSendMessage(text="⚠️ 尚未綁定家庭 ID"))
                return

            all_records = db.reference('scan_history').get()
            if all_records:
                family_records = [val for val in all_records.values() if isinstance(val, dict) and val.get('familyID') == my_family_id]
                total_scans = len(family_records)
                danger_count = 0
                for val in family_records:
                    report_raw = val.get('report', '{}')
                    report_data = json.loads(report_raw) if isinstance(report_raw, str) else report_raw
                    if int(report_data.get('riskScore', 0)) >= 70:
                        danger_count += 1
                
                reply_text = f"🛡️ 【{my_family_id} 家庭戰情室】\n🔍 掃描：{total_scans} 次\n🛑 攔截：{danger_count} 次"
            else:
                reply_text = "目前無紀錄"
        except Exception:
            reply_text = "⚠️ 讀取失敗"
        line_bot_api.reply_message(event.reply_token, TextSendMessage(text=reply_text))

# ==========================================
# 🛡️ 核心 API：AI 掃描端點
# ==========================================
@app.route('/')
def home():
    return "🛡️ AI 防詐系統運作中"

@app.route('/scan', methods=['POST'])
def scan_url():
    data = request.json
    target_url = data.get('url', '')
    web_text = data.get('text', '') 
    image_url = data.get('image_url', '') 
    user_id = data.get('userID', 'anonymous')
    family_id = data.get('familyID', 'none')
    is_urgent = data.get('is_urgent', False)

    if not target_url and not image_url and not web_text:
        return jsonify({"error": "系統未接收到內容"}), 400

    if firebase_initialized and target_url and not image_url and not is_urgent:
        safe_url_key = re.sub(r'[.#$\[\]]', '_', target_url)[:150] 
        try:
            cached_result = db.reference(f'url_cache/{safe_url_key}').get()
            if cached_result:
                cached_dict = json.loads(cached_result) if isinstance(cached_result, str) else cached_result
                if 'riskScore' in cached_dict:
                    response_data = cached_dict.copy()
                    response_data["report"] = json.dumps(cached_dict, ensure_ascii=False) if not isinstance(cached_result, str) else cached_result
                    return jsonify(response_data)
                else:
                    db.reference(f'url_cache/{safe_url_key}').delete()
        except Exception: pass

    if is_urgent:
        def send_emergency_alert():
            try:
                alert_msg = f"🚨 【緊急通報】\n網頁已被強制阻擋！\n原因：{web_text}\n來源網址：{target_url}"
                line_bot_api.push_message(LINE_USER_ID, TextSendMessage(text=alert_msg))
                if firebase_initialized:
                    db.reference('scan_history').push({
                        'url': target_url, 
                        'report': json.dumps({"riskScore": 100, "riskLevel": "極度危險", "reason": web_text}, ensure_ascii=False),
                        'userID': user_id, 'familyID': family_id, 'timestamp': get_tw_time()
                    })
            except Exception: pass
        threading.Thread(target=send_emergency_alert).start()
        return jsonify({"status": "success"})

    try:
        system_prompt = "你是一位資安專家。回傳標準 JSON：riskScore (0-100), riskLevel, dimensions, reason, advice, highlight_keywords"
        messages = [{"role": "system", "content": system_prompt}]
        
        if image_url:
            messages.append({"role": "user", "content": [{"type": "text", "text": "分析此圖："}, {"type": "image_url", "image_url": {"url": image_url}}]})
            model_to_use = os.getenv("AZURE_MODEL_IMAGE", "gpt-4o") 
        else:
            messages.append({"role": "user", "content": [{"type": "text", "text": f"分析內容：\n{web_text[:3500]}"}]})
            model_to_use = os.getenv("AZURE_MODEL_TEXT", "gpt-4o")

        response = client.chat.completions.create(model=model_to_use, messages=messages, response_format={ "type": "json_object" })
        report_dict = json.loads(clean_json_text(response.choices[0].message.content))
        report_str = json.dumps(report_dict, ensure_ascii=False)
        
        if firebase_initialized:
            if target_url and not image_url:
                safe_url_key = re.sub(r'[.#$\[\]]', '_', target_url)[:150]
                try: db.reference(f'url_cache/{safe_url_key}').set(report_str)
                except Exception: pass

            if report_dict.get('riskLevel') in ['高度危險', '極度危險']:
                alert_msg = f"🚨 家庭警報！\n風險等級：{report_dict.get('riskLevel')}\n原因：{report_dict.get('reason')}"
                threading.Thread(target=lambda: line_bot_api.push_message(LINE_USER_ID, TextSendMessage(text=alert_msg))).start()

            db.reference('scan_history').push({
                'url': target_url, 'report': report_str, 'userID': user_id, 
                'familyID': family_id, 'timestamp': get_tw_time()
            })
        
        response_data = report_dict.copy()
        response_data["report"] = report_str
        return jsonify(response_data)

    except Exception as e:
        return jsonify({"riskScore": 0, "reason": f"系統異常: {str(e)}"}), 200

# ==========================================
# 👨‍👩‍👧 家庭 API (包含清除功能)
# ==========================================
@app.route('/api/report_false_positive', methods=['POST'])
def report_false_positive():
    if not firebase_initialized: return jsonify({"status": "success"}) 
    try:
        data = request.json
        db.reference('false_positives').push({'url': data.get('url', ''), 'reason': data.get('reported_reason', ''), 'timestamp': get_tw_time()})
        return jsonify({"status": "success"})
    except Exception: return jsonify({"status": "error"})

@app.route('/api/create_family', methods=['POST'])
def create_family():
    if not firebase_initialized: return jsonify({"status": "error", "message": "資料庫備援中"})
    try:
        uid = request.json.get('uid')
        invite_code = ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))
        db.reference(f'families/{invite_code}').set({'guardianUID': uid, 'memberUIDs': {}, 'familyID': invite_code, 'createdAt': get_tw_time()})
        db.reference(f'users/{uid}').update({'role': 'guardian', 'familyID': invite_code})
        return jsonify({"status": "success", "inviteCode": invite_code})
    except Exception: return jsonify({"status": "error"})

@app.route('/api/join_family', methods=['POST'])
def join_family():
    if not firebase_initialized: return jsonify({"status": "error"})
    try:
        data = request.json
        uid, code = data.get('uid'), data.get('inviteCode', '').upper()
        if db.reference(f'families/{code}').get():
            db.reference(f'families/{code}/memberUIDs/{uid}').set(True)
            db.reference(f'users/{uid}').update({'role': 'member', 'familyID': code})
            return jsonify({"status": "success"})
        return jsonify({"status": "fail", "message": "無效的邀請碼"})
    except Exception: return jsonify({"status": "error"})

@app.route('/api/get_alerts', methods=['POST'])
def get_alerts():
    if not firebase_initialized: return jsonify({"status": "fail", "data": []})
    try:
        family_id = request.json.get('familyID')
        if not family_id or family_id == 'none': return jsonify({"status": "fail", "data": []})
        all_records = db.reference('scan_history').get()
        result = [val for key, val in all_records.items() if val.get('familyID') == family_id] if all_records else []
        result.sort(key=lambda x: x.get('timestamp', ''), reverse=True)
        return jsonify({"status": "success", "data": result[:10]})
    except Exception as e: return jsonify({"status": "error", "message": str(e)})

@app.route('/api/clear_alerts', methods=['POST'])
def clear_alerts():
    if not firebase_initialized: 
        return jsonify({"status": "error", "message": "資料庫備援中"})
    try:
        family_id = request.json.get('familyID')
        if not family_id or family_id == 'none': 
            return jsonify({"status": "fail", "message": "無效的家庭 ID"})
        
        ref = db.reference('scan_history')
        all_records = ref.get()
        if all_records:
            updates = {}
            for key, val in all_records.items():
                if isinstance(val, dict) and val.get('familyID') == family_id:
                    updates[key] = None 
            
            if updates:
                ref.update(updates)
                print(f"🧹 成功清除家庭 [{family_id}] 的 {len(updates)} 筆紀錄")
                
        return jsonify({"status": "success"})
    except Exception as e: 
        print(f"❌ 清除失敗: {str(e)}")
        return jsonify({"status": "error", "message": str(e)})

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print(f"🚀 啟動伺服器 (Port: {port})...")
    app.run(host='0.0.0.0', port=port)