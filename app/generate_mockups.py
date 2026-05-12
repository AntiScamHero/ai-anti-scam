import html

# 這是你提供的 5 筆資料
data = [
    {
        "type": "low",
        "title": "正常防詐提醒",
        "input": "警政署提醒，請勿點擊不明連結，也不要提供信用卡或驗證碼，如有疑問請撥打 165。",
        "score": 0,
        "level": "低風險",
        "reason": "目前未偵測到明顯詐騙組合，但仍建議保持警覺。",
        "rag_info": "相似案例：假物流 / 補繳運費詐騙 (C001)<br>命中特徵：信用卡、連結<br>相似度：0.1538",
        "rules": "- 偵測到敏感資訊要求。<br>- 偵測到連結導向。<br>- 偵測到防詐宣導或提醒語境，已進行語境降權。"
    },
    {
        "type": "low",
        "title": "正常家人訊息",
        "input": "媽，明天我會比較晚回家，晚餐不用等我，我到家再跟你說。",
        "score": 0,
        "level": "低風險",
        "reason": "目前未偵測到明顯詐騙組合，但仍建議保持警覺。",
        "rag_info": "相似案例：無",
        "rules": "無觸發特定風險規則。"
    },
    {
        "type": "medium",
        "title": "假投資群組",
        "input": "加入老師 LINE 群組，AI 化交易保證獲利，零風險高報酬，限量名額。",
        "score": 32, # 註：根據你的系統 32 分是低風險，但在展示上通常設為中風險，這裡維持你的原始資料
        "level": "中風險", 
        "reason": "偵測到部分可疑特徵，請確認來源真實性。",
        "rag_info": "相似案例：假投資 / 飆股群組詐騙 (C002)<br>命中特徵：保證獲利、老師、LINE群、獲利、高報酬<br>相似度：0.3333",
        "rules": "- 偵測到「投資 / 老師 / 保證獲利 / 加 LINE」組合，符合假投資群組詐騙特徵。"
    },
    {
        "type": "high",
        "title": "假物流補繳運費",
        "input": "你的包裹配送失敗，請立即補繳運費並輸入信用卡資料：https://example.com/pay",
        "score": 100,
        "level": "高風險",
        "reason": "偵測到多個高風險詐騙特徵，建議立即停止操作，不要輸入信用卡、密碼、驗證碼或進行轉帳。",
        "rag_info": "相似案例：假物流 / 補繳運費詐騙 (C001)<br>命中特徵：包裹、配送失敗、補繳、補繳運費、運費、信用卡<br>相似度：0.4615",
        "rules": "- 偵測到急迫性話術。<br>- 偵測到付款相關要求。<br>- 偵測到敏感資訊要求。<br>- 偵測到釣魚連結。<br>- 偵測到「物流 / 包裹 / 補繳運費」組合。"
    },
    {
        "type": "high",
        "title": "假檢警帳戶凍結",
        "input": "這裡是偵查隊，你的帳戶涉嫌洗錢即將凍結，請配合檢察官監管帳戶並保密。",
        "score": 72,
        "level": "高風險",
        "reason": "偵測到多個高風險詐騙特徵，建議立即停止操作，不要輸入信用卡、密碼、驗證碼或進行轉帳。",
        "rag_info": "相似案例：假檢警 / 帳戶凍結詐騙 (C003)<br>命中特徵：偵查隊、洗錢、凍結、帳戶、檢察官、監管、保密、涉嫌<br>相似度：0.6",
        "rules": "- 偵測到急迫性話術。<br>- 偵測到匯款或轉帳相關要求。<br>- 偵測到「檢警 / 洗錢 / 帳戶凍結 / 監管」組合。"
    }
]

# CSS 樣式與 HTML 模板
html_content = """
<!DOCTYPE html>
<html lang="zh-TW">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>防詐盾牌 - 測試結果展示</title>
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f0f2f5; padding: 40px; display: flex; flex-wrap: wrap; gap: 30px; justify-content: center; }
        .phone-mockup { width: 350px; background: #fff; border-radius: 20px; box-shadow: 0 10px 25px rgba(0,0,0,0.1); overflow: hidden; border: 8px solid #333; }
        .header { padding: 15px; color: white; text-align: center; font-weight: bold; font-size: 18px; }
        .low .header { background-color: #2e7d32; }
        .medium .header { background-color: #f57c00; }
        .high .header { background-color: #c62828; }
        .content { padding: 20px; }
        .message-bubble { background: #e9ecef; padding: 15px; border-radius: 15px; border-bottom-left-radius: 0; margin-bottom: 20px; font-size: 15px; line-height: 1.5; color: #333;}
        .score-box { text-align: center; margin-bottom: 20px; padding: 15px; border-radius: 10px; }
        .low .score-box { background-color: #e8f5e9; color: #2e7d32; }
        .medium .score-box { background-color: #fff3e0; color: #e65100; }
        .high .score-box { background-color: #ffebee; color: #b71c1c; }
        .score { font-size: 32px; font-weight: bold; }
        .section-title { font-size: 14px; font-weight: bold; color: #666; margin-top: 15px; margin-bottom: 5px; border-bottom: 1px solid #eee; padding-bottom: 5px;}
        .text-sm { font-size: 13px; color: #555; line-height: 1.4; }
    </style>
</head>
<body>
"""

for item in data:
    html_content += f"""
    <div class="phone-mockup {item['type']}">
        <div class="header">{item['title']}</div>
        <div class="content">
            <div class="message-bubble">💬 {item['input']}</div>
            <div class="score-box">
                <div class="score">{item['score']} 分</div>
                <div>{item['level']}</div>
            </div>
            <div class="section-title">🛡️ 系統判定理由</div>
            <div class="text-sm">{item['reason']}</div>
            
            <div class="section-title">🔍 RAG 案例比對</div>
            <div class="text-sm">{item['rag_info']}</div>
            
            <div class="section-title">⚙️ 觸發規則</div>
            <div class="text-sm">{item['rules']}</div>
        </div>
    </div>
    """

html_content += """
</body>
</html>
"""

# 寫入檔案
with open("mockups.html", "w", encoding="utf-8") as f:
    f.write(html_content)

print("✅ 網頁生成成功！請在資料夾中點擊兩下打開 mockups.html")