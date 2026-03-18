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

# 強制設定系統輸出為 UTF-8，避免中文亂碼
os.environ["PYTHONUTF8"] = "1"
os.environ["PYTHONIOENCODING"] = "utf-8"

if sys.stdout.encoding != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
if sys.stderr.encoding != 'utf-8':
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

from flask import Flask, request, jsonify
from flask_cors import CORS
import firebase_admin
from firebase_admin import credentials, db 
from openai import AzureOpenAI
from linebot import LineBotApi, WebhookHandler
from linebot.exceptions import InvalidSignatureError
from linebot.models import MessageEvent, TextMessage, TextSendMessage

# 載入 .env 檔案中的環境變數
load_dotenv()

app = Flask(__name__)
app.config['JSON_AS_ASCII'] = False

# ---------------------------------------------------------
# 🛡️ CORS 安全設定
# ---------------------------------------------------------
# 改為從環境變數讀取擴充功能 ID，預設值為提示文字
ALLOWED_EXTENSION_ID = os.getenv("CHROME_EXTENSION_ID", "chrome-extension://YOUR_EXTENSION_ID_HERE")

CORS(app, resources={
    r"/*": {
        "origins": [
            ALLOWED_EXTENSION_ID,
            "http://localhost:5000",   
            "http://127.0.0.1:5000"
        ]
    }
})

# ---------------------------------------------------------
# 🔑 金鑰與第三方服務初始化
# ---------------------------------------------------------
LINE_CHANNEL_ACCESS_TOKEN = os.getenv("LINE_CHANNEL_ACCESS_TOKEN")
LINE_CHANNEL_SECRET = os.getenv("LINE_CHANNEL_SECRET")
LINE_USER_ID = os.getenv("LINE_USER_ID")

line_bot_api = LineBotApi(LINE_CHANNEL_ACCESS_TOKEN)
handler = WebhookHandler(LINE_CHANNEL_SECRET)

# 支援 Render 的 Secret Files 預設路徑 (/etc/secrets/...)，如果本地測試則讀取預設的 json 檔
KEY_PATH = os.getenv("FIREBASE_KEY_PATH", "/etc/secrets/serviceAccountKey.json")

# 🛡️ Firebase 狀態備援標記 (Fallback)
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
    print(f"⚠️ Firebase 啟動失敗，已切換至「無資料庫備援模式」：{repr(e)}")

# 初始化 Azure OpenAI 客戶端
client = AzureOpenAI(
    api_version="2025-01-01-preview",
    azure_endpoint=os.getenv("AZURE_ENDPOINT"),
    api_key=os.getenv("AZURE_API_KEY"),
)

# ---------------------------------------------------------
# 🛠️ 輔助函式
# ---------------------------------------------------------
def clean_json_text(text):
    """清理 GPT 回傳的 Markdown JSON 格式標籤"""
    text = text.strip()
    text = re.sub(r'^```json\s*|```$', '', text, flags=re.MULTILINE)
    return text.strip()

# ---------------------------------------------------------
# 🟢 LINE Bot 路由與邏輯
# ---------------------------------------------------------
@app.route("/callback", methods=['POST'])
def callback():
    signature = request.headers['X-Line-Signature']
    body = request.get_data(as_text=True)
    try:
        handler.handle(body, signature)
    except InvalidSignatureError:
        return jsonify({"status": "error", "message": "Invalid signature"}), 400
    return 'OK'

@handler.add(MessageEvent, message=TextMessage)
def handle_message(event):
    if not firebase_initialized:
        line_bot_api.reply_message(event.reply_token, TextSendMessage(text="⚠️ 系統資料庫維護中，暫時無法查詢戰情室。"))
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
                line_bot_api.reply_message(event.reply_token, TextSendMessage(text="⚠️ 系統尚未記錄您的家庭 ID。\n請確認您已在擴充功能端將 LINE 帳號連動完成！"))
                return

            all_records = db.reference('scan_history').get()
            if all_records:
                family_records = [val for val in all_records.values() if isinstance(val, dict) and val.get('familyID') == my_family_id]
                total_scans = len(family_records)
                danger_count = sum(1 for val in family_records if int(json.loads(val.get('report', '{}')).get('riskScore', 0)) >= 70)
                
                reply_text = f"🛡️ 【{my_family_id} 家庭防詐戰情室】\n--------------------\n🔍 總掃描次數：{total_scans} 次\n🛑 成功攔截危險：{danger_count} 次\n--------------------\n🟢 目前家人上網安全無虞！"
            else:
                reply_text = "目前家庭資料庫中尚無任何掃描紀錄喔！"
        except Exception:
            reply_text = "⚠️ 戰情系統讀取失敗，請稍後再試。"
            
        line_bot_api.reply_message(event.reply_token, TextSendMessage(text=reply_text))

