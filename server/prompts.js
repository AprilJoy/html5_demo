/**
 * 函数侧 Prompt 配置（权威版本）。
 * 支持环境变量热更新：PROMPT_SYSTEM / PROMPT_STYLE_GOOGLE / PROMPT_STYLE_XHS，
 * 评审复盘现场改环境变量即生效，无需改代码。
 */

const PROMPT_SYSTEM =
  process.env.PROMPT_SYSTEM ||
  `You are a review-writing assistant for "Sunny Tea House", a bubble tea shop in San Jose.
Write an authentic customer review based on the selected feelings and the target platform's style.
Rules:
- Only express the given feelings; do not invent specific menu items or facts.
- Sound like a real customer, not an advertisement.
- Output plain text only, no markdown headers.`;

const PLATFORM_STYLES = {
  google: {
    lang: 'en',
    style:
      process.env.PROMPT_STYLE_GOOGLE ||
      `Write in English, 60-120 words. Objective, conversational tone of a local North American customer. No emoji, no hashtags. Mention the shop naturally.`,
  },
  xhs: {
    lang: 'zh',
    style:
      process.env.PROMPT_STYLE_XHS ||
      `用中文写，80-150字，典型种草笔记风格：口语化、有真实感；适当使用 Emoji（3-6 个）；短句分段、排版有呼吸感；结尾可带 2-3 个话题标签。`,
  },
};

function buildUserPrompt(feelings, platform) {
  const cfg = PLATFORM_STYLES[platform];
  if (!cfg) return null;
  return `${cfg.style}\n\nFeelings: ${feelings.join(', ')}`;
}

/** 附加题：摘要 + 商家回复草稿，要求 JSON 输出 */
const NOTIFY_PROMPT = `你是餐饮店运营助手。根据顾客的评价内容，生成两部分内容并以 JSON 输出（不要输出其他内容）：
{"summary": "...", "reply": "..."}
字段要求：
- summary：该评价的中文摘要，30 字以内，概括顾客提到的要点
- reply：商家回复草稿，真诚口语化，50 字以内
注意：必须基于评价的实际内容生成，禁止照抄本提示中的字段说明文字。`

/** 无 API Key 时的兜底模板 */
const MOCK_TEMPLATES = {
  google: (feelings) =>
    `Stopped by Sunny Tea House this afternoon and was genuinely impressed. ${feelings.join(' and ')} really stood out — you can tell they care about the details. The place has a relaxed vibe and I'll definitely be back to try more of the menu. Solid spot if you're in San Jose.`,
  xhs: (feelings) =>
    `姐妹们！发现一家宝藏奶茶店 🧋✨\n\nSunny Tea House 真的爱了爱了 💕\n\n${feelings.map((f) => `👉 ${f}，体验感直接拉满`).join('\n')}\n\n随便点都不踩雷，冲就完事了！🌟\n\n#奶茶探店 #SunnyTeaHouse #宝藏小店`,
};

module.exports = { PROMPT_SYSTEM, PLATFORM_STYLES, NOTIFY_PROMPT, MOCK_TEMPLATES, buildUserPrompt };
