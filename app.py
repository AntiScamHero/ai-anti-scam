import sys
import io
import os
import json
import datetime
import random
import string
import threading
import re
import warnings  # 🟢 引入警告控制模組
from urllib.parse import urlparse
from dotenv import load_dotenv

# 🛑 隱藏 Python 3.14 與 LINE SDK 產生的 Pydantic V1 相容性警告
warnings.filterwarnings("ignore", message=".*Pydantic V1.*")

from flask import Flask, request, jsonify
from flask_cors import CORS
from flask_socketio import SocketIO, emit, join_room

import firebase_admin
from firebase_admin import credentials, db 

# 🟢 LINE Bot v3 新版 SDK 引入
from linebot.v3 import WebhookHandler
from linebot.v3.exceptions import InvalidSignatureError
from linebot.v3.messaging import Configuration, ApiClient, MessagingApi, ReplyMessageRequest, PushMessageRequest, TextMessage
from linebot.v3.webhooks import MessageEvent, TextMessageContent

# 導入資安與 AI 模組
from security import mask_sensitive_data, is_genuine_white_listed, check_165_blacklist, TRUSTED_DOMAINS
from ai_service import analyze_risk_with_ai

os.environ["PYTHONUTF8"] = "1"
os.environ["PYTHONIOENCODING"] = "utf-8"
if sys.stdout.encoding != 'utf-8': 
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
if sys.stderr.encoding != 'utf-8': 
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

load_dotenv()

app = Flask(__name__)
app.config['JSON_AS_ASCII'] = False
CORS(app, resources={r"/*": {"origins": "*"}})

# 👑 初始化 WebSocket
socketio = SocketIO(app, cors_allowed_origins="*")

def get_tw_time():
    return (datetime.datetime.utcnow() + datetime.timedelta(hours=8)).strftime("%Y-%m-%d %H:%M:%S")

# 🟢 LINE Bot v3 初始化設定
configuration = Configuration(access_token=os.getenv("LINE_CHANNEL_ACCESS_TOKEN"))
handler = WebhookHandler(os.getenv("LINE_CHANNEL_SECRET"))
LINE_USER_ID = os.getenv("LINE_USER_ID")

# Firebase 初始化
KEY_PATH = os.getenv("FIREBASE_KEY_PATH", "/etc/secrets/serviceAccountKey.json")
firebase_initialized = False
try:
    if os.path.exists(KEY_PATH) and not firebase_admin._apps:
        cred = credentials.Certificate(KEY_PATH)
        firebase_admin.initialize_app(cred, {'databaseURL': 'https://antifraud-ai-94d72-default-rtdb.asia-southeast1.firebasedatabase.app'})
        firebase_initialized = True
    elif firebase_admin._apps:
        firebase_initialized = True
except Exception as e:
    print(f"⚠️ Firebase 啟動失敗：{repr(e)}", flush=True)

# 👑 LINE 動態守護者推播
def send_dynamic_line_alert(family_id, url, reason):
    if not firebase_initialized or family_id == 'none': 
        return
    try:
        family_node = db.reference(f'families/{family_id}').get()
        guardian_uid = family_node.get('guardianUID') if family_node else None
        
        target_line_id = LINE_USER_ID 
        
        if guardian_uid:
            user_node = db.reference(f'users/{guardian_uid}').get()
            if user_node and user_node.get('line_id'):
                target_line_id = user_node.get('line_id')
        
        if target_line_id:
            msg = (
                f"🚨 【AI 防詐盾牌 - 緊急警報】🚨\n"
                f"您的家人剛剛觸發了高風險網頁！\n\n"
                f"🔍 原因：{reason[:50]}\n"
                f"🌐 網址：{url[:50]}...\n\n"
                f"系統已主動攔截保護，請確認家人狀況！"
            )
            # 🟢 使用 v3 推播寫法
            with ApiClient(configuration) as api_client:
                line_bot_api = MessagingApi(api_client)
                line_bot_api.push_message(
                    PushMessageRequest(
                        to=target_line_id,
                        messages=[TextMessage(text=msg)]
                    )
                )
    except Exception as e:
        print(f"LINE 動態推播失敗: {e}", flush=True)

