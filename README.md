# DJCYTools AI 短剧叙事工厂

DJCYTools 是一个面向一人公司的本地全栈短视频生成工作台。它把 DeepSeek 剧本生成、120 个短剧模板、结构化剧本编辑、Doubao Seedance 2.0 真实视频生成、首页视频轮播、SQLite 持久化和 PostgreSQL 迁移脚本放在同一条生产线上。

![DJCYTools 工作台](image/README/1777768684633.png)

![DJCYTools 首页视频轮播](image/README/1777768712335.png)

## 当前入口

开发环境：

```text
http://127.0.0.1:5173/
http://127.0.0.1:5173/#workbench
```

生产环境：

```text
http://127.0.0.1:4173/
http://127.0.0.1:4173/#workbench
```

## 启动方式

```bash
npm install
npm run dev
```

生产构建：

```bash
npm run build
npm start
```

## 环境变量

复制 `.env.example` 为 `.env`，至少填写 DeepSeek 和火山方舟 Key：

```text
# 剧本生成：DeepSeek
DJCYTOOLS_SCRIPT_API_KEY=your_deepseek_api_key
DJCYTOOLS_SCRIPT_PROVIDER=DeepSeek
DJCYTOOLS_SCRIPT_BASE_URL=https://api.deepseek.com
DJCYTOOLS_SCRIPT_MODEL=deepseek-chat
DJCYTOOLS_SCRIPT_TIMEOUT_MS=70000

# 真实视频生成：火山方舟 / Doubao Seedance 2.0
DJCYTOOLS_REAL_VIDEO_API_KEY=your_volcengine_ark_api_key
DJCYTOOLS_REAL_VIDEO_PROVIDER=Doubao-Seedance-2.0
DJCYTOOLS_REAL_VIDEO_ENDPOINT=https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks
DJCYTOOLS_REAL_VIDEO_MODEL=doubao-seedance-2-0-260128
DJCYTOOLS_REAL_VIDEO_TIMEOUT_MS=90000

# 可选镜头包接口：保留 legacy，不作为真实视频结果
DJCYTOOLS_VIDEO_API_KEY=your_volcengine_ark_api_key
DJCYTOOLS_VIDEO_PROVIDER=Doubao-Seed-2.0
DJCYTOOLS_VIDEO_ENDPOINT=https://ark.cn-beijing.volces.com/api/v3/responses
DJCYTOOLS_VIDEO_MODEL=doubao-seed-2-0-mini-260215
DJCYTOOLS_VIDEO_TIMEOUT_MS=90000

# 本地账号和服务
DJCYTOOLS_ADMIN_EMAIL=admin@djcytools.local
DJCYTOOLS_ADMIN_PASSWORD=DJCYTools@2026
DJCYTOOLS_ADMIN_NAME=DJCYTools 管理员
DJCYTOOLS_TEAM_NAME=DJCYTools
DJCYTOOLS_APP_URL=http://127.0.0.1:4173

# 可选：PostgreSQL 迁移目标
DJCYTOOLS_DATABASE_URL=postgresql://user:pass@host:5432/djcytools
DJCYTOOLS_DATABASE_SSL=false
```

`.env` 已被 `.gitignore` 忽略。DeepSeek 和火山方舟 API Key 只在服务端代理使用，不会打进前端 bundle。如果真实 Key 曾经出现在聊天、截图或公开文档中，请到平台控制台轮换后再写回本地 `.env`。

## 已实现能力

- 首页：按 Landing Page Guide V2 的方向收紧首屏，使用真实视频轮播承接已生成视频。
- 工作台：核心界面聚焦项目、结构化剧本、分镜建议、真实视频和导出。
- DeepSeek 剧本生成：输出中文结构化 JSON，包括剧名、人设、卖点、大纲、前 3 集脚本和核心对白。
- DeepSeek 定向改写：支持提高冲突、强化投流钩子、降低狗血度和本地化表达。
- Doubao Seedance 2.0 真实视频：通过 `/api/real-video/tasks` 创建火山方舟视频任务，工作台轮询状态，成功后保存并播放真实视频。
- 测试阶段真实视频固定 15 秒，符合 seedance 2.0 单次生成上限；不再使用本地模拟预览冒充成片。
- 已生成视频会同步到 `data/generated-videos/`，并在首页轮播展示。
- 结构化剧本和分镜建议已融合展示，避免重复冗余。
- SQLite 本地持久化：账号、项目、版本、真实视频任务、AI 调用日志等数据落库。
- PostgreSQL 迁移：提供 `npm run migrate:postgres`，正式多实例部署时可从 SQLite 迁移。
- 导出：保留 TXT / PDF / DOC / JSON，方便拿到文件继续剪辑或归档。
- 120 个热门短剧模板，按类型和热度排序。

