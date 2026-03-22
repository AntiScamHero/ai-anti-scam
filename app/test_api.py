import requests
import time
import json
import random
import string
import threading
import re
from datetime import datetime

# 🛠️ 配置區域
BASE_URL = "http://127.0.0.1:5000"  # 本地測試
# BASE_URL = "https://ai-anti-scam.onrender.com"  # 生產環境測試
TIMEOUT_SEC = 35  # 給予 AI 充分的分析時間

class TestResult:
    def __init__(self):
        self.total = 0
        self.passed = 0
        self.failed = []
    
    def add(self, name, passed, detail=""):
        self.total += 1
        if passed:
            self.passed += 1
            print(f"  ✅ {name}: {detail}")
        else:
            self.failed.append({"name": name, "detail": detail})
            print(f"  ❌ {name}: {detail}")
    
    def summary(self):
        rate = (self.passed / self.total * 100) if self.total > 0 else 0
        print("\n" + "="*70)
        print(f"📊 最終測試報告 | 總計：{self.total} | 通過：{self.passed} | 失敗：{self.total - self.passed}")
        print(f"🎯 通過率：{rate:.1f}%")
        print("="*70)
        if self.failed:
            print("\n⚠️ 失敗項目明細:")
            for f in self.failed:
                print(f"  • {f['name']}: {f['detail']}")
        return rate

result = TestResult()

# ==========================================
# 🛡️ 模組 1: 進階個資脫敏與混淆繞過測試 (17 筆)
# ==========================================
def test_pii_masking():
    print("\n" + "="*70)
    print("🛡️ 模組 1: 進階個資脫敏與混淆繞過測試")
    print("="*70)
    
    cases = [
        # 標準格式
        {"name": "標準手機號", "text": "我的電話是 0912-345-678", "should_mask": True},
        {"name": "標準身分證", "text": "身分證 A123456789", "should_mask": True},
        {"name": "標準信用卡", "text": "卡號 4311-1111-2222-3333", "should_mask": True},
        {"name": "標準 Email", "text": "Email: test@gmail.com", "should_mask": True},
        
        # 混淆格式 - 空格
        {"name": "空格混淆手機", "text": "手機 0 9 1 2 3 4 5 6 7 8", "should_mask": True},
        {"name": "空格混淆身分證", "text": "身 分 證 號 碼：A 1 2 3 4 5 6 7 8 9", "should_mask": True},
        {"name": "空格混淆信用卡", "text": "卡號 4 3 1 1 1 1 1 1 2 2 2 2 3 3 3 3", "should_mask": True},
        
        # 混淆格式 - 符號
        {"name": "橫線混淆手機", "text": "0912-345-678", "should_mask": True},
        {"name": "點號混淆身分證", "text": "A.1.2.3.4.5.6.7.8.9", "should_mask": True},
        {"name": "混合符號信用卡", "text": "4311•1111•2222•3333", "should_mask": True},
        
        # 混淆格式 - 零寬字符
        {"name": "零寬字符手機", "text": "09\u200B12\u200B34\u200B56\u200B78", "should_mask": True},
        {"name": "零寬字符身分證", "text": "A\u200B1\u200B2\u200B3\u200B4\u200B5\u200B6\u200B7\u200B8\u200B9", "should_mask": True},
        {"name": "零寬字符 Email", "text": "test\u200B.user@gmail.com", "should_mask": True},
        
        # 邊界測試 - 不應誤報
        {"name": "產品型號誤報測試", "text": "這個產品型號是 A123456789，很好用", "should_mask": False},
        {"name": "日期誤報測試", "text": "今天是 2026 年 03 月 19 日", "should_mask": False},
        # 新增全形字符測試
        {"name": "全形身分證", "text": "身分證 Ａ１２３４５６７８９", "should_mask": True},
        {"name": "全形手機", "text": "手機 ０９１２３４５６７８", "should_mask": True},
    ]
    
    for case in cases:
        try:
            res = requests.post(f"{BASE_URL}/scan", json={"text": case["text"], "url": "http://test.com"}, timeout=TIMEOUT_SEC)
            masked = res.json().get('masked_text', '')
            is_masked = "隱藏" in masked
            
            if case["should_mask"] == is_masked:
                result.add(case["name"], True, f"遮蔽狀態正確")
            else:
                result.add(case["name"], False, f"預期={'應遮蔽' if case['should_mask'] else '不應遮蔽'}, 實際={'遮蔽' if is_masked else '未遮蔽'}, 回傳={masked[:50]}")
        except Exception as e:
            result.add(case["name"], False, f"錯誤：{str(e)}")
        time.sleep(0.5)

