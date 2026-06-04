import argparse
import json
import sys
import requests

DEFAULT_BASE_URL = "http://127.0.0.1:5000"

TEST_CASES = [
    {"name": "低風險：正常防詐提醒", "text": "警政署提醒，請勿點擊不明連結，也不要提供信用卡或驗證碼，如有疑問請撥打 165。", "max_score": 39},
    {"name": "低風險：正常家人訊息", "text": "媽，明天我會比較晚回家，晚餐不用等我，我到家再跟你說。", "max_score": 39},
    {"name": "中高風險：假投資群組", "text": "加入老師 LINE 群組，AI 化交易保證獲利，零風險高報酬，限量名額。", "min_score": 70},
    {"name": "高風險：假物流補繳運費", "text": "你的包裹配送失敗，請立即補繳運費並輸入信用卡資料：https://example.com/pay", "min_score": 70},
    {"name": "高風險：假檢警帳戶凍結", "text": "這裡是偵查隊，你的帳戶涉嫌洗錢即將凍結，請配合檢察官監管帳戶並保密。", "min_score": 80},
]


def call_scan(base_url, text, token=""):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    response = requests.post(
        f"{base_url.rstrip('/')}/scan",
        json={"text": text, "url": "http://mobile-demo.test", "scan_source": "iphone_quick_test"},
        headers=headers,
        timeout=15,
    )
    response.raise_for_status()
    return response.json()


def print_result(case, result):
    score = result.get("riskScore") or result.get("score") or 0
    level = result.get("riskLevel") or result.get("risk_level") or "--"
    print("=" * 80)
    print(case["name"])
    print(f"分數：{score}｜等級：{level}")
    print(f"理由：{result.get('reason') or result.get('summary') or '--'}")
    print(f"建議：{result.get('advice') or '--'}")
    explain = result.get("explain") or []
    if explain:
        print("AI 為什麼判斷：")
        for item in explain[:3]:
            print(f"- {item}")


def main():
    parser = argparse.ArgumentParser(description="AI 防詐盾牌 - 手機 / iPhone 快速驗收測試")
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument("--token", default="", help="可選 Bearer token")
    args = parser.parse_args()

    passed = 0
    for case in TEST_CASES:
        try:
            result = call_scan(args.base_url, case["text"], args.token)
            print_result(case, result)
            score = int(result.get("riskScore") or result.get("score") or 0)
            ok = True
            if "min_score" in case:
                ok = score >= case["min_score"]
            if "max_score" in case:
                ok = score <= case["max_score"]
            print("結果：" + ("✅ 通過" if ok else "❌ 未達預期"))
            passed += 1 if ok else 0
        except requests.exceptions.ConnectionError:
            print("連線失敗：請確認後端 Flask 已啟動，手機與電腦在同一 Wi-Fi，並使用電腦區網 IP。")
            return 2
        except Exception as error:
            print(f"測試失敗：{error}")
            return 2

    print("=" * 80)
    print(f"手機快測通過：{passed}/{len(TEST_CASES)}")
    return 0 if passed == len(TEST_CASES) else 1


if __name__ == "__main__":
    sys.exit(main())
