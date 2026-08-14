/**
 * 4 屏流程状态机：
 *   screen-select   选择页（感受分组 + 平台）
 *   screen-loading  生成中（进度清单动画）
 *   screen-result   评价已生成（只读预览 + 编辑 + 复制跳转）
 *   screen-merchant 商家后台（摘要 + 回复草稿 + 推送状态）
 */
import { APP_CONFIG, findFeeling } from '../config/app.config.js';
import { generateReview, notifyWecom } from './api.js';
import { copyAndJump, copyText } from './clipboard.js';

const $ = (sel) => document.querySelector(sel);

const state = {
  /** Map<groupId, string[]> 每组已选标签 id，按选择顺序 */
  selected: new Map(),
  platform: null,
  lastPayload: null, // 最近一次推送 payload，供“重新推送”
};

/* ---------------- Toast ---------------- */
let toastTimer;
function showToast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('is-show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-show'), 1800);
}

/* ---------------- 屏切换 ---------------- */
function showScreen(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('is-active'));
  $(`#${id}`).classList.add('is-active');
  window.scrollTo(0, 0);
}

/* ---------------- 选择页渲染 ---------------- */
function renderFeelingGroups() {
  const box = $('#feelingGroups');
  box.innerHTML = '';
  APP_CONFIG.feelingGroups.forEach((group) => {
    const wrap = document.createElement('div');
    wrap.className = 'feeling-group';
    wrap.innerHTML = `
      <p class="group-title"><span class="group-dot ${group.tone}"></span>${group.title}</p>
      <div class="tag-row"></div>`;
    const row = wrap.querySelector('.tag-row');
    group.items.forEach((item) => {
      const tag = document.createElement('span');
      tag.className = `tag ${group.tone}`;
      tag.dataset.id = item.id;
      tag.dataset.group = group.id;
      tag.textContent = item.label;
      tag.addEventListener('click', () => onTagClick(group, item.id, tag));
      row.appendChild(tag);
    });
    box.appendChild(wrap);
  });
}

function renderPlatforms() {
  const box = $('#platformList');
  box.innerHTML = '';
  APP_CONFIG.platforms.forEach((p) => {
    const card = document.createElement('div');
    card.className = 'platform-card';
    card.dataset.id = p.id;
    const iconText = p.id === 'google' ? 'G' : '小红书';
    card.innerHTML = `
      <span class="platform-icon ${p.id}">${iconText}</span>
      <span class="platform-meta">
        <span class="platform-name">${p.name}</span>
        <span class="platform-desc" style="display:block">${p.desc}</span>
      </span>
      <span class="platform-check">✓</span>`;
    card.addEventListener('click', () => onPlatformClick(p.id, card));
    box.appendChild(card);
  });
}

function onTagClick(group, id, el) {
  const list = state.selected.get(group.id) || [];
  const idx = list.indexOf(id);
  if (idx >= 0) {
    list.splice(idx, 1);
    el.classList.remove('is-selected');
  } else {
    if (list.length >= APP_CONFIG.maxPerGroup) {
      const removed = list.shift(); // 替换本组最早选择
      const removedEl = document.querySelector(`.tag[data-id="${removed}"]`);
      removedEl?.classList.remove('is-selected');
      showToast(`「${group.title}」最多选 ${APP_CONFIG.maxPerGroup} 个，已替换最早的选择`);
    }
    list.push(id);
    el.classList.add('is-selected');
  }
  state.selected.set(group.id, list);
  refreshGenerateBtn();
}

function onPlatformClick(id, el) {
  state.platform = id;
  document.querySelectorAll('.platform-card').forEach((c) => c.classList.remove('is-selected'));
  el.classList.add('is-selected');
  refreshGenerateBtn();
}

function totalSelected() {
  return [...state.selected.values()].reduce((sum, list) => sum + list.length, 0);
}

function refreshGenerateBtn() {
  $('#generateBtn').disabled = !(totalSelected() >= 1 && state.platform);
}

