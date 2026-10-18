# 恢复手册

场景：VM 或数据盘丢失，要在新 VM 上恢复全部数据。数据分三部分：

| 数据 | 备份位置 | 恢复方式 |
|---|---|---|
| SQLite 数据库（`semestra.db`、`agent_checkpoints.sqlite`） | `gs://<bucket>/litestream/…`（Litestream 持续复制，保留 30 天） | `litestream restore` |
| 用户上传文件（`/data/storage`） | `gs://<bucket>/storage/`（每日镜像，删除的文件保留 30 天版本） | `gcloud storage rsync` |
| 密钥（`SECRET_KEY`、`ENCRYPTION_KEY`、`.env`） | **不在云端**，在你的离线备份里 | 手动放回 |

没有 `ENCRYPTION_KEY`，数据库能恢复，但用户保存的第三方密钥（AI、Canvas）无法解密，只能让用户重新填写。

## 步骤

1. **新建 VM 和数据盘**：按 `GCP-SETUP.md` 第 2、4 步（IP 可以复用旧的静态 IP；换了 IP 就更新 DNS A 记录）。`bootstrap-vm.sh` 跑完后 `/srv/semestra` 已就绪。
2. **放回 `.env`**：来自你的离线备份，路径 `/srv/semestra/app/.env`（模板见 `.env.example`）。
3. **恢复数据库**（在 VM 上，`BUCKET` 换成实际 bucket）：

   ```bash
   cd /srv/semestra/app
   for db in semestra.db agent_checkpoints.sqlite; do
     docker run --rm -e BACKUP_BUCKET=$BUCKET \
       -v $PWD/litestream.yml:/etc/litestream.yml:ro -v /srv/semestra/data:/data \
       litestream/litestream:0.3.13 restore -if-replica-exists -config /etc/litestream.yml /data/$db
   done
   sudo chown -R 10001:10001 /srv/semestra/data
   ```

   恢复到某个时间点：加 `-timestamp 2026-10-20T08:00:00Z`。`agent_checkpoints.sqlite` 在对应模块上线前不存在，`-if-replica-exists` 会跳过。
4. **恢复文件**：

   ```bash
   docker run --rm -v /srv/semestra/data/storage:/storage google/cloud-sdk:slim \
     gcloud storage rsync --recursive gs://$BUCKET/storage /storage
   sudo chown -R 10001:10001 /srv/semestra/data
   ```
5. **启动**：把发布流程里最近一次成功的版本部署上去：`./deploy.sh <版本>`（GitHub Actions 里重跑最近的 Release 工作流，或手动 `docker login ghcr.io` 后执行）。检查 `docker compose exec api python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8000/readyz').read())"`。
6. **验证**：登录一个账户，打开一门课程和一个已上传的文件；确认 `docker compose logs litestream` 在复制，且 `systemctl list-timers | grep semestra` 能看到文件镜像定时器。

## 其它常见恢复

- **误删了某个上传文件**（30 天内）：`gcloud storage ls --all-versions gs://$BUCKET/storage/users/<user_id>/…` 找到历史版本，用 `gcloud storage cp gs://…#<generation> <目标路径>` 取回。
- **一次发布后发现数据损坏**：部署前的快照在 `/srv/semestra/data/backups/pre-deploy/db/`（保留最近 7 份）。停掉 `api`，把快照复制成 `/srv/semestra/data/semestra.db`（删除旁边的 `-wal`、`-shm` 文件），再启动旧版本。Litestream 会把这当作新世代继续复制。

## 演练记录

做完一次完整演练后，在下面追加一行（日期、做了什么、耗时、发现的问题）：

| 日期 | 演练内容 | 耗时 | 问题 |
|---|---|---|---|
| | | | |
