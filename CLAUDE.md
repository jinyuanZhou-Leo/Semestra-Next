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

后端也可直接在 `apps/api` 下用 `uv run semestra dev|serve|openapi`、`uv run alembic ...`、`uv run pytest`（加 `-n auto` 并行，CI 也这样跑，测试之间不能共享文件或全局状态）。

**草稿 PR 不跑 CI（为节省 Actions 额度）**：开 PR 时先建成草稿，迭代期间每次推送前在本地跑相关检查（`pnpm --filter @semestra/web lint`/`typecheck`/`test`，`apps/api` 下 `uv run ruff check . && uv run pyright && uv run pytest -n auto`，改了接口再 `pnpm gen:api`）；自认为完成后把 PR 标成“准备好评审”（ready for review），这时才跑一轮 CI 作为合并门槛。标成就绪后的每次推送都会再跑 CI，所以修改尽量攒到一次推送。CI 按改动路径只跑相关 job（只改前端就不跑 api），同一 PR 的新推送会取消旧运行；`Deploy check` 只在 `deploy/**` 等部署文件变化时运行，`E2E` 只能在 Actions 页手动触发。PR 上的测试只跑受影响的部分（`.github/scripts/affected_tests.py`，推到 main 时跑全量兜底）：后端改了 `modules/<m>/` 就跑 `<m>` 和直接引用它的模块（import 或事件/capability 名字符串）的测试，外加 `apps/api/tests/`，改到 core、迁移、依赖或 `testing.py` 跑全量；前端把改动的 `src/` 文件和用到改动文案 key 的文件交给 `vitest related`，改配置、依赖、`packages/` 或测试 setup 跑全量。本地可用 `python3 .github/scripts/affected_tests.py web --base origin/main` 看会选哪些（后端那侧要在 `apps/api` 下用 `uv run python` 跑）。

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

