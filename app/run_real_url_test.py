# run_real_url_test.py
# AI 防詐盾牌｜真實網站驗證批次測試｜直接修正版
#
# 你的後端啟動時已顯示：
# routes.py api_bp 已註冊：/scan、/api/auth/install ...
# 所以本測試程式直接打 http://127.0.0.1:5000/scan
# 不再打 http://127.0.0.1:5000/api/scan

import time
from datetime import datetime
from pathlib import Path

import pandas as pd
import requests


API_URL = "http://127.0.0.1:5000/scan"
INPUT_FILE = "AI防詐盾牌_真實網站驗證清單_100筆.xlsx"
OUTPUT_FILE = "AI防詐盾牌_真實網站驗證結果_已測試.xlsx"


def restore_url(url):
    if not isinstance(url, str):
        return ""
    return (
        url.strip()
        .replace("hxxps://", "https://")
        .replace("hxxp://", "http://")
        .replace("[.]", ".")
    )


def find_col(df, names):
    for name in names:
        if name in df.columns:
            return name
    return None


def expected_to_norm(value):
    text = str(value).strip().lower()
    if any(w in text for w in ["danger", "high", "高風險", "危險", "詐騙", "惡意", "phishing"]):
        return "danger"
    return "safe"


def normalize_result(data):
    score = (
        data.get("risk_score")
        or data.get("score")
        or data.get("riskScore")
        or data.get("final_score")
        or 0
    )

    risk_level = str(
        data.get("risk_level")
        or data.get("level")
        or data.get("risk")
        or data.get("riskLevel")
        or ""
    ).lower()

    result = str(
        data.get("result")
        or data.get("status")
        or data.get("verdict")
        or data.get("decision")
        or ""
    ).lower()

    is_scam = data.get("is_scam", data.get("isScam", None))

    try:
        score_num = int(float(score))
    except Exception:
        score_num = 0

    combined = f"{risk_level} {result}"

    if is_scam is True:
        return "danger", score

    if any(w in combined for w in ["danger", "high", "scam", "phishing", "高風險", "危險", "詐騙", "惡意"]):
        return "danger", score

    if any(w in combined for w in ["safe", "low", "normal", "安全", "低風險", "正常"]):
        return "safe", score

    if score_num >= 70:
        return "danger", score

    return "safe", score


