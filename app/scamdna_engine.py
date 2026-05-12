# scamdna_engine.py
# AI 防詐盾牌｜ScamDNA 多層防詐判斷引擎
# 目的：
# 1. 補強高齡詐騙資料集中的漏判類型。
# 2. 加入語境降權，避免正常防詐宣導與官方公告被誤判。
# 3. 同時支援 /api/analyze 測試端點與 /scan 主流程使用。

import re
import unicodedata
from urllib.parse import urlparse, unquote

try:
    from rag_engine import find_similar_cases
except Exception:
    find_similar_cases = None

OFFICIAL_TRUSTED_DOMAINS = [
    "gov.tw",
    "fsc.gov.tw",
    "moneywise.fsc.gov.tw",
    "165.npa.gov.tw",
    "npa.gov.tw",
    "mohw.gov.tw",
    "nhia.gov.tw",
    "hpa.gov.tw",
    "cdc.gov.tw",
    "gov.taipei",
    "edu.tw",
]

SCAM_RULES = {
    "假長照補助金": [
        "長照2.0專案加碼", "長照補助核發", "長照補助", "長照補貼", "居家照護津貼",
        "津貼尚未領取", "老人津貼發放", "敬老卡津貼異常", "津貼發生異常", "解鎖以利後續撥款", "免費輪椅", "每月8000元補助",
        "帳戶領取", "銀行帳戶資料", "綁定銀行帳戶", "身分證與存摺拍照", "服務時數可折現",
        "快速入帳", "逾期視同放棄", "提領", "提撥", "撥款", "折現",
    ],
    "假醫院批價異常": [
        "批價", "重複扣款", "醫藥費", "結帳異常", "住院保證金", "尚未退還",
        "提款卡密碼", "健保卡使用違規", "即將鎖卡", "繳納罰金", "醫院帳務科", "ATM操作",
        "退還至您的帳戶", "健保核銷失敗", "補繳差額", "自費項目尚未結清",
        "醫療分期付款設定錯誤", "銀行專員解除分期", "取消設定", "掛號費", "多扣",
    ],
    "假親友借醫療費": [
        "出車禍", "急診室", "手術費", "門號換了", "住院費", "騎車撞到人", "不要跟爸媽說",
        "急性盲腸炎", "馬上開刀", "急需買自費特效藥", "護工的錢", "臨時帳戶",
        "朋友重病", "借錢動手術", "明天馬上還", "心臟病發", "保證金才能動刀",
        "朋友的帳號", "快匯款", "先幫我轉", "急需", "墊住院費", "賠償醫藥費",
    ],
    "假物流 / 包裹補繳運費": [
        "配送失敗", "無法投遞", "補繳運費", "欠缺運費", "海關稅費", "支付關稅",
        "二次運費", "物流處理費", "補收物流處理費", "完成刷卡", "包裹扣留",
        "實名認證", "填寫身分證", "收件人資訊有誤", "暫停發貨", "國外的健康檢測儀器",
        "客服LINE", "藥品包裹", "遭到扣留", "認證費", "銷毀", "集運倉", "更新資訊",
    ],
    "假網購特效保健食品": [
        "根治", "完全根治", "三日治癒", "不用開刀", "神藥", "神明眼藥水", "奇蹟",
        "諾貝爾", "FDA認證", "FDA 認證", "祖傳秘方", "祖傳百年", "活化腦細胞",
        "恢復記憶", "各大醫院不敢公開", "血管清道夫", "血管馬上通暢", "預防中風",
        "終結洗腎", "遠紅外線深層治療", "太空人都在用", "徹底根治", "限時搶購",
        "買一送三", "一折優惠", "無效退費", "今天下單", "數量有限", "售完為止",
        "馬上能跑步", "告別失眠", "貼在腳底三秒入睡", "黑科技護腰",
    ],
    "假投資 / 保證獲利": [
        "保證獲利", "穩賺不賠", "零風險", "保本保息", "月入十萬", "勝率高達", "98%",
        "財富密碼", "AI智能量化交易", "全自動幫你賺", "導師LINE群組", "飆股",
        "前華爾街操盤手", "內線消息", "一週獲利300%", "資金絕不卡關", "隨時可提現",
        "虛擬貨幣養老專案", "專業團隊代操", "每日結算收益", "註冊即贈", "養老金",
    ],
    "假銀行 / 釣魚登入": [
        "網銀系統升級", "重新綁定", "重新綁定裝置", "異常登入", "登入異常", "線上解鎖",
        "實名制核對", "凍結資產", "退款表單", "信用卡海外消費", "異常海外消費",
        "帳戶密碼錯誤次數過多", "帳戶近期登入異常", "防止洗錢", "逾期將暫停使用權限",
        "若非本人操作", "資金安全", "用戶中心", "密碼錯誤次數",
    ],
    "假檢警 / 帳戶凍結": [
        "地方法院", "線上公告", "涉嫌", "重大洗錢", "洗錢防制法", "依法拘提", "冒用開戶",
        "不法集團冒用", "國家安全帳戶", "配合調查", "行政執行署", "強制扣押", "解除凍結",
        "扣押名下財產", "監管帳戶", "偵查不公開", "收取保證金", "名下的銀行帳戶",
    ],
}

