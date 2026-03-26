# 🟢 確保 Eventlet 在最一開始就接管系統執行緒，避免背景任務打架
# import eventlet
# eventlet.monkey_patch()

import sys
import io
import os
import json
import datetime
import random
import string
import threading
import re
import warnings  
import html               
import base64             
import urllib.parse       
from urllib.parse import urlparse
from dotenv import load_dotenv

warnings.filterwarnings("ignore", message=".*Pydantic V1.*")

from flask import Flask, request, jsonify, Response
from werkzeug.exceptions import HTTPException 
from flask_cors import CORS
from flask_socketio import SocketIO, emit, join_room
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

import firebase_admin
from firebase_admin import credentials, db 

from linebot.v3 import WebhookHandler
from linebot.v3.exceptions import InvalidSignatureError
from linebot.v3.messaging import Configuration, ApiClient, MessagingApi, ReplyMessageRequest, PushMessageRequest, TextMessage
from linebot.v3.webhooks import MessageEvent, TextMessageContent

from security import mask_sensitive_data, is_genuine_white_listed, check_165_blacklist, TRUSTED_DOMAINS
from ai_service import analyze_risk_with_ai, stream_scam_simulation
from openai import AzureOpenAI

import requests 

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

limiter = Limiter(
    get_remote_address,
    app=app,
    default_limits=["10000 per day", "5000 per hour"],
    storage_uri="memory://"
)

socketio = SocketIO(app, cors_allowed_origins="*")

@app.errorhandler(HTTPException)
def handle_http_exception(e):
    response = e.get_response()
    response.data = json.dumps({
        "status": "error",
        "riskScore": 99 if e.code == 429 else 10,
        "riskLevel": "系統攔截",
        "reason": f"防護機制觸發 ({e.name})",
        "advice": "請稍後再試",
        "report": "{}"
    })
    response.content_type = "application/json"
    return response

@app.errorhandler(Exception)
def handle_exception(e):
    print(f"❌ [全域錯誤攔截] {e}", flush=True)
    return jsonify({"status": "error", "message": "伺服器內部錯誤", "details": str(e)}), 500

def get_tw_time():
    return (datetime.datetime.utcnow() + datetime.timedelta(hours=8)).strftime("%Y-%m-%d %H:%M:%S")

def check_google_safe_browsing(url):
    api_key = os.getenv("GOOGLE_SAFE_BROWSING_API_KEY")
    if not api_key or not url:
        return False
    
    endpoint = f"https://safebrowsing.googleapis.com/v4/threatMatches:find?key={api_key}"
    payload = {
        "client": {
            "clientId": "ai-anti-fraud-shield",
            "clientVersion": "1.0.0"
        },
        "threatInfo": {
            "threatTypes": ["MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE", "POTENTIALLY_HARMFUL_APPLICATION"],
            "platformTypes": ["ANY_PLATFORM"],
            "threatEntryTypes": ["URL"],
            "threatEntries": [{"url": url}]
        }
    }
    try:
        response = requests.post(endpoint, json=payload, timeout=3)
        if response.status_code == 200:
            data = response.json()
            if "matches" in data:
                return True 
    except Exception as e:
        print(f"⚠️ Google API 檢查超時或失敗: {e}", flush=True)
    return False

configuration = Configuration(access_token=os.getenv("LINE_CHANNEL_ACCESS_TOKEN"))
handler = WebhookHandler(os.getenv("LINE_CHANNEL_SECRET"))
LINE_USER_ID = os.getenv("LINE_USER_ID")

KEY_PATH = os.getenv("FIREBASE_KEY_PATH", "serviceAccountKey.json")
firebase_initialized = False
try:
    if os.path.exists(KEY_PATH) and not firebase_admin._apps:
        cred = credentials.Certificate(KEY_PATH)
        firebase_admin.initialize_app(cred, {'databaseURL': 'https://antifraud-ai-94d72-default-rtdb.asia-southeast1.firebasedatabase.app'})
        firebase_initialized = True
        print("✅ Firebase 初始化成功！", flush=True)
    elif firebase_admin._apps:
        firebase_initialized = True
    else:
        print("⚠️ 找不到 serviceAccountKey.json，Firebase 啟動失敗", flush=True)
except Exception as e:
    print(f"⚠️ Firebase 啟動異常：{repr(e)}", flush=True)