# ==========================================
# 🌐 測試用首頁 (確認伺服器存活狀態)
# ==========================================
@app.route('/', methods=['GET'])
def health_check():
    return jsonify({
        "status": "success", 
        "message": "🟢 AI 防詐騙伺服器正常運作中！",
        "time": get_tw_time()
    })

# ==========================================
# 🚀 核心 API：完美四層防護掃描端點
# ==========================================
@app.route('/scan', methods=['POST'])
def scan_url():
    data = request.json or {}
    
    target_url = data.get('url') or ''
    if len(target_url) > 2000: target_url = target_url[:2000]
    
    raw_text = data.get('text') or ''
    if len(raw_text) > 5000: raw_text = raw_text[:5000]
    
    image_url = data.get('image_url') or ''
    if len(image_url) > 2000: image_url = image_url[:2000]
        
    user_id = data.get('userID') or 'anonymous'
    family_id = data.get('familyID') or 'none'
    is_urgent = data.get('is_urgent', False)

    if not target_url and not image_url and not raw_text:
        return jsonify({"status": "error", "riskScore": 0, "riskLevel": "參數異常", "reason": "未提供內容", "masked_text": ""}), 200

    web_text = mask_sensitive_data(raw_text)
    is_white_listed = is_genuine_white_listed(target_url)

    # 🛡️ 防線 1：官方信任網域
    if is_white_listed and not is_urgent:
        return jsonify({
            "riskScore": 0, "riskLevel": "安全無虞", "reason": "官方信任網域", 
            "advice": "正常存取即可", "masked_text": web_text
        })

    # 🛡️ 防線 2：子網域釣魚與 165 黑名單攔截
    if target_url and not is_white_listed:
        if check_165_blacklist(target_url):
            report_dict = {"riskScore": 100, "riskLevel": "極度危險", "reason": "🚨 165 官方資料庫比對成功：此為已知詐騙網站！", "advice": "請立即關閉網頁！"}
            return jsonify({**report_dict, "report": json.dumps(report_dict, ensure_ascii=False), "masked_text": web_text})
        
        try:
            host = urlparse(target_url.lower().strip()).hostname or ""
            for domain in TRUSTED_DOMAINS:
                if domain in host and not host.endswith("." + domain) and host != domain:
                    return jsonify({"riskScore": 100, "riskLevel": "極度危險", "reason": f"偽裝網域 (試圖欺騙 {domain})", "masked_text": web_text})
        except: 
            pass

    # 🛡️ 防線 3：啟發式規避特徵掃描
    evasion_patterns = [
        (r'在我車上|綁架|斷手斷腳|不准報警|不准報案', '暴力威脅與綁架勒索'),
        (r'中[•\.\-\*\_\s]+獎|中[•\.\-\*\_\s]+奖', '特殊符號切割規避'),
        (r'仲獎|點機|伱巳|領娶|點撃|得獲您|知通獎中', '火星文與反轉排版規避'),
        (r'恭喜您中奖了|点击领取奖金', '簡體字詐騙模板'),
        (r'当選しました|おめでとうございます', '異常日文夾雜規避'),
        (r'Congratulations.*中獎|中獎.*claim', '中英混雜規避'),
        (r'bit\.ly/|rebrand\.ly/|tinyurl\.com/|pse\.is/', '高風險隱藏短網址')
    ]
    for pattern, reason in evasion_patterns:
        if re.search(pattern, raw_text, re.IGNORECASE):
            report_dict = {"riskScore": 95, "riskLevel": "極度危險", "reason": f"系統前置攔截：({reason})", "advice": "請立即關閉網頁！"}
            return jsonify({**report_dict, "report": json.dumps(report_dict, ensure_ascii=False), "masked_text": web_text})
    
    # ⚡ 快取檢查
    safe_url_key = re.sub(r'[.#$\[\]]', '_', target_url)[:120] if target_url else "no_url"
    if firebase_initialized and target_url and not image_url and not is_urgent and not is_white_listed:
        try:
            cached = db.reference(f'url_cache/{safe_url_key}').get()
            if cached:
                c_data = json.loads(cached) if isinstance(cached, str) else cached
                return jsonify({**c_data, "report": json.dumps(c_data, ensure_ascii=False), "masked_text": web_text})
        except: 
            pass

    # 緊急強制通報
    if is_urgent:
        def handle_urgent():
            socketio.emit('emergency_alert', {'url': target_url, 'reason': web_text[:50]}, room=family_id)
            send_dynamic_line_alert(family_id, target_url, "【觸發強制防護盾】" + web_text[:50])
        threading.Thread(target=handle_urgent).start()
        return jsonify({"status": "success"})

    # 🛡️ 防線 4：呼叫 AI 模組
    jailbreak_keywords = ['忽略', 'ignore', 'instruction', 'system prompt', '繞過', 'bypass', '系統指示']
    is_jailbreak_attempt = any(k in raw_text.lower() for k in jailbreak_keywords)

    report_dict = analyze_risk_with_ai(target_url, web_text, image_url, is_jailbreak_attempt)
    report_str = json.dumps(report_dict, ensure_ascii=False)
    score = int(report_dict.get('riskScore', 0))

    if firebase_initialized:
        def background_tasks():
            timestamp = get_tw_time()
            
            db.reference('scan_history').push({
                'url': target_url, 'report': report_str, 'userID': user_id, 'familyID': family_id, 'timestamp': timestamp
            })
            if target_url:
                db.reference(f'url_cache/{safe_url_key}').set(report_str)
            
            socketio.emit('new_scan_result', {
                'url': target_url, 'riskScore': score, 'reason': report_dict.get('reason'), 'timestamp': timestamp
            }, room=family_id)

            if score >= 75:
                send_dynamic_line_alert(family_id, target_url, report_dict.get('reason'))

        threading.Thread(target=background_tasks).start()

    return jsonify({**report_dict, "report": report_str, "masked_text": web_text})

