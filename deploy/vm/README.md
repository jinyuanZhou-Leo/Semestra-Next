# 托管版：GCP 免费 e2-micro（uv + systemd，前端在 Vercel）

目标是 **每月 US$0**：API 跑在 GCP Always Free 的 e2-micro 上，不用 Docker；网页应用部署在 Vercel。和 `deploy/hosted/`（Docker + Caddy + 静态 IP，需要付费机型和 IPv4）是两条独立的路线，现在线上用的是这一条。

```
浏览器 ─► semestra.jyleo.cc（Vercel：网页应用）
      └─► semestra-api.jyleo.cc（Cloudflare）─► Cloudflare Tunnel ─► cloudflared ─► uvicorn 127.0.0.1:8000
                                                                    VM：e2-micro，只有 IPv6 外网地址
VM 出站：IPv6 直连；只有 IPv4 的服务（Canvas、GitHub、DeepSeek…）经 Cloudflare WARP
数据：/var/lib/semestra ─► Litestream 持续复制数据库到 GCS；systemd 定时器每天镜像上传文件
```

## 为什么这样设计（费用）

| 项目 | 免费额度 / 价格 | 本方案 |
|---|---|---|
| e2-micro | 每月 1 台（us-west1 / us-central1 / us-east1） | `us-east1-b` |
| 磁盘 | 30 GB 标准永久磁盘 | 30 GB `pd-standard` 启动盘，数据也在上面 |
| 外网 IPv4 | **不在免费层**，$0.005/小时（每月约 $3.6），每账户每月免 1 小时 | 不配；装机时临时挂一下再删 |
| 外网 IPv6 | 不收费 | 用 |
| Cloud NAT | 每台 VM $0.0014/小时 + $0.045/GB | 不用，改用免费的 Cloudflare WARP |
| 出站流量 | 每月 1 GB（北美出发） | 网页静态文件在 Vercel，API 流量很小 |
| Cloud Storage | 美国三个区域每月 5 GB | 备份 bucket 放 `us-east1` |

没有 IPv4 时只有 IPv6 出站。实测 PyPI、OpenAI、Anthropic、Gemini、OpenRouter、Resend、Google 登录、GCS 都有 IPv6；Canvas（`*.instructure.com`、学校自己的域名）、GitHub、DeepSeek 没有，所以 VM 上装了 WARP，只接管 IPv4 流量（IPv6 和 IAP、内网、元数据服务都排除在外）。代码也因此不在 VM 上 `git clone`，而是从你的电脑经 IAP 拷过去。

## 一次性搭建

以下命令在你的电脑上执行（已登录的 `gcloud`，项目 `semestra-jinyuan`）。

1. **预算告警**：结算 → 预算和提醒，建一个很小的月预算（例如 1 CAD，50% / 90% / 100% 提醒）。它只发邮件，不会停机。
2. **网络和 VM**（默认 VPC 不支持 IPv6 子网，所以单独建一个；防火墙只放行 IAP 的 SSH）：

   ```bash
   export PROJECT=semestra-jinyuan REGION=us-east1 ZONE=us-east1-b
   gcloud services enable compute.googleapis.com storage.googleapis.com iap.googleapis.com
   gcloud iam service-accounts create semestra-vm --display-name="Semestra VM"
   gcloud compute networks create semestra-net --subnet-mode=custom
   gcloud compute networks subnets create semestra-subnet --network=semestra-net --region=$REGION \
     --range=10.10.0.0/24 --stack-type=IPV4_IPV6 --ipv6-access-type=EXTERNAL \
     --enable-private-ip-google-access
   gcloud compute firewall-rules create semestra-iap-ssh --network=semestra-net \
     --direction=INGRESS --allow=tcp:22 --source-ranges=35.235.240.0/20
   gcloud compute instances create semestra-api --zone=$ZONE --machine-type=e2-micro \
     --subnet=semestra-subnet --stack-type=IPV4_IPV6 --ipv6-network-tier=PREMIUM \
     --image-family=debian-13 --image-project=debian-cloud \
     --boot-disk-size=30GB --boot-disk-type=pd-standard \
     --service-account=semestra-vm@$PROJECT.iam.gserviceaccount.com --scopes=storage-rw
   ```

   这样建出来的 VM 带一个临时 IPv4，装机时用。
3. **备份 bucket**（名字全球唯一，自己取）：

   ```bash
   export BUCKET=semestra-backups-<随便几位>
   gcloud storage buckets create gs://$BUCKET --location=$REGION --uniform-bucket-level-access
   gcloud storage buckets update gs://$BUCKET --versioning \
     --lifecycle-file=deploy/hosted/gcs-lifecycle.json
   gcloud storage buckets add-iam-policy-binding gs://$BUCKET \
     --member=serviceAccount:semestra-vm@$PROJECT.iam.gserviceaccount.com --role=roles/storage.objectAdmin
   ```
4. **WARP**（在 VM 上，`gcloud compute ssh semestra-api --zone=$ZONE --tunnel-through-iap`）：

   ```bash
   curl -fsSL https://pkg.cloudflareclient.com/pubkey.gpg | sudo gpg --yes --dearmor -o /usr/share/keyrings/cloudflare-warp-archive-keyring.gpg
   echo "deb [signed-by=/usr/share/keyrings/cloudflare-warp-archive-keyring.gpg] https://pkg.cloudflareclient.com/ $(. /etc/os-release; echo $VERSION_CODENAME) main" \
     | sudo tee /etc/apt/sources.list.d/cloudflare-client.list
   sudo apt-get update && sudo apt-get install -y cloudflare-warp
   warp-cli --accept-tos registration new
   # 先排除，再连接：IAP（SSH 从这里进来）、子网、链路本地（元数据服务）、全部 IPv6
   for r in 35.235.240.0/20 10.10.0.0/24 169.254.0.0/16 2000::/3; do warp-cli --accept-tos tunnel ip add-range $r; done
   warp-cli --accept-tos mode tunnel_only    # 不接管 DNS，元数据服务的域名照常解析
   warp-cli --accept-tos connect && sudo systemctl enable warp-svc
   curl -s https://www.cloudflare.com/cdn-cgi/trace | grep warp=   # 应为 warp=on
   ```
