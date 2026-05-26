# AI 防詐盾牌 LINE Guard 診斷測試
# 使用方式：
# 1. 先把 flask_backend_files/routes.py 部署到 Render
# 2. Render 顯示 Deploy succeeded 後，在 PowerShell 執行本檔

$BASE = "https://ai-anti-scam.onrender.com"

Write-Host "`n[1] 檢查後端是否已部署 v12 LINE Guard"
Invoke-RestMethod "$BASE/api/line_guard_status?url=https://parcel-pay.example.com" | ConvertTo-Json -Depth 8

Write-Host "`n[2] 直接測 /api/scan，要求 suppressLine=true。這一步不應收到 LINE。"
$body = @{
  url = "https://parcel-pay.example.com"
  text = "Demo 測試：包裹配送失敗，請立即補繳運費並輸入信用卡資料。"
  familyID = "請改成你的家庭代碼"
  userID = "debug_user"
  source = "popup_demo"
  scan_source = "popup_demo"
  demoMode = $true
  suppressLine = $true
  suppressLineAlert = $true
  allowLinePush = $false
} | ConvertTo-Json -Depth 8

Invoke-RestMethod "$BASE/api/scan" -Method POST -ContentType "application/json" -Body $body | ConvertTo-Json -Depth 8

Write-Host "`n判斷："
Write-Host "- 如果第 1 步沒有 lineGuardVersion=v12-line-diagnostic-hard-block，代表 Render 沒部署到新版。"
Write-Host "- 如果第 2 步回傳 linePushSuppressed=true 但 LINE 還是收到，代表還有其他舊服務或其他 endpoint 在推播。"
Write-Host "- 如果第 2 步沒有 linePushSuppressed=true，代表 routes.py 邏輯沒有吃到新版。"