- **拉了新提交后 `pnpm dev` 报 `no such table: core_jobs` 等**：本地 SQLite 没迁移到最新 head（新模块带来新迁移）。`semestra dev` 现在启动前会自动 `alembic upgrade head`（`--no-migrate` 可跳过）；单独起服务或用 `serve` 时需手动 `pnpm --filter @semestra/api migrate`。
- **Python 版本**：见上，a7 不能用；`apps/api/.python-version` 是 `3.15`，uv 会选已安装的最新 3.15.x。装不上时先 `uv self update`。
- **uvicorn**：不要写 `uvicorn[standard]`（会拉 PyYAML，没有 3.15 wheel，会退回源码编译并失败）。
- **OpenAPI 生成器与 TS 7**：`@hey-api/openapi-ts` 在 TS 7 下直接崩（`Cannot read properties of undefined (reading 'AnyKeyword')`）。生成器依赖的 `typescript@6.0.3` 只放在 `packages/api-client`，不要升级或删除；也不要把它引入 `apps/web`。
- **`@hey-api/client-fetch` 包已内置**，不要再单独安装这个依赖，配置里直接写插件名即可。
- **改了后端接口后必须跑 `pnpm gen:api` 并提交生成结果**，否则 CI 的 contract 检查会失败。
- **TanStack Router**：`src/routeTree.gen.ts` 要提交（`typecheck` 依赖它）；Paraglide 产物 `src/paraglide/` 不提交，`typecheck` 与 `test` 脚本会先 `pnpm i18n:compile`。
- **shadcn CLI**：非交互运行必须 `CI=1 pnpm dlx shadcn@latest init ... </dev/null`，否则会无限挂起。它默认把组件放到 `src/components/ui`，本项目约定放 `src/ui`（`components.json` 的 `aliases.ui` 已设为 `@/ui`），新增后检查位置。shadcn 4.x 生成的组件从 `cn` 包导入 `cn`，这是正常的。`src/ui/` 已用 `add --all` 装好全部官方组件（field、native-select、spinner、empty、item、sidebar 等）。CLI 同时生成的 `src/hooks/use-mobile.ts`、`src/hooks/use-highlighted-code.ts`、`src/lib/highlighter.tsx` 也视为生成文件。
- **shadcn 主题预设**：沿用旧 Semestra `4.0` 分支的预设——`components.json` 的 `style` 为 `base-luma`，主色为天蓝色系（`oklch(0.5 0.134 242.749)`，色相约 242），字体 Inter（正文）+ Figtree（标题），`--radius: 0.625rem`；令牌在 `apps/web/src/app/theme.css`。该预设在旧仓库 4.0 分支里是未提交的工作区改动（见 `~/Documents/Develop/Semestra/frontend/components.json` 与 `src/app/index.css`）。换预设后用 `CI=1 pnpm dlx shadcn@latest add <组件> --overwrite --yes </dev/null` 重新生成已有组件，CLI 不会自动改 `theme.css` 的色值，需要手动同步。
- **Vitest 只跑 `src/**/*.test.{ts,tsx}`**（见 `vitest.config.ts`）；`e2e/` 下是 Playwright 用例，被 Vitest 收进去会报错。
- **pnpm**：根 `package.json` 的 `packageManager` 字段会强制 pnpm 版本，升级 pnpm 要同步改它。依赖要精确版本，`pnpm add` 前确认 `pnpm-workspace.yaml` 里 `savePrefix: ''` 还在。
- **Node 通过 nvm 管理**：切换 Node 版本不会带走全局包（`pnpm`、`@openai/codex` 等需要重装）；非交互 shell 的 PATH 可能仍指向旧版本。
- **macOS 没有 `timeout` 命令**；长时间运行的命令用后台任务，不要用 `timeout N cmd`。
- Alembic 的 `env.py` 里要手动 import 各模块的 models，否则 autogenerate 与 `alembic check` 看不到它们；新增模块时记得加。
- **测试里没有后台 worker**（`jobs_autostart=False`）：入队后用 `run_jobs()` fixture 执行；推给用户的 SSE 消息用 `collect_events(app, user_id)` 收集。冻结的 `clock` 也驱动任务退避与租约，测重试要 `clock.advance(...)`。同一阶段内的进度推送有 250ms 节流（按真实单调时钟），要断言每一条进度事件时 `monkeypatch.setattr("semestra.core.jobs.PROGRESS_THROTTLE_SECONDS", 0)`。
- **设置项不要自己造页面**：模块配置用 `register_settings(namespace=…, schema=Pydantic 模型, levels=…)` 声明，前端在 manifest 的 `settingsSections` 里写 `{ namespace }` 即可自动生成表单；文案写进 `messages/*.json`（`settings_<namespace，点和横线换成下划线>_<字段>_label|_description|_option_<取值>`，两种语言都要，后端测试会检查）。账户偏好不属于任何模块，只在 `settings_preferences`。
- **设置分区的外观走 `app/settings/rows.tsx`**：`SettingsGroup`（圆角列表，自动分隔线）+ `SettingRow` / `TextRow` / `NumberRow` / `ActionRow` / `SettingsBlock` / `SettingsNote`，不要在分区里用 `Card`、手写 `ItemGroup` + `ItemSeparator`；条件渲染多行用数组，别用 Fragment；删除类操作放该组最后一个 `danger: true` 的分区（M11 §5.6）。
- **多选一设置用 `ChoiceControl`（`app/settings/choice.tsx`）**：≤4 个短选项且都不需要解释时是分段控件（浅灰轨道 + 选中项白底凸起），有选项需要一句解释（`hint`）或超过 4 个时是下拉，选项里两行（名称 + 说明）。自动生成表单的选项说明写 `settings_<ns>_<字段>_option_<值>_description`。不要在设置行里直接用 `ToggleGroup`/`Select` 做多选一；设置以外的分段切换（如日历视图）给 `ToggleGroup` 加 `lib/segmented.ts` 的 `SEGMENTED`/`SEGMENT` 类。
- **界面状态与设置不是一回事**：排序、折叠等记忆状态用 `useUiPref('<模块>.<名称>', 默认值)`，不要放进设置，也不要直接用 localStorage（除了首屏防闪烁必须的主题/强调色/语言）。
- **`src/ui/` 禁止手改，冲突一律取 CLI 官方版本**：合并时 `src/ui/` 下出现冲突（包括两边各自新增同名组件的 add/add），不要手动合并两边的内容，而是在 `apps/web` 运行 `CI=1 pnpm dlx shadcn@latest add <组件> --overwrite --yes </dev/null` 重新生成并以生成结果为准；也不要为了让某个分支编译通过去改 `src/ui/`，改调用方。合并后可在 `apps/web` 跑一次 `add --all --overwrite`，`git status` 应该没有变化。
- **UI 尽量直接用 shadcn 官方组件，不要做薄封装**：页面和模块里直接组合 `@/ui/*`（表单字段 `Field` + `Input` + `FieldError`，空状态 `Empty`，列表行 `Item`，2–5 个选项 `ToggleGroup`，单选卡片 `FieldLabel` > `Field` > `RadioGroupItem`，进度 `Progress`，加载 `Spinner`，表格 `Table`），不要手写同类控件，也不要为了"保持旧接口"或读屏文字这类小问题再包一层（教训：曾为把 `Dialog`/`Sheet` 关闭按钮的英文 sr-only "Close" 换成翻译而写了 `AppDialogContent`/`AppSheetContent`，又给 `Field`、`Empty`、`RadioGroup` 套了 `TextField`、`EmptyState`、`RadioCard` 等，后来全部删掉，并且每次重新生成组件都会让依赖旧接口的分支 typecheck 失败）。生成组件里写死的英文读屏文字可以接受。只有带真实行为（状态、数据加载、业务逻辑）的组件才放 `src/components/`，例如 `ConfirmDialog`、`AsyncBoundary`、`AiAction`。
- **颜色用令牌，不要写死**：强调色通过 `data-accent` 切换 `--accent-hue`，所以组件只用 `bg-primary` 之类的令牌；手写 `oklch(...)`、`sky-500` 会在换强调色后不跟随。
- **语言与时间格式变化会重挂载应用子树**：消息是普通函数，不是响应式的；不要在模块级缓存 `m.xxx()` 的结果，在渲染时调用。
- **React Compiler 已开启，写法要让它能编译**：`pnpm --filter @semestra/web lint` 会跑 `scripts/check-react-compiler.mjs`，任何组件/hook 被编译器跳过都算失败（vite 用的是 `panicThreshold: 'none'`，违规只会悄悄退回未编译代码，所以必须单独检查）。渲染中不读写 `ref.current`、不 `setState`、不修改 props/state 对象；新代码不手写 `useMemo`/`useCallback`（对外暴露的 hook 契约、被外部订阅的稳定引用除外）。编译器 1.0.0 不支持的写法：`try … finally`（把收尾放到 try/catch 之后；catch 里要重新抛出就在抛出前也收尾）、try 里出现 `||`/`??`/`?:`/`?.`/`for…of`（把参数提到 try 之前，或把逻辑放进 `await fn().catch(...)` 的内部函数）、计算属性解构 `{ [k]: _, ...rest }`（用 `lib/omit.ts` 的 `omitKey`）。确实要保留的例外写进脚本顶部的 `allowed` 并写明原因。
- **侧边栏里的东西都走 `SidebarMenu`/`SidebarMenuButton`**：折叠成图标栏的规则（`group-data-[collapsible=icon]:`）只作用于它们，自己写的行折叠时会被压扁；按钮里的文字要 `truncate`（单行裁切），不然过渡那 200ms 里会换行。图标栏里每个入口都要有图标和 `tooltip`；同一入口不要同时放在侧边栏和页面标签里（M02 §5.1）。
- **`@babel/core` 钉在 7.x**：`babel-plugin-react-compiler@1.0.0` 在 Babel 8 的 AST 下会跳过所有带默认值解构参数的组件（`{ a = 1 }`）；`@rolldown/plugin-babel` 同时支持 7 和 8，升级到 8 前先跑 `compiler:check`。
- **effect 里不要同步 `setState`**（oxlint 的 `react/set-state-in-effect` 是错误）：派生值直接在渲染中算，或用“记录上次值，渲染时比较”的写法；订阅外部系统（IntersectionObserver 等）的回调里设置状态没问题。
- **调用模型只走 M06**：不要在别的模块直接用 openai/anthropic/google-genai SDK 或 Pydantic AI。这些 SDK 用 `httpx2`（不是 `httpx`），直接给它们传 `safe_client` 会报错或绕过 SSRF 防护；M06 用 `adapters/bridge.py` 把请求转给 `safe_client`。SDK 的 `api_key=None` 会去读 `OPENAI_API_KEY` 等环境变量，所以 M06 总是显式传 key（没有 key 时传占位值，bridge 去掉鉴权头）。
- **structlog 的 `event` 是保留参数**：`log.info("x", event=...)` 会抛 TypeError，换个字段名。
- **事件只在提交后派发**：自定义路由（`routes.py`）里 `publish` 之后要 `await ctx.db.commit()` 再 `await run_after_commit(ctx)`；capability 路由自动处理。
- **`@capability`、`@job_handler`、`@periodic`、`@events.subscribe` 在 import 时注册**：模块 `__init__.py` 必须 import 定义它们的文件。
- **后台任务在自己的事务里写过库之后不要再 `ctx.stage()`/`ctx.report()`**：进度用单独的短事务写，SQLite 只允许一个写者，会等满 `busy_timeout` 后报 `database is locked`。把最后一次进度报告放在第一次写库之前（M13 导入就是这样）。
- jsdom 没有 `EventSource`：`test-setup.ts` 装了 `FakeEventSource`（`src/test-event-source.ts`），测试里用 `FakeEventSource.last().emit({type, data})` 模拟推送。

