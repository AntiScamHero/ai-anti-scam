# verify_runtime_rules.py
# 用來確認目前 Flask 後端是否真的載入最新版規則。
# 使用方式：
# 1. 先開第一個終端機：python app.py
# 2. 第二個終端機執行：python verify_runtime_rules.py
# 成功時，reason 會看到：2026-05-15-batch-fast-v1

import requests

API_URL = "http://127.0.0.1:5000/scan"

tests = [
    ("safe", "https://www.ctbcbank.com/", "中國信託官網應放行"),
    ("safe", "https://www.esunbank.com/", "玉山銀行官網應放行"),
    ("safe", "https://phishingquiz.withgoogle.com/", "Google 釣魚測驗應放行"),
    ("danger", "hxxp://uphold-up[.]square[.]site/", "UpHold 釣魚網址應攔截"),
    ("danger", "hxxp://aicc108-demo[.]pages[.]dev/title/80025923[.]html", "Cloudflare Pages 釣魚頁應攔截"),
    ("danger", "hxxp://www[.]service-blueticks-fb-479843[.]vercel[.]app/", "Vercel FB 驗證釣魚頁應攔截"),
    ("danger", "hxxps://authentication[.]ms/E[.]3qMY8BhGFzfw?/VGhlIG5leHQgZ2VuZXJhdGlvbiBvZiBzZWN1cml0eSBhd2FyZW5lc3MgaXMgZGVzaWduZWQgZm9yIGVtcGxveWVlcyBhbmQgYnVpbHQgZm9yIGVudGVycHJpc2VzLiBPdXIgaW5kdXN0cnktbGVhZGluZyByZXN1bHRzIGFyZSBwb3dlcmVkIGJ5IGNvZ25pdGl2ZSBhdXRvbWF0aW9uLg", "authentication.ms 高風險網址應攔截"),
]

def normalize(data):
    score = data.get("riskScore", data.get("risk_score", data.get("score", 0)))
    try:
        score = int(float(score))
    except Exception:
        score = 0

    level = str(data.get("riskLevel", data.get("risk_level", ""))).lower()
    result_text = f"{level} {data.get('reason','')}".lower()

    if score >= 70 or "高風險" in result_text or "危險" in result_text:
        return "danger", score
    return "safe", score

ok = 0

for expected, url, note in tests:
    payload = {
        "url": url,
        "title": note,
        "text": f"真實網站驗證測試：{note}",
        "source": "real_world_url_batch_test",
    }
    try:
        r = requests.post(API_URL, json=payload, timeout=10)
        r.raise_for_status()
        data = r.json()
        actual, score = normalize(data)
        reason = str(data.get("reason", ""))
        passed = actual == expected and "2026-05-15-batch-fast-v1" in reason
        ok += 1 if passed else 0
        print(f"{'✅' if passed else '❌'} 預期={expected:<6} 實際={actual:<6} 分數={score:<3}｜{note}")
        print(f"   reason: {reason[:180]}")
    except Exception as e:
        print(f"❌ ERROR｜{note}｜{e}")

print(f"\n通過 {ok}/{len(tests)}")
if ok != len(tests):
    print("如果 reason 沒有看到 2026-05-15-batch-fast-v1，代表 Flask 還在跑舊程式，請按 CTRL+C 關掉 app.py 後重新啟動。")