5. **初始化 VM**：先把这个目录拷上去再执行（在仓库根目录）：

   ```bash
   gcloud compute scp --zone=$ZONE --tunnel-through-iap --recurse deploy/vm semestra-api:~/semestra-vm
   gcloud compute ssh semestra-api --zone=$ZONE --tunnel-through-iap -- \
     "sudo BACKUP_BUCKET=$BUCKET bash ~/semestra-vm/bootstrap.sh"
   ```

   它会建 2 GB swap、装 uv / Litestream / cloudflared、建 `semestra` 用户和目录、装好 systemd 单元。
6. **环境文件**：在 VM 上以 root 按 [`semestra.env.example`](semestra.env.example) 写 `/etc/semestra/semestra.env`，然后 `sudo chown root:semestra` + `sudo chmod 640`。密钥的生成方法和老项目的对应关系见 [`deploy/README.md`](../README.md)。**`SEMESTRA_ENCRYPTION_KEY` 要离线备份**。值只放在 VM 上，不要贴进聊天或提交。
7. **第一次部署**（在你的电脑上，仓库根目录）：`deploy/vm/deploy.sh`。第一次会下载 Python（版本取 `apps/api/.python-version`）和依赖，要几分钟。
8. **Cloudflare Tunnel**：Cloudflare 控制台 → Zero Trust → Networks → Tunnels → 新建 tunnel（cloudflared），复制安装命令里的令牌，在 VM 上执行 `sudo cloudflared service install <令牌>`。然后让它只走 IPv6（不绕 WARP）：

   ```bash
   sudo mkdir -p /etc/systemd/system/cloudflared.service.d
   printf '[Service]\nEnvironment=TUNNEL_EDGE_IP_VERSION=6\n' | sudo tee /etc/systemd/system/cloudflared.service.d/ipv6.conf
   sudo systemctl daemon-reload && sudo systemctl restart cloudflared
   ```

   在 tunnel 的 Public Hostname 里加 `semestra-api.jyleo.cc` → `http://localhost:8000`，Cloudflare 会自动建 DNS 记录。检查 `curl https://semestra-api.jyleo.cc/readyz`。
9. **删掉临时 IPv4**：`gcloud compute instances delete-access-config semestra-api --zone=$ZONE --access-config-name=external-nat`。之后 SSH 照常走 IAP。
10. **Vercel**：新建项目，导入仓库，Root Directory 填 `apps/web`（`apps/web/vercel.json` 已写好构建命令、SPA 回退和安全头）；环境变量 `VITE_API_ORIGIN=https://semestra-api.jyleo.cc`；域名绑定 `semestra.jyleo.cc`。Google 登录要在 OAuth 客户端的“已获授权的 JavaScript 来源”里加上 `https://semestra.jyleo.cc`。
11. **演练恢复**：见下文“恢复”。

## 日常

| 事情 | 命令 |
|---|---|
| 部署当前提交 / 某个 tag | `deploy/vm/deploy.sh` / `deploy/vm/deploy.sh v1.5.0`（失败会自动回滚到上一个版本） |
| 登录 VM | `gcloud compute ssh semestra-api --zone=us-east1-b --tunnel-through-iap` |
| 看日志 | `journalctl -u semestra-api -f`；`journalctl -u cloudflared`；`journalctl -u litestream` |
| 手动数据库快照 | `cd /var/lib/semestra && sudo -u semestra /opt/semestra/current/apps/api/.venv/bin/semestra backup /var/lib/semestra/backups/manual --db-only` |
| WARP 状态 | `warp-cli --accept-tos status` |
| 文件镜像 | `systemctl status semestra-storage-backup.timer` |

部署前的数据库快照在 `/var/lib/semestra/backups/pre-deploy/`。迁移只向前（见 `deploy/README.md`），回滚只换回上一版代码。

## 恢复

1. 按“一次性搭建”第 2、4、5 步重建 VM，放回 `/etc/semestra/semestra.env`（来自你的离线备份）。
2. 恢复数据库：

   ```bash
   sudo systemctl stop semestra-api litestream
   for db in semestra.db agent_checkpoints.sqlite; do
     sudo env $(cat /etc/semestra/backup.env) litestream restore -if-replica-exists -config /etc/litestream.yml /var/lib/semestra/$db
   done
   ```

   恢复到某个时间点：加 `-timestamp 2026-10-20T08:00:00Z`。
3. 恢复文件：`sudo gcloud storage rsync --recursive gs://$BUCKET/storage /var/lib/semestra/storage`，然后 `sudo chown -R semestra:semestra /var/lib/semestra`。
4. 在你的电脑上 `deploy/vm/deploy.sh`，再按第 8 步装回 tunnel（令牌可以在控制台重新获取）。

## 已知限制

- 官网 `/landing/` 和文档 `/docs/` 原来由 Caddy 镜像托管，这条路线还没有安排它们（可以各自再建一个 Vercel 项目）。
- e2-micro 只有约 0.25 个 vCPU 的持续算力，大 PDF 的解析和索引会比较慢；本地 OCR 模型不在这台机器上跑。
- 发布工作流（`release.yml`）的 deploy 任务面向 Docker 路线的 SSH 部署，这条路线用 `deploy/vm/deploy.sh` 手动部署。