## 已完成的模块

- M00：monorepo、配置、数据库基础（PRAGMA、UUIDv7、UTC 类型、mixin）、统一错误信封、`/healthz` `/readyz`、Alembic、OpenAPI 生成链路、i18n 与 shadcn 骨架、lint/测试工具链；后台任务（`core/jobs.py`，表 `core_jobs`，`@job_handler`/`enqueue`/`@periodic`）、事件总线（`core/events.py`）与 SSE（`core/realtime.py`，`GET /events/stream`）、存储（`core/storage.py`）、密钥加密（`core/security.py`）、安全出站客户端（`core/http.py`）；前端扩展契约 `app/extensions.ts`（`defineModule`）、注册表 `app/registry.ts`、最小宿主 `app/host/`、实时刷新 `app/realtime.ts`、`ThemeProvider`、`useUiPref`、`subjectColor`、`lib/format.ts`、`AsyncBoundary`；任务阶段（`stages`、`ctx.stage`、事件 `core.job.progress`）、状态条扩展点 `statusItems`、`AiAction`/`JobProgress`/`useJob`/`useSmoothedProgress`。
  新模块从模板开始：`apps/api/src/semestra/modules/_template`、`apps/web/src/modules/_template`（不注册进应用，复制后改名，再加到 `modules/__init__.py` 的 `register_all` 和 `app/registry.ts`）。
