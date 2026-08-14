/**
 * API 调用层：/generate 与 /notify。
 * 接口失败且开启 useMockOnError 时，回退到本地模板，保证演示闭环不断。
 */
import { APP_CONFIG } from '../config/app.config.js';
import { MOCK_TEMPLATES } from '../config/prompts.js';

const { api, useMockOnError } = APP_CONFIG;

function url(path) {
  return `${api.baseUrl}${path}`;
}

async function postJson(path, body, timeoutMs = api.timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function mockGenerate(feelings, platform) {
  const tpl = MOCK_TEMPLATES[platform] || MOCK_TEMPLATES.google;
  return { text: tpl(feelings), mock: true };
}

/**
 * 生成评价。
 * @param {string[]} feelings 感受标签文案
 * @param {string} platform 平台 id
 * @returns {Promise<{text: string, mock?: boolean}>}
 */
export async function generateReview(feelings, platform) {
  try {
    const data = await postJson(api.generatePath, { feelings, platform });
    if (!data || typeof data.text !== 'string' || !data.text.trim()) {
      throw new Error('empty response');
    }
    return data;
  } catch (err) {
    if (useMockOnError) return mockGenerate(feelings, platform);
    throw err;
  }
}

/**
 * 企微群机器人推送（附加题）。
 * @returns {Promise<{pushed: boolean, summary: string, reply: string} | null>}
 *          失败返回 null，由调用方决定降级展示，不抛错阻塞主流程。
 */
export async function notifyWecom(payload) {
  try {
    return await postJson(api.notifyPath, payload);
  } catch (_) {
    return null;
  }
}
