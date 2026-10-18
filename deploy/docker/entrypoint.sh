#!/bin/sh
# Container entrypoint: (optionally) bootstrap secrets, migrate the database, start the server.
#
#   SEMESTRA_AUTO_SECRETS=true   generate SECRET_KEY / ENCRYPTION_KEY into $DATA_DIR/secrets.env on
#                                first start and reuse them afterwards (self-hosting). Keys given
#                                through the environment always win over the file.
#   SEMESTRA_SKIP_MIGRATIONS=true  do not run `alembic upgrade head` before starting.
set -eu

data_dir="${SEMESTRA_DATA_DIR:-/data}"
secrets_file="$data_dir/secrets.env"

if [ "${SEMESTRA_AUTO_SECRETS:-false}" = "true" ]; then
    mkdir -p "$data_dir"
    if [ ! -f "$secrets_file" ]; then
        (
            umask 077
            python - >"$secrets_file" <<'PY'
import secrets

from cryptography.fernet import Fernet

print(f"SEMESTRA_SECRET_KEY={secrets.token_urlsafe(48)}")
print(f"SEMESTRA_ENCRYPTION_KEY={Fernet.generate_key().decode()}")
PY
        )
        echo "semestra: generated $secrets_file. BACK THIS FILE UP: without SEMESTRA_ENCRYPTION_KEY the stored API keys of your users can no longer be decrypted." >&2
    fi
    while IFS='=' read -r key value; do
        case "$key" in
        SEMESTRA_SECRET_KEY | SEMESTRA_ENCRYPTION_KEY)
            eval "current=\${$key:-}"
            if [ -z "$current" ]; then
                export "$key=$value"
            fi
            ;;
        esac
    done <"$secrets_file"
fi

if [ "${SEMESTRA_SKIP_MIGRATIONS:-false}" != "true" ]; then
    alembic upgrade head
fi

exec "$@"
