# 部署说明

> 想部署到腾讯云 EdgeOne Pages（静态页 + 边缘函数，零依赖、同源无跨域）？见 **[deploy-edgeone.md](./deploy-edgeone.md)**。

## 本地开发

```bash
cd server
node local.js          # http://localhost:8080
```

不带 `DEEPSEEK_API_KEY` 时自动使用本地模板兜底，全流程可演示。

## 部署到腾讯云 SCF

1. 腾讯云控制台 → 云函数 SCF → 新建「Web 函数」，运行时选 Node.js 18+；
2. 将整个项目目录打包为 zip 上传（函数代码根目录即项目根目录）；
3. 函数入口设置为：`scf.main_handler`；
4. 触发器：创建 API 网关触发器，启用「集成响应」，发布后得到访问 URL，即为演示链接；
5. 环境变量（函数配置 → 环境变量）：

| 变量 | 必填 | 说明 |
|---|---|---|
| `DEEPSEEK_API_KEY` | 否* | 不配则走兜底模板 |
| `WECOM_WEBHOOK_URL` | 附加题需要 | 企微群机器人 Webhook 地址 |
| `PROMPT_SYSTEM` 等 | 否 | Prompt 热更新，复盘现场可改 |
| `RATE_LIMIT_PER_HOUR` | 否 | 默认 10 次/IP/小时 |

## 验收 checklist

- [ ] 手机浏览器（含微信内置浏览器）打开链接，4 步流程顺畅
- [ ] 感受标签限选 1–2 个，超选有替换提示
- [ ] Google 输出英文无 Emoji；小红书输出中文带 3–6 个 Emoji 和话题标签
- [ ] 文本框可二次编辑；复制成功 Toast；跳转对应平台入口
- [ ] 点击复制跳转后，企微群收到摘要 + 回复草稿推送
- [ ] 断掉 API Key 后前端兜底文案仍可走完全流程
