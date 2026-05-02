# DJCYTools AI 短剧叙事工厂

DJCYTools 是一个面向短剧出海团队的本地全栈 MVP。它把落地页、账号登录、团队角色、DeepSeek 剧本生成、Doubao-Seed-2.0 视频样片、结构化剧本编辑、版本实验、趋势参考、60 个热门模板、导出、投流回流、SQLite 持久化、访问埋点和 AI 调用日志串成完整闭环。

![1777184657560](image/README/1777184657560.png)

![1777184719219](image/README/1777184719219.png)

## 当前入口

默认首页是产品落地页：

```text
http://127.0.0.1:5173/
http://127.0.0.1:4173/
```

工作台直达：

```text
http://127.0.0.1:5173/#workbench
http://127.0.0.1:4173/#workbench
```

## 启动方式

安装依赖：

```bash
npm install
```

开发环境：

```bash
npm run dev
```

开发地址：

```text
http://127.0.0.1:5173/
```

生产构建与启动：

```bash
npm run build
npm start
```

生产地址默认：

```text
http://127.0.0.1:4173/
```

## 环境变量

复制 `.env.example` 为 `.env` 并填写：

```text
# 剧本生成：DeepSeek
DJCYTOOLS_SCRIPT_API_KEY=your_deepseek_api_key
DJCYTOOLS_SCRIPT_PROVIDER=DeepSeek
DJCYTOOLS_SCRIPT_BASE_URL=https://api.deepseek.com
DJCYTOOLS_SCRIPT_MODEL=deepseek-chat
DJCYTOOLS_SCRIPT_TIMEOUT_MS=70000

# 视频样片生成：火山方舟 / Doubao-Seed-2.0
DJCYTOOLS_VIDEO_API_KEY=your_volcengine_ark_api_key
DJCYTOOLS_VIDEO_PROVIDER=Doubao-Seed-2.0
DJCYTOOLS_VIDEO_ENDPOINT=https://ark.cn-beijing.volces.com/api/v3/responses
DJCYTOOLS_VIDEO_MODEL=doubao-seed-2-0-mini-260215
DJCYTOOLS_VIDEO_TIMEOUT_MS=90000

# 真实视频生成：火山方舟 / Doubao Seedance 视频任务 API
DJCYTOOLS_REAL_VIDEO_API_KEY=your_volcengine_ark_api_key
DJCYTOOLS_REAL_VIDEO_PROVIDER=Doubao-Seedance-2.0
DJCYTOOLS_REAL_VIDEO_ENDPOINT=https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks
DJCYTOOLS_REAL_VIDEO_MODEL=doubao-seedance-2-0-260128
DJCYTOOLS_REAL_VIDEO_TIMEOUT_MS=90000
DJCYTOOLS_MAX_BODY_BYTES=1048576
DJCYTOOLS_REQUEST_TIMEOUT_MS=30000
DJCYTOOLS_RATE_LIMIT_WINDOW_MS=60000
DJCYTOOLS_RATE_LIMIT_MAX=80
DJCYTOOLS_ADMIN_EMAIL=admin@djcytools.local
DJCYTOOLS_ADMIN_PASSWORD=DJCYTools@2026
DJCYTOOLS_ADMIN_NAME=DJCYTools 管理员
DJCYTOOLS_TEAM_NAME=出海短剧实验室
DJCYTOOLS_APP_URL=http://127.0.0.1:4173
DJCYTOOLS_PUBLIC_API_TOKEN=change-me-for-third-party-workflows
DJCYTOOLS_PUBLIC_API_BASE_URL=http://127.0.0.1:4173
# 可选：覆盖本地数据目录，适合 E2E 或隔离开发环境
DJCYTOOLS_DATA_DIR=
# 可选：把邀请/重置通知投递到企业 IM、自动化平台或自建服务
DJCYTOOLS_NOTIFICATION_WEBHOOK_URL=
DJCYTOOLS_NOTIFICATION_WEBHOOK_SECRET=
DJCYTOOLS_NOTIFICATION_TIMEOUT_MS=10000
# 可选：用于多实例迁移预案识别
DJCYTOOLS_DATABASE_URL=postgresql://user:pass@host:5432/djcytools
```

`.env` 已被 `.gitignore` 忽略。DeepSeek 与 Doubao / 火山方舟 API Key 只在服务端代理中使用，不会打进前端 bundle。