不作为当前产品重点展示的方向：团队协作、第三方交付接口、版本实验、评分增长、合规相似度、社区模板市场和本地模拟视频。

## 模板类型

当前内置 120 个热门短剧模板：

```text
豪门/CEO：9 个
婚恋甜虐：10 个
复仇逆袭：9 个
身份继承：7 个
家庭伦理：6 个
超自然狼人：7 个
黑帮危险恋人：5 个
职场现实：5 个
重生穿越：9 个
神医玄学：7 个
校园青春：6 个
萌宝亲情：6 个
法律悬疑：6 个
直播网红：5 个
职业竞技：6 个
阶层逆袭：6 个
熟龄情感：5 个
古装权谋：6 个
```

模板字段：

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

## 常用 API

```text
GET  /api/health
GET  /api/auth/session
POST /api/auth/login
POST /api/auth/register
POST /api/auth/logout
GET  /api/workspace
PUT  /api/workspace
GET  /api/projects
POST /api/projects
GET  /api/projects/:id
PATCH /api/projects/:id
DELETE /api/projects/:id
POST /api/generate-script
POST /api/real-video/tasks
GET  /api/real-video/tasks/:id
GET  /api/showcase/generated-videos
GET  /api/storage/migration-plan
GET  /api/storage/postgres-export
```

## 运行期数据

```text
data/djcytools.sqlite       SQLite 主库，默认忽略
data/generated-videos/      真实视频落盘目录，默认忽略
data/workspace.json         旧数据迁移来源，不再作为主存储
data/ai-logs.json           旧数据迁移来源，不再作为主存储
data/analytics.json         旧数据迁移来源，不再作为主存储
```

## 主要文件

```text
src/LandingPage.jsx          首页和真实视频轮播
src/App.jsx                  工作台主应用
src/components/workbench/    工作台面板组件
src/data/templates.js        120 个模板和市场配置
src/lib/generator.js         本地兜底生成、结构化剧本、分镜建议
src/lib/deepseekClient.js    前端调用 DeepSeek 代理
src/lib/realVideoClient.js   前端调用 Seedance 真实视频任务 API
server/apiCore.mjs           共享 API 内核
server/database.mjs          SQLite schema、迁移、会话和审计
scripts/migrate-sqlite-to-postgres.mjs  SQLite 到 PostgreSQL 迁移脚本
```

## 验证命令

```bash
npm run test
npm run build
E2E_PORT=5199 npm run test:e2e
```

Windows PowerShell 可写成：

```powershell
$env:E2E_PORT="5199"; npm run test:e2e
```

首次运行浏览器测试时如本机没有 Playwright 浏览器，请先执行：

```bash
npx playwright install chromium
```

## PostgreSQL 迁移

正式部署前准备 PostgreSQL 数据库，并在 `.env` 写入：

```bash
DJCYTOOLS_DATABASE_URL=postgresql://user:pass@host:5432/djcytools
DJCYTOOLS_DATABASE_SSL=false
```

执行迁移：

```bash
npm run migrate:postgres
```

只生成 SQL 文件做校验：

```bash
npm run migrate:postgres -- --dry-run
```

## 真实视频排障

- 如果返回 `SetLimitExceeded`，说明火山方舟账号的 seedance 2.0 推理限制或安全体验模式暂停了模型，需要在模型开通页调高或关闭安全体验限制。
- 如果任务成功但首页没有视频，先刷新工作台真实视频面板；后端会把成功任务同步到 `data/generated-videos/`，首页读取 `/api/showcase/generated-videos`。
- 如果提示内容不按剧本生成，优先检查当前剧本版本是否已保存、Seedance 提示词是否来自当前分镜，以及 `.env` 中 `DJCYTOOLS_REAL_VIDEO_MODEL` 是否为 `doubao-seedance-2-0-260128`。
