/**
 * 前端兜底模板（唯一用途：接口不可用时保证演示闭环不断）。
 * 注意：本文件只含 MOCK_TEMPLATES，不含真实 Prompt。
 * 生效的 Prompt 在「服务端」—— server/prompts.js（本地/SCF 版）
 * 与 functions/generate.js、functions/notify.js（EdgeOne 边缘函数版）。
 */

/** 兜底模板：接口不可用时保证演示闭环不断 */
export const MOCK_TEMPLATES = {
  google: (feelings) =>
    `Stopped by Sunny Tea House this afternoon and was genuinely impressed. ${feelings.join(' and ')} really stood out — you can tell they care about the details. The place has a relaxed vibe and I'll definitely be back to try more of the menu. Solid spot if you're in San Jose.`,
  xhs: (feelings) =>
    `姐妹们！发现一家宝藏奶茶店 🧋✨\n\nSunny Tea House 真的爱了爱了 💕\n\n${feelings.map((f) => `👉 ${f}，体验感直接拉满`).join('\n')}\n\n随便点都不踩雷，冲就完事了！🌟\n\n#奶茶探店 #SunnyTeaHouse #宝藏小店`,
};
