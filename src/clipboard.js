/**
 * 剪贴板复制（含降级）与平台跳转。
 * 注意：iOS / 微信 WebView 要求复制必须发生在用户手势事件内，
 * 因此 copyAndJump 必须由点击事件直接触发，中间不要有 await。
 */
import { APP_CONFIG } from '../config/app.config.js';

export async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext !== false) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      /* 走降级 */
    }
  }
  // 降级：execCommand（兼容旧 WebView）
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch (_) {
    ok = false;
  }
  document.body.removeChild(ta);
  return ok;
}

function jumpToPlatform(platformId) {
  const platform = APP_CONFIG.platforms.find((p) => p.id === platformId);
  if (platform) window.open(platform.publishUrl, '_blank');
}

/**
 * 复制文案并跳转平台发布入口。
 * @returns {Promise<boolean>} 复制是否成功
 */
export async function copyAndJump(text, platformId) {
  const ok = await copyText(text);
  jumpToPlatform(platformId);
  return ok;
}