# 明確要求使用者執行的危險動作。避免把「請勿匯款」這種宣導誤判成詐騙。
DANGEROUS_ACTION_PATTERNS = [
    r"請.{0,6}點擊", r"立即.{0,6}點擊", r"點擊.{0,10}(登錄|登入|確認|更新|支付|繳納|綁定|解鎖)",
    r"至.{0,8}網址.{0,10}(確認|填寫|支付|繳納|綁定|解鎖)",
    r"輸入.{0,8}(信用卡|密碼|驗證碼|OTP|身分證)", r"填寫.{0,8}(身分證|帳戶|銀行|信用卡)",
    r"提供.{0,8}(提款卡密碼|密碼|驗證碼|帳戶|身分證)", r"將.{0,8}(身分證|存摺).{0,8}拍照",
    r"(匯款|滙款|轉帳|轉賬).{0,12}(指定帳號|帳戶|這個帳戶|朋友的帳號|國家安全帳戶)",
    r"快.{0,4}(匯款|轉帳)", r"先幫我.{0,4}(轉|匯)", r"加\s*line", r"客服\s*line",
    r"聯絡書記官", r"國家安全帳戶", r"ATM.{0,4}操作", r"操作.{0,4}ATM", r"重新綁定", r"聯絡.{0,12}解鎖",
]

URGENCY_WORDS = [
    "立即", "今日內", "今晚12點前", "24小時內", "逾期", "否則", "即將", "急", "快", "馬上",
    "立刻", "限時", "倒數", "售完為止", "暫停使用", "凍結", "銷毀",
]

SAFE_CONTEXT_PATTERNS = [
    r"防詐騙宣導", r"防詐騙提醒", r"防範詐騙", r"反詐騙公告", r"反詐騙專線",
    r"切勿", r"請勿", r"不會要求", r"絕不會", r"不會主動", r"若接獲可疑",
    r"請立即掛斷", r"警政署.{0,8}呼籲", r"共同呼籲", r"保護您的財產安全",
    r"專員不會私下", r"絕對是詐騙", r"請勿點擊", r"切勿點擊",
]

OFFICIAL_NORMAL_WORDS = [
    "公告", "服務滿意度調查", "電話訪問", "不會要求提供財務資訊", "成人預防保健服務",
    "請攜帶健保卡", "1966長照專線", "防疫指引", "失智友善社區", "申請敬老愛心乘車卡",
    "居家醫療照護整合計畫", "住宿式服務機構使用者補助方案", "消費者保護法", "七天猶豫期",
    "退換貨申請", "物流配送範圍", "結帳頁面自動計算", "超商取貨付款", "到貨簡訊通知",
    "退款流程將於", "原先付款的信用卡帳戶", "特約醫療院所", "社會局窗口",
]

FAMILY_NORMAL_WORDS = [
    "我已經匯款", "我已經線上繳費", "不用再跑一趟", "你不用轉給我", "不用擔心",
    "下次見面再把現金給我", "我明天會去便利商店幫你繳費", "我等等用網銀幫你繳費",
    "我會直接匯款給長照中心", "晚餐你想吃什麼", "記得要", "我買過去", "陪你",
]


def normalize_text(text: str) -> str:
    text = str(text or "")
    try:
        text = unquote(text)
    except Exception:
        pass
    text = unicodedata.normalize("NFKC", text)
    replacements = {
        "滙": "匯", "欵": "款", "賬": "帳", "帐": "帳", "户": "戶", "保建": "保健",
        "醫.院": "醫院", "帳.戶": "帳戶", "帳互": "帳戶", "補.助": "補助", "转": "轉",
        "证": "證", "码": "碼", "输": "輸", "写": "寫", "缴": "繳", "费": "費", "冻": "凍", "结": "結",
    }
    for old, new in replacements.items():
        text = text.replace(old, new)
    return text


def compact_text(text: str) -> str:
    text = normalize_text(text).lower()
    text = re.sub(r"[\s\u200B-\u200D\uFEFF\.·‧・,_，。:：;；!！?？\[\]【】（）()「」『』《》<>／/\\|\-]+", "", text)
    return text


