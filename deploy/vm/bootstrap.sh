#!/usr/bin/env bash
# One-time setup of a fresh Debian VM for the API without Docker (README.md). Run as root:
#
#   sudo BACKUP_BUCKET=semestra-backups-xxxx bash bootstrap.sh
#
# Expects to be run from a copy of deploy/vm (deploy.sh copies it to ~/semestra-vm). Idempotent:
# running it again only fills in what is missing. It does NOT install the Cloudflare Tunnel
# token or the API's environment file; README.md lists those manual steps.
set -euo pipefail

: "${BACKUP_BUCKET:?set BACKUP_BUCKET to the GCS bucket for backups}"
[[ $EUID -eq 0 ]] || {
    echo "run as root" >&2
    exit 1
}

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
litestream_version=0.3.13

# 2 GB of swap: the e2-micro has 1 GB of RAM, and dependency installs and file parsing spike.
if ! swapon --show | grep -q /swapfile; then
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
fi
echo 'vm.swappiness=10' >/etc/sysctl.d/90-semestra.conf
sysctl -q --system

apt-get update
apt-get install -y ca-certificates curl gnupg sqlite3

# uv, installed system-wide. The Python version comes from apps/api/.python-version at deploy time.
if ! command -v uv >/dev/null; then
    curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin UV_NO_MODIFY_PATH=1 sh
fi

# Litestream (continuous SQLite replication to GCS). The package ships litestream.service.
if ! command -v litestream >/dev/null; then
    deb="litestream-v${litestream_version}-linux-amd64.deb"
    curl -fsSLo "/tmp/$deb" "https://github.com/benbjohnson/litestream/releases/download/v${litestream_version}/$deb"
    dpkg -i "/tmp/$deb"
    rm "/tmp/$deb"
fi

# cloudflared, from Cloudflare's apt repository. The tunnel token is installed by hand.
if ! command -v cloudflared >/dev/null; then
    install -m 0755 -d /usr/share/keyrings
    curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg -o /usr/share/keyrings/cloudflare-main.gpg
    echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' \
        >/etc/apt/sources.list.d/cloudflared.list
    apt-get update
    apt-get install -y cloudflared
fi

# The service user and the directory layout:
#   /opt/semestra/releases/<sha>  code, one directory per deploy; /opt/semestra/current -> active one
#   /opt/semestra/python          Python installed by uv
#   /var/lib/semestra             databases, uploaded files, pre-deploy snapshots
#   /etc/semestra                 semestra.env (secrets) and backup.env
id semestra >/dev/null 2>&1 || useradd --system --home-dir /var/lib/semestra --shell /usr/sbin/nologin semestra
install -d -m 0755 -o semestra -g semestra /opt/semestra /opt/semestra/releases /opt/semestra/python
install -d -m 0700 -o semestra -g semestra /var/lib/semestra
install -d -m 0750 -o root -g semestra /etc/semestra
echo "BACKUP_BUCKET=$BACKUP_BUCKET" >/etc/semestra/backup.env

install -m 0644 "$here"/litestream.yml /etc/litestream.yml
install -d /etc/systemd/system/litestream.service.d
install -m 0644 "$here"/systemd/litestream.service.d/semestra.conf /etc/systemd/system/litestream.service.d/
# Litestream runs as root by default; it only reads the databases and writes its own -litestream dirs.
install -m 0644 "$here"/systemd/semestra-api.service /etc/systemd/system/
install -m 0644 "$here"/systemd/semestra-storage-backup.service /etc/systemd/system/
install -m 0644 "$here"/systemd/semestra-storage-backup.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable semestra-api.service litestream.service
systemctl enable --now semestra-storage-backup.timer

cat <<MSG
Done. Remaining by hand (README.md):
  1. Write /etc/semestra/semestra.env from semestra.env.example (root:semestra, chmod 640).
  2. From your Mac: deploy/vm/deploy.sh (copies the code, installs dependencies, migrates, starts).
  3. sudo cloudflared service install <tunnel token>, then the edge IP override in README.md.
MSG