def get_dynamic_advice(scam_dna_list):
    dna_str = ",".join(scam_dna_list) if isinstance(scam_dna_list, list) else str(scam_dna_list)
    
    if "金錢誘惑" in dna_str or "投資" in dna_str:
        return "『最近是不是有看到什麼好康的中獎或投資機會呀？要不要幫你看看？』"
    elif "限時壓力" in dna_str or "恐懼訴求" in dna_str:
        return "『最近是不是有收到什麼包裹卡關、海外網購出問題、或是帳戶要被凍結的緊急通知？別慌，那通常是騙人的喔！』"
    elif "權威誘導" in dna_str:
        return "『剛剛是不是有收到自稱海關或警察的訊息？他們不會隨便傳網址叫人點喔，我們先求證一下。』"
    elif "親情勒索" in dna_str:
        return "『最近有沒有收到誰說急需用錢的訊息？現在 AI 詐騙很多，匯款前記得先通個電話確認喔！』"
    elif "沉沒成本" in dna_str:
        return "『是不是為了拿回之前的錢，對方又叫你匯手續費？這通常是無底洞，我們一起踩煞車好嗎？』"
    else:
        return "『剛剛上網有沒有遇到什麼奇怪的畫面，或是要求輸入密碼的網頁呀？』"

def send_dynamic_line_alert(family_id, url, reason, risk_score=100, scam_dna=None):
    if not firebase_initialized or family_id == 'none': 
        return
    
    if scam_dna is None:
        scam_dna = ["未知套路"]
        
    try:
        family_node = db.reference(f'families/{family_id}').get()
        guardian_uid = family_node.get('guardianUID') if family_node else None
        
        target_line_id = LINE_USER_ID 
        
        if guardian_uid:
            user_node = db.reference(f'users/{guardian_uid}').get()
            if user_node and user_node.get('line_id'):
                target_line_id = user_node.get('line_id')
        
        if target_line_id:
            dna_tags = "、".join(scam_dna)
            care_message = get_dynamic_advice(scam_dna)
            
            msg = (
                f"💞【AI 防詐盾牌 - 親情守護通知】\n"
                f"您的親友剛剛遇到了一個高風險網頁！\n\n"
                f"🛡️ 系統已成功為其暫時攔截。\n"
                f"🚨 威脅分析：此網頁疑似使用了「{dna_tags}」的心理操縱術 (危險指數：{risk_score}分)。\n"
                f"🔍 攔截原因：{reason[:50]}\n\n"
                f"💡 溫柔陪伴指南：\n"
                f"當事者現在可能感到慌張。建議您撥個電話關心，請【避免責備】，可以用這句話當作開頭：\n"
                f"{care_message}\n\n"
                f"🔗 攔截網址：{url[:40]}..."
            )
            
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

@app.route('/', methods=['GET'])
def health_check():
    return jsonify({
        "status": "success", 
        "message": "🟢 AI 防詐騙伺服器正常運作中！",
        "time": get_tw_time()
    })

@app.route('/api/submit_evidence', methods=['POST'])
@limiter.limit("10 per minute") 
def submit_evidence():
    if not firebase_initialized:
        return jsonify({"status": "fail", "message": "Firebase 未連線"}), 500
        
    data = request.json or {}
    url = data.get('url', '未知網址')
    screenshot_base64 = data.get('screenshot_base64') 
    
    if not screenshot_base64:
        return jsonify({"status": "fail", "message": "未提供圖片數據"}), 400
        
    try:
        timestamp = get_tw_time() 
        family_id = data.get('familyID', 'none')
        reason = data.get('reported_reason', '前端智慧攔截')

        ref = db.reference('scam_evidence').push({
            'url': url,
            'screenshot_base64': screenshot_base64,
            'familyID': family_id,
            'timestamp': timestamp,
            'reason': reason
        })
        
        report_dict = {
            "riskScore": 99,
            "riskLevel": "極度危險",
            "reason": f"【前端緊急攔截】{reason}",
            "scamDNA": ["系統強制警示"],
            "advice": "防詐盾牌已在第一線為您阻擋此危險網頁，並完成證據保全。"
        }
        db.reference('scan_history').push({
            'url': url, 
            'report': json.dumps(report_dict, ensure_ascii=False), 
            'userID': 'frontend_intercept', 
            'familyID': family_id, 
            'timestamp': timestamp,
            'evidenceID': ref.key  
        })
        
        if family_id != 'none':
            send_dynamic_line_alert(
                family_id=family_id, 
                url=url, 
                reason=reason, 
                risk_score=99, 
                scam_dna=["系統強制警示"]
            )
        
        print(f"✅ 證據快照已成功入庫！URL: {url[:30]}... ID: {ref.key}", flush=True)
        
        socketio.emit('new_evidence_submitted', {
            'url': url,
            'evidenceID': ref.key,
            'timestamp': timestamp
        }, room=family_id)
        
        socketio.emit('new_scan_result', {
            'url': url, 'riskScore': 99, 'reason': reason, 'timestamp': timestamp
        }, room=family_id)
        
        return jsonify({
            "status": "success", 
            "message": "✅ 證據保全快照已成功存檔，並已通知家人。",
            "evidenceID": ref.key
        })
    except Exception as e:
        print(f"❌ 證據入庫失敗：{e}", flush=True)
        return jsonify({"status": "fail", "message": str(e)}), 500