如果曾经在聊天、截图或公开文档中暴露过真实 Key，请在对应平台控制台轮换密钥后再更新本地 `.env`。

首次启动会按环境变量创建默认所有者账号。未配置时默认账号为 `admin@djcytools.local`，默认密码为 `DJCYTools@2026`；本地自测可以直接使用，上线或分享前请改掉 `DJCYTOOLS_ADMIN_PASSWORD`。

## 已实现能力

- 产品落地页：SEO 标题、结构化数据、首屏 CTA、社会证明、真实产品截图、工作流、模板展示、核心收益、试用反馈、FAQ、最终 CTA、Footer
- DeepSeek 生成短剧项目，输出简体中文结构化 JSON
- DeepSeek 定向改写：提高冲突、投流钩子、降低狗血度、本地化表达、评分建议改写
- Doubao-Seed-2.0 生成 15 秒竖屏短剧样片制作包：浏览器动态视频预览、WebM 导出、镜头时间线、SRT 字幕、旁白、视觉提示词、制作包、渲染清单和 JSON
- Doubao Seedance 视频任务 API 生成真实 9:16 视频片段，并在工作台轮询任务状态、成功后直接播放/打开视频 URL
- 真实视频任务支持参考图、参考视频、参考音频、`generate_audio` 和比例配置；测试阶段时长固定 15 秒，符合 seedance 2.0 单次生成上限
- 本地兜底生成，外部 API 失败时不阻塞工作流
- 结构化剧本编辑：剧名、卖点、人设、大纲、前 3 集脚本、核心对白
- 生成前准备度：检查项目名、情绪痛点、目标观众、模板、集数和钩子密度
- 模板预览：在生成表单中直接查看模板类型、热度、钩子和标签
- 投流钩子编辑：生成后可直接调整卖点卡和广告开场钩子
- 版本实验：版本保存、版本切换、版本对比、来源标记
- AI 评分：钩子、情绪、反转、人设、本地化、投流可剪辑、合规风险、版本相似度
- 分镜建议：每集自动生成 0-10s、10-45s、45-90s 的画面、镜头、声音和道具建议
- 合规与相似度检测：命中未成年、自伤、毒品、性暴力、歧视、高羞辱/高冲突等规则，并对同项目版本做重复度提示
- 互动短剧体验：基于当前版本生成 C 端用户画像、情绪状态和三段互动选择点
- 投流结果回流：按版本记录渠道、素材、花费、曝光、点击、完播、转化、收入，并自动计算 CTR、完播率、CPA、ROAS
- 60 个热门模板，按类型和热度排序
- 模板库管理：复制当前模板、保存团队自定义模板、编辑/删除自定义模板、安装社区模板
- 模板效果回流：根据投流结果聚合模板 ROAS、CTR、完播率，并同步影响趋势信号
- 趋势看板：情绪标签、模板信号、市场提示，可结合团队投流回流刷新，并支持导入趋势快照 JSON
- 账号与权限：登录、HttpOnly 会话、用户表、团队表、所有者/编辑者/查看者角色、接口鉴权
- 邮箱注册：新邮箱注册后自动创建个人团队，并以所有者身份进入工作台
- 团队权限：团队名、成员、角色编辑；非所有者只能查看团队配置
- 团队成员管理 API：所有者可真实更新成员姓名、角色和移除成员，并保护最后一个所有者
- 团队邀请：所有者生成邀请 Token，成员可在登录页接受邀请并加入团队
- 本地通知发件箱：邀请 Token、重置 Token 会进入可审计的本地投递队列，所有者可复制正文、标记已发送/失败，或通过配置的 Webhook 自动投递
- 密码重置：本地 MVP 可申请重置 Token 并设置新密码，后续可把通知发件箱接入邮件或企业 IM
- 登录后改密：账号安全面板支持验证当前密码、设置新密码并清理其他会话
- 操作审计：记录登录、注册、邀请、工作区保存、项目 CRUD、AI 调用和第三方导出等关键动作
- 导出：TXT / PDF / DOC / JSON
- 第三方交付 API：通过 `DJCYTOOLS_PUBLIC_API_TOKEN` 读取项目 JSON，并支持外部投流系统回写效果数据
- 交付接口面板：展示 Public API 配置状态、OpenAPI 地址、当前项目导出地址和 cURL 示例
- 团队 API Token：所有者可在工作台生成/撤销团队级交付 Token；数据库只保存哈希，Token 明文只显示一次
- 工作区备份与恢复：导出/导入完整 JSON 工作区
- 工作区归一化：旧缓存、服务端数据、备份导入都会补齐团队、设置、自定义模板和活跃项目字段
- 项目管理：项目列表查询、搜索筛选、新建草稿、项目改名、状态流转、单项目读取和删除
- SQLite 持久化：用户、团队、项目、版本、评论、导出、投流结果、自定义模板、AI 日志、访问埋点拆表
- 多实例迁移预案：工作台提供 PostgreSQL 迁移计划、表清单和当前团队 SQL 迁移包下载
- JSON 迁移：首次启动会把旧 `data/workspace.json`、`data/ai-logs.json`、`data/analytics.json` 导入 SQLite
- 数据埋点：匿名记录落地页和工作台访问量、独立访客、最近访问时间，并在工作台运行状态展示
- AI 调用日志：模型、token、耗时、估算成本、成功/失败状态
- P0 稳定性：API 请求体限制、DeepSeek / Doubao-Seed-2.0 超时、简单限流、静态资源缓存、安全响应头、统一错误码
- 错误体验：DeepSeek、Doubao-Seed-2.0 或服务端同步失败会在工作台展示可读提示，并保留本地兜底结果
- 测试门禁：Node 内置测试覆盖生成器、工作区归一化、导出、投流指标；Playwright E2E 覆盖落地页、登录、项目草稿、邀请发件箱和公开 API 鉴权
- 开发服务器和生产服务器共用同一套 API 内核

