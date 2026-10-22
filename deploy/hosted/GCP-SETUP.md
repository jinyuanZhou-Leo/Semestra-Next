# 托管版：GCP 一次性搭建

以下命令由你在自己的机器上执行（需要已登录的 `gcloud`）。名称和区域都可以改，但要和 `docker-compose.yml`、`litestream.yml` 里用到的 bucket 名保持一致。`semestra-backups` 这个 bucket 名是全球唯一的，如果被占用，换一个并同步修改 VM 上 `.env` 的 `BACKUP_BUCKET`。

```bash
export PROJECT=<你的项目 ID>
export REGION=northamerica-northeast2     # 多伦多，离你近；可换
export ZONE=${REGION}-a
export BUCKET=semestra-backups
gcloud config set project $PROJECT
gcloud services enable compute.googleapis.com storage.googleapis.com
```

## 1. 备份 bucket 与服务账号

```bash
gcloud iam service-accounts create semestra-vm --display-name="Semestra VM"

gcloud storage buckets create gs://$BUCKET --location=$REGION --uniform-bucket-level-access
gcloud storage buckets update gs://$BUCKET --versioning
# 上传文件被删除后保留 30 天可恢复；Litestream 的旧世代 1 天后清理
gcloud storage buckets update gs://$BUCKET --lifecycle-file=deploy/hosted/gcs-lifecycle.json

# VM 通过元数据服务器使用这个服务账号，不需要任何密钥文件
gcloud storage buckets add-iam-policy-binding gs://$BUCKET \
  --member=serviceAccount:semestra-vm@$PROJECT.iam.gserviceaccount.com \
  --role=roles/storage.objectAdmin
```

## 2. 静态 IP、数据盘、VM、防火墙

```bash
gcloud compute addresses create semestra-api-ip --region=$REGION
gcloud compute disks create semestra-data --zone=$ZONE --size=20GB --type=pd-balanced

gcloud compute instances create semestra-api \
  --zone=$ZONE --machine-type=e2-small \
  --image-family=debian-12 --image-project=debian-cloud \
  --address=semestra-api-ip \
  --service-account=semestra-vm@$PROJECT.iam.gserviceaccount.com --scopes=storage-rw \
  --disk=name=semestra-data,device-name=semestra-data,mode=rw,boot=no,auto-delete=no \
  --tags=semestra-api

gcloud compute firewall-rules create semestra-web \
  --allow=tcp:80,tcp:443,udp:443 --target-tags=semestra-api
gcloud compute addresses describe semestra-api-ip --region=$REGION --format='value(address)'
```

`auto-delete=no` 让数据盘在 VM 被删除后依然保留。SSH 默认由 `default-allow-ssh` 放行；发布工作流从 GitHub 托管的 runner 连入，IP 不固定，所以只能依赖密钥登录（GCE 镜像默认禁用密码登录）。

## 3. DNS

把 `semestra.jyleo.cc` 的 **A 记录**指向上面输出的静态 IP。生效后 Caddy 才能申请到证书。

## 4. 初始化 VM

```bash
# 在本机生成专供发布工作流使用的 SSH 密钥（私钥放进 GitHub secret，不要放在别处）
ssh-keygen -t ed25519 -N '' -f semestra-deploy-key -C github-actions

gcloud compute scp --zone=$ZONE --recurse deploy/hosted semestra-api:~/hosted
gcloud compute ssh semestra-api --zone=$ZONE -- \
  "cd ~/hosted && sudo DATA_DISK=/dev/disk/by-id/google-semestra-data BACKUP_BUCKET=$BUCKET \
   DEPLOY_PUBKEY='$(cat semestra-deploy-key.pub)' bash bootstrap-vm.sh"
```

然后：

1. 以 root 在 `/srv/semestra/app/.env` 写入生产环境文件（模板 `deploy/hosted/.env.example`），`chown deploy:deploy`，`chmod 600`。
2. 生成密钥：`python3 -c "import secrets; print(secrets.token_urlsafe(48))"`；Fernet 密钥：`docker run --rm python:3.13-slim sh -c "pip install -q cryptography && python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'"`。**把 `SEMESTRA_ENCRYPTION_KEY` 离线保存**（密码管理器 + 纸质/U 盘各一份）。
3. 在 GitHub 仓库配置 `production` Environment 的 secrets：
   - `DEPLOY_SSH_KEY`：`semestra-deploy-key` 私钥的全部内容
   - `DEPLOY_SSH_KNOWN_HOSTS`：`ssh-keyscan -t ed25519 <静态 IP>` 的输出
   - `DEPLOY_HOST`：静态 IP；`DEPLOY_USER`：`deploy`
4. 推 tag 触发第一次发布（见 `deploy/README.md`），批准部署。

## 5. 可选：staging

1. DNS：`semestra-staging.jyleo.cc` 指向同一个 IP。
2. VM 上：`cp /srv/semestra/app/conf.d/staging.caddy.example /srv/semestra/app/conf.d/staging.caddy`；`/srv/semestra/app/.env.staging` 复制自 `.env` 并改为 staging 域名（`SEMESTRA_PUBLIC_*`、`SEMESTRA_CORS_ORIGINS`）、**换一组独立的密钥**、关掉 Sentry/Resend 的生产凭据。
3. GitHub：创建 Environment `staging`（同样 4 个 secrets），仓库变量 `STAGING_ENABLED=true`。此后每次合并到 `main` 都会部署到 staging。
4. staging 只有应用（API + 前端同源），不带官网和文档。

## 日常运维速查

| 事情 | 命令（在 VM 的 `/srv/semestra/app`） |
|---|---|
| 看日志 | `docker compose logs -f api` |
| 手动部署某版本 | `./deploy.sh 0.1.0` |
| 手动做一次数据库快照 | `docker compose exec api semestra backup /data/backups/manual --db-only` |
| 看 Litestream 状态 | `docker compose logs --tail 50 litestream` |
| 看文件镜像状态 | `systemctl status semestra-storage-backup.timer`、`journalctl -u semestra-storage-backup` |