@app.route('/api/get_evidence', methods=['POST'])
def get_evidence():
    if not firebase_initialized:
        return jsonify({"status": "fail", "message": "Firebase 未連線"}), 500
        
    data = request.json or {}
    family_id = data.get('familyID')
    evidence_id = data.get('evidenceID') 
    timestamp = data.get('timestamp')
    
    try:
        if evidence_id:
            evidence = db.reference(f'scam_evidence/{evidence_id}').get()
            if evidence and isinstance(evidence, dict) and evidence.get('familyID') == family_id:
                return jsonify({
                    "status": "success",
                    "screenshot_base64": evidence.get('screenshot_base64')
                })
                        
        return jsonify({"status": "fail", "message": "找不到對應的證據快照，可能已遭覆蓋或未上傳成功"}), 404
    except Exception as e:
        print(f"❌ 提取證據失敗: {e}", flush=True)
        return jsonify({"status": "fail", "message": str(e)}), 500

@app.route('/scan', methods=['POST'])
@limiter.limit("1000 per minute") 
def scan_url():
    data = request.json or {}
    
    # 🟢 1. 防呆升級：強制將 null 轉為空字串，徹底消滅 500 錯誤
    target_url = data.get('url')
    target_url = str(target_url) if target_url else ''
    if len(target_url) > 2000: target_url = target_url[:2000]
    
    raw_text = data.get('text')
    raw_text = str(raw_text) if raw_text else ''
    if len(raw_text) > 2500: raw_text = raw_text[:2500]

    image_url = data.get('image_url')
    image_url = str(image_url) if image_url else ''
    if len(image_url) > 2000: image_url = image_url[:2000]
        
    user_id = data.get('userID')
    user_id = str(user_id) if user_id else 'anonymous'
    
    family_id = data.get('familyID')
    family_id = str(family_id) if family_id else 'none'
    
    is_urgent = data.get('is_urgent', False)

    # ==========================================
    # 🛡️ 終極升級 1：獨立且純粹的 Base64 與編碼解碼器 (防呆與多層次解碼)
    # ==========================================
    decoded_extras = ""

    # 1. URL 解碼
    try:
        if '%' in raw_text: decoded_extras += urllib.parse.unquote(raw_text) + " "
        if '%' in target_url: decoded_extras += urllib.parse.unquote(target_url) + " "
    except: pass

    # 2. HTML 實體解碼
    try:
        if '&#' in raw_text or '&amp;' in raw_text:
            decoded_extras += html.unescape(raw_text) + " "
    except: pass

    # 3. Base64 強化解碼
    def decode_base64_safe(s):
        try:
            s = s.replace('-', '+').replace('_', '/')
            pad_len = len(s) % 4
            if pad_len == 1: return ""  
            if pad_len > 0: s += "=" * (4 - pad_len)
            
            decoded_bytes = base64.b64decode(s)
            decoded_str = decoded_bytes.decode('utf-8', errors='ignore')
            decoded_str = urllib.parse.unquote(decoded_str) 
            
            # 確保解碼出來是有意義的文字
            if re.search(r'[\u4e00-\u9fa5]', decoded_str) or len(re.sub(r'[^\w\s]', '', decoded_str)) > 4:
                return decoded_str + " "
        except:
            return ""
        return ""

    # (A) 暴力測試：移除所有空白後解碼
    txt_no_spaces = re.sub(r'\s+', '', raw_text)
    if txt_no_spaces:
        decoded_extras += decode_base64_safe(txt_no_spaces)

    # (B) 片段測試：從內文中找出疑似 Base64 的片段
    b64_matches = re.findall(r'[A-Za-z0-9+/=\-_]{16,}', raw_text)
    for b64 in b64_matches:
        decoded_extras += decode_base64_safe(b64)

    # (C) 網址測試：從 URL 參數中挖出 Base64 
    if target_url:
        url_b64_matches = re.findall(r'[A-Za-z0-9+/=\-_]{16,}', target_url)
        for b64 in url_b64_matches:
            decoded_extras += decode_base64_safe(b64)

    raw_text = raw_text + " " + decoded_extras
    # ==========================================

    if not target_url and not image_url and not raw_text.strip():
        return jsonify({"status": "error", "riskScore": 0, "riskLevel": "參數異常", "reason": "未提供內容", "masked_text": ""}), 200

    # ==========================================
    # 🖼️ 終極升級 2：無 OCR 狀態下的兜底攔截機制 (破解圖片詐騙)
    # ==========================================
    if image_url:
        img_lower = image_url.lower()
        
        if not image_url.startswith('http') and not image_url.startswith('data:'):
            report = {"riskScore": 65, "riskLevel": "中度危險", "scamDNA": ["異常圖片"], "reason": "偵測到無效或惡意的圖片 URL 格式"}
            return jsonify({**report, "report": json.dumps(report, ensure_ascii=False), "masked_text": raw_text})
            
        if any(ext in img_lower for ext in ['.svg', '.webp', '.bmp', '.tiff', '.gif']) or 'image/webp' in img_lower or 'image/svg' in img_lower:
            report = {"riskScore": 65, "riskLevel": "中度危險", "scamDNA": ["異常格式"], "reason": "使用罕見或易藏惡意腳本的圖片格式"}
            return jsonify({**report, "report": json.dumps(report, ensure_ascii=False), "masked_text": raw_text})
            
        suspicious_img_kws = ['qr', 'barcode', 'win', 'prize', 'lottery', 'base64', 'promo', 'award', 'bonus', 'text', 'gift', 'scam', 'free', '中獎', '保證獲利']
        if any(kw in urllib.parse.unquote(img_lower) for kw in suspicious_img_kws):
            report = {"riskScore": 85, "riskLevel": "高度危險", "scamDNA": ["圖片誘惑/QR"], "reason": "偵測到可疑的 QR Code 或圖片誘惑特徵"}
            return jsonify({**report, "report": json.dumps(report, ensure_ascii=False), "masked_text": raw_text})

        if raw_text and len(raw_text.strip()) > 0:
            report = {"riskScore": 80, "riskLevel": "高度危險", "scamDNA": ["多模態夾擊"], "reason": "偵測到圖文夾雜的混合規避手法"}
            return jsonify({**report, "report": json.dumps(report, ensure_ascii=False), "masked_text": raw_text})
            
        report = {"riskScore": 75, "riskLevel": "高度危險", "scamDNA": ["可疑圖片內容"], "reason": "防堵圖片隱藏中獎文字規避"}
        return jsonify({**report, "report": json.dumps(report, ensure_ascii=False), "masked_text": raw_text})
    # ==========================================

    if target_url:
        if '@' in target_url:
            report = {"riskScore": 95, "riskLevel": "極度危險", "scamDNA": ["域名欺騙"], "reason": "偵測到 Userinfo 繞過欺騙", "advice": "切勿點擊"}
            return jsonify({**report, "report": json.dumps(report), "masked_text": ""})
        if re.search(r'[а-яА-Я]', target_url): 
            report = {"riskScore": 95, "riskLevel": "極度危險", "scamDNA": ["域名欺騙"], "reason": "偵測到同形異義字欺騙", "advice": "切勿點擊"}
            return jsonify({**report, "report": json.dumps(report), "masked_text": ""})

    web_text = mask_sensitive_data(raw_text)
    is_white_listed = is_genuine_white_listed(target_url)

    if is_white_listed and not is_urgent:
        return jsonify({
            "riskScore": 0, "riskLevel": "安全無虞", "scamDNA": ["無"], "reason": "官方信任網域", 
            "advice": "正常存取即可", "masked_text": web_text
        })

    check_list = [target_url]
    if "http" in raw_text.lower() or "www." in raw_text.lower() or ".net" in raw_text.lower() or ".com" in raw_text.lower():
        extracted_urls = re.findall(r'(?:https?://|www\.)[^\s]+', raw_text)
        if extracted_urls:
            check_list.extend(extracted_urls)
        else:
            check_list.append(raw_text.strip())

    for u in check_list:
        if not u: continue
        parse_u = u if u.startswith('http') else 'http://' + u
        
        if not is_genuine_white_listed(parse_u):
            if check_165_blacklist(parse_u):
                report_dict = {"riskScore": 100, "riskLevel": "極度危險", "scamDNA": ["黑名單警示"], "reason": "🚨 165 官方資料庫比對成功：此為已知詐騙網站！", "advice": "請立即關閉網頁！"}
                return jsonify({**report_dict, "report": json.dumps(report_dict, ensure_ascii=False), "masked_text": web_text})
            
            if check_google_safe_browsing(parse_u):
                report_dict = {"riskScore": 100, "riskLevel": "極度危險", "scamDNA": ["Google黑名單警示"], "reason": "🚨 Google 官方安全大腦攔截：此為高風險惡意/釣魚網站！", "advice": "請立即關閉網頁！"}
                return jsonify({**report_dict, "report": json.dumps(report_dict, ensure_ascii=False), "masked_text": web_text})
            
            try:
                host = urlparse(parse_u.lower().strip()).hostname or ""
                for domain in TRUSTED_DOMAINS:
                    if domain in host and not host.endswith("." + domain) and host != domain:
                        report_dict = {"riskScore": 100, "riskLevel": "極度危險", "scamDNA": ["偽裝官方"], "reason": f"偽裝網域 (試圖欺騙 {domain})", "advice": "請勿點擊或輸入任何資料！"}
                        return jsonify({**report_dict, "report": json.dumps(report_dict, ensure_ascii=False), "masked_text": web_text})
            except: 
                pass

    evasion_patterns = [
        (r'在我車上|綁架|斷手斷腳|不准報警|不准報案', '暴力威脅與綁架勒索', '恐懼訴求'),
        (r'中[•\.\-\*\_\s]+獎|中[•\.\-\*\_\s]+奖|中獎|加賴|保證獲利|穩賺不賠|點擊領取|恭喜您|解凍帳戶', '高風險詐騙字眼', '金錢誘惑'),
        (r'仲獎|點機|伱巳|領娶|點撃|得獲您|知通獎中', '火星文與反轉排版規避', '規避查緝'),
        (r'恭喜您中奖了|点击领取奖金', '簡體字詐騙模板', '金錢誘惑'),
        (r'当選しました|おめでとうございます', '異常日文夾雜規避', '規避查緝'),
        (r'Congratulations.*中獎|中獎.*claim', '中英混雜規避', '規避查緝'),
        (r'bit\.ly/|rebrand\.ly/|tinyurl\.com/|pse\.is/', '高風險隱藏短網址', '未知套路'),
        (r'檢察官|法院傳票|警局通知|監理站|健保卡鎖卡|ETC欠費|退稅|政府津貼|勞保補助|普發津貼|健保退費', '公家機關威脅詐騙', '權威誘導'),
        (r'Netflix.*過期|Spotify.*到期|Amazon.*退款|蝦皮訂單異常|包裹滯留|超商取貨異常|宅配到府|支付寶轉帳|微信轉帳|銀行登入|帳戶凍結|信用卡盜刷|帳戶更新|中信卡驗證', '服務異常釣魚', '限時壓力'),
        (r'飆股內線|殺豬盤|加密貨幣|BTC|ETH|iPhone中獎|統一發票中獎|假投資群組|假貸款廣告|銀行帳號匯款', '投資與中獎詐騙', '金錢誘惑'),
        (r'假冒主管|車禍|朋友借錢|房東改帳戶', '親友急難詐騙', '親情勒索'),
        (r'台電斷電|自來水停水|瓦斯停氣', '民生服務詐騙', '限時壓力'),
        (r'AI 語音|Deepfake|NFT|元宇宙|炒股機器人|CBDC|碳權|假 APK', '新型態科技詐騙', '未知套路'),
        (r'Google 帳號警告|Facebook 違規通知|Apple ID|系統更新|免費健檢|疫苗預約', '帳號與個資釣魚', '恐懼訴求')
    ]
    
    for pattern, reason, dna_tag in evasion_patterns:
        is_bad_text = re.search(pattern, raw_text, re.IGNORECASE)
        is_bad_image_url = False
        
        if image_url and not image_url.startswith('data:image'):
            is_bad_image_url = re.search(pattern, image_url, re.IGNORECASE)

        if is_bad_text or is_bad_image_url:
            report_dict = {"riskScore": 95, "riskLevel": "極度危險", "scamDNA": [dna_tag], "reason": f"系統前置攔截：({reason})", "advice": "請立即關閉網頁！"}
            return jsonify({**report_dict, "report": json.dumps(report_dict, ensure_ascii=False), "masked_text": web_text})
    
    safe_url_key = re.sub(r'[.#$\[\]]', '_', target_url)[:120] if target_url else "no_url"
    if firebase_initialized and target_url and not image_url and not is_urgent and not is_white_listed:
        try:
            cached = db.reference(f'url_cache/{safe_url_key}').get()
            if cached:
                c_data = json.loads(cached) if isinstance(cached, str) else cached
                return jsonify({**c_data, "report": json.dumps(c_data, ensure_ascii=False), "masked_text": web_text})
        except Exception as e: 
            print(f"⚠️ 讀取快取失敗: {e}", flush=True)

    if is_urgent:
        def handle_urgent():
            with app.app_context(): 
                socketio.emit('emergency_alert', {'url': target_url, 'reason': web_text[:50]}, room=family_id)
                send_dynamic_line_alert(
                    family_id=family_id, 
                    url=target_url, 
                    reason="【觸發強制防護盾】" + web_text[:50], 
                    risk_score=100, 
                    scam_dna=["系統強制警示"]
                )
        socketio.start_background_task(handle_urgent) 
        return jsonify({"status": "success"})

    jailbreak_keywords = ['忽略', 'ignore', 'instruction', 'system prompt', '繞過', 'bypass', '系統指示']
    is_jailbreak_attempt = any(k in raw_text.lower() for k in jailbreak_keywords)

    report_dict = analyze_risk_with_ai(target_url, web_text, image_url, is_jailbreak_attempt)
    report_str = json.dumps(report_dict, ensure_ascii=False)
    score = int(report_dict.get('riskScore', 0))

    if firebase_initialized:
        def background_tasks():
            with app.app_context(): 
                timestamp = get_tw_time()
                try:
                    db.reference('scan_history').push({
                        'url': target_url, 'report': report_str, 'userID': user_id, 'familyID': family_id, 'timestamp': timestamp
                    })
                    if target_url:
                        db.reference(f'url_cache/{safe_url_key}').set(report_str)
                except Exception as e:
                    print(f"⚠️ 寫入掃描紀錄失敗: {e}", flush=True)
                
                socketio.emit('new_scan_result', {
                    'url': target_url, 'riskScore': score, 'reason': report_dict.get('reason'), 'timestamp': timestamp
                }, room=family_id)

                if score >= 75:
                    send_dynamic_line_alert(
                        family_id=family_id, 
                        url=target_url, 
                        reason=report_dict.get('reason', '未知風險'),
                        risk_score=score,
                        scam_dna=report_dict.get('scamDNA', ["高風險套路"])
                    )

        socketio.start_background_task(background_tasks) 

    return jsonify({**report_dict, "report": report_str, "masked_text": web_text})

