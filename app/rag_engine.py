# rag_engine.py
# AI 防詐盾牌｜小型 RAG / 防詐案例比對 MVP
#
# 競賽封版升級重點：
# - 保留原本不依賴 ChromaDB / FAISS 的本地 JSON 架構。
# - 將原本單純 Jaccard 詞彙相似度，升級為「字元 n-gram TF-IDF + Cosine Similarity」。
# - 中文沒有天然空格，因此採用 2~4 字元 n-gram，比一般英文斷詞更適合詐騙短句、簡訊與 LINE 訊息。
# - 若部署環境沒有 rag_cases.json，函式會安全回傳空清單，不影響 /scan 主流程。

import json
import math
import re
import unicodedata
from collections import Counter
from functools import lru_cache
from pathlib import Path

DEFAULT_CASE_PATH = Path(__file__).with_name("rag_cases.json")
RAG_ENGINE_VERSION = "tfidf-char-ngram-v1"


# ==========================================
# 文字正規化 / 特徵抽取
# ==========================================
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
        "点": "點",
        "击": "擊",
        "奖": "獎",
        "领": "領",
        "费": "費",
        "码": "碼",
    }
    for old, new in replacements.items():
        text = text.replace(old, new)
    return text.lower()


def compact_text(text: str) -> str:
    text = normalize_text(text)
    return re.sub(r"[\s，。！？、:：;；\[\]【】（）()「」『』《》<>/\\|._\-]+", "", text)


def risk_phrases():
    return [
        "補繳運費", "海關稅費", "重新綁定", "銀行帳戶", "信用卡", "驗證碼", "提款卡密碼",
        "解除分期", "取消分期", "保證獲利", "零風險", "穩賺不賠", "內線消息", "老師帶單",
        "國家安全帳戶", "監管帳戶", "配合調查", "偵查不公開", "長照補助", "政府補助",
        "醫藥費", "手術費", "出車禍", "不要告訴", "加LINE", "加賴", "下載APK",
        "掃描QR", "QR Code", "中獎", "領獎", "手續費", "保證金", "通關費",
        "防詐騙宣導", "切勿", "請勿", "不會要求", "165反詐騙"
    ]


def tokenize(text: str):
    """
    保留舊版 token 介面，供相容與 matched signal 使用。
    """
    normalized = normalize_text(text)
    compact = compact_text(normalized)
    tokens = set()

    for phrase in risk_phrases():
        p = normalize_text(phrase)
        if p in normalized or p in compact:
            tokens.add(p)

    for n in (2, 3, 4, 5):
        for i in range(max(0, len(compact) - n + 1)):
            tokens.add(compact[i:i + n])

    for match in re.findall(r"[a-z0-9%]{2,}", normalized):
        tokens.add(match)

    return tokens


def char_ngrams(text: str, min_n: int = 2, max_n: int = 4):
    compact = compact_text(text)
    grams = []

    for phrase in risk_phrases():
        p = normalize_text(phrase)
        if p in normalize_text(text) or p in compact:
            grams.append(p)

    for n in range(min_n, max_n + 1):
        if len(compact) < n:
            continue
        grams.extend(compact[i:i + n] for i in range(len(compact) - n + 1))

    grams.extend(re.findall(r"[a-z0-9%]{2,}", normalize_text(text)))
    return grams


def term_frequency(text: str) -> Counter:
    return Counter(char_ngrams(text))


# ==========================================
# 案例載入與 TF-IDF 索引
# ==========================================
def case_text_blob(case: dict) -> str:
    return " ".join([
        str(case.get("type", "")),
        str(case.get("title", "")),
        str(case.get("summary", "")),
        " ".join(case.get("signals", []) or []),
        str(case.get("advice", "")),
    ])


@lru_cache(maxsize=1)
def load_cases(case_path: str = str(DEFAULT_CASE_PATH)):
    path = Path(case_path)
    if not path.exists():
        return []

    try:
        with path.open("r", encoding="utf-8") as f:
            cases = json.load(f)
    except Exception:
        return []

    if not isinstance(cases, list):
        return []

    prepared = []
    for case in cases:
        if not isinstance(case, dict):
            continue
        text_blob = case_text_blob(case)
        item = dict(case)
        item["_tokens"] = tokenize(text_blob)
        item["_tf"] = term_frequency(text_blob)
        prepared.append(item)
    return prepared


