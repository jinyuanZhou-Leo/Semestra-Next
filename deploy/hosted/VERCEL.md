# 前端：Vercel 设置

仓库里已经有 `apps/web/vercel.json`（构建命令、SPA 重写、静态资源长缓存、`index.html` 不缓存、CSP 等安全头）。你需要在 Vercel 控制台做这些事：

1. **导入项目**：Add New → Project → 选择 `Semestra-Next` 仓库（先在 GitHub 上授权 Vercel 访问这个私有仓库）。
2. **Root Directory**：`apps/web`，并保持开启 "Include source files outside of the Root Directory"（需要工作区的根 `package.json`、`pnpm-lock.yaml` 和 `packages/api-client`）。Framework Preset 选 Other（`vercel.json` 已覆盖构建命令和输出目录）。
3. **Node.js Version**：26（项目要求 Node ≥ 26；如果项目设置里还没有 26，需要等 Vercel 支持，或把 Node 版本固定到可用的最新版并告诉我们）。
4. **环境变量**（Production）：
   - `VITE_API_ORIGIN` = `https://api.semestra.jyleo.cc`
   - `VITE_GOOGLE_CLIENT_ID` = Google OAuth Web Client ID（M01 上线后使用）
   - `VITE_SENTRY_DSN` = 前端 Sentry DSN（可选，留空即关闭）
   - Preview 环境：`VITE_API_ORIGIN` = `https://api-staging.semestra.jyleo.cc`（启用 staging 后）
5. **域名**：Settings → Domains 添加 `semestra.jyleo.cc`，按提示在 DNS 增加记录。
6. **Git**：Production Branch 为 `main`。

CSP 里 `connect-src` 写死了 `api.semestra.jyleo.cc` 与 `api-staging.semestra.jyleo.cc`；换域名时改 `vercel.json`。Google 登录需要的域名（`accounts.google.com/gsi/`）已放行。