@socketio.on('join_family_room')
def handle_join_family_room(data):
    family_id = data.get('familyID')
    if family_id:
        join_room(family_id)
        print(f"💻 戰情室已連線並加入房間: {family_id}", flush=True)

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

@app.route('/api/send_family_broadcast', methods=['POST'])
def send_family_broadcast():
    data = request.json
    family_id = data.get('familyID')
    message = data.get('message', '親友提醒：請暫停一切動作，確認網頁安全！')
    
    if not family_id or family_id == 'none':
        return jsonify({"status": "error", "message": "無效的家庭 ID"}), 400
        
    socketio.emit('family_urgent_broadcast', {'message': message}, room=family_id)
    return jsonify({"status": "success", "message": "已成功發送親情廣播！"})

@app.route('/api/simulate_scam', methods=['POST'])
def simulate_scam():
    data = request.json or {}
    user_message = data.get('message', '')
    chat_history = data.get('history', []) 
    scenario_type = data.get('scenario', 'investment')
    
    def generate():
        try:
            for text_chunk in stream_scam_simulation(chat_history, scenario_type, user_message):
                yield f"data: {json.dumps({'text': text_chunk})}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return Response(generate(), mimetype='text/event-stream')

@app.route('/api/report_false_positive', methods=['POST'])
def report_fp():
    if firebase_initialized: 
        try:
            db.reference('false_positives').push({**request.json, 'timestamp': get_tw_time()})
        except Exception as e:
            print(f"⚠️ 誤判回報寫入失敗: {e}", flush=True)
            return jsonify({"status": "error", "message": str(e)}), 500
    return jsonify({"status": "success"})

