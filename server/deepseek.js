/**
 * DeepSeek 调用层：生成 + 输出质量校验（不达标自动重试一次）+ IP 限流。
 * 无 DEEPSEEK_API_KEY 时返回本地模板兜底，保证演示闭环不断。
 */
const {
  PROMPT_SYSTEM,
  PLATFORM_STYLES,
  NOTIFY_PROMPT,
  MOCK_TEMPLATES,
  buildUserPrompt,
} = require('./prompts');

const API_KEY = process.env.DEEPSEEK_API_KEY || '';
const BASE_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
const MAX_TOKENS = 400; // 成本护栏

/* ---------- 用量统计（成本可视化，打印到运行日志） ---------- */
// DeepSeek 计价（deepseek-chat，估算值）：输入 ¥1/百万 token，输出 ¥2/百万 token
const PRICE_PER_1K_PROMPT = 0.001;
const PRICE_PER_1K_COMPLETION = 0.002;
const usage = { calls: 0, promptTokens: 0, completionTokens: 0 };
function addUsage(u) {
  if (!u) return;
  usage.calls += 1;
  usage.promptTokens += u.prompt_tokens || 0;
  usage.completionTokens += u.completion_tokens || 0;
}
function usageReport() {
  const estCost = (usage.promptTokens / 1000) * PRICE_PER_1K_PROMPT
    + (usage.completionTokens / 1000) * PRICE_PER_1K_COMPLETION;
  return { ...usage, estCost };
}

/* ---------- 限流：每 IP 每小时 ---------- */
const RATE_LIMIT = Number(process.env.RATE_LIMIT_PER_HOUR || 10);
const hits = new Map(); // ip -> {count, resetAt}

function rateLimit(ip) {
  const now = Date.now();
  const rec = hits.get(ip);
  if (!rec || now > rec.resetAt) {
    hits.set(ip, { count: 1, resetAt: now + 3600_000 });
    return true;
  }
  if (rec.count >= RATE_LIMIT) return false;
  rec.count += 1;
  return true;
}

/* ---------- 输出质量校验 ---------- */
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

/* ---------- 模型调用 ---------- */
async function chat(messages, { json = false } = {}) {
  const body = {
    model: MODEL,
    messages,
    temperature: 0.9,
    max_tokens: MAX_TOKENS,
  };
  if (json) body.response_format = { type: 'json_object' };
  const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`DeepSeek HTTP ${res.status}`);
  const data = await res.json();
  addUsage(data.usage);
  return data.choices?.[0]?.message?.content || '';
}

/**
 * 生成评价：带一次质量重试；无 Key 走兜底模板。
 */
async function generateReview(feelings, platform) {
  if (!API_KEY || !PLATFORM_STYLES[platform]) {
    return { text: MOCK_TEMPLATES[platform](feelings), mock: true };
  }
  const userPrompt = buildUserPrompt(feelings, platform);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const strict =
      attempt === 1
        ? `${userPrompt}\n\nIMPORTANT: strictly follow the platform style rules (language, length, emoji usage).`
        : userPrompt;
    const text = (await chat([
      { role: 'system', content: PROMPT_SYSTEM },
      { role: 'user', content: strict },
    ])).trim();
    if (validate(text, platform)) return { text };
  }
  // 两次都不达标：返回兜底模板，宁可用模板也不给顾客看跑偏文案
  return { text: MOCK_TEMPLATES[platform](feelings), mock: true, fallback: true };
}

/**
 * 附加题：生成摘要 + 商家回复草稿。
 */
async function summarizeAndReply(reviewText, feelings = []) {
  if (!API_KEY) {
    return {
      summary: feelings.length
        ? `顾客在评价中提到：${feelings.join('、')}，商家可关注对应体验点。`
        : reviewText.slice(0, 30),
      reply: '感谢亲的喜爱与支持，我们会继续努力，期待下次光临！',
    };
  }
  const raw = await chat(
    [
      { role: 'system', content: NOTIFY_PROMPT },
      { role: 'user', content: reviewText },
    ],
    { json: true }
  );
  try {
    const obj = JSON.parse(raw);
    return { summary: String(obj.summary || ''), reply: String(obj.reply || '') };
  } catch (_) {
    return { summary: reviewText.slice(0, 30), reply: raw.slice(0, 50) };
  }
}

module.exports = { generateReview, summarizeAndReply, rateLimit, usageReport };