- M01 认证与账户：`apps/api/src/semestra/modules/auth/`（邮箱验证码、密码、Google、Cookie 会话 + CSRF、原生 JWT/refresh、PAT、DB 持久化限流）与 `apps/web/src/modules/auth/`（登录流程、会话过期对话框、`/settings/account` 各分区）。同时落地了 M00 缺的最小 Capability 注册表（`core/capability.py`，生成 REST 路由与 operationId）和邮件渲染（`core/i18n.py`）。
  新模块的受保护路由放在 `routes/_authed.*`；API 调用统一走 `src/app/api.ts`（自动带 CSRF 头、401 时触发会话过期对话框）。
  本地开发注意：① 沙箱里 Paraglide 的 inlang 插件 CDN 拉不到时，把 `apps/web/project.inlang/settings.json` 临时指向本地副本，且不要提交。
- M15（部署与运维）：`deploy/docker/Dockerfile`（目标 `api` / `api-office` / `allinone`，上下文是仓库根）、`deploy/hosted/`（GCP VM：Caddy + Litestream + `deploy.sh` 自动回滚）、`deploy/selfhost/`（一条命令的 compose，中英 README）、`apps/web/vercel.json`、`core/webapp.py`（`SEMESTRA_SERVE_WEB` 同源托管 SPA）、`core/backup.py` 与 `semestra backup`、可选 Sentry。总览与首次上线要手动做的事见 [deploy/README.md](deploy/README.md)。
  **尚未实现**：`/metrics`、每周 `VACUUM`（M00 的 `@periodic` 已可用，上线前需评估与 Litestream 的配合）。
  给其它模块的约定：持久数据只写 `/data`；后端 GET 路径不要与前端路由同名（同源托管时 API 优先）；系统库加在 Dockerfile 的 `api` 目标；新增环境变量同步 `deploy/.env.example`；Docker 里的 pnpm 版本（`PNPM_VERSION`）要与根 `package.json` 的 `packageManager` 一致。
- M11 设置与偏好：后端 `apps/api/src/semestra/modules/settings/`（`settings_preferences`/`settings_values`/`settings_ui_state`；`register_settings`、`set_scope_resolver`；capability `settings.preference.*`、`settings.schema.list`、`settings.value.*`、`settings.ui_state.*`）；前端框架 `apps/web/src/app/settings/`（`SettingsPage`、`SettingsSections`、`PluginSettingsSections`、`NamespaceForm`）、主题 `app/theme.tsx` + `app/appearance.ts` + `public/theme-init.js`、语言 `app/locale.tsx`、偏好同步 `app/preferences.tsx`、`useUiPref`；内置分区在 `modules/settings/`（外观、语言与时间、关于），账户分区由 `modules/auth` 贡献。设置页路由 `/settings/$group`。
  给其它模块的约定：声明配置命名空间而不是自己写设置页；作用域设置页用 `SettingsPage`；M02 要注册 scope resolver 并为级联删除发 `*.deleted` 事件。细节与偏离见 M11 规格第 9 节。
- M02 学业结构与导航：后端 `apps/api/src/semestra/modules/academics/`（表 `academics_programs`/`_terms`/`_courses`/`_course_terms`/`_term_course_order`；纯规则在 `rules.py`：学科代码、颜色、当前学期、周次、模糊匹配；22 个 capability，`academics.course.find` 只给 agent/MCP；注册了 M11 的 scope resolver）。核心新增：事务内事件 `events.publish_in_transaction` + `@events.subscribe(..., in_transaction=True)`（`*.deleting` 用），注册表对 agent/MCP 调用按 `fields` 裁剪输出。前端 `apps/web/src/modules/academics/`：导航外壳（`shell/`：侧边栏/抽屉、面包屑、`Cmd/Ctrl+↑/↓` 切课、界面导览）、概览页与 4 张卡片、学期与课程页（`pages/TermsAndCoursesPage.tsx`：学期 | 课程两个子模块，课程表在 `components/CoursesTable.tsx`，TanStack Table v9）、新学期向导、onboarding、Program/学期/课程设置分区；路由 `routes/_authed.p.$programId.*`、`/onboarding`，`/` 会跳转到 Program 或 onboarding。
  给其它模块的约定：课程颜色用 `courseColor(course)`（后端已给 `resolved_color`）；扩展点类型在 `modules/academics/types.ts`（`academics.courseColumns`、`termWizardImportSources`、`programSetupFields`、`onboardingSteps`）；跨模块清理订阅 `academics.*.deleting`（同事务，抛错会回滚删除）或 `*.deleted`（提交后）；Program 级 Page 用 id `today` 时侧边栏会出现"今天"入口；页面上的 `data-tour="command-palette"`、`data-tour="assistant"` 会被界面导览自动纳入。前端测试的 API 假数据与 handler 在 `modules/academics/test-data.ts`。细节与偏离见 M02 规格末尾的"实现说明"。