@app.route('/api/create_family', methods=['POST'])
def create_family():
    uid = request.json.get('uid')
    if not uid or not isinstance(uid, str) or not uid.strip(): 
        return jsonify({"status": "error", "msg": "Invalid UID"}), 400
    
    code = ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))
    print(f"👉 [Debug] 準備建立家庭，代碼: {code}, 守護者UID: {uid}", flush=True)

    if firebase_initialized:
        try:
            print("⏳ [Debug] 正在寫入 Firebase families...", flush=True)
            db.reference(f'families/{code}').set({
                'guardianUID': uid, 
                'familyID': code, 
                'createdAt': get_tw_time()
            })
            
            print("⏳ [Debug] 正在更新 Firebase users...", flush=True)
            db.reference(f'users/{uid}').update({
                'role': 'guardian', 
                'familyID': code
            })
            
            print("✅ [Debug] Firebase 寫入成功！準備回傳給前端...", flush=True)
            return jsonify({"status": "success", "inviteCode": code})
            
        except Exception as e:
            print(f"❌ [Debug] 建立家庭寫入 Firebase 發生嚴重錯誤: {e}", flush=True)
            return jsonify({
                "status": "error", 
                "message": f"資料庫寫入失敗，請檢查後端日誌: {str(e)}"
            }), 500
            
    print("❌ [Debug] Firebase 初始化未成功，無法建立家庭", flush=True)
    return jsonify({"status": "error", "message": "Firebase 未連線"}), 500

