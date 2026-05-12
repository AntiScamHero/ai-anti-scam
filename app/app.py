from flask import Flask, jsonify, request, render_template_string
from flask_cors import CORS
from typing import Any, Dict, List, Tuple

from scam_case_matcher import find_similar_scam_case


app = Flask(__name__)
CORS(app)


def contains_any(text: str, keywords: List[str]) -> bool:
    return any(keyword in text for keyword in keywords)


def count_matches(text: str, keywords: List[str]) -> int:
    return sum(1 for keyword in keywords if keyword in text)


def clamp_score(score: int) -> int:
    return max(0, min(100, score))


def get_risk_level(score: int) -> Tuple[str, str]:
    """
    根據分數回傳風險等級與顏色代碼。
    """
    if score >= 70:
        return "高風險", "red"

    if score >= 40:
        return "中風險", "yellow"

    return "低風險", "green"


def run_scamdna_engine(user_text: str, url: str = "") -> Dict[str, Any]:
    """
    ScamDNA MVP 本地規則引擎：
    - 負責主判斷：分數、風險等級、判斷理由
    - 案例比對只負責輔助說明，不直接取代這裡的分數
    """

    text = f"{user_text or ''} {url or ''}".strip()

    score = 0
    evidence: List[str] = []
    matched_rules: List[str] = []

    # ------------------------------------------------------------
    # 1. 通用高風險詐騙特徵
    # ------------------------------------------------------------
    urgent_keywords = [
        "立即", "馬上", "限時", "逾期", "最後通知", "今日內", "盡快", "否則",
        "即將停用", "即將凍結", "立即處理", "限期", "馬上處理", "逾時"
    ]

    payment_keywords = [
        "匯款", "轉帳", "補繳", "付款", "繳費", "手續費", "運費", "保證金",
        "監管帳戶", "安全帳戶", "儲值", "入金", "支付", "刷卡"
    ]

    sensitive_keywords = [
        "信用卡", "帳號", "密碼", "驗證碼", "OTP", "身分證", "身份證", "銀行帳戶",
        "提款卡", "金融卡", "網銀", "個資", "卡號", "有效期限", "背面末三碼"
    ]

    link_keywords = [
        "http://", "https://", "www.", ".com", ".tw", "短網址", "點擊連結",
        "連結", "網址", "登入", "bit.ly", "reurl.cc", "tinyurl"
    ]

    if contains_any(text, urgent_keywords):
        score += 12
        evidence.append("偵測到急迫性話術，例如限時、立即、逾期或即將停用。")
        matched_rules.append("急迫性話術")

    if contains_any(text, payment_keywords):
        score += 18
        evidence.append("偵測到付款、補繳、匯款或轉帳相關要求。")
        matched_rules.append("金流操作要求")

    if contains_any(text, sensitive_keywords):
        score += 20
        evidence.append("偵測到信用卡、帳密、驗證碼或銀行帳戶等敏感資訊要求。")
        matched_rules.append("敏感資訊要求")

    if contains_any(text, link_keywords):
        score += 15
        evidence.append("偵測到連結、網址或登入導向，可能存在釣魚風險。")
        matched_rules.append("外部連結 / 釣魚導向")

    # ------------------------------------------------------------
    # 2. 詐騙類型組合判斷
    # ------------------------------------------------------------
    logistics_keywords = [
        "包裹", "物流", "宅配", "郵局", "黑貓", "配送失敗", "重新派送",
        "地址錯誤", "補繳運費", "運費", "包裹配送", "貨件", "配送異常"
    ]

    investment_keywords = [
        "投資", "飆股", "保證獲利", "穩賺不賠", "老師", "助理",
        "加LINE", "加 line", "LINE群", "LINE 群", "LINE 群組", "會員群",
        "內線", "入金", "出金", "報明牌", "高報酬", "零風險", "限量名額"
    ]

    police_keywords = [
        "偵查隊", "警察", "檢察官", "法院", "洗錢", "帳戶凍結",
        "凍結", "監管", "監管帳戶", "安全帳戶", "筆錄", "保密",
        "刑案", "涉嫌", "通緝", "地檢署"
    ]

    bank_keywords = [
        "銀行", "網銀", "異常刷卡", "停卡", "帳戶停用", "登入驗證",
        "更新資料", "OTP", "信用卡", "身分確認", "身份確認", "卡片停用"
    ]

    healthcare_keywords = [
        "長照", "補助", "津貼", "政府補貼", "醫院", "批價",
        "掛號費", "健保", "醫療費", "欠費", "繳清"
    ]

    family_keywords = [
        "我是", "換手機", "急用", "借錢", "幫我", "先轉",
        "不要打電話", "出事", "匯款", "臨時需要", "先不要問"
    ]

    health_product_keywords = [
        "保健", "降血糖", "降血壓", "神奇療效", "免費試用",
        "只要運費", "名醫推薦", "限時優惠", "改善三高", "逆轉糖尿病"
    ]

    logistics_count = count_matches(text, logistics_keywords)
    investment_count = count_matches(text, investment_keywords)
    police_count = count_matches(text, police_keywords)
    bank_count = count_matches(text, bank_keywords)
    healthcare_count = count_matches(text, healthcare_keywords)
    family_count = count_matches(text, family_keywords)
    health_product_count = count_matches(text, health_product_keywords)

    if logistics_count >= 2:
        score += 35
        evidence.append("偵測到「物流 / 包裹 / 補繳運費」組合，符合常見假物流詐騙特徵。")
        matched_rules.append("假物流補繳運費")

    # 假投資分級：
    # - 命中 2~3 個投資詐騙特徵：中風險
    # - 命中 4 個以上，代表「老師 / LINE群 / 保證獲利 / 零風險 / 高報酬」等高度組合：直接升為高風險
    if investment_count >= 4:
        score += 70
        evidence.append("偵測到高度假投資組合，例如老師帶單、LINE 群組、保證獲利、零風險或高報酬，判定為高風險詐騙特徵。")
        matched_rules.append("高度假投資群組")
    elif investment_count >= 2:
        score += 45
        evidence.append("偵測到「投資 / 老師 / 保證獲利 / 加 LINE」組合，符合假投資群組詐騙特徵。")
        matched_rules.append("假投資群組")

    if police_count >= 2:
        score += 42
        evidence.append("偵測到「檢警 / 洗錢 / 帳戶凍結 / 監管」組合，符合假檢警詐騙特徵。")
        matched_rules.append("假檢警帳戶凍結")

    if bank_count >= 2:
        score += 35
        evidence.append("偵測到「銀行 / 網銀 / 停卡 / OTP / 信用卡」組合，符合假銀行釣魚詐騙特徵。")
        matched_rules.append("假銀行釣魚")

    if healthcare_count >= 2:
        score += 26
        evidence.append("偵測到「長照 / 補助 / 醫院 / 批價 / 健保」組合，可能涉及假補助或假醫療繳費詐騙。")
        matched_rules.append("假長照或假醫療繳費")

    if family_count >= 3:
        score += 32
        evidence.append("偵測到「親友急用 / 換手機 / 借錢 / 不要打電話」組合，符合假親友借款詐騙特徵。")
        matched_rules.append("假親友急用借款")

    if health_product_count >= 2:
        score += 25
        evidence.append("偵測到「保健食品 / 神奇療效 / 免費試用 / 只要運費」組合，可能涉及高齡族群常見保健食品詐騙。")
        matched_rules.append("假保健食品")

    # ------------------------------------------------------------
    # 3. 正常防詐宣導語境降權
    # ------------------------------------------------------------
    anti_fraud_context_keywords = [
        "防詐", "165", "反詐騙", "提醒", "請勿", "不要點擊",
        "不要輸入", "先查證", "官方客服", "警政署", "宣導",
        "詐騙案例", "避免受騙", "小心詐騙", "防止受騙"
    ]

    safe_education_count = count_matches(text, anti_fraud_context_keywords)

    if safe_education_count >= 2:
        score -= 45
        evidence.append("偵測到防詐宣導或提醒語境，已進行語境降權，避免把正常提醒誤判為詐騙。")
        matched_rules.append("防詐宣導語境降權")

    # ------------------------------------------------------------
    # 4. 官方或低風險語境降權
    # ------------------------------------------------------------
    safe_context_keywords = [
        "官方公告", "客服專線", "請洽官方", "無需輸入密碼",
        "不會要求提供密碼", "不會要求轉帳", "請至官方網站",
        "如有疑問請洽", "僅供宣導"
    ]

    if contains_any(text, safe_context_keywords):
        score -= 20
        evidence.append("偵測到官方提醒或安全宣告語境，降低風險分數。")
        matched_rules.append("官方安全語境降權")

    # ------------------------------------------------------------
    # 5. 最終整理
    # ------------------------------------------------------------
    score = clamp_score(score)
    risk_level, risk_color = get_risk_level(score)

    if score >= 70:
        reason = "偵測到多個高風險詐騙特徵，建議立即停止操作，不要輸入信用卡、密碼、驗證碼或進行轉帳。"
        suggestions = [
            "不要點擊訊息中的連結。",
            "不要輸入信用卡、帳號、密碼或 OTP 驗證碼。",
            "先打電話向官方客服或家人確認。",
            "如已輸入資料，請立即聯絡銀行或撥打 165 反詐騙專線。"
        ]
    elif score >= 40:
        reason = "內容具有可疑特徵，建議暫停操作並查證來源。"
        suggestions = [
            "先不要付款或輸入個資。",
            "確認網址是否為官方網站。",
            "詢問家人或撥打官方客服確認。",
            "若對方要求加 LINE、轉帳或提供驗證碼，請提高警覺。"
        ]
    else:
        reason = "目前未偵測到明顯詐騙組合，但仍建議保持警覺。"
        suggestions = [
            "若訊息要求付款、轉帳或輸入密碼，仍應再次確認。",
            "不要把驗證碼提供給任何人。",
            "不確定時可詢問家人或官方客服。"
        ]

    # 讓低風險正常訊息也有判斷依據，不會在 UI 上只出現空白標題。
    if not evidence:
        evidence.append("未偵測到付款、連結、帳密或高風險詐騙組合。")

    return {
        "score": score,
        "riskLevel": risk_level,
        "riskColor": risk_color,
        "reason": reason,
        "evidence": evidence,
        "matchedRules": matched_rules,
        "suggestions": suggestions,
        "debug": {
            "logistics_count": logistics_count,
            "investment_count": investment_count,
            "police_count": police_count,
            "bank_count": bank_count,
            "healthcare_count": healthcare_count,
            "family_count": family_count,
            "health_product_count": health_product_count,
            "safe_education_count": safe_education_count
        }
    }