# ==========================================
# WebSocket 房間管理
# ==========================================
@socketio.on('join_family_room')
def handle_join_family_room(data):
    family_id = data.get('familyID')
    if family_id:
        join_room(family_id)
        print(f"💻 戰情室已連線並加入房間: {family_id}", flush=True)

# ==========================================
# 🟢 LINE Bot 戰情室邏輯
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

@handler.add(MessageEvent, message=TextMessageContent)
def handle_message(event):
    if not firebase_initialized: return
    user_msg = event.message.text
    line_user_id = event.source.user_id 
    
    if "戰情" in user_msg or "回報" in user_msg:
        try:
            users_ref = db.reference('users').get()
            my_family_id = next((u.get('familyID') for u in users_ref.values() if isinstance(u, dict) and u.get('line_id') == line_user_id), 'none')
            
            with ApiClient(configuration) as api_client:
                line_bot_api = MessagingApi(api_client)
                
                if my_family_id == 'none':
                    line_bot_api.reply_message(
                        ReplyMessageRequest(
                            reply_token=event.reply_token,
                            messages=[TextMessage(text="⚠️ 此 LINE 帳號尚未綁定任何家庭 ID。")]
                        )
                    )
                    return
                    
                all_rec = db.reference('scan_history').get()
                f_records = [v for v in all_rec.values() if isinstance(v, dict) and v.get('familyID') == my_family_id] if all_rec else []
                danger = sum(1 for v in f_records if int(json.loads(v.get('report', '{}')).get('riskScore', 0)) >= 70)
                
                line_bot_api.reply_message(
                    ReplyMessageRequest(
                        reply_token=event.reply_token,
                        messages=[TextMessage(text=f"🛡️ 【{my_family_id} 家庭戰情室】\n🔍 總掃描：{len(f_records)} 次\n🛑 已攔截：{danger} 次")]
                    )
                )
        except Exception as e: 
            print(f"LINE Bot 處理錯誤: {e}", flush=True)

# ==========================================
# 👨‍👩‍👧 完整家庭與紀錄 API
# ==========================================
@app.route('/api/report_false_positive', methods=['POST'])
def report_fp():
    if firebase_initialized: 
        db.reference('false_positives').push({**request.json, 'timestamp': get_tw_time()})
    return jsonify({"status": "success"})

@app.route('/api/create_family', methods=['POST'])
def create_family():
    uid = request.json.get('uid')
    if not uid or not isinstance(uid, str) or not uid.strip(): 
        return jsonify({"status": "error", "msg": "Invalid UID"}), 200
    
    code = ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))
    if firebase_initialized:
        db.reference(f'families/{code}').set({'guardianUID': uid, 'familyID': code, 'createdAt': get_tw_time()})
        db.reference(f'users/{uid}').update({'role': 'guardian', 'familyID': code})
        return jsonify({"status": "success", "inviteCode": code})
        
    return jsonify({"status": "error"}), 200

