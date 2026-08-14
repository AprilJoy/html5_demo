// EdgeOne Pages Node Functions —— POST /generate
// 运行在 Node.js 运行时（Cloud Functions）。Prompt 与 server/prompts.js 保持一致。
// 静态页面由 Pages 直接托管，本函数只接管 /generate，与页面同源、无跨域。
// Prompt 支持环境变量热更新：env.PROMPT_SYSTEM / env.PROMPT_STYLE_GOOGLE / env.PROMPT_STYLE_XHS，未配置则回落内置默认。
//
// 说明：Node Functions 的 console.log 会在 EdgeOne Pages 控制台「日志分析」面板中展示
// （与 Edge Functions 不同，Node Functions 的日志原生可见）。因此本文件直接 console.log 即可，
// 无需再依赖 X-Edge-Logs 响应头（响应头仍保留作为备用查看方式）。

const DEFAULT_PROMPT_SYSTEM =
  `You are a review-writing assistant for "Sunny Tea House", a bubble tea shop in San Jose.
Write an authentic customer review based on the selected feelings and the target platform's style.
Rules:
- Only express the given feelings; do not invent specific menu items or facts.
- Sound like a real customer, not an advertisement.
- Output plain text only, no markdown headers.`;

const DEFAULT_STYLES = {
  google: {
    lang: 'en',
    style: `Write in English, 60-120 words. Objective, conversational tone of a local North American customer. No emoji, no hashtags. Mention the shop naturally.`,
  },
  xhs: {
    lang: 'zh',
    style: `用中文写，80-150字，典型种草笔记风格：口语化、有真实感；适当使用 Emoji（3-6 个）；短句分段、排版有呼吸感；结尾可带 2-3 个话题标签。`,
  },
};

// 环境变量热更新：env.PROMPT_STYLE_GOOGLE / env.PROMPT_STYLE_XHS 可覆盖平台风格
function getPlatformStyles(env) {
  return {
    google: { lang: 'en', style: env.PROMPT_STYLE_GOOGLE || DEFAULT_STYLES.google.style },
    xhs: { lang: 'zh', style: env.PROMPT_STYLE_XHS || DEFAULT_STYLES.xhs.style },
  };
}

function buildUserPrompt(feelings, platform, styles) {
  const cfg = styles[platform];
  if (!cfg) return null;
  return `${cfg.style}\n\nFeelings: ${feelings.join(', ')}`;
}

const MOCK_TEMPLATES = {
  google: (feelings) =>
    `Stopped by Sunny Tea House this afternoon and was genuinely impressed. ${feelings.join(' and ')} really stood out — you can tell they care about the details. The place has a relaxed vibe and I'll definitely be back to try more of the menu. Solid spot if you're in San Jose.`,
  xhs: (feelings) =>
    `姐妹们！发现一家宝藏奶茶店 🧋✨\n\nSunny Tea House 真的爱了爱了 💕\n\n${feelings.map((f) => `👉 ${f}，体验感直接拉满`).join('\n')}\n\n随便点都不踩雷，冲就完事了！🌟\n\n#奶茶探店 #SunnyTeaHouse #宝藏小店`,
};

const CJK_RE = /[一-鿿]/;
const EMOJI_RE = /[😀-🙏🌀-🫿☀-➿⬀-⯿️⃣]/gu;
function validate(text, platform) {
  if (!text || typeof text !== 'string') return false;
  const t = text.trim();
  if (platform === 'google') {
    const words = t.split(/\s+/).length;
    return !CJK_RE.test(t) && words >= 20 && words <= 200;
  }
  if (platform === 'xhs') {
    const emojiCount = (t.match(EMOJI_RE) || []).length;
    return CJK_RE.test(t) && emojiCount >= 2 && t.length >= 30 && t.length <= 400;
  }
  return false;
}

// 最佳努力限流：Node Functions 在中心机房运行，多实例仍可能不共享内存，属软限制（演示场景足够）。
const hits = new Map();
function rateLimit(ip, limit) {
  const now = Date.now();
  const rec = hits.get(ip);
  if (!rec || now > rec.resetAt) {
    hits.set(ip, { count: 1, resetAt: now + 3600_000 });
    return true;
  }
  if (rec.count >= limit) return false;
  rec.count += 1;
  return true;
}

// 响应构造：把本次请求收集到的日志（logs 闭包数组）注入 X-Edge-Logs 响应头（备用查看方式）。
// Node Functions 原生支持「日志分析」面板，console.log 可直接在控制台查看。
function json(status, obj, logs) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8' };
  if (logs && logs.length) headers['X-Edge-Logs'] = logs.join(' | ').slice(0, 1800);
  return new Response(JSON.stringify(obj), { status, headers });
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
    const { feelings, platform } = body || {};
    if (!out && (!Array.isArray(feelings) || !feelings.length || !platform)) {
      out = { status: 400, obj: { error: 'feelings and platform are required' } };
    }
    if (!out) {
      const limit = Number(env.RATE_LIMIT_PER_HOUR || 10);
      const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'node';
      if (!rateLimit(ip, limit)) out = { status: 429, obj: { error: 'rate limited' } };
    }
    if (!out) {
      // 环境变量热更新 Prompt，未配置则回落内置默认文案
      const promptSystem = env.PROMPT_SYSTEM || DEFAULT_PROMPT_SYSTEM;
      const styles = getPlatformStyles(env);
      if (!env.DEEPSEEK_API_KEY || !styles[platform]) {
        log(`[node:generate] mock=true platform=${platform}`);
        out = { status: 200, obj: { text: MOCK_TEMPLATES[platform](feelings), mock: true } };
      } else {
        const userPrompt = buildUserPrompt(feelings.map(String), String(platform), styles);
        let text = '';
        let lastUsage = null;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const strict =
            attempt === 1
              ? `${userPrompt}\n\nIMPORTANT: strictly follow the platform style rules (language, length, emoji usage).`
              : userPrompt;
          try {
            const r = await chat(
              [
                { role: 'system', content: promptSystem },
                { role: 'user', content: strict },
              ],
              env
            );
            text = r.content.trim();
            lastUsage = r.usage;
          } catch {
            out = { status: 502, obj: { error: 'upstream failed' } };
            break;
          }
          if (validate(text, platform)) {
            log(`[node:generate] mock=false platform=${platform}`);
            if (lastUsage) log(`[node:usage] promptTokens=${lastUsage.prompt_tokens || 0} completionTokens=${lastUsage.completion_tokens || 0}`);
            out = { status: 200, obj: { text } };
            break;
          }
        }
        if (!out) {
          // 两次都不达标，返回兜底模板，宁可用模板也不给顾客看跑偏文案
          log(`[node:generate] fallback=true platform=${platform}`);
          if (lastUsage) log(`[node:usage] promptTokens=${lastUsage.prompt_tokens || 0} completionTokens=${lastUsage.completion_tokens || 0}`);
          out = { status: 200, obj: { text: MOCK_TEMPLATES[platform](feelings), mock: true, fallback: true } };
        }
      }
    }
  } catch (err) {
    out = { status: 500, obj: { error: 'generate failed' } };
  } finally {
    log(`[node:generate] cost=${Date.now() - t0}ms`);
  }
  return json(out.status, out.obj, logs);
}