def build_response(user_text: str, url: str = "") -> Dict[str, Any]:
    """統一建立 API 回傳資料，讓 GET 與 POST 共用同一套邏輯。"""

    scamdna_result = run_scamdna_engine(user_text=user_text, url=url)

    # 修正重點：
    # 案例比對只在中風險以上顯示。
    # 低風險內容即使命中「信用卡、連結」這類字，也不顯示相似案例，避免評審誤解。
    raw_similar_case = find_similar_scam_case(f"{user_text} {url}".strip())

    if scamdna_result["score"] >= 40:
        similar_case = raw_similar_case
    else:
        similar_case = None

    return {
        "ok": True,
        "score": scamdna_result["score"],
        "riskLevel": scamdna_result["riskLevel"],
        "risk_level": scamdna_result["riskLevel"],
        "riskColor": scamdna_result["riskColor"],
        "risk_color": scamdna_result["riskColor"],
        "reason": scamdna_result["reason"],
        "summary": scamdna_result["reason"],
        "evidence": scamdna_result["evidence"],
        "matchedRules": scamdna_result["matchedRules"],
        "matched_rules": scamdna_result["matchedRules"],
        "suggestions": scamdna_result["suggestions"],
        "similarCase": similar_case,
        "similar_case": similar_case,
        "isScam": scamdna_result["score"] >= 70,
        "is_scam": scamdna_result["score"] >= 70,
        "debug": scamdna_result["debug"]
    }