# ---------------------------------------------------------
# 🛡️ 核心 API：AI 掃描端點
# ---------------------------------------------------------
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
        return jsonify({"error": "系統未接收到可供分析的內容"}), 400

    # 1. 快取檢查 (僅在資料庫正常時執行)
    if firebase_initialized and target_url and not image_url and not is_urgent:
        safe_url_key = re.sub(r'[.#$\[\]]', '_', target_url)[:150] 
        try:
            cached_result = db.reference(f'url_cache/{safe_url_key}').get()
            if cached_result:
                return jsonify({"report": cached_result})
        except Exception:
            pass

    # 2. 緊急推播處理 (強制跳轉攔截時觸發)
    if is_urgent:
        def send_emergency_alert():
            try:
                alert_msg = f"🚨 【防詐盾牌緊急通報】\n家人觸發了最高級別防護！\n\n⛔ 網頁已被強制阻擋！\n原因：{web_text}\n來源網址：{target_url}\n👉 請盡快與家人聯繫確認安全。"
                line_bot_api.push_message(LINE_USER_ID, TextSendMessage(text=alert_msg))
                if firebase_initialized:
                    db.reference('scan_history').push({
                        'url': target_url, 
                        'report': json.dumps({"riskScore": 100, "riskLevel": "極度危險", "reason": web_text}, ensure_ascii=False),
                        'userID': user_id, 
                        'familyID': family_id, 
                        'timestamp': datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                    })
            except Exception: pass
        threading.Thread(target=send_emergency_alert).start()
        return jsonify({"status": "success", "message": "緊急推播已在背景秒發"})

    # 3. 呼叫 Azure OpenAI 進行分析
    try:
        system_prompt = """你是一位專門防護台灣使用者的資安專家。
        請用最白話的台灣繁體中文回答。回傳標準 JSON 格式（絕對不可包含 Markdown 標記），包含：
        - riskScore (整數 0-100)
        - riskLevel (安全無虞、輕微疑慮、高度危險、極度危險)
        - dimensions (物件，評估以下四個面向，各給 0-100 整數評分)：
            - financial_誘騙 (金錢、投資風險)
            - personal_個資 (索取個資風險)
            - urgency_時間壓力 (限時行動風險)
            - authority_冒充權威 (假冒政府、企業風險)
        - reason (1~2 句話說明)
        - advice (最重要的一點建議)
        - highlight_keywords (字串陣列，列出1~3個最具風險關鍵字，若無則為空陣列)"""

        messages = [{"role": "system", "content": system_prompt}]
        
        # 允許透過環境變數動態修改模型名稱，若無設定則預設為原先的名稱
        if image_url:
            messages.append({
                "role": "user", 
                "content": [
                    {"type": "text", "text": "請分析這張圖片中是否包含詐騙話術或危險連結："},
                    {"type": "image_url", "image_url": {"url": image_url}}
                ]
            })
            model_to_use = os.getenv("AZURE_MODEL_IMAGE", "gpt-4o") 
        else:
            messages.append({
                "role": "user", 
                "content": [{"type": "text", "text": f"請分析以下內容：\n{web_text[:3500]}"}]
            })
            model_to_use = os.getenv("AZURE_MODEL_TEXT", "model-router") 

        response = client.chat.completions.create(
            model=model_to_use, 
            messages=messages,
            response_format={ "type": "json_object" }
        )
        
        report_dict = json.loads(clean_json_text(response.choices[0].message.content))
        report_str = json.dumps(report_dict, ensure_ascii=False)
        
        # 4. 資料庫寫入與 LINE 推播 (僅在資料庫正常時執行)
        if firebase_initialized:
            if target_url and not image_url:
                safe_url_key = re.sub(r'[.#$\[\]]', '_', target_url)[:150]
                try:
                    db.reference(f'url_cache/{safe_url_key}').set(report_str)
                except Exception: pass

            if report_dict.get('riskLevel') in ['高度危險', '極度危險']:
                alert_msg = f"🚨 家庭資安警報！\n家人可能遇到詐騙訊息\n風險等級：{report_dict.get('riskLevel')}\n原因：{report_dict.get('reason')}"
                threading.Thread(target=lambda: line_bot_api.push_message(LINE_USER_ID, TextSendMessage(text=alert_msg))).start()

            db.reference('scan_history').push({
                'url': target_url, 
                'report': report_str, 
                'userID': user_id, 
                'familyID': family_id, 
                'timestamp': datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            })
        
        return jsonify({"report": report_str})
    except Exception as e:
        return jsonify({"error": f"分析失敗：{repr(e)}"}), 500