- M03 成绩与 GPA：后端 `apps/api/src/semestra/modules/grading/`（表 `grading_scales`/`_course_results`/`_categories`/`_assessments`；纯计算在 `engine.py`：换算表、课程成绩规则、预测与"达标所需分数"、年课学分归属、学期/Program GPA；27 个 capability，`grading.assessment.find` 只给 agent/MCP；skills 在 `grading/skills/`）与前端 `apps/web/src/modules/grading/`（课程/学期 `grades` 页含计划模式、5 张卡片、Program 与课程设置分区、`academics.courseColumns` 与 `programSetupFields` 贡献）。
  给其它模块的约定：成绩数字一律经 `GpaValue`（尊重"隐藏 GPA"）；M04 用 `service.assessment_deadlines()` 做日历源（本模块还没接）；M08/M09 往成绩簿导入考核时贡献前端扩展点 `grading.assessmentImportSources` 并走 `grading.assessment.create_many`（按 `source_kind`+`source_ref` 去重）；**TanStack Table 的列定义要放在组件外**，需要的回调走 context，否则带输入框的单元格会在每次渲染时被重新挂载。`CourseColumn` 新增可选 `query` 用于加载列所需的跨模块数据。细节与偏离见 M03 规格末尾的"实现说明"。
- M06 AI 接入层：后端 `apps/api/src/semestra/modules/ai/`（表 `ai_providers`/`ai_model_assignments`/`ai_usage_events`；接口层用 Pydantic AI 模型层 + 官方 SDK（`adapters/`，请求经 `bridge.py` 走 `safe_client`），不用 LangChain；对其它模块的接口从 `semestra.modules.ai` 导入：`complete`、`structured`、`extract`（带出处抽取，`Evidenced[T]`）、`embed`、`available`、`get_chat_model`、`wrap_untrusted`；10 个 capability 只开放 HTTP）。前端全局 `useAiStatus`、`<AiRequired>`、`useAiFill` + `<AiFieldMark>`，设置分区在 `modules/ai/`。
  给其它模块的约定：AI 入口用 `<AiRequired purpose=…>` 包裹；单个表单的 AI 结果用 `useAiFill` 回填，不加确认框；文件内容放进 `extract(texts=…)` 或用 `wrap_untrusted` 包装；后台 job 用 `on_segment` 汇报分段进度。测试里提供方接口用 respx mock（参考 `modules/ai/tests/conftest.py` 的 `ai` fixture），用量写入在后台，断言前 `await app.state.ai.drain()`。细节与偏离见 M06 规格末尾的"实现说明"。
- M04 课表与日历：后端 `apps/api/src/semestra/modules/schedule/`（表 `schedule_event_types`/`_meetings`/`_meeting_exceptions`/`_events`/`_feeds`；规则在 `rules.py`；日历聚合注册表 `calendar.py`；ICS 导出与公开订阅在 `routes.py` + `ics.py`；设置命名空间 `calendar`）。前端 `apps/web/src/modules/schedule/`：Program 页 `today`（卡片网格 `board="today"`）、学期页 `calendar`（FullCalendar 6 + 课表视图、筛选、拖动、导出、订阅）、课程页 `schedule`（TanStack Table）、4 张卡片、Program 级"课程类型"设置。
  给其它模块的约定：日历数据只从后端来，用 `@calendar_source("<模块>.<源>")` 注册（`from semestra.modules.schedule.calendar import calendar_source, Occurrence, OccurrenceQuery, OccurrenceRef`），过滤课程用 `q.wants_course(...)`，数据变化时发 `calendar.changed {program_id}`；前端在 manifest 的 `calendarSources` 写标签、图标与 `onOpen(occurrence, navigate, { programId })`。日历时间一律是 Program 时区，前端换算用 `modules/schedule/time.ts`。FullCalendar 的 `plugins`/`locales` 等数组要放模块级常量，否则会无限触发 `datesSet`。细节与偏离见 M04 规格末尾的"实现说明"。
- M10 插件与布局：后端 `modules/plugins/`（目录 `catalog.py` = 前端导出的 `web_manifest.json` + `register_plugin`；表 `plugins_installations`/`plugins_default_offers`；`core/capability.py` 的插件门禁）与 `modules/layouts/`（`layouts_nav`/`_boards`/`_templates`/`_card_settings`，紧凑算法 `grid.py` 与前端 `app/board/layout.ts` 一致）。前端 `app/board/`（可编辑卡片网格）、`app/host/nav.ts` + `ManagePagesDialog`（页面排序与隐藏）、`app/commands/`（命令面板、拼音匹配、`useHostAction`）、`app/hotkeys.ts`（`useHotkey`）、`app/host/StatusBar.tsx`（任务列表）、`modules/plugins/`（插件管理）。
  给其它模块的约定：插件模块（kind `plugin`）后端必须 `register_plugin(PluginInfo(id=..., default_installed=...))`，capability 带 `plugin_id`；改了 manifest 的 Page/卡片/`defaultBoard`/卡片设置 schema 后跑 `pnpm --filter @semestra/web manifest:export` 并提交 `web_manifest.json`；卡片业务数据按 `instance_id` 存，订阅 `layouts.card.deleted` 清理，插件用 `@events.subscribe("plugins.purge", in_transaction=True)` 清理数据（与卸载同一事务，抛错会让卸载失败）；卡片设置用 `useCardSettings` 读写；命令面板条目用 manifest 的 `commands`/`navigationSources`/`searchProviders`，任务名称用 `jobKinds`；全局快捷键用 `useHotkey`。细节见 M10 规格第 9 节。
