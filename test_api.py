import argparse
import os
import sys
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests
import time
import json
import random
import string
import threading
import re
import csv
from datetime import datetime

# 🛠️ 配置區域
BASE_URL = os.getenv("AI_SHIELD_BASE_URL", "http://127.0.0.1:5000")
TIMEOUT_SEC = int(os.getenv("AI_SHIELD_TIMEOUT_SEC", "35"))

# 舊版金鑰只走環境變數 / CLI，不再硬寫到程式碼。
API_SECRET = os.getenv("AI_SHIELD_LEGACY_SECRET", "").strip()

# 正式權限測試開關：後端 REQUIRE_ACCESS_TOKEN=true 時，建議同步開啟。
EXPECT_STRICT_AUTH = os.getenv("AI_SHIELD_EXPECT_STRICT_AUTH", "true").lower() == "true"

TEST_INSTALL_ID = f"test-install-{uuid.uuid4().hex[:12]}"
TEST_USER_ID = os.getenv("AI_SHIELD_TEST_USER_ID", "TEST_USER_API")
TEST_FAMILY_ID = os.getenv("AI_SHIELD_TEST_FAMILY_ID", "none")
ACCESS_TOKEN = ""

# 🌟 建立共用的 Session。優先使用短效 Bearer Token；若有 legacy secret 則相容附上。
session = requests.Session()
if API_SECRET:
    session.headers.update({"X-Extension-Secret": API_SECRET})

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

        report = {
            "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "base_url": BASE_URL,
            "total": self.total,
            "passed": self.passed,
            "failed_count": self.total - self.passed,
            "pass_rate": round(rate, 1),
            "failed": self.failed,
            "competition_summary": {
                "headline": f"{self.passed}/{self.total} tests passed ({rate:.1f}%)",
                "claim_safe_text": "本報告僅代表本輪測試集結果，適合用於競賽 Demo 與原型驗證。",
            }
        }
        try:
            with open("ai_shield_test_report.json", "w", encoding="utf-8") as f:
                json.dump(report, f, ensure_ascii=False, indent=2)
            with open("ai_shield_test_report.csv", "w", encoding="utf-8-sig", newline="") as f:
                writer = csv.writer(f)
                writer.writerow(["name", "detail"])
                for item in self.failed:
                    writer.writerow([item.get("name", ""), item.get("detail", "")])

            status_color = "#0f9d58" if rate >= 95 else "#f59e0b" if rate >= 80 else "#d93025"
            failed_html = "".join(
                f"<li><b>{item.get('name','')}</b><br><span>{item.get('detail','')}</span></li>"
                for item in self.failed
            ) or "<li>本輪沒有失敗項目。</li>"
            with open("ai_shield_test_report.html", "w", encoding="utf-8") as f:
                f.write(f"""<!doctype html><html lang='zh-Hant'><meta charset='utf-8'><title>AI 防詐盾牌測試報告</title>
                <body style='font-family:Microsoft JhengHei,Arial;padding:32px;background:#f6f8ff;color:#10204a'>
                <main style='max-width:960px;margin:auto;background:white;border-radius:24px;padding:32px;box-shadow:0 18px 48px rgba(16,32,74,.12)'>
                <p style='display:inline-block;background:#e9f2ff;color:#1b64d8;padding:6px 12px;border-radius:999px;font-weight:800'>Competition Validation Report</p>
                <h1 style='margin:10px 0 8px'>AI 防詐盾牌｜自動化測試報告</h1>
                <h2 style='font-size:42px;color:{status_color};margin:12px 0'>{self.passed}/{self.total} 通過｜{rate:.1f}%</h2>
                <p>產生時間：{report['generated_at']}｜測試目標：{report['base_url']}</p>
                <p style='line-height:1.7'>{report['competition_summary']['claim_safe_text']} 對外簡報請寫成「本測試集通過率」，避免誤稱全域真實準確率。</p>
                <section style='display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin:24px 0'>
                  <div style='background:#f8fbff;border-radius:16px;padding:18px'><b>總測試</b><div style='font-size:32px;font-weight:900'>{self.total}</div></div>
                  <div style='background:#f0fff7;border-radius:16px;padding:18px'><b>通過</b><div style='font-size:32px;font-weight:900;color:#0f9d58'>{self.passed}</div></div>
                  <div style='background:#fff4f4;border-radius:16px;padding:18px'><b>失敗</b><div style='font-size:32px;font-weight:900;color:#d93025'>{self.total - self.passed}</div></div>
                </section>
                <h3>失敗項目</h3><ol style='line-height:1.7'>{failed_html}</ol>
                </main></body></html>""")
            print("📄 已輸出 ai_shield_test_report.json / ai_shield_test_report.html / ai_shield_test_report.csv")
        except Exception as exc:
            print(f"⚠️ 測試報告輸出失敗：{exc}")
        return rate

