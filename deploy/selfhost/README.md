# Self-hosting Semestra / 自部署 Semestra

One container serves both the API and the web app. You need Docker with the Compose plugin and about 1 GB of RAM.
一个容器同时提供 API 和网页，只需要装有 Compose 插件的 Docker 和约 1 GB 内存。

The full guide (HTTPS, email, backups, AI, every setting) is in the docs site: `apps/docs/content/docs/self-hosting`, or run `pnpm docs:dev`.
完整指南（HTTPS、邮件、备份、AI、全部设置）在文档站里：`apps/docs/content/docs/self-hosting`，或运行 `pnpm docs:dev`。

## Start / 启动

```bash
git clone https://github.com/jinyuanZhou-Leo/Semestra-Next.git
cd Semestra-Next/deploy/selfhost
cp .env.example .env          # optional / 可选
docker compose up -d
```

Open <http://localhost:8000> (or `http://<server-ip>:8000`). The first start takes under a minute: the container creates its secrets, migrates the database and starts.
打开 <http://localhost:8000>（或 `http://<服务器 IP>:8000`）。首次启动不到一分钟：容器会生成密钥、迁移数据库并启动。

> The repository is private for now. Until the image is published publicly, run `docker login ghcr.io` with a token that has `read:packages`, or build locally: `docker build -f deploy/docker/Dockerfile --target allinone -t ghcr.io/jinyuanzhou-leo/semestra-allinone:latest .` from the repository root.
> 仓库目前是私有的。镜像公开之前，用有 `read:packages` 权限的 token 执行 `docker login ghcr.io`，或在仓库根目录自行构建（命令见上）。

### Verification codes / 验证码

Email defaults to `console`: sign-in codes are printed in the log.
邮件默认是 `console`：验证码会打印在日志里。

```bash
docker compose logs -f semestra
```

To send real email, set in `.env`: `SEMESTRA_EMAIL_BACKEND=smtp` plus the SMTP settings listed in [`../.env.example`](../.env.example) (or `resend`).
要发真实邮件，在 `.env` 里设置 `SEMESTRA_EMAIL_BACKEND=smtp` 和 [`../.env.example`](../.env.example) 里的 SMTP 配置（或 `resend`）。

### Single-user mode (planned) / 单用户模式（规划中）

`SEMESTRA_SINGLE_USER` (the first visitor creates the admin account, then sign-up closes) is not implemented yet: the variable is accepted and has no effect. Once real email is configured, anyone who can reach the instance can sign up, so keep it on a private network or behind your own access control for now.
`SEMESTRA_SINGLE_USER`（第一个访问者创建管理员账户，之后关闭注册）尚未实现：这个变量会被接受，但不起作用。配置真实邮件后，任何能访问实例的人都可以注册，所以目前请把实例放在内网，或放在你自己的访问控制之后。

## Secrets / 密钥

On first start the container writes `/data/secrets.env` (inside the `semestra-data` volume) containing `SEMESTRA_SECRET_KEY` and `SEMESTRA_ENCRYPTION_KEY`. **Back this file up**: without the encryption key, API keys your users saved can no longer be decrypted. Values you set yourself in `.env` take precedence.
首次启动时容器会在 `semestra-data` 卷里生成 `/data/secrets.env`，包含这两个密钥。**请备份这个文件**：丢失加密密钥后，用户保存的第三方密钥无法解密。你在 `.env` 里自己设置的值优先。

```bash
docker compose cp semestra:/data/secrets.env ./secrets.env.backup
```

## HTTPS with your own domain / 用自己的域名启用 HTTPS

Point an A/AAAA record at the server, open ports 80 and 443, then in `.env`:
把域名的 A/AAAA 记录指向服务器，开放 80 和 443 端口，然后在 `.env` 里：

```
SEMESTRA_DOMAIN=semestra.example.com
SEMESTRA_PUBLIC_URL=https://semestra.example.com
SEMESTRA_BIND=127.0.0.1
```

```bash
docker compose --profile https up -d
```

Caddy obtains and renews the certificate automatically. If you already run your own reverse proxy, skip the profile, keep `SEMESTRA_BIND=127.0.0.1`, set `SEMESTRA_PUBLIC_URL`, and proxy to port 8000 (do not buffer `/events/stream`).
Caddy 会自动申请和续期证书。已有自己的反向代理时，不用这个 profile，保持 `SEMESTRA_BIND=127.0.0.1`、设置 `SEMESTRA_PUBLIC_URL`，反向代理到 8000 端口即可（不要缓冲 `/events/stream`）。

## Upgrade / 升级

