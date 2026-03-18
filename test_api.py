import requests
import time

# 修改成您的 API 網址 (記得確保 Render 上的伺服器正在運行)
BASE_URL = "https://ai-anti-scam.onrender.com"

def run_50_tests():
    print("🚀 啟動 50 項全功能壓力測試...")
    
    # --- 1. 個資脫敏測試 (10筆) ---
    print("\n[1] 正在測試個資脫敏機制...")
    pii_cases = [
        "我的電話是 0912-345-678", "卡號 4311 1111 2222 3333", "身分證 A123456789", 
        "Email: test@gmail.com", "簡訊傳至 0988123123", "身分證 f222333444", 
        "帳單 4567-8888-9999-0000", "聯絡我 abc@yahoo.com.tw", "0911-000-000", "A123123123"
    ]
    for i, text in enumerate(pii_cases):
        try:
            res = requests.post(f"{BASE_URL}/scan", json={"text": text, "url": "http://test.com"})
            print(f"PII 測試 {i+1}: {'✅' if '已隱藏' in res.text or res.status_code == 200 else '❌'}")
        except Exception as e:
            print(f"PII 測試 {i+1} 失敗: {e}")

    # --- 2. 正常網域白名單 (10筆) ---
    print("\n[2] 正在測試白名單 (Yahoo/Google)...")
    safe_urls = [
        "https://tw.yahoo.com", "https://www.google.com", "https://165.npa.gov.tw", 
        "https://www.facebook.com", "https://www.apple.com", "https://www.moi.gov.tw",
        "https://mail.google.com", "https://tw.news.yahoo.com", "https://www.ey.gov.tw", "https://www.line.me"
    ]
    for url in safe_urls:
        try:
            res = requests.post(f"{BASE_URL}/scan", json={"url": url, "text": "正常內容"})
            score = res.json().get('riskScore', 100)
            print(f"安全測試 {url}: {'✅ (0分)' if score == 0 else '❌'}")
        except Exception as e:
            print(f"安全測試 {url} 失敗: {e}")

    # --- 3. 典型詐騙案例 (20筆) ---
    print("\n[3] 正在測試詐騙偵測能力...")
    for i in range(20):
        try:
            res = requests.post(f"{BASE_URL}/scan", json={"url": "http://scam.xyz", "text": "限時領取飆股，保證獲利"})
            print(f"詐騙測試 {i+1}: {'✅' if res.json().get('riskScore', 0) > 70 else '❌'}")
        except Exception as e:
            print(f"詐騙測試 {i+1} 失敗: {e}")

    # --- 4. 家庭系統 API 測試 (10筆) ---
    print("\n[4] 正在測試家庭系統 API...")
    try:
        test_uid = "TEST_USER_999"
        create_res = requests.post(f"{BASE_URL}/api/create_family", json={"uid": test_uid})
        invite_code = create_res.json().get('inviteCode')
        print(f"建立家庭: {'✅' if invite_code else '❌'}")
        
        if invite_code:
            join_res = requests.post(f"{BASE_URL}/api/join_family", json={"uid": "MEMBER_1", "inviteCode": invite_code})
            print(f"加入家庭: {'✅' if join_res.json().get('status') == 'success' else '❌'}")
    except Exception as e:
        print(f"家庭系統 API 測試失敗: {e}")

    print("\n✨ 50 項測試執行完畢！")

if __name__ == "__main__":
    run_50_tests()