- M12 AI 助手：后端 `apps/api/src/semestra/modules/agent/`（表 `agent_sessions`/`_messages`/`_proposals`/`_attachments`/`_preferences`；工具循环 `loop.py` 跑在 Pydantic AI `Agent` 上（审批用 DeferredToolRequests，工具发现用内置 `search_tools`/`load_capability`，助手行存 `model_parts` 原样回放），不用 LangGraph；skill 解析 `skills.py`；MCP 服务端 `mcp_server.py` 挂在 `/mcp`；SSE 路由在 `routes.py`）。前端 `apps/web/src/modules/assistant/`（右侧面板经 `assistant.Dock` 挂进 app shell、全屏页 `/p/$programId/assistant/{-$sessionId}`、提案卡片、`/` skill 与 `@` 引用、三个 AI 设置分区）。
  给其它模块的约定：每个 agent capability 都要有中英 `capability_<名称>_title`（测试检查）；write capability 最好提供 `preview`（`{target, changes:[{field, before, after}], link:{to}}`）让确认卡片显示 before → after；引用文件的工具结果返回 `citations:[{id,…}]`；skill frontmatter 要有 `title`，可选 `command`；后端测试用 `tests/conftest.py` 的 `FakeModel`（Pydantic AI `FunctionModel`，`model.prompts(i)`/`results(i)`/`tools_of(i)` 查看第 i 次请求）。记忆在 `agent/memory.py`（表 `agent_memories`，快照存在会话 `state["memory"]`，工具不出卡片，敏感信息过滤）；临时对话（`agent_sessions.temporary`）不读不写记忆。细节与偏离见 M12 规格末尾的"实现说明"。
- M14 小插件合集：五个第一方插件（计数器、习惯打卡、番茄钟、便签、世界时钟）。前端 `apps/web/src/modules/plugin-<id>/`，共用的小工具在 `plugin-kit/`（`useCardSettings`、`useOptimisticSettings`、`Ring`、`Burst`、`colors`、`duration`）；后端 `apps/api/src/semestra/modules/plugins_builtin/`：`habit_streak/`（表 `plugin_habit_checkins`；纯连续天数规则在 `streak.py`）、`pomodoro/`（表 `plugin_pomodoro_sessions`）、`sticky_note/`（只有 Agent capability，文本在卡片设置里）；计数器与世界时钟没有后端。`instances.py` 是插件读取 M10 卡片实例的唯一入口，`portability.py` 是 M13 导出适配器。插件开发指南 [docs/plugin-authoring.md](docs/plugin-authoring.md)，模板是 `_template-plugin/`（前端）与 `plugins_builtin/_template/`（后端），都不注册进应用。
  给其它模块的约定：习惯打卡的"今天"与周起点由后端按卡片所在 Program 的时区给出，前端不做时区计算；番茄钟计时状态存 `useUiPref('pomodoro.<instanceId>')`，以 `endsAt` 推算剩余时间，`pomodoro.active` 指向状态条要显示的那个计时；新的内置插件照着模板和指南写。
- M07 文件与文档管线：后端 `apps/api/src/semestra/modules/files/`（表 `files_folders`/`_items`/`_documents`/`_document_pages`/`_chunks`/`_index_state`，FTS5 trigram 表 `files_chunks_fts`，向量表 `files_vec_<指纹>`（sqlite-vec，每个连接在 `core/db.py` 加载）；解析器在 `parse/`，切块 `chunking.py`，检索 `search.py`（关键词 + 语义 + RRF），处理任务 `pipeline.py`；Skill 在 `skills/`）。前端 `apps/web/src/modules/files/`：课程/学期 `files` 页（TanStack Table、网格缩略图、上传浮层、内容搜索）、预览（`react-pdf`）、卡片"快速打开"与"最近文件"。
  给其它模块的约定：要引用课程文件内容（M08/M12）用 capability `files.document.search`、`files.document.read`、`files.document.outline`，回答里的出处写 `citation_id`（`<item>:p<from>-<to>`），前端用 `modules/files/components/Citation.tsx` 的 `<Citation id=… />` 显示（点开预览并定位到页）；其它模块产生的文件用 `from semestra.modules.files import save_bytes_as_file` 存进课程（会自动走处理管线）。文档管线不依赖 AI：没有 embedding 模型时只有关键词检索，没有图像模型时扫描页跳过并在 `ocr_skipped_pages` 里标出。迁移 `env.py` 的 `include_object` 忽略 FTS 与向量虚表；pdf.js 的 cmaps/standard_fonts/wasm/iccs 由 `vite.config.ts` 复制到 `/pdfjs/`（CSP 需要 `'wasm-unsafe-eval'`）。文件解析在限内存、限时长的子进程里（`parse/isolated.py`），测试里换掉 `isolated._child` 模拟卡死或崩溃。测配额时别假设已用为 0：`tests/test_storage.py` 在全量测试里注册了一个固定 1000 字节的 usage provider。后端测试用 `modules/files/tests/conftest.py` 的 `make_pdf`/`make_docx`/`make_png` 与 `fx` fixture（含假 embedding）；前端测试要 `vi.mock('react-pdf')`（jsdom 跑不了 pdf.js）。细节与偏离见 M07 规格末尾的"实现说明"。
