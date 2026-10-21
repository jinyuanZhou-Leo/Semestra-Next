# Semestra 官网（apps/site）

独立的静态站点，和应用（`apps/web`）分开部署。Astro 构建成纯 HTML；React 只在构建时用来渲染和应用相同的 shadcn 组件（`src/ui/` 里的 `Button`、`NavigationMenu`），运行时只有一段滚动动画脚本（`src/scripts/day.ts`）。

| 命令（仓库根目录）                     | 作用                       |
| -------------------------------------- | -------------------------- |
| `pnpm site:dev`                        | 本地预览（:4321）          |
| `pnpm site:build`                      | 构建到 `apps/site/dist/`   |
| `pnpm --filter @semestra/site check`   | 类型检查                   |
| `pnpm --filter @semestra/site capture` | 从真实应用重新截取产品画面 |

- 路由：`/` 中文，`/en/` 英文；文案在 `src/i18n.ts`。
- 主题：跟随系统，深色时给 `<html>` 加 `.dark`（和 shadcn 一致）；令牌在 `src/styles/theme.css`，复制自应用的 `apps/web/src/app/theme.css`，应用改了主题要同步。
- `src/ui/` 是 shadcn CLI 生成的文件，不手改；要新组件在本目录运行 `CI=1 pnpm dlx shadcn@latest add <组件> </dev/null`。

## 产品截图

页面里的应用画面全部是真实应用的截图（`public/shots/<画面>-<light|dark>-<en|zh>.webp`），不手画。应用界面改版后重新截取：

1. 用一个空的本地数据库启动应用：`SEMESTRA_ALLOW_PRIVATE_EGRESS=true pnpm dev`（脚本模型跑在 127.0.0.1，需要放开私有地址）。
2. 启动脚本模型：`python3 apps/site/scripts/capture/server.py`。它是一个只给截图用的 OpenAI 兼容服务，按固定剧本让 Sem 走完真实的工具调用和确认流程（`script.py`），不进生产代码。
3. `pnpm --filter @semestra/site capture`：创建示例账户 Maya Chen（UofT 计算机工程，5 门课）并灌入数据，接上脚本模型，截取中英 × 深浅色全部画面，转成 WebP 写进 `public/shots/`。

截图日期固定在 2026-10-21（第 7 周，周三），和页面上的时间线一致。中间文件在 `scripts/capture/.out/`（不提交）；再次运行会复用已灌好的账户，要重来就删掉这个目录并重置数据库。
