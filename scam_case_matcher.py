import json
import os
from functools import lru_cache
from typing import Any, Dict, List, Optional


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CASE_DB_PATH = os.path.join(BASE_DIR, "scam_cases.json")


@lru_cache(maxsize=1)
def load_scam_cases() -> List[Dict[str, Any]]:
    """
    載入本地詐騙案例庫。
    使用快取避免每次 API 請求都重新讀取 JSON。
    """

    if not os.path.exists(CASE_DB_PATH):
        print(f"[ScamCaseMatcher] 找不到詐騙案例庫：{CASE_DB_PATH}")
        return []

    try:
        with open(CASE_DB_PATH, "r", encoding="utf-8") as file:
            data = json.load(file)

        if not isinstance(data, list):
            print("[ScamCaseMatcher] scam_cases.json 格式錯誤，最外層必須是 list。")
            return []

        return data

    except Exception as error:
        print(f"[ScamCaseMatcher] 讀取詐騙案例庫失敗：{error}")
        return []


def normalize_text(text: str) -> str:
    """
    簡單正規化：
    - 移除多餘空白
    - 統一大小寫
    """
    if not isinstance(text, str):
        return ""

    return text.strip().replace(" ", "").lower()


def find_similar_scam_case(user_text: str) -> Optional[Dict[str, Any]]:
    """
    輕量化案例比對 MVP：
    根據使用者輸入內容，比對本地詐騙案例庫中的關鍵特徵。

    回傳範例：
    {
        "case_id": "C003",
        "source_type": "假檢警 / 帳戶凍結詐騙",
        "similarity_score": 0.6364,
        "matched_features": ["偵查隊", "洗錢", "凍結", "帳戶", "檢察官", "監管", "保密"],
        "description": "...",
        "match_count": 7,
        "total_keywords": 11
    }
    """

    normalized_user_text = normalize_text(user_text)

    if not normalized_user_text:
        return None

    cases = load_scam_cases()

    best_match: Optional[Dict[str, Any]] = None
    highest_score = 0.0

    for case in cases:
        keywords = case.get("keywords", [])

        if not isinstance(keywords, list) or len(keywords) == 0:
            continue

        unique_keywords = []
        seen = set()

        for keyword in keywords:
            keyword_text = str(keyword).strip()
            normalized_keyword = normalize_text(keyword_text)

            if not normalized_keyword:
                continue

            if normalized_keyword in seen:
                continue

            seen.add(normalized_keyword)
            unique_keywords.append({
                "original": keyword_text,
                "normalized": normalized_keyword
            })

        if not unique_keywords:
            continue

        matched_features = [
            item["original"]
            for item in unique_keywords
            if item["normalized"] in normalized_user_text
        ]

        similarity_score = len(matched_features) / len(unique_keywords)

        if similarity_score > highest_score:
            highest_score = similarity_score
            best_match = {
                "case_id": case.get("id", ""),
                "source_type": case.get("type", ""),
                "similarity_score": round(similarity_score, 4),
                "matched_features": matched_features,
                "description": case.get("description", ""),
                "match_count": len(matched_features),
                "total_keywords": len(unique_keywords)
            }

    if not best_match:
        return None

    # 門檻：
    # - 至少命中 2 個關鍵特徵
    # - 相似度至少 15%
    if best_match["match_count"] >= 2 and highest_score >= 0.15:
        return best_match

    return None


if __name__ == "__main__":
    # 可單獨測試案例比對是否正常。
    sample_text = "這裡是偵查隊，你的帳戶涉嫌洗錢即將凍結，請配合檢察官監管帳戶並保密。"
    print(find_similar_scam_case(sample_text))
