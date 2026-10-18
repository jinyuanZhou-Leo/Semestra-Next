# Semestra-Next 开发手册（给 agent）

Semestra-Next 是 Semestra 的从零重写版（独立仓库）。设计与规格在 `docs/`：先读 [docs/specs/README.md](docs/specs/README.md)（模块索引与 agent 工作约定）和 [M00](docs/specs/M00-工程基础与共享约定.md)，再读自己负责的模块规格。规格与实现不一致时，在同一个 PR 里更新规格。

## 目录

```
apps/api/            FastAPI 后端（uv，Python 3.15）  → src/semestra/{core,modules}
apps/web/            React SPA（Vite + TanStack Router）→ src/{routes,app,modules,ui,components,lib}
packages/api-client/ 由 OpenAPI 生成的客户端，禁止手改 src/generated
deploy/              环境变量示例与部署文件
docs/                设计稿与模块规格
```

## 常用命令（仓库根目录）

| 命令 | 作用 |
|---|---|
| `pnpm install` + `uv sync --project apps/api` | 安装前后端依赖 |
| `pnpm dev` | 同时启动 API（:8000，自动重载）和 Web（:5173） |
| `pnpm lint` / `pnpm format` | oxlint + oxfmt；ruff |
| `pnpm typecheck` | `tsc`（TS 7）；pyright |
| `pnpm test` | vitest；pytest |
| `pnpm gen:api` | 导出 OpenAPI → 重新生成 `packages/api-client`，提交生成结果 |
| `pnpm --filter @semestra/api migrate` | `alembic upgrade head` |
| `pnpm --filter @semestra/web e2e` | Playwright 冒烟（需先 `pnpm exec playwright install chromium`） |

后端也可直接在 `apps/api` 下用 `uv run semestra dev|serve|openapi`、`uv run alembic ...`、`uv run pytest`。

## 硬性约定摘要（完整版见 M00）

- 后端不返回面向用户的文案，只返回 `{error:{code,params,request_id}}`；前端按 `error_<code>` 翻译。
- 所有用户数据表带 `user_id`；表名 `<module>_<entity>`；模块只写自己前缀的表，读他人数据走对方 service。
- 主键 UUIDv7 字符串；时间一律 UTC aware；派生值（GPA 等）不入库。
- 业务操作用 `@capability` 定义一次，同时得到 REST / Agent tool / MCP tool。
- 前端不手写 fetch 调用业务接口；只用生成客户端。`src/ui/` 只由 shadcn CLI 生成，不手改。
- 用户可见字符串全部走 Paraglide（`messages/en.json` 与 `zh-CN.json` 同步，`pnpm --filter @semestra/web i18n:lint` 检查）。
- 颜色只用 token，不写死颜色值。
- Alembic 保持单一 head；合并前基于最新 head 重新生成迁移。
- 耗时任务在 `@job_handler` 里声明 `stages`（阶段与权重），进度由后端换算；前端只用 `<AiAction>` / `<JobProgress>` 展示，不自己拼阶段权重（M00 3.7、4.7.1）。
- 确认原则：表单提交就是确认，AI 回填表单不加确认框；只有不可撤销且没有其他确认步骤的操作才弹确认（M00 4.8）。AI 界面保持低调，规则见 M06 第 7 节。

## 环境注意事项（M00 搭建时发现）

- **Python 必须是 3.15.0 正式版**。3.15.0a7 与 Cython 构建的扩展（SQLAlchemy 的 `_collections_cy` 等）不兼容，会报 `unknown slot ID 84`。用 `uv python install 3.15`（需要 uv ≥ 0.13）。
- 已验证有 3.15 wheel 的 C 扩展依赖：pydantic-core、cryptography、argon2-cffi-bindings、greenlet、SQLAlchemy 的 Cython 扩展、uvloop、httptools、watchfiles、orjson、pymupdf、sqlite-vec。
- **PyYAML 没有 3.15 wheel**，所以不能用 `uvicorn[standard]`；`pyproject.toml` 里手动列出 httptools、uvloop、watchfiles、websockets、python-dotenv 代替。
- `@hey-api/openapi-ts` 依赖 TypeScript 的 JS API，而 TS 7（原生版）没有它，所以 `packages/api-client` 单独固定 `typescript@6.0.3` 仅供代码生成使用；应用本身用 TS 7。
- 前端依赖精确版本锁定（`pnpm-workspace.yaml` 里 `savePrefix: ''`）。
- 根目录 `oxlint` 不带路径会异常变慢，lint 脚本都显式指定目录。

