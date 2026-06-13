window.CONFIG = {
  API_BASE_URL: "https://ai-anti-scam.onrender.com",

  // LINE 家庭通知設定
  // 請填「AI 防詐測試二號機」的 Basic ID，例如：@123abcde
  // 若尚未填入，App 會先提供「複製邀請文字」備援，不會中斷其他功能。
  LINE_BOT_NAME: "AI防詐測試二號機",
  LINE_BOT_BASIC_ID: "",

  // 後端第一階段預留 API；後端完成後 App 會自動改走這些 API。
  LINE_INVITE_API: "/api/line/invite",
  LINE_BIND_STATUS_API: "/api/line/bind-status",
  LINE_TEST_PUSH_API: "/api/line/test-push",
  LINE_UNBIND_API: "/api/line/unbind"
};
