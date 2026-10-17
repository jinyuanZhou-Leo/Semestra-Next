#!/usr/bin/env bash
# One-time setup for a fresh Debian 12 VM. Run as root after attaching the data disk:
#
#   DATA_DISK=/dev/disk/by-id/google-semestra-data \
#   BACKUP_BUCKET=semestra-backups \
#   DEPLOY_PUBKEY='ssh-ed25519 AAAA... github-actions' \
#   sudo -E bash bootstrap-vm.sh
#
# It installs Docker, formats and mounts the disk at /srv/semestra (only if the disk has no
# filesystem yet), creates the directory layout, a "deploy" user for the release workflow and
# the systemd timer that mirrors uploaded files to GCS. See GCP-SETUP.md for the full runbook.
set -euo pipefail

: "${DATA_DISK:?set DATA_DISK to the persistent disk device}"
: "${BACKUP_BUCKET:?set BACKUP_BUCKET}"
: "${DEPLOY_PUBKEY:?set DEPLOY_PUBKEY to the public key the release workflow uses}"
[[ $EUID -eq 0 ]] || {
    echo "run as root" >&2
    exit 1
}

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mount_point=/srv/semestra
app_uid=10001 # the uid the API container runs as

if ! command -v docker >/dev/null; then
    apt-get update
    apt-get install -y ca-certificates curl gnupg
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
    # shellcheck source=/dev/null
    codename="$(. /etc/os-release && echo "$VERSION_CODENAME")"
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $codename stable" \
        >/etc/apt/sources.list.d/docker.list
    apt-get update
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
fi
systemctl enable --now docker

if ! blkid "$DATA_DISK" >/dev/null 2>&1; then
    mkfs.ext4 -m 0 -E lazy_itable_init=0,lazy_journal_init=0,discard "$DATA_DISK"
fi
uuid="$(blkid -s UUID -o value "$DATA_DISK")"
grep -q "$uuid" /etc/fstab || echo "UUID=$uuid $mount_point ext4 discard,defaults,nofail 0 2" >>/etc/fstab
mkdir -p "$mount_point"
mountpoint -q "$mount_point" || mount "$mount_point"

mkdir -p "$mount_point"/{app,data,data-staging}
chown "$app_uid:$app_uid" "$mount_point/data" "$mount_point/data-staging"
chmod 0700 "$mount_point/data" "$mount_point/data-staging"

id deploy >/dev/null 2>&1 || useradd --create-home --shell /bin/bash --groups docker deploy
install -d -m 0700 -o deploy -g deploy /home/deploy/.ssh
echo "$DEPLOY_PUBKEY" >/home/deploy/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys
chmod 0600 /home/deploy/.ssh/authorized_keys
chown -R deploy:deploy "$mount_point/app"

install -d /etc/semestra
echo "BACKUP_BUCKET=$BACKUP_BUCKET" >/etc/semestra/backup.env
install -m 0644 "$here"/systemd/semestra-storage-backup.service /etc/systemd/system/
install -m 0644 "$here"/systemd/semestra-storage-backup.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now semestra-storage-backup.timer

cat <<MSG
Done. Remaining by hand:
  1. Put the production environment file at $mount_point/app/.env (see .env.example).
  2. If the GHCR images are private: docker login ghcr.io -u <user> with a read:packages token (as the deploy user).
  3. Run the release workflow (or copy this directory to $mount_point/app and run ./deploy.sh <tag>).
MSG