result = TestResult()


def configure_from_cli():
    global BASE_URL, TIMEOUT_SEC, API_SECRET, EXPECT_STRICT_AUTH, TEST_USER_ID, TEST_FAMILY_ID

    parser = argparse.ArgumentParser(description="AI 防詐盾牌 - 競賽封版全功能壓力測試套件")
    parser.add_argument("--base-url", default=BASE_URL, help="API Base URL")
    parser.add_argument("--timeout", type=int, default=TIMEOUT_SEC, help="單次請求逾時秒數")
    parser.add_argument("--legacy-secret", default=API_SECRET, help="舊版 X-Extension-Secret，相容測試用")
    parser.add_argument("--user-id", default=TEST_USER_ID, help="測試 userID")
    parser.add_argument("--family-id", default=TEST_FAMILY_ID, help="測試 familyID")
    parser.add_argument("--skip-auth", action="store_true", help="跳過 /api/auth/install，只用 legacy secret 或公開 Demo 模式")
    parser.add_argument("--expect-strict-auth", action="store_true", default=EXPECT_STRICT_AUTH, help="期待後端 REQUIRE_ACCESS_TOKEN=true，越權存取必須被拒絕")
    parser.add_argument("--demo-auth", action="store_true", help="以 Demo 權限模式執行；越權測試不強制要求拒絕。")

    args = parser.parse_args()

    BASE_URL = args.base_url.rstrip("/")
    TIMEOUT_SEC = args.timeout
    API_SECRET = args.legacy_secret.strip()
    EXPECT_STRICT_AUTH = False if args.demo_auth else bool(args.expect_strict_auth)
    TEST_USER_ID = args.user_id
    TEST_FAMILY_ID = args.family_id

    session.headers.clear()
    if API_SECRET:
        session.headers.update({"X-Extension-Secret": API_SECRET})

    return args


def safe_json_response(response):
    try:
        return response.json()
    except Exception:
        return {"raw_text": response.text[:500], "status_code": response.status_code}


def authenticate_install(user_id=None, family_id=None, install_id=None, target_session=None):
    """
    取得短效 accessToken，並寫入指定 session 的 Authorization header。
    若後端尚未啟用 /api/auth/install，會回傳空字串，但不讓測試中斷。
    """
    global ACCESS_TOKEN

    target_session = target_session or session
    payload = {
        "installID": install_id or TEST_INSTALL_ID,
        "userID": user_id or TEST_USER_ID,
        "familyID": family_id or TEST_FAMILY_ID,
    }

    try:
        res = requests.post(
            f"{BASE_URL}/api/auth/install",
            json=payload,
            timeout=TIMEOUT_SEC,
            headers={"Content-Type": "application/json"}
        )
        data = safe_json_response(res)
        token = data.get("accessToken", "") if isinstance(data, dict) else ""

        if res.ok and token:
            target_session.headers.update({"Authorization": f"Bearer {token}"})

            if target_session is session:
                ACCESS_TOKEN = token

            return token, data

        return "", data

    except Exception as exc:
        return "", {"status": "error", "message": str(exc)}