## 已知坑（别再踩）

- **Python 版本**：见上，a7 不能用；`apps/api/.python-version` 是 `3.15`，uv 会选已安装的最新 3.15.x。装不上时先 `uv self update`。
- **uvicorn**：不要写 `uvicorn[standard]`（会拉 PyYAML，没有 3.15 wheel，会退回源码编译并失败）。
- **OpenAPI 生成器与 TS 7**：`@hey-api/openapi-ts` 在 TS 7 下直接崩（`Cannot read properties of undefined (reading 'AnyKeyword')`）。生成器依赖的 `typescript@6.0.3` 只放在 `packages/api-client`，不要升级或删除；也不要把它引入 `apps/web`。
- **`@hey-api/client-fetch` 包已内置**，不要再单独安装这个依赖，配置里直接写插件名即可。
- **改了后端接口后必须跑 `pnpm gen:api` 并提交生成结果**，否则 CI 的 contract 检查会失败。
- **TanStack Router**：`src/routeTree.gen.ts` 要提交（`typecheck` 依赖它）；Paraglide 产物 `src/paraglide/` 不提交，`typecheck` 与 `test` 脚本会先 `pnpm i18n:compile`。
- **shadcn CLI**：非交互运行必须 `CI=1 pnpm dlx shadcn@latest init ... </dev/null`，否则会无限挂起。它默认把组件放到 `src/components/ui`，本项目约定放 `src/ui`（`components.json` 的 `aliases.ui` 已设为 `@/ui`），新增后检查位置。shadcn 4.x 生成的组件从 `cn` 包导入 `cn`，这是正常的。
- **shadcn 主题预设**：沿用旧 Semestra `4.0` 分支的预设——`components.json` 的 `style` 为 `base-luma`，主色为天蓝色系（`oklch(0.5 0.134 242.749)`，色相约 242），字体 Inter（正文）+ Figtree（标题），`--radius: 0.625rem`；令牌在 `apps/web/src/app/theme.css`。该预设在旧仓库 4.0 分支里是未提交的工作区改动（见 `~/Documents/Develop/Semestra/frontend/components.json` 与 `src/app/index.css`）。换预设后用 `CI=1 pnpm dlx shadcn@latest add <组件> --overwrite --yes </dev/null` 重新生成已有组件，CLI 不会自动改 `theme.css` 的色值，需要手动同步。
- **Vitest 只跑 `src/**/*.test.{ts,tsx}`**（见 `vitest.config.ts`）；`e2e/` 下是 Playwright 用例，被 Vitest 收进去会报错。
- **pnpm**：根 `package.json` 的 `packageManager` 字段会强制 pnpm 版本，升级 pnpm 要同步改它。依赖要精确版本，`pnpm add` 前确认 `pnpm-workspace.yaml` 里 `savePrefix: ''` 还在。
- **Node 通过 nvm 管理**：切换 Node 版本不会带走全局包（`pnpm`、`@openai/codex` 等需要重装）；非交互 shell 的 PATH 可能仍指向旧版本。
- **macOS 没有 `timeout` 命令**；长时间运行的命令用后台任务，不要用 `timeout N cmd`。
- Alembic 的 `env.py` 里要手动 import 各模块的 models，否则 autogenerate 与 `alembic check` 看不到它们；新增模块时记得加。
- **测试里没有后台 worker**（`jobs_autostart=False`）：入队后用 `run_jobs()` fixture 执行；推给用户的 SSE 消息用 `collect_events(app, user_id)` 收集。冻结的 `clock` 也驱动任务退避与租约，测重试要 `clock.advance(...)`。同一阶段内的进度推送有 250ms 节流（按真实单调时钟），要断言每一条进度事件时 `monkeypatch.setattr("semestra.core.jobs.PROGRESS_THROTTLE_SECONDS", 0)`。
- **structlog 的 `event` 是保留参数**：`log.info("x", event=...)` 会抛 TypeError，换个字段名。
- **事件只在提交后派发**：自定义路由（`routes.py`）里 `publish` 之后要 `await ctx.db.commit()` 再 `await run_after_commit(ctx)`；capability 路由自动处理。
- **`@capability`、`@job_handler`、`@periodic`、`@events.subscribe` 在 import 时注册**：模块 `__init__.py` 必须 import 定义它们的文件。
- jsdom 没有 `EventSource`：`test-setup.ts` 装了 `FakeEventSource`（`src/test-event-source.ts`），测试里用 `FakeEventSource.last().emit({type, data})` 模拟推送。

