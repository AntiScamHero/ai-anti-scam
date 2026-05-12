# rag_engine.py
# AI 防詐盾牌｜小型 RAG / 防詐案例比對 MVP
#
# 特點：
# - 不需要 ChromaDB / FAISS / Hugging Face，先用本地 JSON + 詞彙相似度完成可展示版本。
# - 回傳最相似的詐騙案例，讓警示頁不只說「高風險」，也能說「像哪一類真實詐騙樣態」。
# - 未來若要升級，可把 find_similar_cases() 換成 ChromaDB 或 FAISS 向量檢索。

import json
import re
import unicodedata
from pathlib import Path
from functools import lru_cache

DEFAULT_CASE_PATH = Path(__file__).with_name("rag_cases.json")


def normalize_text(text: str) -> str:
    text = unicodedata.normalize("NFKC", str(text or ""))
    replacements = {
        "滙": "匯",
        "欵": "款",
        "賬": "帳",
        "帐": "帳",
        "户": "戶",
        "保建": "保健",
        "轉賬": "轉帳",
        "加 line": "加LINE",
        "加 LINE": "加LINE",
        "FDA 認證": "FDA認證",
    }
    for old, new in replacements.items():
        text = text.replace(old, new)
    return text.lower()


def tokenize(text: str):
    """
    簡易中文 token：
    - 保留 2~8 字的連續中文/英文/數字片段
    - 加入常見高風險短語
    """
    text = normalize_text(text)
    tokens = set()

    # 常見防詐短語優先抽取
    phrases = [
        "補繳運費", "海關稅費", "重新綁定", "銀行帳戶", "信用卡", "驗證碼", "提款卡密碼",
        "解除分期", "保證獲利", "零風險", "國家安全帳戶", "配合調查", "長照補助",
        "醫藥費", "批價", "退費", "出車禍", "手術費", "根治", "三日治癒", "不用開刀",
        "防詐騙宣導", "切勿", "請勿", "不會要求", "165反詐騙"
    ]

    for p in phrases:
        if normalize_text(p) in text:
            tokens.add(normalize_text(p))

    # 中文 2~5 gram，避免完全依賴斷詞套件
    compact = re.sub(r"[\s，。！？、:：;；\[\]【】（）()「」『』《》<>/\\|._-]+", "", text)
    for n in (2, 3, 4, 5):
        for i in range(max(0, len(compact) - n + 1)):
            piece = compact[i:i+n]
            if len(piece) == n:
                tokens.add(piece)

    # 英文數字詞
    for m in re.findall(r"[a-z0-9%]{2,}", text):
        tokens.add(m)

    return tokens


@lru_cache(maxsize=1)
def load_cases(case_path: str = str(DEFAULT_CASE_PATH)):
    path = Path(case_path)
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8") as f:
        cases = json.load(f)

    prepared = []
    for case in cases:
        text_blob = " ".join([
            str(case.get("type", "")),
            str(case.get("title", "")),
            str(case.get("summary", "")),
            " ".join(case.get("signals", []) or []),
            str(case.get("advice", "")),
        ])
        case = dict(case)
        case["_tokens"] = tokenize(text_blob)
        prepared.append(case)
    return prepared


def similarity(query_tokens, case_tokens):
    if not query_tokens or not case_tokens:
        return 0.0

    overlap = query_tokens & case_tokens
    if not overlap:
        return 0.0

    # Jaccard + 覆蓋率混合，讓短訊息也能比對到案例
    jaccard = len(overlap) / len(query_tokens | case_tokens)
    coverage = len(overlap) / max(1, min(len(query_tokens), len(case_tokens)))
    return round(jaccard * 0.45 + coverage * 0.55, 4)


def find_similar_cases(text: str, top_k: int = 3, min_score: float = 0.10):
    """
    回傳格式：
    [
      {
        "case_id": "RAG001",
        "type": "假物流 / 包裹補繳運費",
        "title": "...",
        "similarity": 0.34,
        "matched_signals": ["補繳運費", "信用卡"],
        "advice": "...",
        "source_name": "...",
        "source_url": "..."
      }
    ]
    """
    query_tokens = tokenize(text)
    results = []

    for case in load_cases():
        score = similarity(query_tokens, case.get("_tokens", set()))
        if score < min_score:
            continue

        matched_signals = []
        normalized_text = normalize_text(text)
        for sig in case.get("signals", []) or []:
            if normalize_text(sig) in normalized_text:
                matched_signals.append(sig)

        results.append({
            "case_id": case.get("case_id", ""),
            "type": case.get("type", ""),
            "title": case.get("title", ""),
            "similarity": score,
            "matched_signals": matched_signals[:6],
            "summary": case.get("summary", ""),
            "advice": case.get("advice", ""),
            "source_name": case.get("source_name", ""),
            "source_url": case.get("source_url", ""),
        })

    results.sort(key=lambda item: item["similarity"], reverse=True)
    return results[:top_k]


if __name__ == "__main__":
    demo = "您的包裹配送失敗，請立即補繳運費並輸入信用卡資料。"
    for item in find_similar_cases(demo):
        print(item)
