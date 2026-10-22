# Semestra 官网（apps/site）

独立的静态站点，和应用（`apps/web`）分开部署。Astro 构建成纯 HTML；React 只在构建时用来渲染和应用相同的 shadcn 组件（`src/ui/` 里的 `Button`、`NavigationMenu`），运行时只有一段滚动动画脚本（`src/scripts/landing.ts`：进场动画、首屏窗口的 3D 摆正、分层视差和成绩卡片轮播）。

| 命令（仓库根目录）                     | 作用                                       |
| -------------------------------------- | ------------------------------------------ |
| `pnpm site:dev`                        | 本地预览（http://localhost:4321/landing/） |
| `pnpm site:build`                      | 构建到 `apps/site/dist/`                   |
| `pnpm --filter @semestra/site check`   | 类型检查                                   |
| `pnpm --filter @semestra/site capture` | 从真实应用重新截取产品画面                 |

- 路由：站点挂在 `/landing` 下（`astro.config.mjs` 的 `base`）：`/landing/` 英文，`/landing/zh/` 中文；文案在 `src/i18n.ts`。生产环境里应用、文档（`/docs`）和官网共用 `semestra.jyleo.cc` 一个域名，未登录的人打开应用的 `/` 会被带到 `/landing/`（应用的 `VITE_LANDING_URL`）。
- 外链：应用和文档的地址在 `src/i18n.ts`（`APP_URL`、`DOCS_URL`）。生产环境是同源路径（`/login`、`/docs/<en|zh>/…`）；`site:dev` 时指向本地的应用（:5173）和文档站（:3001/docs）；构建时可用 `PUBLIC_APP_URL`、`PUBLIC_DOCS_URL`、`PUBLIC_SITE_URL` 覆盖。路由方案见项目文件 `discussions/2026-10-22-三站路由方案.md`。
- 引用 `public/` 里的文件要经过 `asset()`，带上 `/landing` 前缀。
- 主题：跟随系统，深色时给 `<html>` 加 `.dark`（和 shadcn 一致）；令牌在 `src/styles/theme.css`，复制自应用的 `apps/web/src/app/theme.css`，应用改了主题要同步。
- `src/ui/` 是 shadcn CLI 生成的文件，不手改；要新组件在本目录运行 `CI=1 pnpm dlx shadcn@latest add <组件> </dev/null`。

## 产品截图

页面里的应用画面全部是真实应用的截图，不手画：

- `public/shots/<画面>-<light|dark>-<en|zh>.webp`：整窗截图（首屏的"今天"页面、Sem 全屏对话）。
- `public/parts/<局部>-<light|dark>-<en|zh>.webp`：界面局部（今日课程卡片、周视图、命令面板、成绩册、Sem 的确认卡片等），由 `scripts/capture/parts.mjs` 截取。自带圆角的元素用 `part(…, { cut: true })` 连同圆角一起抠出，背景透明，页面上只加阴影不再套框；其余局部带一圈页面边距，页面上套圆角框。组件里用 `src/components/Shot.astro` 引用（`cut` 对应抠图），它按系统主题切换深浅色版本。

应用界面改版后重新截取：

1. 用一个空的本地数据库启动应用：`SEMESTRA_ALLOW_PRIVATE_EGRESS=true pnpm dev`（脚本模型跑在 127.0.0.1，需要放开私有地址）。
2. 启动脚本模型：`python3 apps/site/scripts/capture/server.py`。它是一个只给截图用的 OpenAI 兼容服务，按固定剧本让 Sem 走完真实的工具调用和确认流程（`script.py`），不进生产代码。
3. `pnpm --filter @semestra/site capture`：创建示例账户 Maya Chen（UofT 计算机工程，5 门课）并灌入数据，接上脚本模型，截取中英 × 深浅色全部画面和局部，转成 WebP 写进 `public/`。只重截某一部分时，单独跑对应脚本后再跑 `node scripts/capture/convert.mjs`。

截图时间固定在 2026-10-21 08:40（多伦多时间，第 7 周周三）。浏览器时区也固定为 America/Toronto：Playwright 的假时钟和 `@date-fns/tz` 一起用时，浏览器时区和学业项目时区不同会让日历整体错位。中间文件在 `scripts/capture/.out/`（不提交）；再次运行会复用已灌好的账户，要重来就删掉这个目录并重置数据库。
