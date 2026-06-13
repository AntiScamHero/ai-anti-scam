window.CONFIG = {
  API_BASE_URL: "https://ai-anti-scam.onrender.com",

  // LINE 家庭通知設定
  // 重要：這裡必須填 LINE 官方帳號真正的 Basic ID，例如：@123abcde
  // 找不到前先留空字串，不要放「@你的二號機BasicID」這種範例值，否則會產生壞掉的 LINE 連結。
  LINE_BOT_NAME: "AI防詐盾牌",
  LINE_BOT_BASIC_ID: "@175ttwou",

  // 家庭邀請連結；APK / file:// 模式主要走 LINE 官方帳號綁定，不依賴目前頁面網址。
  FAMILY_INVITE_BASE_URL: "https://ai-anti-scam.onrender.com/join",

  // LINE 後端 API
  LINE_INVITE_API: "/api/line/invite",
  LINE_BIND_STATUS_API: "/api/line/bind-status",
  LINE_TEST_PUSH_API: "/api/line/test-push",
  LINE_UNBIND_API: "/api/line/unbind"
};
