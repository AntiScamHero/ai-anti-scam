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
# 強制設定系統輸出為 UTF-8，避免中文亂碼
os.environ["PYTHONUTF8"] = "1"
os.environ["PYTHONIOENCODING"] = "utf-8"

if sys.stdout.encoding != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
if sys.stderr.encoding != 'utf-8':
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

# 🛡️ 清除環境中的代理設定，防止 Azure OpenAI 連線問題
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

# 載入 .env 檔案中的環境變數
load_dotenv()

app = Flask(__name__)
app.config['JSON_AS_ASCII'] = False

# 🛡️ CORS 全面開放，確保戰情室與擴充功能都能順利連線
CORS(app, resources={r"/*": {"origins": "*"}})

# 💡 專屬台灣時間產生器 (解決 Render 慢 8 小時的問題)
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

# 支援 Render 的 Secret Files 預設路徑，如果本地測試則讀取預設的 json 檔
KEY_PATH = os.getenv("FIREBASE_KEY_PATH", "/etc/secrets/serviceAccountKey.json")

# Firebase 狀態備援標記 (Fallback)
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

# ==========================================
# 🛠️ 輔助函式
# ==========================================
def clean_json_text(text):
    """清理 GPT 回傳的 Markdown JSON 格式標籤"""
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
                line_bot_api.reply_message(event.reply_token, TextSendMessage(text="⚠️ 尚未綁定家庭 ID，請先在擴充功能完成連動。"))
                return

            all_records = db.reference('scan_history').get()
            if all_records:
                family_records = [val for val in all_records.values() if isinstance(val, dict) and val.get('familyID') == my_family_id]
                total_scans = len(family_records)
                
                # 🛡️ 強化：安全解析風險分數
                danger_count = 0
                for val in family_records:
                    report_raw = val.get('report', '{}')
                    # 如果 report 是字串就 parse，否則直接用
                    report_data = json.loads(report_raw) if isinstance(report_raw, str) else report_raw
                    if int(report_data.get('riskScore', 0)) >= 70:
                        danger_count += 1
                
                reply_text = f"🛡️ 【{my_family_id} 家庭戰情室】\n--------------------\n🔍 總掃描次數：{total_scans} 次\n🛑 攔截風險：{danger_count} 次\n--------------------\n🟢 目前家人上網環境受保護中！"
            else:
                reply_text = "目前家庭資料庫中尚無掃描紀錄。"
        except Exception as e:
            print(f"戰情讀取報錯: {e}")
            reply_text = "⚠️ 戰情系統讀取失敗，請稍後再試。"
            
        line_bot_api.reply_message(event.reply_token, TextSendMessage(text=reply_text))

