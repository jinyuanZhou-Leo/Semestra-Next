#!/usr/bin/env bash
# Runs on the VM as root, fed by deploy.sh: `sudo bash -s <sha> < remote-deploy.sh`.
set -euo pipefail

sha="$1"
releases=/opt/semestra/releases
rel="$releases/$sha"
data=/var/lib/semestra
as_app=(sudo -u semestra env HOME="$data" UV_PYTHON_INSTALL_DIR=/opt/semestra/python
    UV_CACHE_DIR=/opt/semestra/uv-cache UV_PYTHON_PREFERENCE=only-managed)

[[ -f /etc/semestra/semestra.env ]] || {
    echo "deploy: /etc/semestra/semestra.env is missing (see semestra.env.example)" >&2
    exit 1
}
ln -sfn /etc/semestra/semestra.env "$data/.env"

if [[ ! -d "$rel" ]]; then
    install -d -o semestra -g semestra "$rel"
    tar -xzf "/tmp/semestra-$sha.tar.gz" -C "$rel"
    chown -R semestra:semestra "$rel"
fi
rm -f "/tmp/semestra-$sha.tar.gz"
install -d -o semestra -g semestra /opt/semestra/uv-cache

echo "deploy: installing dependencies"
(cd "$rel/apps/api" && "${as_app[@]}" uv sync --frozen --no-dev --compile-bytecode)

previous="$(readlink -f /opt/semestra/current || true)"
if [[ -n "$previous" && -f "$data/semestra.db" ]]; then
    echo "deploy: database snapshot"
    (cd "$data" && "${as_app[@]}" "$previous/apps/api/.venv/bin/semestra" backup "$data/backups/pre-deploy" --db-only) ||
        echo "deploy: WARNING pre-deploy snapshot failed, continuing" >&2
fi

echo "deploy: migrating"
(cd "$data" && "${as_app[@]}" "$rel/apps/api/.venv/bin/alembic" -c "$rel/apps/api/alembic.ini" upgrade head)

ln -sfn "$rel" /opt/semestra/current
systemctl restart semestra-api.service
for _ in $(seq 60); do
    if curl -fsS -o /dev/null http://127.0.0.1:8000/readyz; then
        echo "deploy: $sha is ready"
        # Keep the five newest releases.
        ls -1dt "$releases"/*/ | tail -n +6 | xargs -r rm -rf
        systemctl is-active --quiet litestream.service || systemctl restart litestream.service
        exit 0
    fi
    sleep 2
done

echo "deploy: $sha did not become ready; journalctl -u semestra-api follows" >&2
journalctl -u semestra-api.service -n 40 --no-pager >&2 || true
if [[ -n "$previous" ]]; then
    # Migrations only move forward (deploy/README.md), so the previous code runs on the new schema.
    ln -sfn "$previous" /opt/semestra/current
    systemctl restart semestra-api.service
    echo "deploy: rolled back to $(basename "$previous")" >&2
fi
exit 1
