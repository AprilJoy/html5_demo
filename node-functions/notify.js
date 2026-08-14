// EdgeOne Pages Node Functions —— POST /notify
// 运行在 Node.js 运行时（Cloud Functions）。Prompt 与 server/prompts.js 保持一致。
// 摘要+回复草稿 + 群机器人推送（自动识别钉钉/企微；钉钉支持「关键词」或「加签」）。
//
// 说明：Node Functions 的 console.log 会在 EdgeOne Pages 控制台「日志分析」面板中展示
// （与 Edge Functions 不同，Node Functions 的日志原生可见）。X-Edge-Logs 响应头仍保留作备用。

const NOTIFY_PROMPT = `你是餐饮店运营助手。根据顾客的评价内容，生成两部分内容并以 JSON 输出（不要输出其他内容）：
{"summary": "...", "reply": "..."}
字段要求：
- summary：该评价的中文摘要，30 字以内，概括顾客提到的要点
- reply：商家回复草稿，真诚口语化，50 字以内
注意：必须基于评价的实际内容生成，禁止照抄本提示中的字段说明文字。`;

const MOCK_REPLY = '感谢亲的喜爱与支持，我们会继续努力，期待下次光临！';
function mockSummary(feelings) {
  if (feelings && feelings.length) return `顾客在评价中提到：${feelings.join('、')}，商家可关注对应体验点。`;
  return null;
}

function detectChannel(url) {
  if (url.includes('oapi.dingtalk.com')) return 'dingtalk';
  if (url.includes('qyapi.weixin.qq.com')) return 'wecom';
  return 'unknown';
}

// 钉钉「加签」安全设置：sign = Base64(HmacSHA256(timestamp + "\n" + secret))。
// 用 Web Crypto（Node 20 全局可用）；若环境不支持则退化为不加签（关键词模式仍可用）。
async function hmacSign(url, secret) {
  if (!secret) return url;
  try {
    if (!globalThis.crypto?.subtle) return url;
    const timestamp = Date.now();
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(`${timestamp}\n${secret}`));
    const sign = encodeURIComponent(btoa(String.fromCharCode(...new Uint8Array(sigBuf))));
    return `${url}&timestamp=${timestamp}&sign=${sign}`;
  } catch {
    return url;
  }
}

async function pushRobot({ text, platform, feelings, summary, reply }, env) {
  const url =
    env.ROBOT_WEBHOOK_URL || env.DINGTALK_WEBHOOK_URL || env.WECOM_WEBHOOK_URL || '';
  if (!url) return { pushed: false, channel: 'none' };

  const channel = detectChannel(url);
  const lines = [
    `平台：${platform === 'xhs' ? '小红书' : 'Google'}`,
    `感受标签：${(feelings || []).join('、')}`,
    `> 原文：${text.slice(0, 120)}${text.length > 120 ? '…' : ''}`,
    `> 摘要：${summary}`,
    `> 回复草稿：${reply}`,
  ];

  let payload;
  if (channel === 'dingtalk') {
    // 关键词安全设置：消息必须含关键词。若后台关键词已是消息天然词（如品牌名），则不额外加前缀。
    const kw = (env.ROBOT_KEYWORD || env.DINGTALK_KEYWORD || '').trim();
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

  const targetUrl = channel === 'dingtalk' ? await hmacSign(url, env.DINGTALK_SECRET) : url;
  const res = await fetch(targetUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  let bizOk = res.ok;
  let errMsg = '';
  try {
    const d = await res.json();
    if (typeof d.errcode === 'number') {
      bizOk = res.ok && d.errcode === 0;
      errMsg = d.errmsg || '';
    }
  } catch {
    /* 非 JSON 响应按 HTTP 状态判断 */
  }
  return { pushed: bizOk, channel, errMsg };
}

async function chat(messages, env, jsonMode = false) {
  const base = env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
  const model = env.DEEPSEEK_MODEL || 'deepseek-chat';
  const body = { model, messages, temperature: 0.9, max_tokens: 400 };
  if (jsonMode) body.response_format = { type: 'json_object' };
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.DEEPSEEK_API_KEY}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`DeepSeek HTTP ${res.status}`);
  const data = await res.json();
  // 同时返回本次调用的 token 用量，便于「只要用模型就打印日志」
  return {
    content: data.choices?.[0]?.message?.content || '',
    usage: data.usage || null,
  };
}

// 响应构造：把本次请求收集到的日志（logs 闭包数组）注入 X-Edge-Logs 响应头（备用查看方式）。
function json(status, obj, logs) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8' };
  if (logs && logs.length) headers['X-Edge-Logs'] = logs.join(' | ').slice(0, 1800);
  return new Response(JSON.stringify(obj), { status, headers });
}

export default async function onRequest(context) {
  const { request, env } = context;
  // 本次请求独立的日志收集器（闭包数组，同时驱动 console.log 与 X-Edge-Logs 头）
  const logs = [];
  const log = (...args) => {
    const line = args.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(' ');
    logs.push(line);
    console.log(line); // Node Functions：控制台「日志分析」面板原生可见
  };
  const t0 = Date.now();
  if (request.method !== 'POST') return json(405, { error: 'method not allowed' }, logs);

  let out; // { status, obj }
  try {
    let body;
    try {
      body = await request.json();
    } catch {
      out = { status: 400, obj: { error: 'invalid json' } };
    }
    const { text, platform, feelings } = body || {};
    if (!out && !text) out = { status: 400, obj: { error: 'text is required' } };
    if (!out) {
      // 支持环境变量热更新 Prompt，未配置则用内置默认文案
      const notifyPrompt = env.NOTIFY_PROMPT || NOTIFY_PROMPT;

      let summary;
      let reply;
      let usedModel = false;
      let usage = null;
      if (!env.DEEPSEEK_API_KEY) {
        summary = mockSummary(feelings || []) || text.slice(0, 30);
        reply = MOCK_REPLY;
      } else {
        try {
          const r = await chat(
            [
              { role: 'system', content: notifyPrompt },
              { role: 'user', content: String(text) },
            ],
            env,
            true
          );
          const obj = JSON.parse(r.content);
          summary = String(obj.summary || '');
          reply = String(obj.reply || '');
          usedModel = true;
          usage = r.usage;
        } catch {
          summary = text.slice(0, 30);
          reply = '';
        }
      }

      const push = await pushRobot({ text: String(text), platform, feelings, summary, reply }, env);
      log(`[node:notify] channel=${push.channel} pushed=${push.pushed} ${push.errMsg || ''}`);
      // 用到了模型就打印本次调用的 token 用量
      if (usedModel && usage) {
        log(`[node:usage] promptTokens=${usage.prompt_tokens || 0} completionTokens=${usage.completion_tokens || 0}`);
      }
      out = { status: 200, obj: { ok: true, pushed: push.pushed, channel: push.channel, errMsg: push.errMsg, summary, reply } };
    }
  } catch (err) {
    out = { status: 500, obj: { error: 'notify failed' } };
  } finally {
    log(`[node:notify] cost=${Date.now() - t0}ms`);
  }
  return json(out.status, out.obj, logs);
}