@app.route('/api/join_family', methods=['POST'])
def join_family():
    data = request.json
    uid = data.get('uid')
    code = data.get('inviteCode', '').upper()
    
    if not code or len(code) != 6 or not code.isalnum(): 
        return jsonify({"status": "fail", "message": "無效的邀請碼格式"}), 200
        
    if firebase_initialized and db.reference(f'families/{code}').get():
        db.reference(f'families/{code}/memberUIDs/{uid}').set(True)
        db.reference(f'users/{uid}').update({'role': 'member', 'familyID': code})
        return jsonify({"status": "success"})
        
    return jsonify({"status": "fail", "message": "無效的邀請碼"}), 200

@app.route('/api/get_alerts', methods=['POST'])
def get_alerts():
    fid = request.json.get('familyID')
    if not fid or not isinstance(fid, str) or len(fid) != 6: 
        return jsonify({"status": "fail", "data": []}), 200
        
    if not firebase_initialized: 
        return jsonify({"status": "fail", "data": []}), 200
        
    all_rec = db.reference('scan_history').get() or {}
    if isinstance(all_rec, list): 
        all_rec = {str(i): v for i, v in enumerate(all_rec) if v is not None}
        
    result = [v for v in all_rec.values() if isinstance(v, dict) and v.get('familyID') == fid]
    result.sort(key=lambda x: x.get('timestamp', ''), reverse=True)
    
    return jsonify({"status": "success", "data": result[:20]})

@app.route('/api/clear_alerts', methods=['POST'])
def clear_alerts():
    fid = request.json.get('familyID')
    if not fid or not isinstance(fid, str) or len(fid) != 6: 
        return jsonify({"status": "error", "message": "無效參數"}), 200
        
    if not firebase_initialized: 
        return jsonify({"status": "error"}), 200
        
    ref = db.reference('scan_history')
    all_rec = ref.get() or {}
    if isinstance(all_rec, list): 
        all_rec = {str(i): v for i, v in enumerate(all_rec) if v is not None}
        
    if all_rec:
        updates = {k: None for k, v in all_rec.items() if isinstance(v, dict) and v.get('familyID') == fid}
        if updates: 
            ref.update(updates)
            
    return jsonify({"status": "success"})

# ==========================================
# 📞 緊急聯絡人：動態聯防 API (全新加入)
# ==========================================
@app.route('/api/set_contact', methods=['POST'])
def set_contact():
    """讓守護者(子女)設定自己的聯絡方式"""
    data = request.json
    uid = data.get('uid')
    contact = data.get('contact') # 格式應為 "tel:0912345678" 或 "https://line.me/ti/p/你的ID"
    
    if firebase_initialized and uid and contact:
        db.reference(f'users/{uid}').update({'emergency_contact': contact})
        return jsonify({"status": "success"})
    return jsonify({"status": "error"})

@app.route('/api/get_contact', methods=['POST'])
def get_contact():
    """長輩端點擊按鈕時，動態抓取子女的聯絡方式"""
    fid = request.json.get('familyID')
    # 如果沒綁定家庭，預設回傳 165
    if not firebase_initialized or not fid or fid == 'none':
        return jsonify({"status": "fail", "contact": "tel:165"}) 
        
    try:
        family_node = db.reference(f'families/{fid}').get()
        if family_node and isinstance(family_node, dict) and family_node.get('guardianUID'):
            guardian_uid = family_node.get('guardianUID')
            user_node = db.reference(f'users/{guardian_uid}').get()
            
            if user_node and isinstance(user_node, dict):
                contact = user_node.get('emergency_contact')
                if contact:
                    return jsonify({"status": "success", "contact": contact})
    except Exception as e:
        print(f"取得聯絡人失敗: {e}", flush=True)
        
    # 如果系統找不到子女電話，依然安全回傳 165 專線
    return jsonify({"status": "fail", "contact": "tel:165"})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print("\n" + "="*50)
    print("🚀 系統啟動中...")
    print(f"👉 請打開瀏覽器點擊這個連結測試：http://127.0.0.1:{port}/")
    print("="*50 + "\n", flush=True)
    
    socketio.run(app, host='0.0.0.0', port=port, debug=True, allow_unsafe_werkzeug=True)