# ---------------------------------------------------------
# 👨‍👩‍👧 家庭防護與其他 API 端點
# ---------------------------------------------------------
@app.route('/api/report_false_positive', methods=['POST'])
def report_false_positive():
    if not firebase_initialized: return jsonify({"status": "success"}) # 備援模式直接回報成功不報錯
    try:
        data = request.json
        db.reference('false_positives').push({
            'url': data.get('url', ''), 
            'reason': data.get('reported_reason', ''),
            'timestamp': datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        })
        return jsonify({"status": "success"})
    except Exception as e: 
        return jsonify({"status": "error"})

@app.route('/api/create_family', methods=['POST'])
def create_family():
    if not firebase_initialized: 
        return jsonify({"status": "error", "message": "資料庫備援中，暫時無法建立"})
    try:
        uid = request.json.get('uid')
        invite_code = ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))
        db.reference(f'families/{invite_code}').set({
            'guardianUID': uid, 
            'memberUIDs': {}, 
            'familyID': invite_code, 
            'createdAt': datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        })
        db.reference(f'users/{uid}').update({'role': 'guardian', 'familyID': invite_code})
        return jsonify({"status": "success", "inviteCode": invite_code})
    except Exception as e: 
        return jsonify({"status": "error"})

@app.route('/api/join_family', methods=['POST'])
def join_family():
    if not firebase_initialized: 
        return jsonify({"status": "error", "message": "資料庫備援中，暫時無法加入"})
    try:
        data = request.json
        uid, code = data.get('inviteCode', '').upper()
        if db.reference(f'families/{code}').get():
            db.reference(f'families/{code}/memberUIDs/{uid}').set(True)
            db.reference(f'users/{uid}').update({'role': 'member', 'familyID': code})
            return jsonify({"status": "success"})
        return jsonify({"status": "fail", "message": "無效的邀請碼"})
    except Exception as e: 
        return jsonify({"status": "error"})

@app.route('/api/get_alerts', methods=['POST'])
def get_alerts():
    if not firebase_initialized: 
        return jsonify({"status": "fail", "data": []})
    try:
        family_id = request.json.get('familyID')
        if not family_id or family_id == 'none': 
            return jsonify({"status": "fail", "data": []})
        
        all_records = db.reference('scan_history').get()
        result = [val for key, val in all_records.items() if val.get('familyID') == family_id] if all_records else []
        result.sort(key=lambda x: x.get('timestamp', ''), reverse=True)
        return jsonify({"status": "success", "data": result[:10]})
    except Exception as e: 
        return jsonify({"status": "error"})

# ---------------------------------------------------------
# 🚀 啟動伺服器 (相容 Render 動態 Port 機制)
# ---------------------------------------------------------
if __name__ == "__main__":
    # Render 會強制指定環境變數 PORT，本地測試則預設為 5000
    port = int(os.environ.get("PORT", 5000))
    print(f"🚀 啟動伺服器 (Port: {port})...")
    
    # 雲端正式環境會由 Render 設定的 gunicorn 接手，這裡的 app.run 是保留給本地端備用的
    app.run(host='0.0.0.0', port=port)