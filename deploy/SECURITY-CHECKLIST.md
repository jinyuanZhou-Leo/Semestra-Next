# 上线前安全清单

托管版每次大版本上线前逐项确认；自部署用户适用其中与自己相关的几项。能自动检查的项写了对应位置。

- [ ] **密钥只在两处**：VM 的 `/srv/semestra/app/.env`（`chmod 600`，属主 `deploy`）和 GitHub Environments。仓库中没有明文：`git log -p | grep -iE "(secret|api_key|token)="` 无命中；GitHub 仓库已开启 secret scanning。
- [ ] **`SEMESTRA_ENCRYPTION_KEY` 已离线备份**，且至少两处（密码管理器 + 另一介质）。丢失它，用户保存的第三方密钥无法恢复。
- [ ] **生产环境拒绝弱密钥**：`SEMESTRA_ENV=prod`，缺少密钥时容器启动失败（`deploy-check` 工作流每次都会验证）。
- [ ] **Cookie**：`Secure`、`HttpOnly`、`SameSite=Lax`，CSRF 校验生效（M01 实现；上线前用浏览器开发者工具确认 Set-Cookie，并确认无 `X-Semestra-CSRF` 的写请求被拒绝）。
- [ ] **CORS** 只允许正式前端域名：`curl -si -H 'Origin: https://evil.example' https://api.semestra.jyleo.cc/healthz` 的响应里没有 `access-control-allow-origin`。
- [ ] **Caddy 安全头与请求体上限**：`curl -sI https://api.semestra.jyleo.cc/healthz` 能看到 HSTS、`X-Content-Type-Options`、`X-Frame-Options`；超过 60 MB 的上传返回 413。前端同理检查 `https://semestra.jyleo.cc`（CSP 在 `apps/web/vercel.json`）。
- [ ] **出站私网拦截开启**：托管版 `.env` 中 `SEMESTRA_ALLOW_PRIVATE_EGRESS=false`（或未设置）；自部署才打开。
- [ ] **限流生效**（登录、发码、上传、AI）：对各接口连续请求，确认返回 `common.rate_limited`。
- [ ] **容器以非 root 运行**：`docker compose exec api id -u` 为 `10001`（`deploy-check` 也会验证）。
- [ ] **只开放 80/443**：GCP 防火墙规则 `semestra-web`；API 容器的 8000 端口没有映射到宿主机（compose 只用 `expose`）。
- [ ] **SSH**：只允许密钥登录；`deploy` 用户的私钥只存在于 GitHub Environment secret；`DEPLOY_SSH_KNOWN_HOSTS` 已固定主机密钥。`production` Environment 配置了 Required reviewers。
- [ ] **GCS bucket**：统一 bucket 级访问控制、关闭公共访问、已开启版本控制与生命周期规则；服务账号只有这一个 bucket 的权限。
- [ ] **备份恢复演练完成一次**，并在 `hosted/RESTORE.md` 的演练记录里留了一行。
- [ ] **监控**：Uptime 检查 `/healthz`，告警送达你本人；Sentry（如启用）确认事件里没有请求体、Cookie、请求头。
- [ ] **Sentry 数据**：后端 `send_default_pii=False`，请求内容在 `before_send` 中被清除；前端只上传错误与堆栈。
- [ ] **依赖**：GitHub Dependabot（或定期 `uv lock --upgrade` / `pnpm update`）已启用。
