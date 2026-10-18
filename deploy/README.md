# 部署（M15）

| 目录 / 文件 | 内容 |
|---|---|
| `docker/Dockerfile` | 多阶段构建，目标 `api`（后端）、`api-office`（后端 + LibreOffice）、`allinone`（后端 + 前端静态文件，同源提供）；构建上下文是仓库根目录 |
| `docker/entrypoint.sh` | 容器入口：可选自动生成密钥 → `alembic upgrade head` → 启动 |
| `hosted/` | 托管版（GCP VM：API + Caddy + Litestream）：compose、部署/回滚脚本、VM 初始化、GCS 备份、恢复手册 |
| `selfhost/` | 自部署版：一条命令启动的 compose，中英文 README |
| `.env.example` | 所有后端环境变量的完整说明 |
| `SECURITY-CHECKLIST.md` | 上线前逐项确认的安全清单 |
| `../apps/web/vercel.json` | Vercel 的构建、SPA 重写、缓存与安全头 |

```
托管版
  浏览器 ──► Vercel（semestra.jyleo.cc，静态前端）
     └─────► Caddy（api.semestra.jyleo.cc，自动 HTTPS）──► api 容器 ──► /srv/semestra/data
                                                      Litestream ──► GCS（数据库持续复制）
                                                      systemd timer ─► GCS（上传文件每日镜像）
自部署
  浏览器 ──► semestra-allinone 容器（API + 前端同源）──► 数据卷 /data
```

## 发布流程（托管版）

1. `main` 合并后，CI 全绿。
2. 打 tag：`git tag v0.1.0 && git push origin v0.1.0`（tag 必须在 `main` 上，格式 `vMAJOR.MINOR.PATCH[-pre]`）。
3. `Release` 工作流构建并推送三个镜像到 GHCR（`semestra-api`、`semestra-api:<版本>-office`、`semestra-allinone`）。
4. `deploy` 任务等待 GitHub Environment `production` 的人工批准，批准后通过 SSH 把配置同步到 VM 并执行 `deploy.sh <版本>`：先做数据库快照，再拉镜像并启动，`/readyz` 不通过则自动回滚到上一个版本。
5. 部署成功后工作流检查公网 `https://api.semestra.jyleo.cc/readyz`，然后创建 GitHub Release（自动生成变更日志）。

前端由 Vercel 的 Git 集成在 `main` 变更时自动构建发布，与后端 tag 发布相互独立；破坏性的接口变更要先发后端、再合并前端。

> 数据库迁移只向前。自动回滚恢复的是上一个镜像，不会撤销迁移；所以迁移要写成向前兼容（先加后删），部署前的快照保存在 VM 的 `/srv/semestra/data/backups/pre-deploy/`。

## 第一次上线要你亲手做的事

代码和脚本都已就绪，下面这些涉及账户、密钥和 DNS，必须由你操作（详细命令见各文档）：

1. **GCP**：创建项目与计费、VM、数据盘、静态 IP、服务账号、备份 bucket → [`hosted/GCP-SETUP.md`](hosted/GCP-SETUP.md)
2. **DNS**：`api.semestra.jyleo.cc` 的 A 记录指向 VM 静态 IP；`semestra.jyleo.cc` 按 Vercel 提示配置。
3. **密钥**：可以直接沿用老项目的值（对应关系见下表），不需要重新注册第三方账户；**ENCRYPTION_KEY 要离线备份**（丢失后用户保存的 AI/Canvas 密钥无法解密）。
4. **VM 上的 `.env`**：按 [`hosted/.env.example`](hosted/.env.example) 填写，把老项目的值填进去（值只放在 VM 的 `.env` 里，不要贴进聊天或提交到仓库）。

   | 老项目（`backend/.env`） | 新项目 | 说明 |
   |---|---|---|
   | `JWT_SECRET_KEY` | `SEMESTRA_SECRET_KEY` | 直接沿用即可；老会话本来就不会迁移 |
   | `LMS_CREDENTIALS_ENCRYPTION_KEY` | `SEMESTRA_ENCRYPTION_KEY` | 老的是 base64 的 32 字节 AES 密钥，格式恰好也是合法的 Fernet 密钥，可以直接用；老数据不会迁移，所以沿用只是省事，不是必须。没有的话用 `deploy/.env.example` 里的命令生成 |
   | `RESEND_API_KEY` | `SEMESTRA_RESEND_API_KEY` | 同一个 Resend 账户和已验证的发信域名 |
   | `AUTH_EMAIL_FROM` | `SEMESTRA_EMAIL_FROM` | 发信域名要和 Resend 里已验证的一致 |
   | `GOOGLE_CLIENT_ID` | `SEMESTRA_GOOGLE_CLIENT_ID`（后端）和 `VITE_GOOGLE_CLIENT_ID`（Vercel） | 还要到 Google Cloud 控制台，在这个 OAuth 客户端的"已获授权的 JavaScript 来源"里加上 `https://semestra.jyleo.cc` |
   | `AUTH_EMAIL_CODE_SECRET`、`AUTH_RATE_LIMIT_KEY_SECRET` | 暂无 | 由 M01 实现时定义新变量名，到时再补进 `.env.example`；值同样可以沿用 |
   | `DATABASE_URL`、`FRONTEND_URL`、`ALLOWED_HOSTS` 等 | 不用带 | 新项目由 compose 和 `SEMESTRA_PUBLIC_*` 决定 |
5. **GitHub**：创建 Environment `production`（勾选 Required reviewers），配置 secrets：`DEPLOY_HOST`、`DEPLOY_USER`（`deploy`）、`DEPLOY_SSH_KEY`、`DEPLOY_SSH_KNOWN_HOSTS`；GHCR 镜像若为私有，VM 需要 `docker login ghcr.io`（`read:packages` token）。
6. **Vercel**：导入仓库、Root Directory 设为 `apps/web`、环境变量与域名 → [`hosted/VERCEL.md`](hosted/VERCEL.md)
7. **监控**：UptimeRobot（或 GCP Uptime Check）监控 `https://api.semestra.jyleo.cc/healthz` 与 `https://semestra.jyleo.cc`。
8. **演练**：按 [`hosted/RESTORE.md`](hosted/RESTORE.md) 做一次恢复演练，然后过一遍 [`SECURITY-CHECKLIST.md`](SECURITY-CHECKLIST.md)。
9. **可选 staging**：见 `hosted/GCP-SETUP.md` 末尾；启用后把仓库变量 `STAGING_ENABLED` 设为 `true`。

## 本地试一下镜像

```bash
docker build -f deploy/docker/Dockerfile --target allinone -t semestra-allinone .
docker run --rm -p 8000:8000 -e SEMESTRA_AUTO_SECRETS=true -v semestra-data:/data semestra-allinone
# http://localhost:8000
```
