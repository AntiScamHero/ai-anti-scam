/**
 * 小守護｜Render 後端 LINE 緊急推播範例
 *
 * 放置位置建議：你的 Render 後端 server.js / app.js
 * 需要環境變數：
 *   LINE_CHANNEL_ACCESS_TOKEN=你的 LINE Messaging API Channel access token
 *   LINE_TARGET_USER_ID=要收到警報的家人 userId 或 groupId
 *
 * 注意：LINE Token 不可以放在前端。前端只送 allowLinePush=true，後端才真正呼叫 LINE API。
 */

const express = require('express');
const app = express();
app.use(express.json({ limit: '2mb' }));

const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';
const LINE_TARGET_USER_ID = process.env.LINE_TARGET_USER_ID || '';

function shouldSendLine(payload = {}) {
  return Boolean(payload.allowLinePush || payload.realLinePush) && !payload.suppressLine && !payload.suppressLineAlert;
}

function buildLineMessage(payload = {}) {
  const score = Number(payload.riskScore || 0) || 0;
  const level = payload.riskLevel || (score >= 70 ? '高風險' : score >= 40 ? '中風險' : '低風險');
  const title = payload.lineAlertTitle || '小守護緊急提醒';
  const domain = payload.domain || '';
  const reason = payload.reason || payload.ai_reason || '系統偵測到高風險內容。';
  const url = payload.url || payload.originalUrl || '';

  return [
    `⚠️ ${title}`,
    '',
    `風險等級：${level}`,
    `風險分數：${score}/100`,
    domain ? `可疑網域：${domain}` : '',
    `原因：${reason}`,
    '',
    '請提醒家人：不要點連結、不要輸入驗證碼、不要匯款。',
    url ? `網址：${url}` : ''
  ].filter(Boolean).join('\n');
}

async function pushLineMessage(text) {
  if (!LINE_CHANNEL_ACCESS_TOKEN || !LINE_TARGET_USER_ID) {
    return { ok: false, skipped: true, reason: 'LINE env not configured' };
  }

  const response = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`
    },
    body: JSON.stringify({
      to: LINE_TARGET_USER_ID,
      messages: [{ type: 'text', text }]
    })
  });

  const body = await response.text().catch(() => '');
  if (!response.ok) throw new Error(`LINE push failed ${response.status}: ${body}`);
  return { ok: true };
}

// 你原本如果已經有 /api/submit_evidence，請把「LINE 推播區塊」合併進既有 route，不要重複建立。
app.post('/api/submit_evidence', async (req, res) => {
  const payload = req.body || {};

  // TODO：這裡保留你原本的資料庫寫入邏輯，例如儲存到 alerts / evidence 資料表。
  const savedRecord = {
    id: payload.recordID || `evidence_${Date.now()}`,
    familyID: payload.familyID || 'none',
    riskScore: payload.riskScore || 0,
    riskLevel: payload.riskLevel || '未知',
    timestamp: payload.timestamp || new Date().toISOString()
  };

  let lineResult = { ok: false, skipped: true, reason: 'allowLinePush=false' };

  try {
    if (shouldSendLine(payload)) {
      lineResult = await pushLineMessage(buildLineMessage(payload));
    }
  } catch (error) {
    console.error('LINE push error:', error);
    lineResult = { ok: false, error: error.message };
    // 不要因為 LINE 失敗就讓攔截/戰情室失敗；比賽展示才不會整個卡住。
  }

  res.json({
    status: 'success',
    message: 'evidence saved',
    data: savedRecord,
    linePush: lineResult
  });
});

module.exports = { app, shouldSendLine, buildLineMessage, pushLineMessage };