- M08 导入中心：后端 `apps/api/src/semestra/modules/imports/`（表 `imports_sessions`/`_items`/`_uploads`；ICS 解析 `ics.py`，相对日期 `dates.py`，抽取结果 → item 的纯函数 `build.py` + `extraction.py`，问题校验 `validate.py`，提交顺序与回滚 `service.py`；job `imports.extract`；8 个 capability，`imports.item.add_many` 只给 agent/MCP；skill `imports/skills/import-from-documents.md`）。对 M05/M07 的依赖在 `deps.py` 里按名字晚绑定（`deps.call(ctx, "<capability>", args)` 与 `importlib`），缺了只让对应 item/文件失败。前端 `apps/web/src/modules/imports/`：任意处调用 `openImport(request)`（`launcher.ts`）打开导入对话框（manifest 新字段 `overlays` 渲染的 `ImportHost`），审核视图 `SessionView` 同时用于对话框和 `/p/$programId/imports/$sessionId`；Program 设置"数据"下的导入历史。
  给其它模块的约定：要在提交导入时做额外写入用 `register_commit_hook(source_kind, fn)`（同一事务，抛错会让整个提交回滚）；新的导入来源在前端调用 `openImport`，不要自己写审核界面。SQLite 坑：pysqlite 只在第一条 DML 才开事务，第一个 `begin_nested()` 会变成外层事务并在 release 时提交，所以 savepoint 前先 flush 一次写入（见 `service.commit`）。细节与偏离见 M08 规格末尾的"实现说明"。
- M13 数据导出导入与账户删除：后端 `modules/portability/`（`registry.py` 的 `register_portability`、`tables.py` 的 `table_adapter`/`Table`、备份 zip `archive.py`、表 `portability_archives`；导出/导入/删除账户三个任务；上传与下载是 `routes.py`）；每个有数据的模块在自己的 `portability.py` 注册适配器。前端 `modules/portability/`（账户设置"数据"组）与公开路由 `/account-deleted`。
  给其它模块的约定：**新表要注册进本模块的适配器**（覆盖测试会检查每张带 `user_id` 的表），细节见 M13 规格第 11 节。

- M09 LMS 集成：后端 `apps/api/src/semestra/modules/lms/`（表 `lms_connections`/`_program_bindings`/`_course_links`/`_imported_refs`/`_cache`；provider 注册 `providers/base.py` 的 `register_lms_provider`，Canvas 在 `providers/canvas/`；HTML 清洗 `html.py`（nh3）；读接口 `reads.py`，导入 `imports.py`（M08 提交钩子），日历源 `calendar.py`；provider 契约测试 `tests/provider_contract.py`，模块测试用假 provider）。前端 `apps/web/src/modules/lms/`：账户/学业项目/课程设置的"集成"分区、学期向导与成绩册的导入来源、`LmsUpdatesBanner`、公告卡片。
  给其它模块的约定：新 provider 只需实现 `LmsProvider` 并通过 `check_provider` 契约测试，前端贡献 `lms.providerUi`；凭证只经 `service._seal/_open` 加解密，任何输出只给 `credentials_hint`；provider 只抛 `lms.*` 错误码。读平台内容一律走 `lms.*` capability（带缓存与功能标志检查），返回的 HTML 已清洗，但对 agent 仍是不可信数据。细节与偏离见 M09 规格末尾的"实现说明"。
- M16 Canvas Tab（插件 `canvas-tab`）：只有前端 `apps/web/src/modules/plugin-canvas-tab/`，数据全部来自 M09 的 `lms.*` 读接口；后端只在 `plugins_builtin` 登记 `PluginInfo`。共享的 HTML 渲染组件 `components/SafeHtml.tsx`（DOMPurify）。
  给其它模块的约定：Page 需要额外数据才能判断是否可用时，用 `availabilityQuery(scope)` + `isAvailable(scope, data)`（M10 扩展，数据走查询缓存）；课程 Page 路由保留字符串 search 参数，Page 可以用 `useSearch({ strict: false })` 存自己的状态。细节见 M16 规格末尾的"实现说明"。

