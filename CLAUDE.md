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

## 环境注意事项（M00 搭建时发现）

- **Python 必须是 3.15.0 正式版**。3.15.0a7 与 Cython 构建的扩展（SQLAlchemy 的 `_collections_cy` 等）不兼容，会报 `unknown slot ID 84`。用 `uv python install 3.15`（需要 uv ≥ 0.13）。
- 已验证有 3.15 wheel 的 C 扩展依赖：pydantic-core、cryptography、argon2-cffi-bindings、greenlet、SQLAlchemy 的 Cython 扩展、uvloop、httptools、watchfiles、orjson、pymupdf、sqlite-vec。
- **PyYAML 没有 3.15 wheel**，所以不能用 `uvicorn[standard]`；`pyproject.toml` 里手动列出 httptools、uvloop、watchfiles、websockets、python-dotenv 代替。
- `@hey-api/openapi-ts` 依赖 TypeScript 的 JS API，而 TS 7（原生版）没有它，所以 `packages/api-client` 单独固定 `typescript@6.0.3` 仅供代码生成使用；应用本身用 TS 7。
- 前端依赖精确版本锁定（`pnpm-workspace.yaml` 里 `savePrefix: ''`）。
- 根目录 `oxlint` 不带路径会异常变慢，lint 脚本都显式指定目录。

## 已完成的模块

- M00（环境部分）：monorepo、配置、数据库基础（PRAGMA、UUIDv7、UTC 类型、mixin）、统一错误信封、`/healthz` `/readyz`、Alembic、OpenAPI 生成链路、i18n 与 shadcn 骨架、lint/测试工具链。
  **尚未实现**：Capability 注册表、任务队列、事件总线与 SSE、存储抽象、扩展契约宿主（`defineModule`）、示例模块 —— 这些仍属于 M00 的交付内容。
