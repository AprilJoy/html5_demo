/**
 * 本地开发服务器：静态文件 + API 同源，与 SCF 共用 handler.route()。
 * 用法：node server/local.js [port]   （默认 8080）
 * 环境变量两种给法（优先级：shell 环境变量 > .env 文件）：
 *   ① DEEPSEEK_API_KEY=xxx node server/local.js
 *   ② 项目根目录建 .env 文件（已 gitignore，勿提交勿上传 SCF）
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

// 极简 .env 加载器：仅本地开发用；SCF 上走控制台环境变量，不依赖文件。
// 注意必须在 require('./handler') 之前执行（deepseek.js 在模块加载时读环境变量）。
(function loadEnv() {
  const envFile = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envFile)) return;
  for (const line of fs.readFileSync(envFile, 'utf-8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  }
})();

const { route } = require('./handler');

const PORT = Number(process.argv[2] || process.env.PORT || 8080);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  let body;
  if (req.method === 'POST') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf-8');
    try {
      body = JSON.parse(raw);
    } catch (_) {
      body = undefined;
    }
  }

  try {
    const result = await route({
      method: req.method,
      path: url.pathname,
      body,
      ip: req.socket.remoteAddress,
    });
    res.writeHead(result.status, result.headers);
    res.end(result.body);
  } catch (err) {
    console.error('[local] error:', err);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal Server Error');
  }
});

server.listen(PORT, () => {
  const robot = process.env.ROBOT_WEBHOOK_URL || process.env.DINGTALK_WEBHOOK_URL || process.env.WECOM_WEBHOOK_URL;
  const rateLimit = Number(process.env.RATE_LIMIT_PER_HOUR || 10);
  const maxTokens = Number(process.env.DEEPSEEK_MAX_TOKENS || 400);
  const model = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
  console.log(`Sunny Tea House demo running at http://localhost:${PORT}`);
  console.log('[安全] API Key : ' + (process.env.DEEPSEEK_API_KEY ? '已配置（仅服务端环境变量，前端不可见）' : '未配置 → mock 兜底模式'));
  console.log(`[安全] 限流护栏: ${rateLimit} 次/IP/小时 · 防演示链接被刷爆额度`);
  console.log(`[成本] 模型=${model} · max_tokens=${maxTokens}(输出长度护栏) · 单价约 ¥1/百万输入+¥2/百万输出 · 每次调用见 [usage] 日志`);
  console.log('[安全] 群机器人 : ' + (robot ? '已配置（仅服务端，未暴露前端）' : '未配置 → 演示模式'));
});