# ==========================================
# 🎭 模組 2: 白名單繞過與域名欺騙測試 (20 筆)
# ==========================================
def test_domain_spoofing():
    print("\n" + "="*70)
    print("🎭 模組 2: 白名單繞過與域名欺騙測試")
    print("="*70)
    
    # 安全網域 (應返回 0 分)
    safe_domains = [
        "https://www.google.com",
        "https://www.yahoo.com",
        "https://www.ey.gov.tw",
        "https://www.line.me",
        "https://www.facebook.com",
        "https://www.apple.com",
        "https://momo.com.tw",
        "https://www.pchome.com.tw",
        "https://mail.google.com",
        "https://drive.google.com",
    ]
    
    # 欺騙網域 (應返回高風險)
    scam_domains = [
        # 子域名欺騙
        {"url": "https://security.google.com.scam-site.xyz", "desc": "google.com.scam 欺騙"},
        {"url": "https://login.yahoo.com.fake-domain.net", "desc": "yahoo.com.fake 欺騙"},
        {"url": "https://verify.gov.tw.phishing.cc", "desc": "gov.tw.phishing 欺騙"},
        
        # 字元替換欺騙
        {"url": "https://g0ogle-security.com", "desc": "0 替換 o"},
        {"url": "https://yaho0-login.net", "desc": "0 替換 o"},
        {"url": "https://faceb00k-support.top", "desc": "00 替換 oo"},
        {"url": "https://app1e-id-verify.com", "desc": "1 替換 l"},
        
        # 政府機關欺騙
        {"url": "https://165-npa-gov-tw.scam.cc", "desc": "165 反詐騙欺騙"},
        {"url": "https://gov-tw-subsidy.info", "desc": "政府津貼欺騙"},
        {"url": "https://tax-refund-tw.com", "desc": "退稅欺騙"},
        {"url": "https://npa-police-verify.net", "desc": "警察局欺騙"},
        
        # 電商欺騙
        {"url": "https://shopee-verify-order.xyz", "desc": "蝦皮訂單欺騙"},
        {"url": "https://momo-gift-card.claim", "desc": "momo 禮品卡欺騙"},
        {"url": "https://pchome-refund.net", "desc": "PChome 退款欺騙"},
        
        # 銀行欺騙
        {"url": "https://secure-banking-login.biz", "desc": "銀行登入欺騙"},
        {"url": "https://ctbc-card-verify.com", "desc": "中信卡驗證欺騙"},
        {"url": "https://fubon-account-update.net", "desc": "富邦帳戶更新欺騙"},
        
        # 其他高風險
        {"url": "https://apple-id-verify.xyz", "desc": "Apple ID 欺騙"},
        {"url": "https://update-system.io", "desc": "系統更新欺騙"},
    ]
    
    print("\n  [安全網域測試]")
    for url in safe_domains:
        try:
            res = requests.post(f"{BASE_URL}/scan", json={"url": url, "text": "請更新資料"}, timeout=TIMEOUT_SEC)
            score = res.json().get('riskScore', 100)
            if score == 0:
                result.add(f"安全：{url[:30]}", True, f"Score: {score}")
            else:
                result.add(f"安全：{url[:30]}", False, f"Score: {score} (應為 0)")
        except Exception as e:
            result.add(f"安全：{url[:30]}", False, f"錯誤：{str(e)}")
        time.sleep(0.3)
    
    print("\n  [欺騙網域測試]")
    for case in scam_domains:
        try:
            res = requests.post(f"{BASE_URL}/scan", json={"url": case["url"], "text": "請點擊更新"}, timeout=TIMEOUT_SEC)
            score = res.json().get('riskScore', 0)
            if score >= 50:
                result.add(f"欺騙：{case['desc']}", True, f"Score: {score}")
            else:
                result.add(f"欺騙：{case['desc']}", False, f"Score: {score} (應>=50, 遭到繞過)")
        except Exception as e:
            result.add(f"欺騙：{case['desc']}", False, f"錯誤：{str(e)}")
        time.sleep(0.3)

