import pandas as pd
import requests
import time
from datetime import datetime
from pathlib import Path

# ==========================================
# AI 防詐盾牌｜不覆蓋舊報告版測試器
# ==========================================
INPUT_FILE = "01_測試資料集_100筆.xlsx"
API_URL = "http://127.0.0.1:5000/api/analyze"
REQUEST_TIMEOUT = 15

def make_output_filename():
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    return f"02_測試結果報告_{stamp}.xlsx"

def normalize_level(raw_level, score=0):
    text = str(raw_level or "").strip()

    if text in ["極度危險", "高度危險", "高風險", "中高風險"]:
        return "高風險"
    if text in ["中風險", "可疑", "提醒"]:
        return "中風險"
    if text in ["安全無虞", "安全", "正常", "低風險"]:
        return "低風險"

    try:
        s = float(score)
        if s >= 70:
            return "高風險"
        if s >= 40:
            return "中風險"
        return "低風險"
    except Exception:
        return text or "低風險"

def is_correct(real_label, level):
    if real_label == "詐騙":
        return level in ["高風險", "中風險"]
    if real_label == "正常":
        return level == "低風險"
    return False

def main():
    print("啟動測試：AI 防詐盾牌 - 不覆蓋報告版\n")

    if not Path(INPUT_FILE).exists():
        print(f"❌ 找不到檔案：{INPUT_FILE}")
        return

    output_file = make_output_filename()
    df = pd.read_excel(INPUT_FILE)

    result_columns = [
        "系統判斷",
        "系統分數",
        "是否判斷正確",
        "分析時間(秒)",
        "高風險是否攔截",
        "家屬通知是否成功",
        "誤判類型",
        "系統理由/備註",
    ]

    for col in result_columns:
        if col not in df.columns:
            df[col] = None

    for col in ["系統判斷", "是否判斷正確", "高風險是否攔截", "家屬通知是否成功", "誤判類型", "系統理由/備註"]:
        df[col] = df[col].astype("object")

    total = len(df)
    fraud_total = 0
    normal_total = 0
    fraud_detected = 0
    normal_false_positive = 0
    correct_total = 0
    total_time = 0

    for index, row in df.iterrows():
        test_id = str(row.get("編號", f"T{index+1:03d}"))
        content = str(row.get("內容/網址/文字", ""))
        real_label = str(row.get("真實標籤", "")).strip()

        if real_label == "詐騙":
            fraud_total += 1
        elif real_label == "正常":
            normal_total += 1

        start = time.time()

        try:
            response = requests.post(API_URL, json={"text": content}, timeout=REQUEST_TIMEOUT)

            if response.status_code == 200:
                data = response.json()
                score = data.get("riskScore", data.get("score", 0))
                level = data.get("riskLevel", data.get("risk_level", "低風險"))
                reason = data.get("reason", "無回傳理由")
                level = normalize_level(level, score)
            else:
                score = 0
                level = "連線錯誤"
                reason = f"HTTP {response.status_code}: {response.text[:200]}"

        except Exception as e:
            score = 0
            level = "連線錯誤"
            reason = str(e)

        elapsed = round(time.time() - start, 2)
        total_time += elapsed

        correct = is_correct(real_label, level)
        if correct:
            correct_total += 1

        if real_label == "詐騙" and level in ["高風險", "中風險"]:
            fraud_detected += 1

        if real_label == "正常" and level in ["高風險", "中風險"]:
            normal_false_positive += 1

        if real_label == "正常" and level in ["高風險", "中風險"]:
            error_type = "誤判"
        elif real_label == "詐騙" and level == "低風險":
            error_type = "漏判"
        elif level == "連線錯誤":
            error_type = "連線錯誤"
        else:
            error_type = ""

        df.at[index, "系統分數"] = score
        df.at[index, "系統判斷"] = level
        df.at[index, "是否判斷正確"] = "是" if correct else "否"
        df.at[index, "分析時間(秒)"] = elapsed
        df.at[index, "高風險是否攔截"] = "是" if level == "高風險" else "否"
        df.at[index, "家屬通知是否成功"] = "未測"
        df.at[index, "誤判類型"] = error_type
        df.at[index, "系統理由/備註"] = reason

        print(f"進度 {index+1}/{total} | {test_id} | 標籤:{real_label} | 判斷:{level} | 正確:{'是' if correct else '否'} | {elapsed}s")
        time.sleep(0.2)

    df.to_excel(output_file, index=False)

    fraud_rate = fraud_detected / fraud_total * 100 if fraud_total else 0
    false_positive_rate = normal_false_positive / normal_total * 100 if normal_total else 0
    accuracy = correct_total / total * 100 if total else 0
    avg_time = total_time / total if total else 0

    print("\n" + "=" * 60)
    print("✅ 測試完成，已另存新檔，不會覆蓋舊報告。")
    print(f"📄 輸出檔案：{output_file}")
    print("=" * 60)
    print(f"📊 測試總數：{total} 筆（詐騙 {fraud_total} / 正常 {normal_total}）")
    print(f"🎯 詐騙辨識率：{fraud_rate:.1f}%")
    print(f"⚠️ 正常誤判率：{false_positive_rate:.1f}%")
    print(f"🏆 整體正確率：{accuracy:.1f}%")
    print(f"⏱️ 平均分析時間：{avg_time:.2f} 秒")
    print("=" * 60)

if __name__ == "__main__":
    main()
