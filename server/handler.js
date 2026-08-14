/**
 * 路由与业务逻辑层：SCF 入口与本地服务器共用。
 * route() 输入统一的请求抽象，输出统一的响应抽象，两边各写一个薄适配器。
 *
 * 路由：
 *   GET  /          → index.html
 *   GET  /assets/*、/src/*、/config/* → 静态文件（ES Module 需正确 MIME）
 *   POST /generate  → AI 生成评价（限流 + 质量校验）
 *   POST /notify    → 摘要/回复草稿 + 群机器人推送（自动识别钉钉/企微）
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { generateReview, summarizeAndReply, rateLimit, usageReport } = require('./deepseek');

const ROOT = path.join(__dirname, '..');
// 通用 Webhook：按 URL 主机自动识别渠道。优先级 ROBOT_WEBHOOK_URL > DINGTALK_WEBHOOK_URL > WECOM_WEBHOOK_URL
const WEBHOOK_URL =
  process.env.ROBOT_WEBHOOK_URL ||
  process.env.DINGTALK_WEBHOOK_URL ||
  process.env.WECOM_WEBHOOK_URL ||
  '';
// 钉钉机器人「加签」安全设置的密钥（SEC 开头），企微不需要
const DINGTALK_SECRET = process.env.DINGTALK_SECRET || '';
// 钉钉机器人「关键词」安全设置的关键词，消息正文需包含此关键词才能通过（企微不需要）
const ROBOT_KEYWORD = process.env.ROBOT_KEYWORD || process.env.DINGTALK_KEYWORD || '';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function json(status, obj, extraHeaders = {}) {
  return {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders },
    body: JSON.stringify(obj),
  };
}

function serveStatic(urlPath) {
  const rel = urlPath === '/' ? '/index.html' : urlPath;
  const filePath = path.normalize(path.join(ROOT, rel));
  // 防目录穿越
  if (!filePath.startsWith(ROOT)) return null;
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return null;
  const ext = path.extname(filePath);
  return {
    status: 200,
    headers: { 'Content-Type': MIME[ext] || 'application/octet-stream' },
    body: fs.readFileSync(filePath, 'utf-8'),
  };
}

/** 按 Webhook URL 识别机器人渠道 */
function detectChannel(url) {
  if (url.includes('oapi.dingtalk.com')) return 'dingtalk';
  if (url.includes('qyapi.weixin.qq.com')) return 'wecom';
  return 'unknown';
}

/**
 * 钉钉加签 URL：sign = Base64(HmacSHA256(timestamp + "\n" + secret, secret))，URL 编码后拼接。
 * 安全设置为「关键词」时无需此步骤。
 */
function signedDingtalkUrl(url) {
  if (!DINGTALK_SECRET) return url;
  const timestamp = Date.now();
  const sign = encodeURIComponent(
    crypto.createHmac('sha256', DINGTALK_SECRET).update(`${timestamp}\n${DINGTALK_SECRET}`).digest('base64')
  );
  return `${url}&timestamp=${timestamp}&sign=${sign}`;
}

/**
 * 推送群机器人。钉钉与企微的 markdown 消息结构不同，按渠道拼装。
 * 钉钉安全设置支持两种：「关键词」（消息需含关键词）或「加签」（配 DINGTALK_SECRET）。
 */
async function pushRobot({ text, platform, feelings, summary, reply }) {
  if (!WEBHOOK_URL) return { pushed: false, channel: 'none' };
  const channel = detectChannel(WEBHOOK_URL);
  const lines = [
    `平台：${platform === 'xhs' ? '小红书' : 'Google'}`,
    `感受标签：${(feelings || []).join('、')}`,
    `> 原文：${text.slice(0, 120)}${text.length > 120 ? '…' : ''}`,
    `> 摘要：${summary}`,
    `> 回复草稿：${reply}`,
  ];
  let payload;
  if (channel === 'dingtalk') {
    // 钉钉关键词安全：消息必须含关键词，否则报「关键词不匹配」。
    // 若后台关键词已是消息里天然存在的词（如品牌名），则不额外加前缀，保持干净。
    const kw = (ROBOT_KEYWORD || '').trim();
    const body = `新评价 · Sunny Tea House\n\n${lines.join('\n\n')}`;
    const needPrefix = kw && !body.includes(kw);
    const prefix = needPrefix ? `【${kw}】` : '';
    payload = {
      msgtype: 'markdown',
      markdown: {
        title: `${prefix}新评价 - Sunny Tea House`,
        text: `${prefix}${body}`,
      },
    };
  } else {
    payload = { msgtype: 'markdown', markdown: { content: lines.join('\n') } };
  }
  const targetUrl = channel === 'dingtalk' ? signedDingtalkUrl(WEBHOOK_URL) : WEBHOOK_URL;
  const res = await fetch(targetUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  // 钉钉/企微成功均返回 errcode 为 0；HTTP 200 不代表业务成功
  let bizOk = res.ok;
  let errMsg = '';
  try {
    const data = await res.json();
    if (typeof data.errcode === 'number') {
      bizOk = res.ok && data.errcode === 0;
      errMsg = data.errmsg || '';
    }
  } catch (_) { /* 非 JSON 响应按 HTTP 状态判断 */ }
  return { pushed: bizOk, channel, errMsg };
}

/**
 * 统一路由入口。
 * @param {{method: string, path: string, body?: any, ip?: string}} req
 * @returns {Promise<{status: number, headers: object, body: string}>}
 */
async function route(req) {
  const { method, path: urlPath, body, ip = 'unknown' } = req;

  if (method === 'GET') {
    const file = serveStatic(urlPath.split('?')[0]);
    return file || { status: 404, headers: { 'Content-Type': 'text/plain' }, body: 'Not Found' };
  }

  if (method === 'POST' && urlPath === '/generate') {
    if (!rateLimit(ip)) return json(429, { error: 'rate limited' });
    const t0 = Date.now();
    const { feelings, platform } = body || {};
    if (!Array.isArray(feelings) || feelings.length === 0 || !platform) {
      return json(400, { error: 'feelings and platform are required' });
    }
    try {
      const result = await generateReview(feelings.map(String), String(platform));
      const u = usageReport();
      console.log(
        `[usage] calls=${u.calls} promptTokens=${u.promptTokens} completionTokens=${u.completionTokens} estCost=¥${u.estCost.toFixed(4)} mock=${!!result.mock} cost=${Date.now() - t0}ms`
      );
      return json(200, result);
    } catch (err) {
      console.log(`[usage] error cost=${Date.now() - t0}ms`);
      return json(502, { error: 'upstream failed' });
    }
  }

  if (method === 'POST' && urlPath === '/notify') {
    const t0 = Date.now();
    const { text, platform, feelings } = body || {};
    if (!text) return json(400, { error: 'text is required' });
    try {
      const { summary, reply } = await summarizeAndReply(String(text), feelings || []);
      const { pushed, channel, errMsg } = await pushRobot({ text: String(text), platform, feelings, summary, reply });
      console.log(`[notify] channel=${channel} platform=${platform} pushed=${pushed} ${errMsg} summary=${summary} cost=${Date.now() - t0}ms`);
      return json(200, { ok: true, pushed, channel, errMsg, summary, reply });
    } catch (err) {
      console.log(`[notify] error cost=${Date.now() - t0}ms`);
      return json(502, { error: 'notify failed' });
    }
  }

  return json(404, { error: 'not found' });
}

module.exports = { route };