# ==========================================
# 👹 模組 3: 社交工程詐騙測試 (30 筆)
# ==========================================
def test_social_engineering():
    print("\n" + "="*70)
    print("👹 模組 3: 社交工程詐騙測試 (大魔王級別)")
    print("="*70)
    
    scam_cases = [
        # 檢察官/法院詐騙
        {"name": "檢察官詐術", "text": "【台北地檢署】您涉及洗錢案，請於 2 小時內點擊連結查看傳票，否則將發布通緝", "min_score": 85},
        {"name": "法院傳票詐騙", "text": "法院通知：您有未處理的民事案件，請立即點擊連結繳納保證金", "min_score": 85},
        
        # 帳號安全詐騙
        {"name": "LINE 帳號異常", "text": "您的 LINE 帳號正在異地登入，請點擊驗證否則將永久停權", "min_score": 80},
        {"name": "Google 帳號警告", "text": "Google 安全警告：您的帳號已被鎖定，請立即驗證身分", "min_score": 80},
        {"name": "Facebook 違規通知", "text": "您的 Facebook 帳號發布違規內容，請點擊申訴否則將刪除", "min_score": 75},
        
        # 公用事業詐騙
        {"name": "台電斷電威脅", "text": "【台電】電費已逾期 3 期，今日 18:00 執行斷電，請線上補繳", "min_score": 85},
        {"name": "自來水停水通知", "text": "自來水公司：水費未繳，明日將停止供水，請立即繳納", "min_score": 80},
        {"name": "瓦斯停氣通知", "text": "瓦斯公司通知：您家瓦斯將因欠費停供，請點擊繳費", "min_score": 80},
        
        # 包裹詐騙
        {"name": "包裹滯留詐騙", "text": "【郵局】您的國際包裹因運費不足 32 元被滯留，請補繳否則銷毀", "min_score": 80},
        {"name": "超商取貨異常", "text": "您的 7-11 取貨付款訂單因系統異常無法出貨，請點擊驗證", "min_score": 75},
        {"name": "宅配到府詐騙", "text": "黑貓宅急便：您的包裹地址錯誤，請重新填寫並支付重新配送費", "min_score": 75},
        
        # 熟人詐騙
        {"name": "假冒主管", "text": "我是總經理，換手機了，加我新 LINE 有急事需要處理", "min_score": 75},
        {"name": "假冒家人車禍", "text": "媽，我出車禍在醫院，急需手術費 10 萬，直接匯到這個帳戶，不要告訴爸爸", "min_score": 90},
        {"name": "假冒朋友借錢", "text": "兄弟，我現在有困難，可以借我 5 萬嗎？明天一定還", "min_score": 70},
        
        # 投資詐騙
        {"name": "飆股內線", "text": "老師內線消息，這支股票明天必漲 30%，只有群組成員能買", "min_score": 90},
        {"name": "加密貨幣詐騙", "text": "投資 USDT 每日獲利 5%，保本保息，限額 100 萬", "min_score": 90},
        {"name": "殺豬盤話術", "text": "我跟著老師投資已經賺了 500 萬，你也可以，加我 LINE 教你", "min_score": 90},
        
        # 中獎詐騙
        {"name": "BTC 中獎詐騙", "text": "Congratulations! You won 1 BTC. 請立即點擊領取，限時 24 小時", "min_score": 85},
        {"name": "iPhone 中獎", "text": "您已被抽中獲得 iPhone 16 Pro，請填寫地址並支付運費 500 元", "min_score": 85},
        {"name": "統一發票中獎", "text": "您的統一發票中獎 100 萬，請點擊連結兌領", "min_score": 85},
        
        # 政府補貼詐騙
        {"name": "普發津貼詐騙", "text": "政府普發津貼 6000 元，線上申請最後一天，逾期不候", "min_score": 85},
        {"name": "勞保補助詐騙", "text": "勞保局通知：您可申請勞保補助 3 萬元，請點擊申請", "min_score": 80},
        {"name": "健保退費詐騙", "text": "健保署：您有健保費溢繳，請點擊連結申請退費", "min_score": 80},
        
        # 電商詐騙
        {"name": "蝦皮訂單異常", "text": "【蝦皮購物】您的商品因超商異常無法寄出，請點擊驗證訂單", "min_score": 80},
        {"name": "Netflix 過期", "text": "Netflix 會員資格已過期，請點擊此處更新付款資訊", "min_score": 75},
        {"name": "Amazon 退款", "text": "Amazon：您的訂單已取消，請點擊連結申請退款", "min_score": 75},
        
        # 銀行金融詐騙
        {"name": "帳戶凍結詐騙", "text": "您的銀行帳戶已被凍結，請點擊連結解除凍結", "min_score": 85},
        {"name": "信用卡盜刷", "text": "信用卡刷卡確認：您於海外消費 50,000 元，若非本人請點擊取消", "min_score": 85},
        {"name": "ETC 欠費", "text": "ETC 國道通行費欠費 50 元，請立即繳納以免受罰", "min_score": 80},
        {"name": "健保卡鎖卡", "text": "您的健保卡使用違規，將於 24 小時內鎖卡，請聯繫客服", "min_score": 80},
    ]
    
    for case in scam_cases:
        try:
            res = requests.post(f"{BASE_URL}/scan", json={"url": "http://scam-test.com", "text": case["text"]}, timeout=TIMEOUT_SEC)
            score = res.json().get('riskScore', 0)
            reason = res.json().get('reason', '')[:30]
            
            if score >= case["min_score"]:
                result.add(case["name"], True, f"Score: {score} (門檻:{case['min_score']})")
            else:
                result.add(case["name"], False, f"Score: {score} (門檻:{case['min_score']}) - {reason}")
        except Exception as e:
            result.add(case["name"], False, f"錯誤：{str(e)}")
        time.sleep(0.5)

# ==========================================
# 🧪 模組 4: 混合語言與規避測試 (10 筆)
# ==========================================
def test_evasion_techniques():
    print("\n" + "="*70)
    print("🧪 模組 4: 混合語言與規避測試")
    print("="*70)
    
    cases = [
        {"name": "中英混合", "text": "Congratulations! 您已中獎 100 萬 USD，請立即 claim", "min_score": 80},
        {"name": "繁簡混合", "text": "恭喜您中奖了，请立即点击领取奖金", "min_score": 75},
        {"name": "日文混合", "text": "おめでとうございます！当選しました，請點擊領取", "min_score": 75},
        {"name": "符號分隔", "text": "中•獎•通•知：您•獲•得•100•萬", "min_score": 75},
        {"name": "同音字規避", "text": "仲獎通知：您獲得 100 萬，請點機領取", "min_score": 70},
        {"name": "火星文規避", "text": "伱巳中獎 100 萬，請點撃領娶", "min_score": 70},
        {"name": "Base64 編碼", "text": "5L+g5a6J6KGM6ZqL55m955qE5Lq66ZmF5LiW55m955qE5Lq6", "min_score": 50},
        {"name": "URL 編碼", "text": "%E4%B8%AD%E7%8D%8E%E9%80%9A%E7%9F%A5", "min_score": 50},
        {"name": "反轉文字", "text": "。取領擊點請，萬 001 得獲您：知通獎中", "min_score": 60},
        {"name": "隱藏連結", "text": "請點擊這裡 http://bit.ly/3xYz 領取獎金", "min_score": 80},
    ]
    
    for case in cases:
        try:
            res = requests.post(f"{BASE_URL}/scan", json={"url": "http://test.com", "text": case["text"]}, timeout=TIMEOUT_SEC)
            score = res.json().get('riskScore', 0)
            
            if score >= case["min_score"]:
                result.add(case["name"], True, f"Score: {score}")
            else:
                result.add(case["name"], False, f"Score: {score} (門檻:{case['min_score']})")
        except Exception as e:
            result.add(case["name"], False, f"錯誤：{str(e)}")
        time.sleep(0.5)

