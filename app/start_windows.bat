@echo off
chcp 65001 > nul
echo 正在啟動 AI 防詐盾牌 RAG MVP 後端 v3...
echo.
pip install -r requirements.txt
echo.
python app.py
pause
