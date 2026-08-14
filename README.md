# Sunny Tea House · AI 评价生成 Demo

移动端 H5：顾客勾选消费感受 → 选平台（Google / 小红书）→ AI 生成平台风格评价 → 编辑后一键复制并跳转发布。附加能力：生成内容触发企微群机器人推送（中文摘要 + 商家回复草稿）。

## 目录结构

```
html5_demo/
├── index.html              # 单页入口（4 步流程）
├── assets/
│   └── css/main.css        # 极简高对比样式（CSS 变量主题，便于换肤）
├── config/
│   ├── app.config.js       # 应用配置：感受标签、平台、API 端点、兜底开关
│   └── prompts.js          # Prompt 模板 + 平台风格块 + 兜底文案
├── src/
│   ├── main.js             # 入口
│   ├── steps.js            # 4 步流程状态机
│   ├── api.js              # /generate /notify 调用 + 失败兜底
│   └── clipboard.js        # 剪贴板复制（含降级）+ 平台跳转
├── server/
│   ├── handler.js          # 路由与业务逻辑（SCF / 本地共用）
│   ├── deepseek.js         # 大模型调用、输出校验重试、限流
│   ├── prompts.js          # 函数侧 Prompt 配置（可用环境变量覆盖）
│   ├── scf.js              # 腾讯云 SCF 入口适配
│   ├── local.js            # 本地开发服务器（静态 + API 同源）
│   └── package.json
├── docs/
│   └── deploy.md           # 部署说明
└── .env.example            # 环境变量样例
```

## 本地运行

```bash
node server/local.js        # 默认 http://localhost:8080
```

不配 `DEEPSEEK_API_KEY` 时自动使用本地模板兜底文案，全流程可演示。

## 部署

- **腾讯云 EdgeOne Pages（推荐）**：静态页 + 边缘函数，零依赖、同源无跨域。见 [`docs/deploy-edgeone.md`](docs/deploy-edgeone.md)。
- 腾讯云 SCF：见 `docs/deploy.md`。核心思路：整个 Demo 是一个腾讯云 SCF Web 函数，页面与 API 同源，无跨域。