# ==========================================
# 🛡️ 核心 API：AI 掃描端點 (包含快取防毒機制)
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
        return jsonify({"error": "系統未接收到可供分析的內容"}), 400

    # 1. 🚀 快取檢查與「排毒」機制
    if firebase_initialized and target_url and not image_url and not is_urgent:
        safe_url_key = re.sub(r'[.#$\[\]]', '_', target_url)[:150] 
        try:
            cached_result = db.reference(f'url_cache/{safe_url_key}').get()
            if cached_result:
                try:
                    cached_dict = json.loads(cached_result) if isinstance(cached_result, str) else cached_result
                except Exception:
                    cached_dict = {}

                # 🛡️ 判斷記憶是否壞掉
                if 'riskScore' in cached_dict or 'RiskScore' in cached_dict or 'risk_score' in cached_dict:
                    response_data = cached_dict.copy()
                    response_data["report"] = json.dumps(cached_dict, ensure_ascii=False) if not isinstance(cached_result, str) else cached_result
                    return jsonify(response_data)
                else:
                    print(f"🧹 清除 {target_url} 的損壞快取紀錄")
                    db.reference(f'url_cache/{safe_url_key}').delete()
        except Exception as e:
            print(f"⚠️ 讀取快取發生異常: {str(e)}")
            pass

    # 2. 緊急推播處理
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
                        'timestamp': get_tw_time()
                    })
            except Exception:
                pass
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
            model_to_use = os.getenv("AZURE_MODEL_TEXT", "gpt-4o")

        response = client.chat.completions.create(
            model=model_to_use, 
            messages=messages,
            response_format={ "type": "json_object" }
        )
        
        report_dict = json.loads(clean_json_text(response.choices[0].message.content))
        report_str = json.dumps(report_dict, ensure_ascii=False)
        
        # 4. 資料庫寫入與 LINE 推播
        if firebase_initialized:
            if target_url and not image_url:
                safe_url_key = re.sub(r'[.#$\[\]]', '_', target_url)[:150]
                try:
                    db.reference(f'url_cache/{safe_url_key}').set(report_str)
                except Exception:
                    pass

            if report_dict.get('riskLevel') in ['高度危險', '極度危險']:
                alert_msg = f"🚨 家庭資安警報！\n家人可能遇到詐騙訊息\n風險等級：{report_dict.get('riskLevel')}\n原因：{report_dict.get('reason')}"
                threading.Thread(target=lambda: line_bot_api.push_message(LINE_USER_ID, TextSendMessage(text=alert_msg))).start()

            db.reference('scan_history').push({
                'url': target_url, 
                'report': report_str, 
                'userID': user_id, 
                'familyID': family_id, 
                'timestamp': get_tw_time()
            })
        
        response_data = report_dict.copy()
        response_data["report"] = report_str
        return jsonify(response_data)

    except Exception as e:
        print(f"❌ 分析失敗：{str(e)}")
        fallback_data = {
            "riskScore": 0, 
            "riskLevel": "分析中斷", 
            "dimensions": {"financial_誘騙":0, "personal_個資":0, "urgency_時間壓力":0, "authority_冒充權威":0},
            "reason": f"系統連線異常: {str(e)}", 
            "advice": "請檢查 Azure API 設定", 
            "highlight_keywords": []
        }
        response_data = fallback_data.copy()
        response_data["report"] = json.dumps(fallback_data, ensure_ascii=False)
        return jsonify(response_data), 200

# ==========================================
# 👨‍👩‍👧 家庭防護與其他 API 端點
# ==========================================
@app.route('/api/report_false_positive', methods=['POST'])
def report_false_positive():
    if not firebase_initialized: 
        return jsonify({"status": "success"}) 
    try:
        data = request.json
        db.reference('false_positives').push({
            'url': data.get('url', ''), 
            'reason': data.get('reported_reason', ''),
            'timestamp': get_tw_time()
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
            'createdAt': get_tw_time()
        })
        
        db.reference(f'users/{uid}').update({
            'role': 'guardian', 
            'familyID': invite_code
        })
        
        return jsonify({"status": "success", "inviteCode": invite_code})
    except Exception as e: 
        return jsonify({"status": "error"})

@app.route('/api/join_family', methods=['POST'])
def join_family():
    if not firebase_initialized: 
        return jsonify({"status": "error", "message": "資料庫備援中，暫時無法加入"})
    try:
        data = request.json
        uid = data.get('uid')
        code = data.get('inviteCode', '').upper()
        
        if db.reference(f'families/{code}').get():
            db.reference(f'families/{code}/memberUIDs/{uid}').set(True)
            db.reference(f'users/{uid}').update({
                'role': 'member', 
                'familyID': code
            })
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
        return jsonify({"status": "error", "message": str(e)})

@app.route('/api/clear_alerts', methods=['POST'])
def clear_alerts():
    if not firebase_initialized: 
        return jsonify({"status": "error", "message": "資料庫備援中，暫時無法清除"})
    try:
        family_id = request.json.get('familyID')
        if not family_id or family_id == 'none': 
            return jsonify({"status": "fail", "message": "無效的家庭 ID"})
        
        # 取得所有紀錄並比對 familyID
        ref = db.reference('scan_history')
        all_records = ref.get()
        if all_records:
            updates = {}
            for key, val in all_records.items():
                if isinstance(val, dict) and val.get('familyID') == family_id:
                    # 將要刪除的節點設為 None，這是 Firebase 批次刪除的標準做法
                    updates[key] = None 
            
            # ⚡ 一次性打包發送刪除指令，瞬間清空，避免非同步時間差！
            if updates:
                ref.update(updates)
                    
        return jsonify({"status": "success"})
    except Exception as e: 
        return jsonify({"status": "error", "message": str(e)})
# ==========================================
# 🚀 啟動伺服器
# ==========================================
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print(f"🚀 啟動伺服器 (Port: {port})...")
    app.run(host='0.0.0.0', port=port)