## UI 相关
 - 使用shadcn/ui组件前先使用context7查对应组件的文档
 - shadcn组件文件夹中的shadcn组件禁止修改 (apps/web/src/ui)
 - 删除/撤销/移除/退出登录一类按钮和菜单项一律用 shadcn 的 `destructive` variant（`Button`、`DropdownMenuItem` 都有）；删除、撤销、批量操作和退出登录要用 `ConfirmDialog`（退出登录用 `SignOutDialog`）二次确认；表单里尚未保存的行（草稿行、可再添加的条目）的移除按钮只标红，不弹确认；但删除成绩分类、GPA 区间这类会改变换算结果的条目要确认。
 - 英文文案用 sentence case（“New program”），样式上不用 `uppercase`。
 - 已知并接受的官方组件读屏问题（不要再为它们改代码或包一层）：`Dialog`/`Sheet` 关闭按钮读作英文 "Close"；`ItemGroup` 固定是 `role="list"`，但 `Item` 是普通 `div`、`ItemSeparator` 也直接放在列表里，读屏器拿不到列表项数量（PR #13 Codex 评审指出）。
 - `src/ui/` 合并有冲突时，一律用 shadcn CLI 重新生成的官方版本解决（`CI=1 pnpm dlx shadcn@latest add <组件> --overwrite --yes </dev/null`），不要手动合并内容，也不要为了让分支编译通过去改它，改调用方。
 - UI 尽可能直接用 shadcn 官方组件（`@/ui/*`），不要手写同类控件，也不要为了保持旧接口或读屏文字这类小问题做额外的薄封装；生成组件里写死的英文读屏文字（如 Dialog/Sheet 的 "Close"）可以接受。只有带真实行为的组件才放 `src/components/`。教训：曾写过 `AppDialogContent`、`TextField`、`EmptyState`、`RadioCard` 等薄封装，后来全部删除，还导致依赖旧接口的分支 typecheck 失败。
- 设置里的列表（AI 服务商、LMS 连接、API 令牌、登录设备、课程类型、学科颜色、成绩分类等）一律用 `@/app/settings` 的 `SettingsTable`（TanStack Table + `@/ui/table`，和 `SettingsGroup` 同样的圆角边框，占满分区宽度）：列定义放组件外、回调走 context；名称列 `w-full max-w-0`（输入框 `w-full`）吃掉剩余宽度；第一列图标/色点 + 名称，第二行 `text-xs text-muted-foreground` 放细节；状态用 `Badge`，进行中用 `Spinner`，行高固定不跳。低频操作全部进行末 `RowMenu`（「⋯」+ tooltip），删除/撤销/断开放最后：`DropdownMenuSeparator` + `variant="destructive"` + `ConfirmDialog`。可排序的表传 `onReorder`（行首拖动手柄，`@dnd-kit/sortable`），菜单里放 `MoveMenuItems`（上移/下移），不要再在行内放上下箭头。末行「+ 添加…」用 `ActionRow`，需要输入的点开后在同一位置换成一行小表单。颜色用「色点 + 下拉箭头」的小按钮（不能只放一个裸色点，用户不 hover 就看不出能改）：`ColorDotPicker`（点开 `ColorPicker`），成绩分类的命名色用 `CategoryColorSelect`（列表里显示颜色名）。
- 空状态统一用 shadcn `Empty`（不封装组件），按三档：①页面级/分区：`EmptyMedia variant="icon"` + `EmptyTitle`（状态，如"还没有学期"）+ `EmptyDescription`（一句话说明下一步）+ `EmptyContent` 内至多一个动词开头的主按钮；②看板卡片内/表格单元格内：图标 + 标题，可选一个链接式按钮，不要描述，`<Empty className="border-0 p-0">` 去掉虚线框和大内边距；页面里与表格并列的分区（例如课程课表页的“单次事件”）没有数据时，可以改用与表格相同的圆角实线框 `<Empty className="rounded-2xl border border-solid border-border p-6">`，让分区形状一致（`border-solid` 不能省，`Empty` 默认是 `border-dashed`）；③筛选无结果：`SearchX` 图标 + "没有匹配的…" + "清除筛选"按钮。sidebar/下拉/Select 等极小空间允许一行 `text-xs text-muted-foreground`，文案同一套。标题写状态不写命令，按钮写动词，不用感叹号。加载用 `Skeleton`/`Spinner`，出错用 `Alert`，都不算空状态。禁止再手写 `text-center text-sm text-muted-foreground` 的空状态。
- M05 待办：后端 `apps/api/src/semestra/modules/tasks/`（表 `tasks_lists`/`tasks_items`；规则在 `rules.py`；Program 级设置走 M11 命名空间 `tasks`，不建偏好表；`auto.py` 订阅 `grading.assessment.*` 生成/同步任务；日历源 `tasks.due`；Agent skill `skills/manage-tasks.md`）。前端 `apps/web/src/modules/tasks/`：页面 `pages/TasksPage.tsx`（Program/学期/课程同一组件）、卡片 `tasks.today`/`tasks.list`/`tasks.counter`、快速添加 `parse.ts`（chrono-node，中英文）。
  给其它模块的约定：导入或 Agent 批量建任务用 `tasks.item.create_many`（按 `source_kind`+`source_ref` 去重）；任务的学期由课程与截止日自动推断；读任务走 `tasks.item.query`/`tasks.item.count`，不要直接读 `tasks_*` 表。细节与偏离见 M05 规格第 10 节。