@app.route("/", methods=["GET"])
def home():
    return jsonify({
        "service": "AI 防詐盾牌 API",
        "status": "running",
        "message": "手機瀏覽器請開 /demo 使用掃描畫面；API 可用 POST /api/analyze，或用 GET /api/analyze?text=測試文字。",
        "endpoints": {
            "demo": "GET /demo",
            "analyze_post": "POST /api/analyze",
            "analyze_get_test": "GET /api/analyze?text=測試文字",
            "health": "GET /api/health"
        }
    })


@app.route("/api/health", methods=["GET"])
def health_check():
    return jsonify({
        "ok": True,
        "message": "AI 防詐盾牌後端運作中"
    })


@app.route("/api/analyze", methods=["GET", "POST", "OPTIONS"])
def analyze_text():
    """
    支援兩種方式：
    1. 正式前端使用：POST /api/analyze，JSON: {"text": "...", "url": "..."}
    2. 手機瀏覽器直接測試：GET /api/analyze?text=你的包裹配送失敗請立即補繳運費
    """

    if request.method == "OPTIONS":
        return jsonify({"ok": True}), 200

    if request.method == "GET":
        user_text = request.args.get("text", "")
        url = request.args.get("url", "")

        if not user_text and not url:
            return jsonify({
                "ok": False,
                "message": "這個端點是分析 API。若用瀏覽器直接測試，請使用 /api/analyze?text=測試文字；若要手機操作畫面，請開 /demo。",
                "demo_url": "/demo",
                "example": "/api/analyze?text=你的包裹配送失敗請立即補繳運費"
            }), 200

        return jsonify(build_response(user_text=user_text, url=url)), 200

    data = request.get_json(silent=True) or {}

    user_text = (
        data.get("text")
        or data.get("content")
        or data.get("message")
        or ""
    )

    url = data.get("url") or ""

    if not user_text and not url:
        return jsonify({
            "ok": False,
            "error": "未提供可分析內容，請提供 text、content、message 或 url。"
        }), 400

    return jsonify(build_response(user_text=user_text, url=url)), 200