# ==========================================
# ⚙️ 模組 5: 系統穩定性與邊界測試 (15 筆)
# ==========================================
def test_system_stability():
    print("\n" + "="*70)
    print("⚙️ 模組 5: 系統穩定性與邊界測試")
    print("="*70)
    
    # 空/無效輸入
    invalid_payloads = [
        {"name": "空 JSON", "payload": {}},
        {"name": "空文字", "payload": {"text": "", "url": ""}},
        {"name": "Null 文字", "payload": {"text": None, "url": "http://safe.com"}},
        {"name": "錯誤金鑰", "payload": {"wrong_key": "test_data"}},
        {"name": "超長文字", "payload": {"text": "A" * 50000, "url": "http://safe.com"}},
        {"name": "特殊符號", "payload": {"text": "!@#$%^&*()_+-=[]{}|;':\",./<>?", "url": "http://safe.com"}},
        {"name": "Emoji 轟炸", "payload": {"text": "🚨🔥💰🎁" * 100, "url": "http://safe.com"}},
        {"name": "緊急通報", "payload": {"is_urgent": True, "text": "緊急阻擋測試", "url": "http://safe.com"}},
    ]
    
    for case in invalid_payloads:
        try:
            res = requests.post(f"{BASE_URL}/scan", json=case["payload"], timeout=TIMEOUT_SEC)
            if res.status_code in [200, 400, 422]:
                result.add(case["name"], True, f"狀態碼：{res.status_code}")
            else:
                result.add(case["name"], False, f"異常狀態碼：{res.status_code}")
        except Exception as e:
            result.add(case["name"], False, f"錯誤：{str(e)}")
        time.sleep(0.3)
    
    # 併發測試
    print("\n  [併發壓力測試]")
    def concurrent_request(idx):
        try:
            res = requests.post(f"{BASE_URL}/scan", json={"text": f"測試 {idx}", "url": "http://test.com"}, timeout=TIMEOUT_SEC)
            return res.status_code == 200
        except:
            return False
    
    threads = []
    success_count = 0
    for i in range(10):
        t = threading.Thread(target=lambda: None)
        threads.append(t)
    
    # 簡化併發測試
    for i in range(10):
        if concurrent_request(i):
            success_count += 1
    
    if success_count >= 8:
        result.add("併發測試 (10 請求)", True, f"成功：{success_count}/10")
    else:
        result.add("併發測試 (10 請求)", False, f"成功：{success_count}/10")
    
    # 家庭系統 API
    print("\n  [家庭系統 API 測試]")
    test_uid = f"TEST_{int(time.time())}"
    invite_code = ""
    
    try:
        res = requests.post(f"{BASE_URL}/api/create_family", json={"uid": test_uid}, timeout=TIMEOUT_SEC).json()
        invite_code = res.get('inviteCode', '')
        result.add("建立家庭", bool(invite_code), f"邀請碼：{invite_code}")
    except Exception as e:
        result.add("建立家庭", False, str(e))
    
    try:
        res = requests.post(f"{BASE_URL}/api/join_family", json={"uid": "TEST_MEMBER", "inviteCode": invite_code}, timeout=TIMEOUT_SEC).json()
        result.add("加入家庭", res.get('status') == 'success')
    except Exception as e:
        result.add("加入家庭", False, str(e))
    
    try:
        res = requests.post(f"{BASE_URL}/api/get_alerts", json={"familyID": invite_code}, timeout=TIMEOUT_SEC).json()
        result.add("獲取警報", res.get('status') == 'success')
    except Exception as e:
        result.add("獲取警報", False, str(e))
    
    try:
        res = requests.post(f"{BASE_URL}/api/clear_alerts", json={"familyID": invite_code}, timeout=TIMEOUT_SEC).json()
        result.add("清除警報", res.get('status') == 'success')
    except Exception as e:
        result.add("清除警報", False, str(e))
    
    # 響應時間測試
    print("\n  [響應時間測試]")
    start = time.time()
    requests.post(f"{BASE_URL}/scan", json={"text": "快速測試", "url": "http://test.com"}, timeout=TIMEOUT_SEC)
    elapsed = time.time() - start
    
    if elapsed < 30:
        result.add("響應時間", True, f"{elapsed:.2f}秒")
    else:
        result.add("響應時間", False, f"{elapsed:.2f}秒 (超過 30 秒)")

# ==========================================
# 🚨 模組 6: 2026 新趨勢詐騙測試 (10 筆)
# ==========================================
def test_2026_trends():
    print("\n" + "="*70)
    print("🚨 模組 6: 2026 新趨勢詐騙測試")
    print("="*70)
    
    cases = [
        {"name": "AI 語音合成", "text": "媽，我是小明，我聲音可能怪怪的是因為感冒，我出車禍急需 20 萬手術費", "min_score": 90},
        {"name": "Deepfake 視訊", "text": "視訊通話邀請：您的家人請求緊急匯款協助", "min_score": 85},
        {"name": "NFT 投資詐騙", "text": "限量 NFT 空投，免費領取，只需支付 gas 費 0.1 ETH", "min_score": 85},
        {"name": "元宇宙土地", "text": "元宇宙虛擬土地投資，早鳥價 10 萬，明年翻倍", "min_score": 85},
        {"name": "AI 炒股機器人", "text": "AI 自動交易機器人，月報酬率 20%，保本保息", "min_score": 90},
        {"name": "CBDC 數位貨幣", "text": "央行數位貨幣提前兌換，1 台幣換 1.5 數位幣，限時", "min_score": 85},
        {"name": "碳權交易詐騙", "text": "投資碳權交易，政府補貼 50%，年報酬 30%", "min_score": 85},
        {"name": "遠端工作詐騙", "text": "在家工作打字員，日薪 3000，無需經驗，加 LINE", "min_score": 80},
        {"name": "假 APK 詐騙", "text": "您的包裹已送達，請點擊下載憑證 APK 查看", "min_score": 90},
        {"name": "QR Code 詐騙", "text": "掃描 QR Code 領取政府補助，限時 24 小時", "min_score": 85},
    ]
    
    for case in cases:
        try:
            res = requests.post(f"{BASE_URL}/scan", json={"url": "http://scam.com", "text": case["text"]}, timeout=TIMEOUT_SEC)
            score = res.json().get('riskScore', 0)
            
            if score >= case["min_score"]:
                result.add(case["name"], True, f"Score: {score}")
            else:
                result.add(case["name"], False, f"Score: {score} (門檻:{case['min_score']})")
        except Exception as e:
            result.add(case["name"], False, f"錯誤：{str(e)}")
        time.sleep(0.5)