def main():
    input_path = Path(INPUT_FILE)

    if not input_path.exists():
        raise FileNotFoundError(
            f"找不到 {INPUT_FILE}\n"
            f"請把 Excel 放在跟 run_real_url_test.py 同一個資料夾。"
        )

    df = pd.read_excel(input_path)

    url_col = find_col(df, ["URL", "網址", "測試網址", "url"])
    expected_col = find_col(df, ["預期結果", "預期判斷", "Expected", "expected"])
    type_col = find_col(df, ["類型", "分類", "Type", "type"])
    title_col = find_col(df, ["標題", "Title", "title"])
    content_col = find_col(df, ["內容", "文字", "測試內容", "Text", "text"])

    if not url_col:
        raise ValueError("Excel 找不到 URL / 網址 欄位。")
    if not expected_col:
        raise ValueError("Excel 找不到 預期結果 / 預期判斷 欄位。")

    # 關鍵修正：所有輸出欄位一律先轉成文字欄，避免 pandas 寫入 ERROR 爆掉
    output_cols = ["系統判斷", "系統分數", "是否正確", "分析時間", "系統理由", "錯誤訊息", "實際API路徑"]
    for col in output_cols:
        if col not in df.columns:
            df[col] = ""
        df[col] = df[col].astype("object")

    total = 0
    correct = 0
    tp = tn = fp = fn = 0

    print("開始批次測試...")
    print(f"API：{API_URL}")
    print(f"輸入檔：{INPUT_FILE}")
    print("-" * 70)

    for idx, row in df.iterrows():
        raw_url = str(row.get(url_col, "")).strip()
        url = restore_url(raw_url)
        expected = expected_to_norm(row.get(expected_col, ""))

        category = str(row.get(type_col, "")) if type_col else ""
        title = str(row.get(title_col, "")) if title_col else ""
        content = str(row.get(content_col, "")) if content_col else ""

        if not content or content.lower() == "nan":
            content = f"真實網站驗證。類型：{category}。網址：{url}。標題：{title}"

        payload = {
            "url": url,
            "title": title,
            "text": content,
            "source": "real_world_url_batch_test"
        }

        total += 1

        try:
            res = requests.post(API_URL, json=payload, timeout=30)
            res.raise_for_status()
            data = res.json()

            system_result, score = normalize_result(data)
            is_correct = system_result == expected

            reason = (
                data.get("reason")
                or data.get("summary")
                or data.get("message")
                or data.get("analysis")
                or data.get("explanation")
                or ""
            )

            if is_correct:
                correct += 1

            if expected == "danger" and system_result == "danger":
                tp += 1
            elif expected == "safe" and system_result == "safe":
                tn += 1
            elif expected == "safe" and system_result == "danger":
                fp += 1
            elif expected == "danger" and system_result == "safe":
                fn += 1

            df.at[idx, "系統判斷"] = system_result
            df.at[idx, "系統分數"] = str(score)
            df.at[idx, "是否正確"] = "正確" if is_correct else "錯誤"
            df.at[idx, "分析時間"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            df.at[idx, "系統理由"] = str(reason)
            df.at[idx, "錯誤訊息"] = ""
            df.at[idx, "實際API路徑"] = API_URL

            print(f"{idx + 1:03d}｜預期 {expected:<6}｜系統 {system_result:<6}｜{'正確' if is_correct else '錯誤'}｜{raw_url}")

        except Exception as e:
            df.at[idx, "系統判斷"] = "ERROR"
            df.at[idx, "系統分數"] = ""
            df.at[idx, "是否正確"] = "錯誤"
            df.at[idx, "分析時間"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            df.at[idx, "系統理由"] = ""
            df.at[idx, "錯誤訊息"] = str(e)
            df.at[idx, "實際API路徑"] = API_URL

            print(f"{idx + 1:03d}｜ERROR｜{raw_url}｜{e}")

        time.sleep(0.25)

    accuracy = correct / total if total else 0
    false_positive_rate = fp / (fp + tn) if (fp + tn) else 0
    false_negative_rate = fn / (fn + tp) if (fn + tp) else 0
    recall = tp / (tp + fn) if (tp + fn) else 0

    summary = pd.DataFrame([
        ["使用 API 路徑", API_URL],
        ["總測試數", total],
        ["正確數", correct],
        ["錯誤數", total - correct],
        ["整體準確率", f"{accuracy:.2%}"],
        ["TP：高風險正確抓到", tp],
        ["TN：正常正確放行", tn],
        ["FP：正常被誤判危險", fp],
        ["FN：高風險被誤判安全", fn],
        ["正常網站誤判率 FP Rate", f"{false_positive_rate:.2%}"],
        ["高風險漏判率 FN Rate", f"{false_negative_rate:.2%}"],
        ["高風險抓到率 Recall", f"{recall:.2%}"],
        ["測試完成時間", datetime.now().strftime("%Y-%m-%d %H:%M:%S")],
    ], columns=["項目", "結果"])

    with pd.ExcelWriter(OUTPUT_FILE, engine="openpyxl") as writer:
        df.to_excel(writer, sheet_name="測試結果", index=False)
        summary.to_excel(writer, sheet_name="統計摘要", index=False)

    print("\n========== 測試完成 ==========")
    print(f"總測試數：{total}")
    print(f"正確數：{correct}")
    print(f"整體準確率：{accuracy:.2%}")
    print(f"正常網站誤判率：{false_positive_rate:.2%}")
    print(f"高風險漏判率：{false_negative_rate:.2%}")
    print(f"高風險抓到率：{recall:.2%}")
    print(f"輸出檔案：{OUTPUT_FILE}")


if __name__ == "__main__":
    main()