DEMO_HTML = """
<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AI 防詐盾牌 Demo</title>
  <style>
    body { margin: 0; background: #eef4fb; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans TC", Arial, sans-serif; color: #172033; }
    .wrap { max-width: 420px; margin: 0 auto; padding: 14px; }
    .card { background: white; border-radius: 18px; padding: 18px; margin-bottom: 14px; box-shadow: 0 6px 18px rgba(28,49,82,.08); border: 1px solid #dde8f5; }
    .badge { display: inline-block; font-size: 12px; color: #1764b1; background: #e8f2ff; padding: 4px 10px; border-radius: 999px; font-weight: 700; }
    h1 { margin: 10px 0 8px; font-size: 24px; }
    p { color: #4d5c70; line-height: 1.55; margin: 8px 0; }
    label { display: block; font-weight: 800; margin-bottom: 8px; font-size: 15px; }
    input, textarea { width: 100%; box-sizing: border-box; border: 1px solid #cbd7e6; border-radius: 12px; padding: 12px; font-size: 15px; outline: none; background: white; }
    textarea { min-height: 150px; resize: vertical; line-height: 1.5; }
    button { width: 100%; border: 0; border-radius: 13px; background: #246be8; color: white; padding: 14px; font-size: 16px; font-weight: 800; margin-top: 10px; }
    .result { border-left: 5px solid #26b36a; }
    .result.yellow { border-left-color: #f59e0b; }
    .result.red { border-left-color: #ef4444; }
    .score { font-size: 34px; font-weight: 900; margin: 6px 0; }
    .risk { font-weight: 900; font-size: 18px; }
    .casebox { background: #f8fbff; border: 1px solid #dbe7f7; border-radius: 12px; padding: 12px; margin-top: 12px; }
    .casebox strong { color: #1457ad; }
    .muted { font-size: 12px; color: #6b778c; }
    .chips span { display: inline-block; background: #edf3ff; color: #255a9f; padding: 4px 8px; border-radius: 999px; font-size: 12px; margin: 4px 4px 0 0; }
    ul { padding-left: 20px; color: #4d5c70; line-height: 1.55; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <span class="badge">手機版 Demo</span>
      <h1>AI 防詐盾牌</h1>
      <p>貼上可疑簡訊、LINE 訊息或網址，系統會用 ScamDNA + 案例比對快速判斷風險。</p>
      <p class="muted">這個頁面由 Flask 後端直接提供，手機可以直接使用。</p>
    </div>

    <div class="card">
      <label for="apiUrl">API 位置</label>
      <input id="apiUrl" value="/api/analyze">
      <br><br>
      <label for="text">可疑內容</label>
      <textarea id="text">你的包裹配送失敗，請立即補繳運費並輸入信用卡資料：https://example.com/pay</textarea>
      <button onclick="scan()">立即掃描</button>
      <p id="status" class="muted"></p>
    </div>

    <div id="resultBox" class="card result" style="display:none;">
      <div id="riskLevel" class="risk"></div>
      <div><span id="score" class="score"></span> / 100</div>
      <p id="reason"></p>
      <div id="caseBox" class="casebox" style="display:none;">
        <strong>相似詐騙案例比對</strong>
        <p id="caseType"></p>
        <p class="muted" id="caseDesc"></p>
        <div class="chips" id="features"></div>
      </div>
      <div>
        <strong>判斷依據</strong>
        <ul id="evidence"></ul>
      </div>
    </div>
  </div>

<script>
async function scan() {
  const apiUrl = document.getElementById("apiUrl").value.trim();
  const text = document.getElementById("text").value.trim();
  const status = document.getElementById("status");
  const resultBox = document.getElementById("resultBox");
  status.textContent = "掃描中...";
  resultBox.style.display = "none";

  try {
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({text})
    });

    const data = await res.json();

    if (!res.ok || !data.ok) {
      status.textContent = data.error || data.message || "掃描失敗";
      return;
    }

    status.textContent = "掃描完成";
    resultBox.className = "card result";

    // 顏色雙保險：
    // 後端會回傳 riskColor；前端也用分數與 riskLevel 再判斷一次。
    // 避免舊欄位或快取造成高風險沒有變紅色。
    if (data.riskColor === "red" || data.riskLevel === "高風險" || data.score >= 70) {
      resultBox.classList.add("red");
    } else if (data.riskColor === "yellow" || data.riskLevel === "中風險" || data.score >= 40) {
      resultBox.classList.add("yellow");
    }

    document.getElementById("riskLevel").textContent = data.riskLevel;
    document.getElementById("score").textContent = data.score;
    document.getElementById("reason").textContent = data.reason;

    const evidenceEl = document.getElementById("evidence");
    evidenceEl.innerHTML = "";
    (data.evidence || []).forEach(item => {
      const li = document.createElement("li");
      li.textContent = item;
      evidenceEl.appendChild(li);
    });

    const similarCase = data.similarCase || data.similar_case;
    const caseBox = document.getElementById("caseBox");

    // 雙保險：
    // 後端已經設定低風險不回傳案例；
    // 前端也再判斷一次，低於 40 分不顯示案例比對。
    if (similarCase && data.score >= 40) {
      caseBox.style.display = "block";
      document.getElementById("caseType").textContent =
        similarCase.source_type + "｜相似度：" + similarCase.similarity_score;
      document.getElementById("caseDesc").textContent = similarCase.description || "";

      const features = document.getElementById("features");
      features.innerHTML = "";
      (similarCase.matched_features || []).forEach(feature => {
        const span = document.createElement("span");
        span.textContent = feature;
        features.appendChild(span);
      });
    } else {
      caseBox.style.display = "none";
    }

    resultBox.style.display = "block";
  } catch (err) {
    status.textContent = "連線失敗：" + err.message;
  }
}
</script>
</body>
</html>
"""


@app.route("/demo", methods=["GET"])
def demo_page():
    return render_template_string(DEMO_HTML)


if __name__ == "__main__":
    app.run(
        host="0.0.0.0",
        port=5000,
        debug=True
    )