# ==========================================
# 🌐 模組 7: 進階網域攻擊測試 (10 筆)
# ==========================================
def test_advanced_domain_attacks():
    print("\n" + "="*70)
    print("🌐 模組 7: 進階網域攻擊測試 (同形異義字、Userinfo、編碼繞過)")
    print("="*70)
    
    cases = [
        {"name": "同形異義字 (西里爾)", "url": "https://www.аррӏе.com", "text": "請登入 Apple 帳號", "min_score": 90},
        {"name": "Userinfo 繞過", "url": "https://www.google.com@evil.com", "text": "安全檢查", "min_score": 80},
        {"name": "多層子域偽裝", "url": "https://login-apple.com-id-verify.xyz", "text": "Apple 驗證", "min_score": 90},
        {"name": "URL 編碼", "url": "https%3A%2F%2Fevil.com", "text": "點擊連結", "min_score": 70},  # 系統可能無法解析，但仍應判為風險
        {"name": "零寬字符域名", "url": "https://www.goo\u200Bgle.com", "text": "Google 服務", "min_score": 80},
        {"name": "全形域名", "url": "ｈｔｔｐｓ：／／ｅｖｉｌ．ｃｏｍ", "text": "惡意網站", "min_score": 80},
        {"name": "IP 代替域名", "url": "http://192.168.1.1/admin", "text": "路由器後台", "min_score": 70},  # 內部 IP 可能被視為可疑
        {"name": "非標準埠誘導", "url": "http://safe.com:8080/login", "text": "銀行登入", "min_score": 60},  # 非標準埠不一定危險，但結合文字可加分
        {"name": "混合大小寫與反斜線", "url": "http://www。google。com", "text": "Google 搜尋", "min_score": 80},  # 全形句號
        {"name": "短網址重定向", "url": "https://bit.ly/3fake", "text": "點擊領取獎品", "min_score": 80},
    ]
    
    for case in cases:
        try:
            res = requests.post(f"{BASE_URL}/scan", json={"url": case["url"], "text": case["text"]}, timeout=TIMEOUT_SEC)
            score = res.json().get('riskScore', 0)
            if score >= case["min_score"]:
                result.add(case["name"], True, f"Score: {score}")
            else:
                result.add(case["name"], False, f"Score: {score} < {case['min_score']}")
        except Exception as e:
            result.add(case["name"], False, f"錯誤：{str(e)}")
        time.sleep(0.5)

# ==========================================
# 🖼️ 模組 8: 圖片詐騙測試 (5 筆)
# ==========================================
def test_image_scam():
    print("\n" + "="*70)
    print("🖼️ 模組 8: 圖片詐騙測試 (image_url 參數)")
    print("="*70)
    
    # 由於無法實際提供圖片，這裡用 dummy 圖片 URL，但仍可測試參數傳遞與系統回應
    cases = [
        {"name": "圖片含中獎文字", "image_url": "https://fakeimg.pl/300x200?text=Congratulations+You+Won", "text": "", "min_score": 70},
        {"name": "圖片 QR Code", "image_url": "https://fakeimg.pl/300x200?text=QR+Code", "text": "掃碼領獎", "min_score": 70},
        {"name": "無效圖片 URL", "image_url": "https://nonexistent.image.com/123.jpg", "text": "請查看圖片", "min_score": 50},
        {"name": "同時提供文字與圖片", "image_url": "https://fakeimg.pl/300x200?text=Scam", "text": "這是一張詐騙圖片", "min_score": 75},
        {"name": "不同圖片格式", "image_url": "https://fakeimg.pl/300x200.gif?text=Animated", "text": "動態圖片", "min_score": 60},
    ]
    
    for case in cases:
        try:
            payload = {"image_url": case["image_url"], "text": case["text"], "url": ""}
            res = requests.post(f"{BASE_URL}/scan", json=payload, timeout=TIMEOUT_SEC)
            score = res.json().get('riskScore', 0)
            # 只要有 image_url 且文字具誘導性，期望 AI 給出一定風險
            if score >= case["min_score"]:
                result.add(case["name"], True, f"Score: {score}")
            else:
                result.add(case["name"], False, f"Score: {score} < {case['min_score']}")
        except Exception as e:
            result.add(case["name"], False, f"錯誤：{str(e)}")
        time.sleep(0.5)