## 模板类型

当前内置 60 个热门短剧模板：

```text
豪门/CEO：5 个
婚恋甜虐：6 个
复仇逆袭：5 个
身份继承：4 个
家庭伦理：3 个
超自然狼人：4 个
黑帮危险恋人：2 个
职场现实：1 个
重生穿越：5 个
神医玄学：4 个
校园青春：3 个
萌宝亲情：3 个
法律悬疑：3 个
直播网红：2 个
职业竞技：3 个
阶层逆袭：3 个
熟龄情感：2 个
古装权谋：2 个
```

模板字段包括：

```text
id
name
type
category
heatRank
heatScore
tags
premise
lead
rival
hook
beat
defaultParams
```

## API

```text
GET  /api/health
GET  /api/auth/session
POST /api/auth/login
POST /api/auth/register
POST /api/auth/invite/accept
POST /api/auth/password-reset/request
POST /api/auth/password-reset/confirm
POST /api/auth/logout
PATCH /api/account/password
GET  /api/workspace
PUT  /api/workspace
GET  /api/projects
POST /api/projects
GET  /api/projects/:id
PATCH /api/projects/:id
DELETE /api/projects/:id
GET  /api/ai-logs
GET  /api/audit-logs
GET  /api/notifications/outbox
PATCH /api/notifications/outbox/:id
POST /api/notifications/outbox/:id/deliver
GET  /api/analytics/summary
POST /api/analytics/event
GET  /api/team/invites
POST /api/team/invites
PATCH /api/team/members/:id
DELETE /api/team/members/:id
GET  /api/api-tokens
POST /api/api-tokens
DELETE /api/api-tokens/:id
GET  /api/templates/insights
GET  /api/trends/summary
GET  /api/trends/snapshots
POST /api/trends/snapshots
GET  /api/storage/migration-plan
GET  /api/storage/postgres-export
POST /api/generate-script
POST /api/generate-video-sample
POST /api/real-video/tasks
GET  /api/real-video/tasks/:id
GET  /api/public/openapi.json
GET  /api/public/health
GET  /api/public/projects
GET  /api/public/projects/:id/export
POST /api/public/projects/:id/campaign-results
```

公开交付 API 支持两种鉴权方式：

```text
Authorization: Bearer <DJCYTOOLS_PUBLIC_API_TOKEN>
X-DJCYTOOLS-API-KEY: <DJCYTOOLS_PUBLIC_API_TOKEN>
```