@lru_cache(maxsize=1)
def build_tfidf_index(case_path: str = str(DEFAULT_CASE_PATH)):
    cases = load_cases(case_path)
    if not cases:
        return [], {}, []

    doc_freq = Counter()
    for case in cases:
        doc_freq.update(set(case.get("_tf", {}).keys()))

    doc_count = len(cases)
    idf = {
        term: math.log((1 + doc_count) / (1 + df)) + 1.0
        for term, df in doc_freq.items()
    }

    vectors = []
    for case in cases:
        vectors.append(tfidf_vector(case.get("_tf", Counter()), idf))

    return cases, idf, vectors


def tfidf_vector(tf: Counter, idf: dict):
    if not tf:
        return {}

    vector = {}
    for term, count in tf.items():
        if not term:
            continue
        vector[term] = (1.0 + math.log(count)) * idf.get(term, 1.0)
    return vector


def cosine_similarity(vec_a: dict, vec_b: dict) -> float:
    if not vec_a or not vec_b:
        return 0.0

    if len(vec_a) > len(vec_b):
        vec_a, vec_b = vec_b, vec_a

    dot = sum(weight * vec_b.get(term, 0.0) for term, weight in vec_a.items())
    if dot <= 0:
        return 0.0

    norm_a = math.sqrt(sum(value * value for value in vec_a.values()))
    norm_b = math.sqrt(sum(value * value for value in vec_b.values()))
    if norm_a <= 0 or norm_b <= 0:
        return 0.0

    return dot / (norm_a * norm_b)


# ==========================================
# 相似度與查詢
# ==========================================
def lexical_similarity(query_tokens, case_tokens):
    if not query_tokens or not case_tokens:
        return 0.0

    overlap = query_tokens & case_tokens
    if not overlap:
        return 0.0

    jaccard = len(overlap) / len(query_tokens | case_tokens)
    coverage = len(overlap) / max(1, min(len(query_tokens), len(case_tokens)))
    return round(jaccard * 0.35 + coverage * 0.65, 4)


def find_similar_cases(text: str, top_k: int = 3, min_score: float = 0.08):
    """
    回傳格式：
    [
      {
        "case_id": "RAG001",
        "type": "假物流 / 包裹補繳運費",
        "title": "...",
        "similarity": 0.34,
        "tfidf_similarity": 0.31,
        "lexical_similarity": 0.22,
        "matched_signals": ["補繳運費", "信用卡"],
        "advice": "...",
        "source_name": "...",
        "source_url": "...",
        "engine": "tfidf-char-ngram-v1"
      }
    ]
    """
    query_text = str(text or "")
    query_tf = term_frequency(query_text)
    query_tokens = tokenize(query_text)
    cases, idf, vectors = build_tfidf_index()

    if not cases:
        return []

    query_vec = tfidf_vector(query_tf, idf)
    normalized_text = normalize_text(query_text)
    compact_query = compact_text(query_text)
    results = []

    for index, case in enumerate(cases):
        tfidf_score = cosine_similarity(query_vec, vectors[index])
        lex_score = lexical_similarity(query_tokens, case.get("_tokens", set()))
        score = round(max(tfidf_score, lex_score * 0.92), 4)

        if score < min_score:
            continue

        matched_signals = []
        for sig in case.get("signals", []) or []:
            normalized_sig = normalize_text(sig)
            if normalized_sig and (normalized_sig in normalized_text or normalized_sig in compact_query):
                matched_signals.append(sig)

        results.append({
            "case_id": case.get("case_id", ""),
            "type": case.get("type", ""),
            "title": case.get("title", ""),
            "similarity": score,
            "tfidf_similarity": round(tfidf_score, 4),
            "lexical_similarity": round(lex_score, 4),
            "matched_signals": matched_signals[:6],
            "summary": case.get("summary", ""),
            "advice": case.get("advice", ""),
            "source_name": case.get("source_name", ""),
            "source_url": case.get("source_url", ""),
            "engine": RAG_ENGINE_VERSION,
        })

    results.sort(key=lambda item: item["similarity"], reverse=True)
    return results[:top_k]


if __name__ == "__main__":
    demo = "您的包裹配送失敗，請立即補繳運費並輸入信用卡資料。"
    for item in find_similar_cases(demo):
        print(item)