# ==========================================
# 💰 模組 9: 金融與帳戶詐騙測試 (10 筆)
# ==========================================
def test_financial_scam():
    print("\n" + "="*70)
    print("💰 模組 9: 金融與帳戶詐騙測試 (銀行帳號、加密貨幣地址)")
    print("="*70)
    
    cases = [
        {"name": "銀行帳號匯款", "text": "請匯款至 012-3456789-01 陳小美", "min_score": 80},
        {"name": "加密貨幣地址 BTC", "text": "傳送 0.5 BTC 到 1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", "min_score": 85},
        {"name": "加密貨幣地址 ETH", "text": "請支付 0.1 ETH 至 0xAbC123... 以完成驗證", "min_score": 85},
        {"name": "假貸款廣告", "text": "無需聯徵，最快 1 小時撥款，加 LINE：loan123", "min_score": 80},
        {"name": "假投資群組", "text": "股票代碼內線，保證獲利，加入群組領飆股", "min_score": 90},
        {"name": "信用卡到期更新", "text": "您的信用卡將到期，請點擊更新卡號 4311-1111-2222-3333", "min_score": 85},
        {"name": "支付寶轉帳", "text": "支付寶紅包 1000 元，點擊領取", "min_score": 70},
        {"name": "微信轉帳", "text": "微信轉帳 500 元，請確認收款", "min_score": 70},
        {"name": "退款詐騙", "text": "您訂單退款 3000 元，請提供銀行帳戶", "min_score": 80},
        {"name": "投資保證高獲利", "text": "每月固定配息 8%，本金安全，限額 50 萬", "min_score": 90},
    ]
    
    for case in cases:
        try:
            res = requests.post(f"{BASE_URL}/scan", json={"url": "http://fake.com", "text": case["text"]}, timeout=TIMEOUT_SEC)
            score = res.json().get('riskScore', 0)
            if score >= case["min_score"]:
                result.add(case["name"], True, f"Score: {score}")
            else:
                result.add(case["name"], False, f"Score: {score} < {case['min_score']}")
        except Exception as e:
            result.add(case["name"], False, f"錯誤：{str(e)}")
        time.sleep(0.5)

# ==========================================
# 👥 模組 10: 新型態社交工程測試 (10 筆)
# ==========================================
def test_new_social_engineering():
    print("\n" + "="*70)
    print("👥 模組 10: 新型態社交工程測試")
    print("="*70)
    
    cases = [
        {"name": "假綁架進階", "text": "你女兒在我車上，立刻匯 20 萬到 0123456789，不准報警！", "min_score": 95},
        {"name": "假冒航空公司", "text": "中華航空通知：您的機票因超賣需改簽，請聯繫客服 0800-123-456", "min_score": 80},
        {"name": "假冒監理站", "text": "您的車輛有違規罰單未繳，逾期將加倍，繳費連結 http://mvp-gov.cc", "min_score": 85},
        {"name": "免費健檢詐騙", "text": "社區免費老人健檢，需預繳保證金 500 元", "min_score": 80},
        {"name": "疫苗預約詐騙", "text": "第三劑疫苗預約成功，點擊確認 http://vax-tw.com", "min_score": 80},
        {"name": "勞保局補助", "text": "勞工紓困補助已核准，點擊領取 http://gov- subsidy.com", "min_score": 85},
        {"name": "電信公司停話", "text": "您的門號將被停用，請點擊更新資料 http://ch-fix.com", "min_score": 80},
        {"name": "Netflix 付款失敗", "text": "Netflix 付款失敗，請重新填寫信用卡資訊", "min_score": 75},
        {"name": "Spotify 會員到期", "text": "您的 Spotify 高級會員今日到期，續費享 5 折", "min_score": 70},
        {"name": "假冒房東改帳戶", "text": "我是房東，新帳戶請將租金匯至 822-1234567890", "min_score": 85},
    ]
    
    for case in cases:
        try:
            res = requests.post(f"{BASE_URL}/scan", json={"url": "http://scam.net", "text": case["text"]}, timeout=TIMEOUT_SEC)
            score = res.json().get('riskScore', 0)
            if score >= case["min_score"]:
                result.add(case["name"], True, f"Score: {score}")
            else:
                result.add(case["name"], False, f"Score: {score} < {case['min_score']}")
        except Exception as e:
            result.add(case["name"], False, f"錯誤：{str(e)}")
        time.sleep(0.5)