通知 Webhook 会以 `POST application/json` 发送 `djcytools.notification` 事件，正文包含通知主题、收件人、Token 文本和目标对象。配置 `DJCYTOOLS_NOTIFICATION_WEBHOOK_SECRET` 后，请校验请求头 `X-DJCYTools-Signature: sha256=<hmac>`，签名内容为 `<X-DJCYTools-Timestamp>.<raw body>`。

运行期数据写入：

```text
data/djcytools.sqlite
data/workspace.json      旧数据迁移来源，不再作为主存储
data/ai-logs.json        旧数据迁移来源，不再作为主存储
data/analytics.json      旧数据迁移来源，不再作为主存储
```

这些文件默认被 `.gitignore` 忽略。

埋点只区分 `landing` 和 `workbench` 两类页面。前端生成匿名访客 ID，服务端只保存哈希后的访客标识、页面类型和访问时间，不保存 DeepSeek、Doubao / 火山方舟 Key、IP 或原始访客 ID。

工作区备份文件包含项目、版本、评论、团队成员和自定义模板，可通过工作台右侧「运行状态」面板导入恢复。

## 主要文件

```text
src/LandingPage.jsx          落地页
src/App.jsx                  工作台主应用
src/components/workbench/    工作台面板组件
src/data/templates.js        60 个模板和市场配置
src/data/trends.js           趋势和模板信号
src/lib/generator.js         本地生成、评分、分镜、合规、相似度、互动体验工具
src/lib/deepseekClient.js    前端调用 DeepSeek 代理
src/lib/videoSampleClient.js 前端调用 Doubao-Seed-2.0 视频样片代理
src/lib/workspaceApi.js      前端工作区、项目 CRUD、团队安全、趋势、AI 日志和埋点 API
server/apiCore.mjs           共享 API 内核
server/database.mjs          SQLite schema、迁移、会话、邀请、密码重置、审计和权限
server.mjs                   生产服务器
vite.config.js               开发服务器与 API 插件
```

## 验证命令

```bash
npm run test
npm run test:e2e
npm run build
npm run check
```

首次运行浏览器测试时如本机没有 Playwright 浏览器，请先执行：

```bash
npx playwright install chromium
```

常用健康检查：

```bash
curl http://127.0.0.1:4173/api/health
curl http://127.0.0.1:4173/api/auth/session
curl -c cookies.txt -H "Content-Type: application/json" -d "{\"email\":\"admin@djcytools.local\",\"password\":\"DJCYTools@2026\"}" http://127.0.0.1:4173/api/auth/login
curl -c cookies.txt -H "Content-Type: application/json" -d "{\"email\":\"new@djcytools.local\",\"password\":\"DJCYTools@2026\",\"name\":\"新用户\",\"teamName\":\"新团队\"}" http://127.0.0.1:4173/api/auth/register
curl -b cookies.txt http://127.0.0.1:4173/api/workspace
curl -b cookies.txt http://127.0.0.1:4173/api/ai-logs
curl -b cookies.txt http://127.0.0.1:4173/api/audit-logs
curl -b cookies.txt http://127.0.0.1:4173/api/trends/summary
curl -b cookies.txt http://127.0.0.1:4173/api/analytics/summary
curl -b cookies.txt http://127.0.0.1:4173/api/storage/postgres-export
curl http://127.0.0.1:4173/api/public/openapi.json
curl -H "X-DJCYTOOLS-API-KEY: change-me-for-third-party-workflows" http://127.0.0.1:4173/api/public/health
curl -H "X-DJCYTOOLS-API-KEY: change-me-for-third-party-workflows" http://127.0.0.1:4173/api/public/projects
curl -X POST -H "Content-Type: application/json" -H "X-DJCYTOOLS-API-KEY: change-me-for-third-party-workflows" -d "{\"channel\":\"Meta Ads\",\"spend\":120,\"impressions\":18000,\"clicks\":720,\"completions\":3200,\"conversions\":24,\"revenue\":360}" http://127.0.0.1:4173/api/public/projects/<project-id>/campaign-results
```

## 生产化建议

- 按团队实际工具补充 SMTP 或企业 IM 原生机器人适配；当前已支持通用 Webhook 投递
- 接入真实平台榜单、广告素材库或 BI，把静态趋势和团队投流回流合并成每日更新数据源
- 多实例正式上线时按工作台迁移预案切换 PostgreSQL，并补充云端备份和恢复流程
- 合规审核接入人工复核或专业内容安全服务，当前规则适合 MVP 预筛