def normalize_host(url: str) -> str:
    if not url:
        return ""
    raw = str(url).strip()
    if not re.match(r"^https?://", raw, re.I):
        raw = "https://" + raw.lstrip("/")
    try:
        host = urlparse(raw).hostname or ""
        return host.lower().replace("www.", "", 1)
    except Exception:
        return ""


def domain_matches(host: str, domain: str) -> bool:
    host = (host or "").lower().replace("www.", "", 1)
    domain = (domain or "").lower().replace("www.", "", 1)
    return bool(host and domain and (host == domain or host.endswith("." + domain)))


def is_trusted_official_domain(url: str) -> bool:
    host = normalize_host(url)
    return any(domain_matches(host, d) for d in OFFICIAL_TRUSTED_DOMAINS)


def find_keyword_hits(text: str, keywords):
    raw = normalize_text(text)
    comp = compact_text(raw)
    hits = []
    for kw in keywords:
        kw_raw = normalize_text(kw)
        kw_comp = compact_text(kw_raw)
        if not kw_comp:
            continue
        if kw_raw in raw or kw_comp in comp:
            if kw not in hits:
                hits.append(kw)
    return hits


def find_regex_hits(text: str, patterns):
    raw = normalize_text(text)
    hits = []
    match = re.search(pattern, raw, re.I)
if match:
    hits.append(match.group()) # 儲存網頁上實際出現的那段話
        except re.error:
            continue
    return hits


def compute_category_score(count: int) -> int:
    if count <= 0:
        return 0
    return min(58, 30 + (count - 1) * 12)


def simple_level(score: int) -> str:
    if score >= 70:
        return "高風險"
    if score >= 40:
        return "中風險"
    return "低風險"


def rich_level(score: int) -> str:
    """
    第四輪修正：
    統一風險分級，避免 40~49 分被標成「低風險」。
    - 70 分以上：高風險
    - 40~69 分：中風險
    - 39 分以下：低風險
    """
    if score >= 70:
        return "高風險"
    if score >= 40:
        return "中風險"
    return "低風險"