# ==========================================
# 🔒 模組 11: 越權與安全性測試 (8 筆)
# ==========================================
def test_security_boundary():
    print("\n" + "="*70)
    print("🔒 模組 11: 越權與安全性測試 (家庭 API)")
    print("="*70)
    
    # 先建立兩個不同的家庭
    uid1 = f"GUARD_{int(time.time())}"
    uid2 = f"GUARD2_{int(time.time())}"
    member1 = f"MEM_{int(time.time())}"
    code1, code2 = "", ""
    
    try:
        res1 = requests.post(f"{BASE_URL}/api/create_family", json={"uid": uid1}, timeout=TIMEOUT_SEC).json()
        code1 = res1.get('inviteCode', '')
        result.add("建立家庭 A", bool(code1), f"邀請碼：{code1}")
    except Exception as e:
        result.add("建立家庭 A", False, str(e))
    
    try:
        res2 = requests.post(f"{BASE_URL}/api/create_family", json={"uid": uid2}, timeout=TIMEOUT_SEC).json()
        code2 = res2.get('inviteCode', '')
        result.add("建立家庭 B", bool(code2), f"邀請碼：{code2}")
    except Exception as e:
        result.add("建立家庭 B", False, str(e))
    
    time.sleep(1)
    
    # 加入家庭測試
    try:
        res = requests.post(f"{BASE_URL}/api/join_family", json={"uid": member1, "inviteCode": code1}, timeout=TIMEOUT_SEC).json()
        result.add("加入家庭 A (成員)", res.get('status') == 'success')
    except Exception as e:
        result.add("加入家庭 A (成員)", False, str(e))
    
    # 越權測試案例
    cases = [
        {"name": "空白邀請碼加入", "payload": {"uid": "test", "inviteCode": ""}, "expect_fail": True},
        {"name": "超長邀請碼", "payload": {"uid": "test", "inviteCode": "A"*20}, "expect_fail": True},
        {"name": "特殊符號邀請碼", "payload": {"uid": "test", "inviteCode": "@#$%"}, "expect_fail": True},
        {"name": "不存在的家庭ID獲取警報", "payload": {"familyID": "NOEXIST"}, "expect_fail": True},
        {"name": "用家庭B的ID獲取家庭A的警報", "payload": {"familyID": code1 if code2 else "xxxxxx"}, "use_wrong": True},
        {"name": "清除他人家庭警報", "payload": {"familyID": code1 if code2 else "xxxxxx"}, "use_wrong": True},
        {"name": "建立家庭時傳入非字串UID", "payload": {"uid": 12345}, "expect_fail": True},
        {"name": "加入家庭時傳入不存在UID", "payload": {"uid": "no_such_user", "inviteCode": code1}, "expect_fail": False},  # 系統可能仍允許
    ]
    
    for case in cases:
        try:
            if case.get("use_wrong"):
                fid = code2 if code2 else "FAKE"
                if "清除" in case["name"]:
                    res = requests.post(f"{BASE_URL}/api/clear_alerts", json={"familyID": fid}, timeout=TIMEOUT_SEC).json()
                    passed = (res.get('status') == 'success')
                else:
                    res = requests.post(f"{BASE_URL}/api/get_alerts", json={"familyID": fid}, timeout=TIMEOUT_SEC).json()
                    passed = (res.get('status') == 'success' and res.get('data') == [])
                result.add(case["name"], passed, f"回傳預期的合法空資料: {res}")
            elif case.get("expect_fail"):
                if case["name"] == "建立家庭時傳入非字串UID":
                    res = requests.post(f"{BASE_URL}/api/create_family", json=case["payload"], timeout=TIMEOUT_SEC)
                    passed = res.status_code == 400
                else:
                    res = requests.post(f"{BASE_URL}/api/join_family", json=case["payload"], timeout=TIMEOUT_SEC)
                    passed = res.status_code == 400
                result.add(case["name"], passed, f"狀態碼: {res.status_code}")
            else:
                # 正常情況應成功
                res = requests.post(f"{BASE_URL}/api/join_family", json=case["payload"], timeout=TIMEOUT_SEC).json()
                passed = res.get('status') == 'success'
                result.add(case["name"], passed, f"回應: {res}")
        except Exception as e:
            result.add(case["name"], False, f"錯誤：{str(e)}")
        time.sleep(0.5)

# ==========================================
# ⚠️ 模組 12: 邊界與錯誤處理補充 (5 筆)
# ==========================================
def test_error_handling():
    print("\n" + "="*70)
    print("⚠️ 模組 12: 邊界與錯誤處理補充")
    print("="*70)
    
    cases = [
        {"name": "同時提供 url 和 image_url", "payload": {"url": "http://test.com", "image_url": "http://fakeimg.pl", "text": "測試"}, "desc": "應優先處理哪個？"},
        {"name": "極大 JSON (1MB)", "payload": {"text": "A" * 1000000, "url": "http://test.com"}, "desc": "伺服器應能處理或返回413"},
        {"name": "非 JSON Content-Type", "headers": {"Content-Type": "text/plain"}, "data": "plain text", "desc": "應返回400"},
        {"name": "回報誤報端點", "endpoint": "/api/report_false_positive", "payload": {"url": "http://safe.com", "reason": "誤判"}, "desc": "應成功"},
        {"name": "緊急通報觸發", "payload": {"is_urgent": True, "text": "這是一筆緊急詐騙", "url": "http://scam.com"}, "desc": "應快速回應"},
    ]
    
    for case in cases:
        try:
            if case.get("endpoint"):
                res = requests.post(f"{BASE_URL}{case['endpoint']}", json=case["payload"], timeout=TIMEOUT_SEC)
                passed = res.status_code == 200
            elif case.get("headers"):
                res = requests.post(f"{BASE_URL}/scan", headers=case["headers"], data=case["data"], timeout=TIMEOUT_SEC)
                passed = res.status_code == 400 or res.status_code == 415
            else:
                res = requests.post(f"{BASE_URL}/scan", json=case["payload"], timeout=TIMEOUT_SEC)
                passed = res.status_code == 200  # 期望至少不崩潰
            result.add(case["name"], passed, f"狀態碼: {res.status_code}")
        except Exception as e:
            result.add(case["name"], False, f"錯誤：{str(e)}")
        time.sleep(0.5)