```bash
docker compose pull && docker compose up -d
```

Database migrations run automatically on start. Pin a version with `SEMESTRA_VERSION=1.2.0` in `.env` if you do not want to follow `latest`. Take a backup first (below).
数据库迁移会在启动时自动执行。不想跟随 `latest` 时，在 `.env` 里用 `SEMESTRA_VERSION=1.2.0` 固定版本。升级前先备份（见下）。

## Backup / 备份

Everything lives in the `semestra-data` volume (`/data`): databases, uploaded files and `secrets.env`.
所有数据都在 `semestra-data` 卷（`/data`）里：数据库、上传文件和 `secrets.env`。

**One-off consistent snapshot / 一次性一致性快照**

```bash
docker compose exec semestra semestra backup /data/backups     # databases + files
docker compose cp semestra:/data/backups ./semestra-backup
```

**Built-in daily backup to a folder on the host / 每日自动备份到宿主机目录**

```bash
mkdir backups && sudo chown 10001 backups
```

Uncomment `- ./backups:/backups` in `docker-compose.yml`, add `SEMESTRA_BACKUP_DIR=/backups` to `.env`, then `docker compose up -d`. It keeps the 7 newest snapshots of each database (`SEMESTRA_BACKUP_KEEP`) and mirrors uploaded files into `backups/storage`. Copy that folder off the machine regularly: a backup on the same disk does not survive the disk.
取消 `docker-compose.yml` 里 `- ./backups:/backups` 的注释，在 `.env` 加 `SEMESTRA_BACKUP_DIR=/backups`，再 `docker compose up -d`。每个数据库保留最近 7 份快照（`SEMESTRA_BACKUP_KEEP`），上传文件镜像到 `backups/storage`。请定期把这个目录复制到别的机器：和数据在同一块盘上的备份扛不住磁盘损坏。

**Restore / 恢复**

```bash
docker compose down
docker run --rm -v semestra_semestra-data:/data -v "$PWD/semestra-backup:/in:ro" alpine sh -c \
  'cp /in/db/semestra-<timestamp>.sqlite /data/semestra.db && rm -f /data/semestra.db-wal /data/semestra.db-shm && chown -R 10001:10001 /data'
docker compose up -d
```

(Also restore `storage/` and `secrets.env` into `/data` if the volume is new.)
（如果是全新的卷，还要把 `storage/` 和 `secrets.env` 放回 `/data`。）

## AI features / AI 功能

Users normally add their own provider key in the app. To give every user a default provider (e.g. a local model), configure an instance-wide one.
用户通常在应用里填写自己的 AI 提供方密钥。要给所有用户一个默认提供方（比如本地模型），配置实例级提供方。

With a local Ollama / 使用本地 Ollama：

```bash
docker compose --profile ai-local up -d
docker compose exec ollama ollama pull qwen3:8b
docker compose exec ollama ollama pull nomic-embed-text
```

Then in `.env` / 然后在 `.env` 里：

```
SEMESTRA_INSTANCE_AI_KIND=ollama
SEMESTRA_INSTANCE_AI_BASE_URL=http://ollama:11434
SEMESTRA_INSTANCE_AI_CHAT_MODEL=qwen3:8b
SEMESTRA_INSTANCE_AI_EMBEDDING_MODEL=nomic-embed-text
```

An Ollama running elsewhere on your network works too: set its URL as `SEMESTRA_INSTANCE_AI_BASE_URL` (private addresses are allowed by default in self-hosted mode). Ollama on the GPU needs the NVIDIA container toolkit and an override file; see the Ollama docs.
网络里别处运行的 Ollama 同样可用：把它的地址填进 `SEMESTRA_INSTANCE_AI_BASE_URL`（自部署默认允许访问私网地址）。要让 Ollama 用 GPU，需要安装 NVIDIA container toolkit 并写 override 文件，参见 Ollama 文档。

## Troubleshooting / 排错

| Symptom / 现象 | Check / 检查 |
|---|---|
| Container restarts / 容器反复重启 | `docker compose logs semestra` |
| "must be set in prod" | `SEMESTRA_AUTO_SECRETS` was removed from the compose file and no keys are set / 密钥缺失 |
| Cannot sign in over plain HTTP from another machine | Set `SEMESTRA_PUBLIC_URL` to the exact URL you open, or use the HTTPS profile / 设置 `SEMESTRA_PUBLIC_URL` 为实际访问地址，或启用 HTTPS |
| Volume permission errors on a bind mount | `sudo chown -R 10001:10001 <dir>` (the container runs as uid 10001) |