def make_authed_session(user_id, family_id="none", install_id=None):
    temp_session = requests.Session()
    if API_SECRET:
        temp_session.headers.update({"X-Extension-Secret": API_SECRET})
    token, data = authenticate_install(
        user_id=user_id,
        family_id=family_id,
        install_id=install_id or f"test-install-{uuid.uuid4().hex[:8]}",
        target_session=temp_session
    )
    return temp_session, token, data


def create_family_with_session(uid):
    temp_session, _, _ = make_authed_session(uid, "none")
    response = temp_session.post(f"{BASE_URL}/api/create_family", json={"uid": uid}, timeout=TIMEOUT_SEC)
    data = safe_json_response(response)
    token = data.get("accessToken", "") if isinstance(data, dict) else ""
    family_id = data.get("inviteCode", data.get("familyID", "")) if isinstance(data, dict) else ""

    if token:
        temp_session.headers.update({"Authorization": f"Bearer {token}"})

    return temp_session, family_id, data


def post_json(path, payload, target_session=None):
    target_session = target_session or session
    return target_session.post(f"{BASE_URL}{path}", json=payload, timeout=TIMEOUT_SEC)


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
            res = session.post(f"{BASE_URL}/scan", json={"text": case["text"], "url": "http://test.com"}, timeout=TIMEOUT_SEC)
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
            res = session.post(f"{BASE_URL}/scan", json={"url": url, "text": "請更新資料"}, timeout=TIMEOUT_SEC)
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
            res = session.post(f"{BASE_URL}/scan", json={"url": case["url"], "text": "請點擊更新"}, timeout=TIMEOUT_SEC)
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
            res = session.post(f"{BASE_URL}/scan", json={"url": "http://scam-test.com", "text": case["text"]}, timeout=TIMEOUT_SEC)
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
            res = session.post(f"{BASE_URL}/scan", json={"url": "http://test.com", "text": case["text"]}, timeout=TIMEOUT_SEC)
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
            res = session.post(f"{BASE_URL}/scan", json=case["payload"], timeout=TIMEOUT_SEC)
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
        # requests.Session 不是 thread-safe；每個 worker 使用獨立 Session，並加上 Connection: close，
        # 避免 Windows / urllib3 連線池在高併發下互相卡住。
        headers = {"Content-Type": "application/json", "Connection": "close"}
        if "Authorization" in session.headers:
            headers["Authorization"] = session.headers["Authorization"]
        if "X-Extension-Secret" in session.headers:
            headers["X-Extension-Secret"] = session.headers["X-Extension-Secret"]

        payload = {"text": f"測試 {idx}", "url": f"http://test.com/concurrent-{idx}"}
        last_detail = ""

        for attempt in range(3):
            try:
                with requests.Session() as local_session:
                    res = local_session.post(
                        f"{BASE_URL}/scan",
                        json=payload,
                        headers=headers,
                        timeout=TIMEOUT_SEC,
                    )
                if res.status_code == 200:
                    return True, f"{idx}:200"

                last_detail = f"{idx}:HTTP {res.status_code} {res.text[:80]}"

            except Exception as exc:
                last_detail = f"{idx}:{type(exc).__name__} {str(exc)[:80]}"

            time.sleep(0.25 * (attempt + 1))

        return False, last_detail
    
    success_count = 0
    fail_details = []
    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = [executor.submit(concurrent_request, i) for i in range(10)]
        for future in as_completed(futures):
            ok, detail = future.result()
            if ok:
                success_count += 1
            else:
                fail_details.append(detail)

    if success_count >= 8:
        result.add("併發測試 (10 請求)", True, f"成功：{success_count}/10")
    else:
        detail_text = f"成功：{success_count}/10"
        if fail_details:
            detail_text += "；失敗細節：" + " | ".join(fail_details[:5])
        result.add("併發測試 (10 請求)", False, detail_text)
    
    # 家庭系統 API
    print("\n  [家庭系統 API 測試]")
    test_uid = f"TEST_{int(time.time())}"
    invite_code = ""
    
    try:
        res = session.post(f"{BASE_URL}/api/create_family", json={"uid": test_uid}, timeout=TIMEOUT_SEC).json()
        invite_code = res.get('inviteCode', '')
        family_token = res.get('accessToken', '')
        if family_token:
            session.headers.update({"Authorization": f"Bearer {family_token}"})
        result.add("建立家庭", bool(invite_code), f"邀請碼：{invite_code}")
    except Exception as e:
        result.add("建立家庭", False, str(e))
    
    try:
        res = session.post(f"{BASE_URL}/api/join_family", json={"uid": "TEST_MEMBER", "inviteCode": invite_code}, timeout=TIMEOUT_SEC).json()
        result.add("加入家庭", res.get('status') == 'success')
    except Exception as e:
        result.add("加入家庭", False, str(e))
    
    try:
        res = session.post(f"{BASE_URL}/api/get_alerts", json={"familyID": invite_code}, timeout=TIMEOUT_SEC).json()
        result.add("獲取警報", res.get('status') == 'success')
    except Exception as e:
        result.add("獲取警報", False, str(e))
    
    try:
        res = session.post(f"{BASE_URL}/api/clear_alerts", json={"familyID": invite_code}, timeout=TIMEOUT_SEC).json()
        result.add("清除警報", res.get('status') == 'success')
    except Exception as e:
        result.add("清除警報", False, str(e))
    
    # 響應時間測試
    print("\n  [響應時間測試]")
    start = time.time()
    session.post(f"{BASE_URL}/scan", json={"text": "快速測試", "url": "http://test.com"}, timeout=TIMEOUT_SEC)
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
            res = session.post(f"{BASE_URL}/scan", json={"url": "http://scam.com", "text": case["text"]}, timeout=TIMEOUT_SEC)
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
            res = session.post(f"{BASE_URL}/scan", json={"url": case["url"], "text": case["text"]}, timeout=TIMEOUT_SEC)
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
            res = session.post(f"{BASE_URL}/scan", json=payload, timeout=TIMEOUT_SEC)
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
            res = session.post(f"{BASE_URL}/scan", json={"url": "http://fake.com", "text": case["text"]}, timeout=TIMEOUT_SEC)
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
            res = session.post(f"{BASE_URL}/scan", json={"url": "http://scam.net", "text": case["text"]}, timeout=TIMEOUT_SEC)
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

    # auth/install 基本輸入邊界：正式封版不能讓明顯異常 ID 直接換 token。
    auth_boundary_cases = [
        {"name": "auth/install 空 installID", "payload": {"installID": "", "userID": "USER_AUTH_TEST", "familyID": "none"}},
        {"name": "auth/install 特殊字元 installID", "payload": {"installID": "../../evil", "userID": "USER_AUTH_TEST", "familyID": "none"}},
        {"name": "auth/install 異常 familyID", "payload": {"installID": "test-install-boundary", "userID": "USER_AUTH_TEST", "familyID": "../../"}},
    ]

    for case in auth_boundary_cases:
        try:
            res = requests.post(f"{BASE_URL}/api/auth/install", json=case["payload"], timeout=TIMEOUT_SEC)
            data = safe_json_response(res)
            passed = res.status_code in [400, 401, 403] or data.get("status") in ["fail", "error"]
            result.add(case["name"], passed, f"狀態碼: {res.status_code}, 回應: {data}")
        except Exception as e:
            result.add(case["name"], False, f"錯誤：{str(e)}")

    uid1 = f"GUARD_{int(time.time())}"
    uid2 = f"GUARD2_{int(time.time())}"
    member1 = f"MEM_{int(time.time())}"

    family_a_session, code1, family_a_data = create_family_with_session(uid1)
    result.add("建立家庭 A", bool(code1), f"邀請碼：{code1}, 回應：{family_a_data}")

    family_b_session, code2, family_b_data = create_family_with_session(uid2)
    result.add("建立家庭 B", bool(code2), f"邀請碼：{code2}, 回應：{family_b_data}")

    member_session, _, _ = make_authed_session(member1, "none")
    try:
        res = member_session.post(
            f"{BASE_URL}/api/join_family",
            json={"uid": member1, "inviteCode": code1},
            timeout=TIMEOUT_SEC
        )
        data = safe_json_response(res)
        member_token = data.get("accessToken", "") if isinstance(data, dict) else ""
        if member_token:
            member_session.headers.update({"Authorization": f"Bearer {member_token}"})
        result.add("加入家庭 A (成員)", data.get("status") == "success", f"回應：{data}")
    except Exception as e:
        result.add("加入家庭 A (成員)", False, str(e))

    # 格式邊界測試
    format_cases = [
        {"name": "空白邀請碼加入", "payload": {"uid": "test", "inviteCode": ""}, "expect_status": [400]},
        {"name": "超長邀請碼", "payload": {"uid": "test", "inviteCode": "A"*20}, "expect_status": [400]},
        {"name": "特殊符號邀請碼", "payload": {"uid": "test", "inviteCode": "@#$%"}, "expect_status": [400]},
        {"name": "建立家庭時傳入非字串UID", "endpoint": "/api/create_family", "payload": {"uid": 12345}, "expect_status": [400]},
        {"name": "加入家庭時傳入不存在UID", "payload": {"uid": "no_such_user", "inviteCode": code1}, "expect_status": [200]},
    ]

    for case in format_cases:
        try:
            endpoint = case.get("endpoint", "/api/join_family")
            res = session.post(f"{BASE_URL}{endpoint}", json=case["payload"], timeout=TIMEOUT_SEC)
            passed = res.status_code in case["expect_status"]
            result.add(case["name"], passed, f"狀態碼: {res.status_code}, 回應: {safe_json_response(res)}")
        except Exception as e:
            result.add(case["name"], False, f"錯誤：{str(e)}")
        time.sleep(0.3)

    if not code1 or not code2:
        result.add("越權測試前置資料", False, "家庭 A/B 建立失敗，略過實質越權測試")
        return

    # 合法讀取：家庭 A token 讀取家庭 A
    try:
        res = family_a_session.post(f"{BASE_URL}/api/get_alerts", json={"familyID": code1}, timeout=TIMEOUT_SEC)
        data = safe_json_response(res)
        result.add("合法讀取家庭 A 警報", res.status_code == 200 and data.get("status") == "success", f"狀態碼: {res.status_code}, 回應: {data}")
    except Exception as e:
        result.add("合法讀取家庭 A 警報", False, str(e))

    # 越權讀取：家庭 B token 嘗試讀取家庭 A
    try:
        res = family_b_session.post(f"{BASE_URL}/api/get_alerts", json={"familyID": code1}, timeout=TIMEOUT_SEC)
        data = safe_json_response(res)
        if EXPECT_STRICT_AUTH:
            passed = res.status_code in [401, 403] or data.get("status") in ["fail", "error"]
            detail = f"正式權限模式，應拒絕。狀態碼: {res.status_code}, 回應: {data}"
        else:
            passed = True
            detail = f"Demo 權限模式不強制拒絕；若要驗證越權防護，請加 --expect-strict-auth 並讓後端 REQUIRE_ACCESS_TOKEN=true。狀態碼: {res.status_code}"
        result.add("越權讀取家庭 A 警報", passed, detail)
    except Exception as e:
        result.add("越權讀取家庭 A 警報", False, str(e))

    # 越權清除：家庭 B token 嘗試清除家庭 A
    try:
        res = family_b_session.post(f"{BASE_URL}/api/clear_alerts", json={"familyID": code1}, timeout=TIMEOUT_SEC)
        data = safe_json_response(res)
        if EXPECT_STRICT_AUTH:
            passed = res.status_code in [401, 403] or data.get("status") in ["fail", "error"]
            detail = f"正式權限模式，應拒絕。狀態碼: {res.status_code}, 回應: {data}"
        else:
            passed = True
            detail = f"Demo 權限模式不強制拒絕；若要驗證越權防護，請加 --expect-strict-auth 並讓後端 REQUIRE_ACCESS_TOKEN=true。狀態碼: {res.status_code}"
        result.add("越權清除家庭 A 警報", passed, detail)
    except Exception as e:
        result.add("越權清除家庭 A 警報", False, str(e))

    # 不存在 familyID 不應被當成成功資料
    try:
        res = session.post(f"{BASE_URL}/api/get_alerts", json={"familyID": "NOEXIST"}, timeout=TIMEOUT_SEC)
        data = safe_json_response(res)
        passed = res.status_code in [400, 401, 403, 404] or data.get("status") in ["fail", "error"]
        result.add("不存在的家庭ID獲取警報", passed, f"狀態碼: {res.status_code}, 回應: {data}")
    except Exception as e:
        result.add("不存在的家庭ID獲取警報", False, str(e))

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
                res = session.post(f"{BASE_URL}{case['endpoint']}", json=case["payload"], timeout=TIMEOUT_SEC)
                passed = res.status_code == 200
            elif case.get("headers"):
                res = session.post(f"{BASE_URL}/scan", headers=case["headers"], data=case["data"], timeout=TIMEOUT_SEC)
                passed = res.status_code == 400 or res.status_code == 415
            else:
                res = session.post(f"{BASE_URL}/scan", json=case["payload"], timeout=TIMEOUT_SEC)
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
                res = session.post(f"{BASE_URL}/scan", json=case["payload"], timeout=TIMEOUT_SEC)
                passed = res.status_code == case.get("expect_status", 200)
                result.add(case["name"], passed, f"狀態碼: {res.status_code}")
            elif case.get("check_status"):
                # 這類攻擊應至少不被伺服器崩潰，通常返回 200 或 400
                res = session.post(f"{BASE_URL}/scan", json={"url": "http://test.com", "text": case["text"]}, timeout=TIMEOUT_SEC)
                passed = res.status_code in [200, 400, 422]
                result.add(case["name"], passed, f"狀態碼: {res.status_code}")
            else:
                res = session.post(f"{BASE_URL}/scan", json={"url": "http://scam.com", "text": case["text"]}, timeout=TIMEOUT_SEC)
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
    args = configure_from_cli()

    print("="*70)
    print("🚀 啟動「競賽封版」全功能壓力測試套件 (短效 Token / 嚴格越權測試版)")
    print("="*70)
    print(f"📍 測試目標：{BASE_URL}")
    print(f"⏱️  請求時限：{TIMEOUT_SEC}秒")
    print(f"🔐 Legacy Secret：{'已啟用' if API_SECRET else '未啟用'}")
    print(f"🧪 嚴格權限期待：{EXPECT_STRICT_AUTH}")

    if args.skip_auth:
        print("🎫 短效 Token：已跳過")
    else:
        token, auth_data = authenticate_install()
        print(f"🎫 短效 Token：{'已取得' if token else '未取得，改用相容模式'}")
        print(f"👤 auth userID：{auth_data.get('userID', TEST_USER_ID) if isinstance(auth_data, dict) else TEST_USER_ID}")
        print(f"👨‍👩‍👧 auth familyID：{auth_data.get('familyID', TEST_FAMILY_ID) if isinstance(auth_data, dict) else TEST_FAMILY_ID}")

    print("="*70)

    start_time = time.time()

    # 執行所有測試模組
    test_pii_masking()
    test_domain_spoofing()
    test_social_engineering()
    test_evasion_techniques()
    test_system_stability()
    test_2026_trends()
    test_advanced_domain_attacks()
    test_image_scam()
    test_financial_scam()
    test_new_social_engineering()
    test_security_boundary()
    test_error_handling()
    test_missing_scenarios()

    end_time = time.time()

    total_rate = result.summary()
    print(f"\n⏱️  總執行時間：{end_time - start_time:.2f}秒")
    print("="*70)

    if total_rate >= 95:
        print("🎉 測試結果：優秀！系統已達生產等級！")
        sys.exit(0)
    elif total_rate >= 80:
        print("⚠️  測試結果：良好，但有改進空間")
        sys.exit(1)
    else:
        print("❌ 測試結果：需要重大改進")
        sys.exit(2)
