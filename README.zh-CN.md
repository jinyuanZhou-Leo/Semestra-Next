<div align="center">

# Semestra

**把整个学业放在一处：课程、成绩、课表、待办，还有一个什么都知道的 AI 助手。**

[English](README.md) · [快速开始](#快速开始) · [自部署](deploy/selfhost/README.md) · [文档](docs/specs/README.md)

![FastAPI](https://img.shields.io/badge/FastAPI-Python_3.15-009688?logo=fastapi&logoColor=white)
![React](https://img.shields.io/badge/React_19-TanStack_Router-61DAFB?logo=react&logoColor=black)
![SQLite](https://img.shields.io/badge/SQLite-Alembic-003B57?logo=sqlite&logoColor=white)
![shadcn/ui](https://img.shields.io/badge/shadcn%2Fui-Base_UI-000000?logo=shadcnui&logoColor=white)
![i18n](https://img.shields.io/badge/i18n-English_%7C_简体中文-blue)

<br />

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/grades-zh-dark.webp" />
  <img alt="Semestra 的课程成绩簿：考核列表、分类平均分、当前成绩，以及达到目标 GPA 所需的分数" src="docs/assets/screenshots/grades-zh-light.webp" />
</picture>

</div>

## Semestra 是什么？

Semestra 是给大学生用的学期规划工具。建好 Program，加上学期和课程，其余的都会自动连起来：成绩簿算出当前成绩和期末需要考多少，日历知道你的讲座、实验和考试，截止日期变成待办，内置助手 **Sem** 可以用自然语言查看和修改这一切。

这个仓库是 [Semestra](https://github.com/jinyuanZhou-Leo/Semestra) 的从零重写版。每个功能都是一个声明了类型化 capability 的模块，所以同一个操作在界面里、在助手里、在插件里、通过 MCP 都能用。

## 功能

### 成绩与 GPA

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/academics-zh-dark.webp" />
  <img alt="学期与课程页：已结束学期的课程、学分、最终成绩与 GPA" src="docs/assets/screenshots/academics-zh-light.webp" />
</picture>

- **每门课一个成绩簿**：加权分类、可标记不计入的考核、按分数或百分比录入，当前成绩实时计算。
- **预测与规划模式**：设定目标，看剩下的考核平均需要多少分；或者试填"假设"分数，不影响真实成绩。
- **学期与累计 GPA**：内置换算表（默认多伦多大学 4.0，另有美国 4.33、标准 4.0、澳洲 7 分制、韩国 4.5），也可以自定义。
- **全年课**：跨多个学期，但只有一个最终成绩。

### 课表与日历

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/schedule-zh-dark.webp" />
  <img alt="学期日历周视图：讲座、辅导、实验、截止日期与事件" src="docs/assets/screenshots/schedule-zh-light.webp" />
</picture>

- **按教学班管理上课时间**（讲座、辅导、实验），带教室、起止周和单次停课。
- **一个日历看全部**：上课、考核截止、待办到期、事件和 LMS 日历，支持周、月、列表和课表视图。
- **冲突提醒**：上课时间重叠时会提示；支持 **ICS 导出和订阅链接**，可以同步到手机日历。

### 今天与待办

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/today-zh-dark.webp" />
  <img alt="今天页：今天的课程与当前时间线、本周到期、今天的待办" src="docs/assets/screenshots/today-zh-light.webp" />
</picture>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/tasks-zh-dark.webp" />
  <img alt="待办列表：优先级、标记、截止日期与课程标签" src="docs/assets/screenshots/tasks-zh-light.webp" />
</picture>

- **今天页**：下一节课、本周到期和今天的待办。
- **待办支持列表、智能列表和快速添加**：输入 `Fri lab report !!!`，日期和优先级会自动识别。待办可以归属课程，考核也能自动生成待办（在设置里开启）。
- **页面自己排**：Program、学期和课程的页面都是卡片看板，可以排序、调整大小，还能用插件扩展。

### Sem：AI 助手

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/assistant-zh-dark.webp" />
  <img alt="Sem 回答学生某门课的现状以及期中需要考多少分" src="docs/assets/screenshots/assistant-zh-light.webp" />
</picture>

- **问账户里的任何事**，比如"期中要考多少分？"、"把 ECE243 的实验挪到周五"。Sem 用的是和应用相同的 capability，默认在修改数据前先给出确认卡片。
- **使用你自己的 API 密钥**：支持 Anthropic、OpenAI、Google Gemini、Ollama，以及任何兼容 OpenAI 或 Anthropic 接口的服务商，按模型统计用量和费用。
- **智能导入**：拖入 syllabus、课表或 ICS 文件，先审核抽取出的课程、上课时间和考核，再保存。
- **记忆、技能和临时对话**，还有 `/mcp` 上的 **MCP 服务端**，外部客户端可以用 API 令牌调用同样的工具。

### 插件与集成

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/plugins-zh-dark.webp" />
  <img alt="设置中的插件目录：习惯打卡、番茄钟、便签、计数器、世界时钟和 Canvas 标签页" src="docs/assets/screenshots/plugins-zh-light.webp" />
</picture>

- **Canvas LMS**：关联 Canvas 课程后可以导入作业、叠加它的日历，并在 Canvas 标签页里浏览公告、成绩、单元、页面和测验。
- **官方插件**，按账户安装：习惯打卡、番茄钟、便签、计数器和世界时钟。写插件见[插件开发指南](apps/docs/content/docs/plugins.zh.mdx)。
- **设置逐级继承**：账户 → Program → 学期 → 课程；亮色与暗色主题；完整的中英文界面。
- **数据归你所有**：一键导出为一个归档，导入到另一个实例，或者删除账户。

## 技术栈

| 层 | 选型 |
|---|---|
| 后端 | FastAPI、SQLAlchemy 2、Alembic、SQLite（FTS5 与 sqlite-vec），Python 3.15（uv） |
| AI | 基于官方 SDK 的 Pydantic AI agent 循环，出站请求走防 SSRF 的 HTTP 客户端 |
| 前端 | React 19、TypeScript 7、Vite 8、TanStack Router（SPA）、TanStack Query / Table / Form、React Compiler |
| UI | shadcn/ui（Base UI）、Tailwind CSS 4、AI Elements、FullCalendar |
| 国际化 | Paraglide JS（`en`、`zh-CN`） |
| API 客户端 | 用 `@hey-api/openapi-ts` 从 OpenAPI 生成 |
| 工具链 | pnpm workspaces、oxlint 与 oxfmt、ruff、pyright、Vitest、pytest、Playwright |
| 部署 | Docker；自部署 compose，或 Vercel（前端）+ GCP VM 上的 Caddy 与 Litestream（API） |

## 快速开始

需要 [uv](https://docs.astral.sh/uv/) 0.13+、Node 26+、pnpm 12+。

```bash
git clone https://github.com/jinyuanZhou-Leo/Semestra-Next.git
cd Semestra-Next

uv python install 3.15
pnpm install
uv sync --project apps/api
pnpm --filter @semestra/api migrate

pnpm dev        # API http://localhost:8000，Web http://localhost:5173
```

打开 <http://localhost:5173>，用任意邮箱登录。开发环境不会真的发邮件：验证码会打印在 API 日志里，并写入 `apps/api/data/dev-outbox.jsonl`。

要和 Sem 对话，打开 **设置 → AI → 服务商**，添加一个 API 密钥，或者指向本地的 Ollama。默认会拦截发往 localhost 和内网地址的请求，所以用本地 Ollama 时要在 `apps/api/.env` 里加上 `SEMESTRA_ALLOW_PRIVATE_EGRESS=true`，再重启 `pnpm dev`。

### 常用命令

| 命令 | 作用 |
|---|---|
| `pnpm dev` | 同时启动 API（自动重载）和 Web |
| `pnpm lint` / `pnpm format` | Web 跑 oxlint、oxfmt、文案检查和 React Compiler 检查；API 跑 ruff |
| `pnpm typecheck` | `tsc` 与 pyright |
| `pnpm test` | Vitest 与 pytest |
| `pnpm gen:api` | 导出 OpenAPI 并重新生成 `packages/api-client` |
| `pnpm --filter @semestra/web e2e` | Playwright 冒烟测试（第一次先运行 `pnpm --filter @semestra/web exec playwright install chromium`） |

## 自部署

一个容器同时提供 API 和网页：

```bash
cd Semestra-Next/deploy/selfhost
cp .env.example .env    # 可选
docker compose up -d    # 然后打开 http://localhost:8000
```

镜像目前还没公开：需要先登录 `ghcr.io` 或在本地构建，见 [deploy/selfhost/README.md](deploy/selfhost/README.md)。

邮件、密钥、备份与升级见 [deploy/selfhost/README.md](deploy/selfhost/README.md)，全部环境变量的说明在 [deploy/.env.example](deploy/.env.example)。托管版（Vercel 与 GCP）见 [deploy/README.md](deploy/README.md)。

## 目录结构

```
apps/
  api/                 FastAPI 后端：src/semestra/{core, modules/*}
  web/                 React SPA：src/{routes, app, modules/*, ui, components, lib}
  docs/                文档站（Fumadocs，静态导出）：自部署、AI、MCP、LMS、API
packages/
  api-client/          由 OpenAPI 生成的 TypeScript 客户端（不要手改 src/generated）
deploy/                Dockerfile、自部署 compose、托管版（GCP + Vercel）脚本
docs/
  specs/               每个模块一份设计规格，M00 到 M16
```

大多数功能在前后端各是一个模块：`academics`、`grading`、`schedule`、`tasks`、`files`、`imports`、`lms`、`ai`、`plugins`、`settings`、`portability` 等（助手在后端叫 `agent`，在前端叫 `assistant`）。后端模块声明 **capability**，一份定义默认同时生成 REST 路由、助手工具和 MCP 工具；前端模块通过 `defineModule` 注册自己的页面、卡片和设置。

## 路线图

- **自部署单用户模式**（规划中）：设置 `SEMESTRA_SINGLE_USER=true` 后，第一个访问者用邮箱和密码创建管理员账户，之后关闭注册。这个变量已经在 `deploy/.env.example` 里预留，但目前还不起作用。

## 文档

- [模块规格](docs/specs/README.md)：每个模块的设计与实现说明
- [CLAUDE.md](CLAUDE.md)：开发约定与已知的坑
- [文档站](apps/docs)（`pnpm docs:dev`）：自部署、AI 服务商、MCP、Canvas、API 参考与[插件开发指南](apps/docs/content/docs/plugins.zh.mdx)
- [部署](deploy/README.md)与[上线安全清单](deploy/SECURITY-CHECKLIST.md)
