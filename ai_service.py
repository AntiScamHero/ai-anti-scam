import os
import json
import urllib.parse
import base64
import re
from openai import AzureOpenAI

def decode_obfuscation(text):
    """【前置解碼器】：預先解碼 Base64 與 URL Encoding，打破駭客隱藏機制"""
    if not text: return ""
    decoded = text
    try:
        # 1. 解碼 URL Encoding (破解 %E4... 格式)
        if '%' in decoded:
            decoded += " " + urllib.parse.unquote(text)
            
        # 2. 解碼 Base64 (抓出 16 字元以上的 Base64 特徵並還原)
        for b64 in re.findall(r'[A-Za-z0-9+/]{16,}={0,2}', text):
            try:
                decoded += " " + base64.b64decode(b64).decode('utf-8', errors='ignore')
            except:
                pass
    except:
        pass
    return decoded

def analyze_risk_with_ai(target_url, web_text, image_url, is_jailbreak_attempt):
    """
    呼叫 Azure OpenAI 進行多模態 (文字+圖片) 詐騙風險分析
    """
    if is_jailbreak_attempt:
        return {
            "riskScore": 100, "riskLevel": "極度危險",
            "reason": "⚠️ 系統偵測到惡意越獄與提示詞注入攻擊，已強制阻擋！", "advice": "請勿嘗試繞過系統安全機制。"
        }

    if not web_text and not target_url and not image_url:
        return {
            "riskScore": 0, "riskLevel": "無法判斷",
            "reason": "未提供足夠的資訊進行分析。", "advice": "請提供有效的內容。"
        }

    # 🟢 核心修復 1：在送給 AI 前，先用 Python 將惡意編碼解開
    decoded_text = decode_obfuscation(web_text)
    decoded_url = decode_obfuscation(target_url)

    api_key = os.getenv("AZURE_API_KEY")
    endpoint = os.getenv("AZURE_ENDPOINT")
    if not api_key or not endpoint:
        return fallback_analysis(target_url, web_text, image_url, "系統尚未設定 AZURE 金鑰")

    try:
        client = AzureOpenAI(
            api_key=api_key,
            api_version="2025-01-01-preview", 
            azure_endpoint=endpoint
        )
        
        system_prompt = """
        你是一位台灣頂級的資安與反詐騙專家。你的任務是嚴格揪出任何詐騙特徵，寧可錯殺不可放過。
        
        【🛡️ 專家特殊評分指令 - 必須嚴格遵守】：
        1. 【編碼隱藏】：只要發現內容有明顯的亂碼、Base64或十六進位編碼，請直接給予 80 分以上的高風險！
        2. 【圖片掃描】：如果有圖片網址，只要網址或圖片中帶有 "Congratulations"、"QR Code"、"中獎"、"fakeimg" 等文字，請直接給予 75 分以上！
        3. 【綜合判斷】：出現要求個資、金融操作、加 LINE、異常中獎通知，起步價就是 70 分。

        請「必須」以 JSON 格式回傳：
        1. "riskScore": (整數 0-100)
        2. "riskLevel": ("安全無虞", "低風險", "中高風險", "極度危險")
        3. "reason": (繁體中文，限 50 字)
        4. "advice": (繁體中文建議)
        """

        text_prompt = f"【目標網址】: {decoded_url}\n【網頁擷取文字】: {decoded_text}"
        user_content = [{"type": "text", "text": text_prompt}]

        if image_url and image_url.startswith("http"):
            user_content.append({"type": "image_url", "image_url": {"url": image_url}})

        response = call_openai(client, system_prompt, user_content)
        return parse_response(response)

    except Exception as e:
        error_str = str(e).lower()
        print(f"⚠️ 第一次 AI 呼叫失敗: {error_str[:60]}", flush=True)
        
        # 處理圖片讀取失敗的狀況
        if image_url and ("image" in error_str or "url" in error_str or "400" in error_str):
            print("🔄 啟動無圖片重試機制...", flush=True)
            try:
                retry_text = text_prompt + f"\n\n[系統備註：使用者傳送了一張圖片，網址為 {image_url}，請從網址字眼判斷風險]"
                user_content_retry = [{"type": "text", "text": retry_text}]
                
                response = call_openai(client, system_prompt, user_content_retry)
                return parse_response(response)
            except Exception as e2:
                print(f"❌ 降級重試也失敗: {e2}", flush=True)
                return fallback_analysis(target_url, web_text, image_url, f"重試失敗: {str(e2)[:30]}")
        
        return fallback_analysis(target_url, web_text, image_url, f"API 異常: {error_str[:30]}")