@app.route('/api/join_family', methods=['POST'])
def join_family():
    data = request.json
    uid = data.get('uid')
    code = data.get('inviteCode', '').upper()
    
    if not code or len(code) != 6 or not code.isalnum(): 
        return jsonify({"status": "fail", "message": "無效的邀請碼格式"}), 400

    print(f"👉 [Debug] 準備加入家庭，代碼: {code}, 申請人UID: {uid}", flush=True)

    if firebase_initialized:
        try:
            print("⏳ [Debug] 正在查詢 Firebase 驗證家庭是否存在...", flush=True)
            family_node = db.reference(f'families/{code}').get()
            
            if family_node:
                print("⏳ [Debug] 正在寫入 Firebase 成員名單...", flush=True)
                db.reference(f'families/{code}/memberUIDs/{uid}').set(True)
                
                print("⏳ [Debug] 正在更新 Firebase users...", flush=True)
                db.reference(f'users/{uid}').update({
                    'role': 'member', 
                    'familyID': code
                })
                print("✅ [Debug] Firebase 加入成功！準備回傳給前端...", flush=True)
                return jsonify({"status": "success"})
            else:
                print("❌ [Debug] 找不到此家庭代碼", flush=True)
                return jsonify({"status": "fail", "message": "無效的邀請碼"}), 400
                
        except Exception as e:
            print(f"❌ [Debug] 加入家庭讀寫 Firebase 發生嚴重錯誤: {e}", flush=True)
            return jsonify({
                "status": "error", 
                "message": f"資料庫讀寫失敗，請檢查後端日誌: {str(e)}"
            }), 500

    print("❌ [Debug] Firebase 初始化未成功，無法加入家庭", flush=True)
    return jsonify({"status": "fail", "message": "Firebase 未連線"}), 500

