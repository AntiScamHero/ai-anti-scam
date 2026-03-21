import os
import requests
from dotenv import load_dotenv

load_dotenv()
api_key = os.getenv("AZURE_API_KEY")
endpoint = os.getenv("AZURE_ENDPOINT")

if not api_key or not endpoint:
    print("❌ 找不到 API Key 或 Endpoint，請確認 .env 檔案設定是否正確！")
    exit()

# 清除網址結尾多餘的斜線
endpoint = endpoint.rstrip('/')

# 台灣大專院校與微軟學生方案最常使用的部署名稱題庫
candidate_names = [
    "gpt-35-turbo", "gpt-4o", "gpt-4o-mini", "gpt-4",
    "gpt-3.5-turbo", "gpt35", "gpt4", "gpt-4-turbo",
    "gpt-35-turbo-16k", "gpt-4-32k", "default", "model",
    "chatgpt", "openai", "test"
]

print("🚀 啟動終極盲猜腳本：自動測試所有常見部署名稱...\n")

found = False
for name in candidate_names:
    print(f"嘗試部署名稱: [{name}] ... ", end="")
    
    # 直接打對話 API 測試是否存活
    url = f"{endpoint}/openai/deployments/{name}/chat/completions?api-version=2023-05-15"
    headers = {"api-key": api_key, "Content-Type": "application/json"}
    payload = {"messages": [{"role": "user", "content": "hi"}], "max_tokens": 5}

    try:
        response = requests.post(url, headers=headers, json=payload)
        if response.status_code == 200:
            print("✅ 成功！找到啦！")
            print(f"\n🎉 恭喜！這個名稱是正確的，請將你的 .env 檔案裡的 AZURE_MODEL_NAME 改成： {name}")
            found = True
            break
        elif response.status_code == 400:
            # 有時候因為模型版本差異會回傳 400 Bad Request，但這也代表「部署名稱」是存在的！
            print("✅ 成功找到路徑！(雖然回傳 400，但部署名稱存在)")
            print(f"\n🎉 請將你的 .env 檔案裡的 AZURE_MODEL_NAME 改成： {name}")
            found = True
            break
        elif response.status_code == 404:
            print("❌ 錯誤 (404 找不到)")
        elif response.status_code == 401:
            print("❌ 權限不足 (401)，這把金鑰可能已經失效了")
            break
        else:
            print(f"⚠️ 其他狀態碼: {response.status_code}")
    except Exception as e:
        print(f"連線失敗: {e}")

if not found:
    print("\n😭 題庫裡的名稱都猜錯了... 這代表助教可能取了非常特殊的自訂名稱 (例如你們的組別名稱 team-1 等)。")