## 已完成的模块

- M00：monorepo、配置、数据库基础（PRAGMA、UUIDv7、UTC 类型、mixin）、统一错误信封、`/healthz` `/readyz`、Alembic、OpenAPI 生成链路、i18n 与 shadcn 骨架、lint/测试工具链；后台任务（`core/jobs.py`，表 `core_jobs`，`@job_handler`/`enqueue`/`@periodic`）、事件总线（`core/events.py`）与 SSE（`core/realtime.py`，`GET /events/stream`）、存储（`core/storage.py`）、密钥加密（`core/security.py`）、安全出站客户端（`core/http.py`）；前端扩展契约 `app/extensions.ts`（`defineModule`）、注册表 `app/registry.ts`、最小宿主 `app/host/`、实时刷新 `app/realtime.ts`、`ThemeProvider`、`useUiPref`、`subjectColor`、`lib/format.ts`、`AsyncBoundary`/`EmptyState`；任务阶段（`stages`、`ctx.stage`、事件 `core.job.progress`）、状态条扩展点 `statusItems`、`AiAction`/`JobProgress`/`useJob`/`useSmoothedProgress`。
  新模块从模板开始：`apps/api/src/semestra/modules/_template`、`apps/web/src/modules/_template`（不注册进应用，复制后改名，再加到 `modules/__init__.py` 的 `register_all` 和 `app/registry.ts`）。
- M01 认证与账户：`apps/api/src/semestra/modules/auth/`（邮箱验证码、密码、Google、Cookie 会话 + CSRF、原生 JWT/refresh、PAT、DB 持久化限流）与 `apps/web/src/modules/auth/`（登录流程、会话过期对话框、`/settings/account` 各分区）。同时落地了 M00 缺的最小 Capability 注册表（`core/capability.py`，生成 REST 路由与 operationId）和邮件渲染（`core/i18n.py`）。
  新模块的受保护路由放在 `routes/_authed.*`；API 调用统一走 `src/app/api.ts`（自动带 CSRF 头、401 时触发会话过期对话框）。
  本地开发注意：① 沙箱里 Paraglide 的 inlang 插件 CDN 拉不到时，把 `apps/web/project.inlang/settings.json` 临时指向本地副本，且不要提交；② `src/ui/` 里 M01 新增的组件是手写的（shadcn registry 不可达），见 M01 规格第 12 节。
- M15（部署与运维）：`deploy/docker/Dockerfile`（目标 `api` / `api-office` / `allinone`，上下文是仓库根）、`deploy/hosted/`（GCP VM：Caddy + Litestream + `deploy.sh` 自动回滚）、`deploy/selfhost/`（一条命令的 compose，中英 README）、`apps/web/vercel.json`、`core/webapp.py`（`SEMESTRA_SERVE_WEB` 同源托管 SPA）、`core/backup.py` 与 `semestra backup`、可选 Sentry。总览与首次上线要手动做的事见 [deploy/README.md](deploy/README.md)。
  **尚未实现**：`/metrics`、每周 `VACUUM`（M00 的 `@periodic` 已可用，上线前需评估与 Litestream 的配合）。
  给其它模块的约定：持久数据只写 `/data`；后端 GET 路径不要与前端路由同名（同源托管时 API 优先）；系统库加在 Dockerfile 的 `api` 目标；新增环境变量同步 `deploy/.env.example`；Docker 里的 pnpm 版本（`PNPM_VERSION`）要与根 `package.json` 的 `packageManager` 一致。