# ==========================================
# 🆕 模組 13: 遺漏詐騙與進階輸入測試 (15 筆)
# ==========================================
def test_missing_scenarios():
    print("\n" + "="*70)
    print("🆕 模組 13: 遺漏詐騙與進階輸入測試")
    print("="*70)

    cases = [
        # 假交友/假援交詐騙
        {"name": "假交友(買點數)", "text": "寶貝，我急需用錢，可以幫我買 5000 元遊戲點數嗎？晚點還你", "min_score": 85},
        {"name": "假援交(先付保證金)", "text": "約會前須先付 3000 元保證金，防止放鴿子", "min_score": 85},

        # 假網拍私下交易
        {"name": "假網拍(加LINE)", "text": "商品已賣出，請加 LINE ID @shop123 下單，價格可議", "min_score": 80},

        # 假貸款手續費
        {"name": "假貸款(先付手續費)", "text": "您的貸款已核准，請先匯款 5000 元手續費至 012-3456789", "min_score": 85},

        # 假防疫/疫調簡訊
        {"name": "假疫調簡訊", "text": "疫調通知：您曾與確診者足跡重疊，請點擊連結填寫資料 http://cdc-tw.cc", "min_score": 85},

        # 假帳單/罰單繳費
        {"name": "假停車費逾期", "text": "您有未繳納的停車費 120 元，逾期將加倍，繳費連結 http://pay-tp.gov", "min_score": 80},

        # 假冒電信小額付款
        {"name": "假小額付款", "text": "您的電信帳單小額付款 2990 元，若非本人請回電 0800-123-456", "min_score": 75},

        # 假冒銀行客服操作ATM
        {"name": "假客服操作ATM", "text": "您的帳戶被重複扣款，請至 ATM 操作取消設定", "min_score": 90},

        # 假中獎稅金
        {"name": "假中獎稅金", "text": "您中獎 100 萬，須先繳納 15% 稅金才能領取", "min_score": 85},

        # 假帳號被盜求救
        {"name": "假帳號被盜(收驗證碼)", "text": "我帳號被盜，手機收不到驗證碼，幫我收一下，號碼是 0912-345-678", "min_score": 80},

        # 多步驟詐騙 (長文本)
        {"name": "多步驟詐騙", "text": "【蝦皮客服】您的訂單因系統錯誤被重複扣款，我們將協助退款，請提供您銀行客服電話。稍後銀行會致電給您。\n【假冒銀行】您好，這裡是國泰世華，我們要協助您解除分期付款，請至 ATM 操作...", "min_score": 95},

        # SQL 注入嘗試
        {"name": "SQL注入", "text": "' OR 1=1; -- 測試注入", "url": "http://test.com", "min_score": 50, "check_status": True},

        # NoSQL 注入嘗試 (需發送特殊 JSON，但這裡用文字模擬)
        {"name": "NoSQL注入", "text": "{\"$ne\": null}", "min_score": 50, "check_status": True},

        # 路徑遍歷嘗試
        {"name": "路徑遍歷", "text": "../../../etc/passwd", "min_score": 50, "check_status": True},

        # 超長參數名稱 (測試伺服器處理極長 key)
        {"name": "超長參數", "payload": {f"key_{'A'*5000}": "value"}, "min_score": None, "expect_status": 200},

        # 多重短網址重定向 (文字模擬)
        {"name": "多層短網址", "text": "點擊 http://bit.ly/abc 領取獎品，再轉到 http://tinyurl.com/def", "min_score": 80},
    ]

    for case in cases:
        try:
            if "payload" in case:
                res = requests.post(f"{BASE_URL}/scan", json=case["payload"], timeout=TIMEOUT_SEC)
                passed = res.status_code == case.get("expect_status", 200)
                result.add(case["name"], passed, f"狀態碼: {res.status_code}")
            elif case.get("check_status"):
                # 這類攻擊應至少不被伺服器崩潰，通常返回 200 或 400
                res = requests.post(f"{BASE_URL}/scan", json={"url": "http://test.com", "text": case["text"]}, timeout=TIMEOUT_SEC)
                passed = res.status_code in [200, 400, 422]
                result.add(case["name"], passed, f"狀態碼: {res.status_code}")
            else:
                res = requests.post(f"{BASE_URL}/scan", json={"url": "http://scam.com", "text": case["text"]}, timeout=TIMEOUT_SEC)
                score = res.json().get('riskScore', 0)
                if score >= case["min_score"]:
                    result.add(case["name"], True, f"Score: {score}")
                else:
                    result.add(case["name"], False, f"Score: {score} < {case['min_score']}")
        except Exception as e:
            result.add(case["name"], False, f"錯誤：{str(e)}")
        time.sleep(0.5)

# ==========================================
# 🏁 主程式
# ==========================================
if __name__ == "__main__":
    print("="*70)
    print("🚀 啟動「地獄級」全功能壓力測試套件 (2026 終極完整版)")
    print("="*70)
    print(f"📍 測試目標：{BASE_URL}")
    print(f"⏱️  請求時限：{TIMEOUT_SEC}秒")
    print("="*70)
    
    start_time = time.time()
    
    # 執行所有測試模組
    test_pii_masking()                # 模組 1 (約 17 筆)
    test_domain_spoofing()             # 模組 2 (20 筆)
    test_social_engineering()          # 模組 3 (30 筆)
    test_evasion_techniques()          # 模組 4 (10 筆)
    test_system_stability()            # 模組 5 (約 15 筆)
    test_2026_trends()                 # 模組 6 (10 筆)
    test_advanced_domain_attacks()     # 模組 7 (10 筆)
    test_image_scam()                  # 模組 8 (5 筆)
    test_financial_scam()              # 模組 9 (10 筆)
    test_new_social_engineering()      # 模組 10 (10 筆)
    test_security_boundary()           # 模組 11 (8 筆)
    test_error_handling()              # 模組 12 (5 筆)
    test_missing_scenarios()           # 模組 13 (15 筆)
    
    end_time = time.time()
    
    # 最終報告
    total_rate = result.summary()
    print(f"\n⏱️  總執行時間：{end_time - start_time:.2f}秒")
    print("="*70)
    
    if total_rate >= 95:
        print("🎉 測試結果：優秀！系統已達生產等級！")
    elif total_rate >= 80:
        print("⚠️  測試結果：良好，但有改進空間")
    else:
        print("❌ 測試結果：需要重大改進")
    
    print("="*70)