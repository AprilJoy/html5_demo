/**
 * 应用配置：感受标签分组、平台、API 端点、兜底开关。
 * 新增分组/平台/标签只需在此加配置，无需改业务代码。
 */
export const APP_CONFIG = {
  shopName: 'Sunny Tea House',
  shopCity: 'San Jose, CA',
  shopSlogan: '喝完来评价一杯吧',

  /** 感受标签：分组展示，每组最多可选 maxPerGroup 个 */
  maxPerGroup: 2,
  feelingGroups: [
    {
      id: 'positive',
      title: '好的体验',
      tone: 'good',
      items: [
        { id: 'service', label: '服务好', labelEn: 'great service' },
        { id: 'fast',    label: '出餐快', labelEn: 'quick service' },
        { id: 'clean',   label: '环境干净', labelEn: 'clean environment' },
        { id: 'pretty',  label: '饮品颜值高', labelEn: 'beautiful drinks' },
      ],
    },
    {
      id: 'improve',
      title: '可以更好',
      tone: 'bad',
      items: [
        { id: 'sweet', label: '偏甜了', labelEn: 'a touch too sweet' },
        { id: 'slow',  label: '出餐慢', labelEn: 'a bit slow' },
        { id: 'noisy', label: '环境偏吵', labelEn: 'a little noisy' },
      ],
    },
  ],

  /** 目标平台 */
  platforms: [
    {
      id: 'google',
      name: 'Google 评价',
      shortName: 'Google',
      badge: 'Google 英文',
      desc: '英文 · 北美本地消费者客观口吻',
      styleNote: '符合 Google 英文风格',
      publishLabel: '复制并打开 Google 评价',
      publishTip: '复制后自动打开 Google Maps 评价发布页',
      publishUrl: 'https://www.google.com/maps/search/Sunny+Tea+House+San+Jose',
    },
    {
      id: 'xhs',
      name: '小红书',
      shortName: '小红书',
      badge: '小红书 中文',
      desc: '中文 · 种草笔记风格',
      styleNote: '符合小红书种草风格',
      publishLabel: '复制并打开小红书',
      publishTip: '复制后自动打开小红书发布入口',
      publishUrl: 'https://www.xiaohongshu.com',
    },
  ],

  /** API 端点：同源部署时 baseUrl 留空 */
  api: {
    baseUrl: '',
    generatePath: '/generate',
    notifyPath: '/notify',
    timeoutMs: 15000,
  },

  /** 接口失败时是否使用本地模板兜底（演示保命措施） */
  useMockOnError: true,
};

/** 按 id 查标签（跨分组） */
export function findFeeling(id) {
  for (const group of APP_CONFIG.feelingGroups) {
    const hit = group.items.find((item) => item.id === id);
    if (hit) return hit;
  }
  return null;
}