def analyze_with_scamdna(text: str = "", url: str = "", title: str = "") -> dict:
    combined = "\n".join([str(title or ""), str(url or ""), str(text or "")]).strip()
    if not combined:
        return {
            "engine": "ScamDNA", "score": 0, "risk_level": "低風險", "riskScore": 0, "riskLevel": "安全無虞",
            "scamDNA": ["未分類"], "reason": "未提供文本", "advice": "目前沒有可分析內容。",
            "signals": {}, "matchedKeywords": {},
        }

    score = 0
    reasons = []
    matched = {}
    scam_types = []

    trusted_domain = is_trusted_official_domain(url)
    safe_hits = find_regex_hits(combined, SAFE_CONTEXT_PATTERNS)
    official_hits = find_keyword_hits(combined, OFFICIAL_NORMAL_WORDS)
    family_hits = find_keyword_hits(combined, FAMILY_NORMAL_WORDS)
    dangerous_hits = find_regex_hits(combined, DANGEROUS_ACTION_PATTERNS)
    urgency_hits = find_keyword_hits(combined, URGENCY_WORDS)

    for category, keywords in SCAM_RULES.items():
        hits = find_keyword_hits(combined, keywords)
        if hits:
            matched[category] = hits[:8]
            scam_types.append(category)
            score += compute_category_score(len(hits))
            reasons.append(f"偵測到「{category}」特徵：{', '.join(hits[:4])}")

    if dangerous_hits:
        score += min(36, 18 + (len(dangerous_hits) - 1) * 6)
        reasons.append("偵測到要求使用者執行高風險動作")

    if urgency_hits:
        score += min(18, 8 + (len(urgency_hits) - 1) * 3)
        reasons.append(f"偵測到急迫催促語氣：{', '.join(urgency_hits[:4])}")

    # 高風險組合規則，用於補強單一關鍵字不足的場景
    comp = compact_text(combined)
    combo_rules = [
        ("補助 + 帳戶 / 身分資料", ["補助", "帳戶"], 22),
        ("補助 + 身分證 / 存摺", ["補助", "身分證"], 22),
        ("醫院退費 + ATM", ["退費", "ATM"], 24),
        ("親友急用錢 + 匯款", ["急", "匯款"], 22),
        ("包裹 + 運費 / 刷卡", ["包裹", "運費"], 24),
        ("包裹 + 身分證 / 認證", ["包裹", "身分證"], 22),
        ("投資 + 保證獲利", ["投資", "保證獲利"], 26),
        ("帳戶 + 凍結 / 洗錢", ["帳戶", "凍結"], 24),
        ("檢警 + 安全帳戶", ["安全帳戶"], 28),
        ("疾病 + 根治 / 奇蹟療效", ["根治"], 18),
    ]
    for name, words, add_score in combo_rules:
        if all(compact_text(w) in comp for w in words):
            score += add_score
            reasons.append(f"命中高風險組合：{name}")

    # 語境降權：防詐宣導、官方公告、家屬正常照護訊息。
    # 注意：如果內容明確要求轉帳、填資料、加 LINE，就不會完全放行。
    if safe_hits:
        strong_prevention = bool(re.search(r"(切勿|請勿|絕不會|不會.{0,12}(要求|私下|主動)|勿提供|勿點擊)", normalize_text(combined), re.I))
        if strong_prevention:
            score -= 90
            reasons.append("判定為明確的防詐宣導 / 禁止操作語境，大幅降低誤判風險")
        elif dangerous_hits and score >= 70:
            score -= 25
            reasons.append("內容含防詐提醒語境，但仍包含高風險操作要求，僅部分降權")
        else:
            score -= 75
            reasons.append("判定為正常防詐宣導 / 提醒語境，降低誤判風險")

    if trusted_domain and not dangerous_hits:
        score -= 50
        reasons.append("來源屬官方可信網域，且未要求直接危險操作，降低風險")

    if official_hits and not dangerous_hits:
        score -= 40
        reasons.append("判定為官方公告 / 正常網站服務說明，降低風險")

    if family_hits and not dangerous_hits and len(urgency_hits) <= 1:
        score -= 25
        reasons.append("判定為一般家屬照護或正常繳費提醒，降低風險")


    # 小型 RAG / 案例比對：不直接硬加分，主要提供可解釋證據
    similar_cases = []
    if find_similar_cases:
        try:
            similar_cases = find_similar_cases(combined, top_k=3, min_score=0.10)
        except Exception:
            similar_cases = []

    if similar_cases and score >= 40:
        top_case = similar_cases[0]
        reasons.append(f"相似案例比對：接近「{top_case.get('type', '未知詐騙')}」樣態（相似度 {top_case.get('similarity', 0)}）")

    score = max(0, min(100, int(score)))

    if not reasons:
        reasons = ["未發現明顯詐騙特徵"]
    if not scam_types:
        scam_types = ["未分類"]

    if score >= 70:
        advice = "請不要輸入信用卡、密碼、驗證碼或匯款，先關閉頁面並詢問家人或官方客服。"
    elif score >= 40:
        advice = "內容具有可疑特徵，建議先暫停操作並查證來源。"
    else:
        advice = "目前未發現明顯詐騙特徵；若後續要求匯款、帳密、驗證碼或加 LINE，請重新掃描。"

    signals = {
        "trustedOfficialDomain": trusted_domain,
        "safeContext": safe_hits,
        "officialNormalContext": official_hits,
        "familyNormalContext": family_hits,
        "dangerousActions": dangerous_hits,
        "urgencyWords": urgency_hits,
        "similarCases": similar_cases,
    }

    explain = []
    if dangerous_hits:
        explain.append("偵測到危險操作要求：" + "、".join(dangerous_hits[:2]))
    if urgency_hits:
        explain.append("偵測到急迫壓力字詞：" + "、".join(urgency_hits[:3]))
    for scam_type, kws in list(matched.items())[:3]:
        if kws:
            explain.append(f"{scam_type}：命中 {', '.join(kws[:3])}")
    if similar_cases and score >= 40:
        explain.append("與歷史詐騙案例相似，可作為佐證。")
    if not explain:
        explain = ["未發現明確危險操作；若後續要求匯款或驗證碼，請重新掃描。"]

    return {
        "engine": "ScamDNA",
        "score": score,
        "risk_level": simple_level(score),
        "riskScore": score,
        "riskLevel": rich_level(score),
        "scamDNA": scam_types[:5],
        "reason": "；".join(reasons[:8]),
        "advice": advice,
        "explain": explain[:5],
        "signals": signals,
        "matchedKeywords": matched,
    }


def is_scamdna_safe_context(report: dict) -> bool:
    if not isinstance(report, dict):
        return False
    signals = report.get("signals") or {}
    return bool(
        signals.get("trustedOfficialDomain")
        or signals.get("safeContext")
        or signals.get("officialNormalContext")
        or signals.get("familyNormalContext")
    ) and not bool(signals.get("dangerousActions"))


def should_trust_official_without_block(url: str, report: dict) -> bool:
    if not is_trusted_official_domain(url):
        return False
    signals = (report or {}).get("signals") or {}
    return not bool(signals.get("dangerousActions")) and int((report or {}).get("riskScore", 0)) <= 40
