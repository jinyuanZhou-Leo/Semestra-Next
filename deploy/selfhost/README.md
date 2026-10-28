# Self-hosting Semestra / 自部署 Semestra

One container serves both the API and the web app. You need Docker with the Compose plugin and about 3 GB of RAM: the default image (about 2 GB) reads scanned pages on the server, which takes up to 2 GB while it runs. Without that, the smaller image needs about 1 GB ([Local OCR](#local-ocr--本机-ocr)).
一个容器同时提供 API 和网页，需要装有 Compose 插件的 Docker 和约 3 GB 内存：默认镜像（约 2 GB）会在服务器上识别扫描页，识别时最多占用 2 GB。不需要这个功能时，换成小镜像只要约 1 GB（见[本机 OCR](#local-ocr--本机-ocr)）。

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

> The repository is private for now. Until the image is published publicly, run `docker login ghcr.io` with a token that has `read:packages`, or build locally: `docker build -f deploy/docker/Dockerfile --target allinone-ocr -t ghcr.io/jinyuanzhou-leo/semestra-allinone:latest-ocr .` from the repository root.
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

## Local OCR / 本机 OCR

The default image (`semestra-allinone:<version>-ocr`, about 2 GB) reads scanned PDF pages and photos on this machine with PaddleOCR (PP-OCRv6, on ONNX Runtime, CPU only), so no AI model is called for them. It runs on amd64 and arm64, including Docker on Apple Silicon. Reading takes up to 2 GB of RAM on top of the app's 1 GB, one document at a time, and about 2 seconds per page with the default model.
默认镜像（`semestra-allinone:<版本>-ocr`，约 2 GB）用 PaddleOCR（PP-OCRv6，ONNX Runtime，只用 CPU）在本机识别扫描版 PDF 和照片，不会为此调用 AI 模型。支持 amd64 与 arm64（包括 Apple Silicon 上的 Docker）。识别时在应用本身约 1 GB 之外再占用最多 2 GB 内存，一次处理一个文档，默认模型每页约 2 秒。

Every model is inside the image. Each user can pick another one (PP-OCRv6 tiny/small/medium, PP-OCRv5 mobile/server) or a provider's model in the **OCR** row of AI settings; `SEMESTRA_LOCAL_OCR_MODEL` sets the one used until they do.
所有模型都已打包在镜像里。每个用户可以在 AI 设置的 **OCR** 一行换成别的模型（PP-OCRv6 tiny/small/medium、PP-OCRv5 mobile/server）或某个服务商的模型；`SEMESTRA_LOCAL_OCR_MODEL` 设定用户没选时用的模型。

To switch to the smaller image without it, set `SEMESTRA_IMAGE_VARIANT=` (empty) in `.env` and run `docker compose up -d`; users then choose a provider's model for **OCR**. Set it back to `-ocr` to return.
要换成不带它的小镜像，在 `.env` 里写 `SEMESTRA_IMAGE_VARIANT=`（留空），再运行 `docker compose up -d`；用户之后在 **OCR** 一行里选服务商的模型。改回 `-ocr` 即可换回来。

## Troubleshooting / 排错

| Symptom / 现象 | Check / 检查 |
|---|---|
| Container restarts / 容器反复重启 | `docker compose logs semestra` |
| "must be set in prod" | `SEMESTRA_AUTO_SECRETS` was removed from the compose file and no keys are set / 密钥缺失 |
| Cannot sign in over plain HTTP from another machine | Set `SEMESTRA_PUBLIC_URL` to the exact URL you open, or use the HTTPS profile / 设置 `SEMESTRA_PUBLIC_URL` 为实际访问地址，或启用 HTTPS |
| Volume permission errors on a bind mount | `sudo chown -R 10001:10001 <dir>` (the container runs as uid 10001) |
