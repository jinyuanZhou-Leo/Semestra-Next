# Self-hosting Semestra

[English](#english) · [中文](#中文)

## English

One container serves the API and the web app on port 8000; all data lives in the `semestra-data`
volume. You need Docker with the Compose plugin and about 4 GB of RAM (1 GB with the smaller
image). The repository and the images are public.

```bash
git clone https://github.com/jinyuanZhou-Leo/Semestra-Next.git
cd Semestra-Next/deploy/selfhost
cp .env.example .env
```

### On your computer

```bash
docker compose up -d
```

Open <http://localhost:8000>. Sign-in codes are in `docker compose logs -f semestra`.

### On your local network

Set `SEMESTRA_PUBLIC_URL=http://<machine-ip>:8000` in `.env`, then `docker compose up -d`.

### On a server with a domain (bundled Caddy, automatic HTTPS)

Point the domain at the server and open ports 80 and 443. In `.env`:

```bash
COMPOSE_PROFILES=https
SEMESTRA_DOMAIN=semestra.example.com
SEMESTRA_PUBLIC_URL=https://semestra.example.com
SEMESTRA_BIND=127.0.0.1
```

Then `docker compose up -d`.

### Behind your own reverse proxy

Set `SEMESTRA_PUBLIC_URL=https://<your domain>` and `SEMESTRA_BIND=127.0.0.1`, start with
`docker compose up -d`, and proxy to `127.0.0.1:8000`. Do not buffer `/events/stream`, and allow
request bodies up to 1100 MB.

### After that

```bash
docker compose cp semestra:/data/secrets.env ./secrets.env.backup   # keep this file safe
docker compose pull && docker compose up -d                          # upgrade
```

Email, backups and restore, image choice, building the image yourself, optional features and every
setting: [`apps/docs/content/docs/self-hosting`](../../apps/docs/content/docs/self-hosting) (run
`pnpm docs:dev` to read it as a site).

## 中文

一个容器在 8000 端口同时提供 API 和网页应用，全部数据都在 `semestra-data` 卷里。需要装有 Compose 插件的 Docker，以及约
4 GB 内存（小镜像约 1 GB）。仓库和镜像都是公开的。

```bash
git clone https://github.com/jinyuanZhou-Leo/Semestra-Next.git
cd Semestra-Next/deploy/selfhost
cp .env.example .env
```

### 在本机

```bash
docker compose up -d
```

打开 <http://localhost:8000>。登录验证码在 `docker compose logs -f semestra` 里。

### 在局域网

在 `.env` 里设置 `SEMESTRA_PUBLIC_URL=http://<机器 IP>:8000`，再运行 `docker compose up -d`。

### 有域名的服务器（内置 Caddy，自动 HTTPS）

把域名指向服务器，开放 80 和 443 端口。在 `.env` 里：

```bash
COMPOSE_PROFILES=https
SEMESTRA_DOMAIN=semestra.example.com
SEMESTRA_PUBLIC_URL=https://semestra.example.com
SEMESTRA_BIND=127.0.0.1
```

再运行 `docker compose up -d`。

### 放在已有的反向代理后面

设置 `SEMESTRA_PUBLIC_URL=https://<你的域名>` 和 `SEMESTRA_BIND=127.0.0.1`，运行 `docker compose up -d`，把域名代理到
`127.0.0.1:8000`。不要缓冲 `/events/stream`，并允许最大 1100 MB 的请求体。

### 之后

```bash
docker compose cp semestra:/data/secrets.env ./secrets.env.backup   # 妥善保管这个文件
docker compose pull && docker compose up -d                          # 升级
```

邮件、备份与恢复、镜像选择、自己构建镜像、可选功能和全部设置见
[`apps/docs/content/docs/self-hosting`](../../apps/docs/content/docs/self-hosting)（运行 `pnpm docs:dev` 可以按网站阅读）。