/** 选中感受文案（保持组顺序 + 组内选择顺序）；Google 平台用英文 */
function selectedFeelingLabels(useEn) {
  const labels = [];
  APP_CONFIG.feelingGroups.forEach((group) => {
    (state.selected.get(group.id) || []).forEach((id) => {
      const f = findFeeling(id);
      labels.push((useEn ? f?.labelEn : f?.label) || id);
    });
  });
  return labels;
}

function platformConfig() {
  return APP_CONFIG.platforms.find((p) => p.id === state.platform);
}

/* ---------------- 屏 2：生成中 ---------------- */
function resetChecklist() {
  document.querySelectorAll('.check-item').forEach((li) => {
    li.classList.remove('is-doing', 'is-done');
  });
  $('#progressFill').style.width = '0';
  $('#genError').hidden = true;
  $('#retryGen').hidden = true;
}

function setCheckState(n, cls) {
  const li = document.querySelector(`.check-item[data-check="${n}"]`);
  li.classList.remove('is-doing', 'is-done');
  if (cls) li.classList.add(cls);
}

async function runGenerate() {
  const platform = platformConfig();
  const zhLabels = selectedFeelingLabels(false);

  // 填充生成中屏信息
  $('#loadingSummary').textContent = `已选择：${zhLabels.join(' · ')} → ${platform.shortName}`;
  $('#checkText1').textContent = `已分析：${zhLabels.join(' · ')}`;
  $('#checkText2').textContent = `已匹配平台风格（${platform.badge.replace(' ', ' · ')}）`;
  resetChecklist();
  showScreen('screen-loading');

  // 进度清单动画与真实请求并行
  const animate = async () => {
    setCheckState(1, 'is-doing');
    $('#progressFill').style.width = '25%';
    await sleep(500);
    setCheckState(1, 'is-done');
    setCheckState(2, 'is-doing');
    $('#progressFill').style.width = '55%';
    await sleep(500);
    setCheckState(2, 'is-done');
    setCheckState(3, 'is-doing');
    $('#progressFill').style.width = '80%';
  };

  try {
    const [result] = await Promise.all([
      generateReview(selectedFeelingLabels(state.platform === 'google'), state.platform),
      animate(),
    ]);
    setCheckState(3, 'is-done');
    $('#progressFill').style.width = '100%';
    await sleep(350);
    fillResultScreen(result.text);
    showScreen('screen-result');
    // 必须在屏幕显示后再撑高，否则拿不到真实 scrollHeight
    requestAnimationFrame(autoGrowEditor);
  } catch (err) {
    setCheckState(3, null);
    $('#genError').hidden = false;
    $('#retryGen').hidden = false;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ---------------- 屏 3：结果 ---------------- */
function fillResultScreen(text) {
  const platform = platformConfig();
  $('#platformBadge').textContent = platform.badge;
  $('#previewTags').textContent = `基于：${selectedFeelingLabels(false).join(' · ')}`;
  const editor = $('#reviewEditor');
  editor.value = text;
  autoGrowEditor();
  updateCharCount();
  $('#copyPublishBtn').textContent = platform.publishLabel;
  $('#publishTip').textContent = platform.publishTip;
}

/** 编辑框自动撑高：内容少时无滚动条，撑满限高后再滚动 */
function autoGrowEditor() {
  const editor = $('#reviewEditor');
  editor.style.height = 'auto';
  editor.style.height = `${editor.scrollHeight}px`;
}

function updateCharCount() {
  const platform = platformConfig();
  const len = $('#reviewEditor').value.length;
  $('#charCount').textContent = `${len} 字 · ${platform.styleNote}`;
  autoGrowEditor();
}

async function onCopyPublish() {
  const text = $('#reviewEditor').value.trim();
  if (!text) {
    showToast('内容为空，请先生成评价');
    return;
  }
  const ok = await copyAndJump(text, state.platform);
  showToast(ok ? '已复制，正在打开发布页…' : '复制失败，请长按文本手动复制');

  // 进入商家后台并触发推送（异步填充）
  state.lastPayload = {
    text,
    platform: state.platform,
    feelings: selectedFeelingLabels(false),
  };
  showScreen('screen-merchant');
  pushToWecom();
}

/* ---------------- 屏 4：商家后台 ---------------- */
async function pushToWecom() {
  const badge = $('#pushBadge');
  badge.textContent = '推送中…';
  badge.classList.remove('is-ok');
  $('#summaryText').textContent = '生成中…';
  $('#replyText').textContent = '生成中…';
  $('#postUrl').textContent = '···';
  $('#postStatus').textContent = '···';
  $('#postStatus').className = 'post-status';
  $('#pushResult').textContent = '';

  const data = await notifyWecom(state.lastPayload);

  if (!data) {
    $('#summaryText').textContent = '推送服务暂不可用';
    $('#replyText').textContent = '请稍后点击「重新推送」重试';
    $('#postStatus').textContent = 'FAILED';
    $('#postStatus').classList.add('is-fail');
    badge.textContent = '推送失败';
    $('#pushResult').textContent = '网络异常，未推送到门店群';
    $('#pushResult').classList.add('is-fail');
    return;
  }

  const CHANNEL_META = {
    dingtalk: { url: 'oapi.dingtalk.com/robot/send', name: '钉钉群' },
    wecom: { url: 'qyapi.weixin.qq.com/cgi-bin/webhook/send', name: '企微群' },
  };
  const meta = CHANNEL_META[data.channel] || { url: 'webhook（未识别渠道）', name: '门店群' };

  $('#summaryText').textContent = data.summary || '—';
  $('#replyText').textContent = data.reply || '—';
  $('#postUrl').textContent = meta.url;
  const time = new Date().toTimeString().slice(0, 5);
  $('#pushResult').classList.remove('is-fail');

  // 未配置 Webhook：演示模式
  if (data.channel === 'none') {
    $('#postStatus').textContent = 'DEMO';
    $('#postStatus').className = 'post-status';
    badge.textContent = '演示模式';
    badge.classList.remove('is-ok', 'is-fail');
    $('#pushResult').textContent = `演示模式：未配置 Webhook，推送内容已生成 · ${time}`;
    return;
  }

  // 已配置且推送成功
  if (data.pushed) {
    $('#postStatus').textContent = '200 OK';
    $('#postStatus').classList.add('is-ok');
    $('#postStatus').classList.remove('is-fail');
    badge.textContent = '已推送';
    badge.classList.add('is-ok');
    badge.classList.remove('is-fail');
    $('#pushResult').textContent = `✓ 已推送到「Sunny Tea House ${meta.name}」 · ${time}`;
    return;
  }

  // 已配置但推送失败：显示真实错误，方便排查
  $('#postStatus').textContent = 'FAILED';
  $('#postStatus').classList.add('is-fail');
  $('#postStatus').classList.remove('is-ok');
  badge.textContent = '推送失败';
  badge.classList.add('is-fail');
  badge.classList.remove('is-ok');
  $('#pushResult').textContent = `✗ 推送失败（${meta.name}）：${data.errMsg || '未知错误'} · ${time}`;
  $('#pushResult').classList.add('is-fail');
}

/* ---------------- 入口 ---------------- */
export function init() {
  $('#shopSub').textContent = `${APP_CONFIG.shopCity} · ${APP_CONFIG.shopSlogan}`;
  renderFeelingGroups();
  renderPlatforms();

  $('#generateBtn').addEventListener('click', runGenerate);
  $('#retryGen').addEventListener('click', runGenerate);
  $('#regenBtn').addEventListener('click', runGenerate);
  $('#reviewEditor').addEventListener('input', updateCharCount);
  $('#copyPublishBtn').addEventListener('click', onCopyPublish);
  $('#repushBtn').addEventListener('click', pushToWecom);
  $('#backHomeBtn').addEventListener('click', () => showScreen('screen-select'));
  $('#copyReplyBtn').addEventListener('click', async () => {
    const ok = await copyText($('#replyText').textContent);
    showToast(ok ? '回复草稿已复制' : '复制失败');
  });
}
