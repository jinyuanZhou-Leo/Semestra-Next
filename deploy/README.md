# 部署（M15）

| 目录 / 文件 | 内容 |
|---|---|
| `docker/Dockerfile` | 多阶段构建，目标 `api`（后端）、`api-office`（后端 + LibreOffice）、`allinone`（后端 + 前端静态文件，同源提供）；构建上下文是仓库根目录 |
| `docker/entrypoint.sh` | 容器入口：可选自动生成密钥 → `alembic upgrade head` → 启动 |
| `selfhost/` | 自部署版：一条命令启动的 compose，中英文 README |
| `.env.example` | 所有后端环境变量的完整说明 |

自部署：浏览器 ──► `semestra-allinone` 容器（API + 前端同源）──► 数据卷 `/data`。

## 发布流程

1. 功能 PR 各自带 changeset（见 [.changeset/README.md](../.changeset/README.md)）。合并到 `main` 后，`Version` 工作流自动维护一个「Release (version packages)」PR：新版本号、`release-notes/<版本>.json`、`CHANGELOG.md`。
2. 想发版时，先在 `main` 上润色 `.changeset/*.md` 里的中英文说明（不要在版本 PR 里改 JSON：`main` 每次有推送都会重建并强制推送这个 PR，改动会丢）；PR 放了几天的话，先在 Actions 里手动运行一次 `Version` 刷新发布日期（按多伦多时间），再合并。`Version` 工作流随即打 tag `v<版本>` 并调用 `Release` 工作流（用 `GITHUB_TOKEN` 推的 tag 不会触发 `push` 事件，所以是直接调用）。仓库设置里要打开 Settings → Actions → General →「Allow GitHub Actions to create and approve pull requests」，否则开不了版本 PR。也可以手动打 tag：`git tag v1.2.3 && git push origin v1.2.3`（必须在 `main` 上，格式 `vMAJOR.MINOR.PATCH[-pre]`）。
3. `Release` 工作流（也可以在 Actions 页手动运行，输入已有的 tag 补发）构建并推送镜像到 GHCR（`semestra-api`、`semestra-api:<版本>-office`、`semestra-allinone`），然后创建 GitHub Release（正文取 `release-notes/<版本>.json` 的英文条目；手动打的 tag 没有这个文件时用 GitHub 自动生成的 PR 列表）。

> 数据库迁移只向前。退回旧版本镜像不会撤销已执行的迁移，所以迁移要写成向前兼容（先加后删），旧代码在新表结构上也能运行。

## 本地试一下镜像

```bash
docker build -f deploy/docker/Dockerfile --target allinone -t semestra-allinone .
docker run --rm -p 8000:8000 -e SEMESTRA_AUTO_SECRETS=true -v semestra-data:/data semestra-allinone
# http://localhost:8000
```