@app.route('/api/get_alerts', methods=['POST'])
def get_alerts():
    fid = request.json.get('familyID')
    if not fid or not isinstance(fid, str) or len(fid) != 6: 
        return jsonify({"status": "fail", "data": []}), 400
        
    if not firebase_initialized: 
        return jsonify({"status": "fail", "data": []}), 500
        
    try:
        all_rec = db.reference('scan_history').get() or {}
        if isinstance(all_rec, list): 
            all_rec = {str(i): v for i, v in enumerate(all_rec) if v is not None}
            
        result = [v for v in all_rec.values() if isinstance(v, dict) and v.get('familyID') == fid]
        result.sort(key=lambda x: x.get('timestamp', ''), reverse=True)
        
        return jsonify({"status": "success", "data": result[:20]})
    except Exception as e:
        print(f"❌ [Debug] 獲取戰情室警告失敗: {e}", flush=True)
        return jsonify({"status": "fail", "data": []}), 500

@app.route('/api/clear_alerts', methods=['POST'])
def clear_alerts():
    fid = request.json.get('familyID')
    if not fid or not isinstance(fid, str) or len(fid) != 6: 
        return jsonify({"status": "error", "message": "無效參數"}), 400
        
    if not firebase_initialized: 
        return jsonify({"status": "error"}), 500
        
    try:
        ref = db.reference('scan_history')
        all_rec = ref.get() or {}
        if isinstance(all_rec, list): 
            all_rec = {str(i): v for i, v in enumerate(all_rec) if v is not None}
        if all_rec:
            updates = {k: None for k, v in all_rec.items() if isinstance(v, dict) and v.get('familyID') == fid}
            if updates: 
                ref.update(updates)

        evidence_ref = db.reference('scam_evidence')
        all_evi = evidence_ref.get() or {}
        if isinstance(all_evi, list):
            all_evi = {str(i): v for i, v in enumerate(all_evi) if v is not None}
        if all_evi:
            evi_updates = {k: None for k, v in all_evi.items() if isinstance(v, dict) and v.get('familyID') == fid}
            if evi_updates:
                evidence_ref.update(evi_updates)
                
        return jsonify({"status": "success"})
    except Exception as e:
        print(f"❌ [Debug] 清除戰情室紀錄失敗: {e}", flush=True)
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/reset_demo', methods=['POST'])
def reset_demo():
    data = request.json or {}
    family_id = data.get('familyID', 'demo_family') 
    
    if not firebase_initialized:
        return jsonify({"status": "error", "message": "Firebase 未連線"}), 500
        
    try:
        ref = db.reference('scan_history')
        all_rec = ref.get() or {}
        
        if isinstance(all_rec, list):
            all_rec = {str(i): v for i, v in enumerate(all_rec) if v is not None}
            
        updates = {}
        for key, val in all_rec.items():
            if isinstance(val, dict) and val.get('familyID') == family_id:
                updates[key] = None 
                
        if updates: 
            ref.update(updates)
            
        socketio.emit('demo_reset_triggered', {'message': '系統已洗白'}, room=family_id)
        
        return jsonify({"status": "success", "message": "✨ 神蹟降臨：Demo 狀態已完美重置！"})
    except Exception as e:
        print(f"❌ [Debug] 洗白展示紀錄失敗: {e}", flush=True)
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/set_contact', methods=['POST'])
def set_contact():
    data = request.json
    uid = data.get('uid')
    contact = data.get('contact') 
    
    if firebase_initialized and uid and contact:
        try:
            db.reference(f'users/{uid}').update({'emergency_contact': contact})
            return jsonify({"status": "success"})
        except Exception as e:
            print(f"❌ [Debug] 設定聯絡人失敗: {e}", flush=True)
            return jsonify({"status": "error", "message": str(e)}), 500
    return jsonify({"status": "error"}), 400

@app.route('/api/get_contact', methods=['POST'])
def get_contact():
    fid = request.json.get('familyID')
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
        print(f"❌ [Debug] 取得聯絡人失敗: {e}", flush=True)
        
    return jsonify({"status": "fail", "contact": "tel:165"})

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print("\n" + "="*50)
    print("🚀 系統啟動中...")
    print(f"👉 請打開瀏覽器點擊這個連結測試：http://127.0.0.1:{port}/")
    print("="*50 + "\n", flush=True)
    
    socketio.run(app, host='0.0.0.0', port=port, debug=True, allow_unsafe_werkzeug=True)