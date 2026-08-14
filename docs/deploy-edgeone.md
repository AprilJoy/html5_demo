# 部署到腾讯云 EdgeOne Pages

把 Demo 整体托管到 EdgeOne Pages：**静态页面**由 Pages 直接分发，**`/generate`、`/notify` 两个接口**写成「边缘函数（Edge Functions）」跑在 V8 边缘运行时。前端 `config/app.config.js` 里 `api.baseUrl` 为空（同源相对路径），所以函数与页面天然同源、无跨域。

> 本项目后端**零 npm 依赖**，且钉钉用的是「关键词」安全模式（不需要加签 HMAC），所以选 Edge Functions 最干净——函数包体极小、冷启动快、无需 Node 运行时。

## 一、改动了什么

```
html5_demo/
├── index.html              # 静态页面（Pages 直接托管）
├── assets/  config/  src/  # 前端静态资源
├── functions/              # 新增：EdgeOne Pages 边缘函数目录
│   ├── generate.js         # → POST /generate
│   └── notify.js           # → POST /notify
├── server/                 # 本地 / SCF 用的 Node 版本（EdgeOne 用不到，保留兼容）
└── .env                    # 本地用，已 gitignore，绝不提交、不进 EdgeOne
```

- `functions/generate.js` 与 `functions/notify.js` 是**自包含**的 ESM 文件，Prompt 与 `server/prompts.js` 保持一致（复制了一份，避免跨目录 import 在边缘运行时出兼容问题）。
- 密钥（DeepSeek Key、钉钉 Webhook）**不再从 `.env` 文件读**，改为从 EdgeOne 控制台的环境变量读取，函数内通过 `context.env.XXX` 访问。

## 二、方式 A：Git 仓库 + 控制台（推荐，最省心）

1. **把代码推到 Git 仓库**（GitHub / 工蜂 / Gitee 等均可）。确保仓库根目录包含 `index.html` 和 `functions/`。
   - 注意 `.env` 已在 `.gitignore` 中，密钥不会进仓库。
2. 登录 [EdgeOne 控制台](https://console.cloud.tencent.com/edgeone) → **EdgeOne Pages** → **创建项目** → 选择「导入 Git 仓库」，授权并选中该仓库。
3. 构建配置（关键三步）：
   - **框架预设**：选「无 / Others」（或自定义）。
   - **构建命令**：**留空**（纯静态 HTML，无需构建）。
   - **输出目录**：填 **`.`**（项目根目录，即 `index.html` 所在层）。
   - > 若平台提示输出目录不存在，可改为根目录名（如 `html5_demo`）或把静态文件放到 `dist/` 后再填 `dist`。
4. 点击「部署」。等待构建完成，得到一个 `*.edgeonepages.cn`（或自定义域名）的访问地址。
5. 进入项目 **设置 → 环境变量**，按下方表格把密钥填进去（见第三节），保存后**重新部署一次**让变量生效。
6. 手机浏览器打开地址，走一遍 4 步流程 + 商家后台推送即可验收。

## 三、环境变量（必填/选填）

控制台「环境变量」里添加，函数内用 `context.env.变量名` 读取：

| 变量 | 必填 | 说明 |
|---|---|---|
| `DEEPSEEK_API_KEY` | 否* | 不配则 `/generate`、`/notify` 走本地模板兜底，全流程仍可演示 |
| `ROBOT_WEBHOOK_URL` | 附加题需要 | 钉钉群机器人 Webhook（含 `access_token`） |
| `ROBOT_KEYWORD` | 钉钉关键词模式需要 | 当前为 `Sunny Tea House`；消息正文已含该词，不会额外加前缀 |
| `DINGTALK_SECRET` | 仅「加签」模式需要 | 若钉钉后台设的是「加签」而非「关键词」，在此填 SEC 开头的密钥 |
| `DEEPSEEK_BASE_URL` | 否 | 默认 `https://api.deepseek.com` |
| `DEEPSEEK_MODEL` | 否 | 默认 `deepseek-chat` |
| `RATE_LIMIT_PER_HOUR` | 否 | 默认 `10` 次/IP/小时（边缘侧为软限制，见注意事项）|

> *演示可不放 Key；但要让顾客看到真实 AI 文案，必须配 `DEEPSEEK_API_KEY`。

## 四、方式 B：命令行 CLI（适合习惯终端 / CI）

```bash
npm install -g edgeone          # 安装 CLI
cd html5_demo
edgeone pages init              # 初始化（会自动建 functions 目录，已有可跳过）
edgeone pages link              # 关联已在控制台创建的项目
edgeone pages dev               # 本地预览：http://localhost:8088（前端+函数同源）
# 提交并推送代码到 Git，控制台会自动构建发布；或用：
edgeone pages deploy            # 直接部署
# 环境变量（也可在控制台填，二选一）：
edgeone pages env add DEEPSEEK_API_KEY sk-xxxx
edgeone pages env add ROBOT_WEBHOOK_URL https://oapi.dingtalk.com/robot/send?access_token=xxxx
edgeone pages env add ROBOT_KEYWORD "Sunny Tea House"
```

## 五、验证 checklist

- [ ] 打开 Pages 地址，手机 + 微信内置浏览器均正常
- [ ] 标签限选、双平台风格（Google 英文无 Emoji / 小红书中文带 Emoji+话题）
- [ ] 编辑、复制、跳转发布正常
- [ ] 商家后台收到钉钉推送（关键词模式：后台安全设置关键词需与 `ROBOT_KEYWORD` 一致，当前为 `Sunny Tea House`）
- [ ] 临时删掉 `DEEPSEEK_API_KEY` 重新部署，前端兜底文案仍能走完全流程

## 六、注意事项

1. **限流是软限制**：边缘函数实例间不共享内存，内置 `rateLimit` 只在一个隔离实例内生效，不能严格全局限流。演示足够；如需严格全局限流，改用 EdgeOne KV 存储计数。
2. **Prompt 热更新**：`functions/*.js` 内的 Prompt 已支持环境变量覆盖——在控制台设置 `PROMPT_SYSTEM` / `PROMPT_STYLE_GOOGLE` / `PROMPT_STYLE_XHS` / `NOTIFY_PROMPT` 即可热更新，无需改代码、重新部署后生效；不配置时回落到函数内内置默认文案。
3. **密钥安全**：`.env` 不进仓库、不进函数包；只在控制台环境变量配置。前端永远拿不到 Key。
4. **加签模式**：当前用「关键词」模式无需 `DINGTALK_SECRET`。若以后切到「加签」，`notify.js` 已内置 Web Crypto 的 HMAC 签名逻辑，填 `DINGTALK_SECRET` 即可自动加签。
5. **与 SCF 的关系**：`server/`（local.js / scf.js / handler.js）仍可用于本地开发和腾讯云 SCF 部署，互不影响。EdgeOne 走的是 `functions/` 这套边缘函数。

## 七、回退到 SCF（备用）

若 EdgeOne 不满足需求，仍可用原有 SCF 方案：见 `docs/deploy.md`，把整个目录打包上传为 Web 函数，入口 `scf.main_handler`。