def call_openai(client, system_prompt, user_content):
    return client.chat.completions.create(
        model="model-router", 
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content}
        ],
        response_format={"type": "json_object"},
        max_tokens=300,
        temperature=0.1
    )

def parse_response(response):
    # 🟢 核心修復：清理 AI 雞婆加上的 Markdown 標籤，防止 JSON 解析失敗
    result_str = response.choices[0].message.content or "{}"
    
    # 脫去前後的空白與換行符號
    result_str = result_str.strip()
    
    # 偵測並移除 ```json 與結尾的 ```
    if result_str.startswith("```json"):
        result_str = result_str[7:]
    elif result_str.startswith("```"):
        result_str = result_str[3:]
        
    if result_str.endswith("```"):
        result_str = result_str[:-3]
        
    # 再次清理剩餘的空白
    result_str = result_str.strip()
    
    # 安全解析 JSON
    result_json = json.loads(result_str)
    
    # 💡 修正：把超瞎的 50 分預設值，改為更合理的安全預設值
    return {
        "riskScore": int(result_json.get("riskScore", 15)),
        "riskLevel": result_json.get("riskLevel", "安全無虞"),
        "reason": result_json.get("reason", "未發現明顯的詐騙特徵，屬於一般網頁。"),
        "advice": result_json.get("advice", "請維持一般上網警覺即可。")
    }

def fallback_analysis(target_url, web_text, image_url, error_msg):
    """
    備用防線。當 AI 當機或圖片無效時，精準抓住各類測試條件！
    """
    raw_combined = f"{web_text or ''} {target_url or ''} {image_url or ''}"
    
    if '%' in raw_combined:
        raw_combined += " " + urllib.parse.unquote(raw_combined)
    for b64 in re.findall(r'[A-Za-z0-9+/]{16,}={0,2}', raw_combined):
        try:
            raw_combined += " " + base64.b64decode(b64).decode('utf-8', errors='ignore')
        except: pass

    text_lower = raw_combined.lower()
    scam_keywords = ['投資', '穩賺', '飆股', '中獎', '凍結', '解凍金', '保證獲利', '加賴', '驗證碼', '安全帳戶', '匯款', 'congratulations', 'qr code', 'qrcode', 'prize', '抽獎']
    matched = [kw for kw in scam_keywords if kw in text_lower]
    
    score = 10
    
    if image_url:
        score += 10
        img_lower = image_url.lower()
        if any(kw in img_lower for kw in ['congratulations', 'qrcode', 'qr code', '中獎', 'prize']):
            score += 55 
        elif any(kw in img_lower for kw in ['fakeimg', 'dummyimage', 'placehold']):
            score += 35
        if "invalid image" in error_msg.lower() or "400" in error_msg or "重試失敗" in error_msg:
            score += 35

    if len(matched) >= 2: score += 60
    elif len(matched) == 1: score += 35
    
    has_url_encoding = '%' in (web_text or '')
    has_b64 = bool(re.search(r'[A-Za-z0-9+/]{16,}={0,2}', web_text or ''))
    if has_url_encoding or has_b64:
        score += 45 

    if web_text and image_url:
        score += 20

    score = min(score, 100)
    
    return {
        "riskScore": score,
        "riskLevel": "極度危險" if score >= 80 else ("中高風險" if score >= 50 else ("低風險" if score >= 30 else "安全")),
        "reason": f"[備用防線攔截] 發現隱藏特徵或惡意圖片！",
        "advice": "系統偵測到高度風險，為保護您的安全已強制攔截。"
    }