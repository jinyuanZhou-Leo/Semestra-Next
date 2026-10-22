#!/usr/bin/env bash
# Deploy an image tag to the hosted stack and roll back automatically if it does not come up.
#
#   ./deploy.sh <image-tag>             production (services "api" and "caddy", same tag)
#   ./deploy.sh --staging <image-tag>   staging    (service "api-staging", profile "staging")
#
# Runs on the VM in /srv/semestra/app; the release workflow calls it over SSH.
# Schema migrations only move forward: a rollback restores the previous image, and a
# database snapshot taken just before the deploy is kept in /data/backups/pre-deploy.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

service=api
pulled=(api caddy)
tag_var=SEMESTRA_IMAGE_TAG
compose=(docker compose)
if [[ "${1:-}" == "--staging" ]]; then
    service=api-staging
    pulled=(api-staging)
    tag_var=SEMESTRA_STAGING_IMAGE_TAG
    compose=(docker compose --profile staging)
    shift
fi
tag="${1:?usage: deploy.sh [--staging] <image-tag>}"
[[ "$tag" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || {
    echo "invalid image tag: $tag" >&2
    exit 2
}
[[ -f .env ]] || {
    echo ".env is missing in $PWD" >&2
    exit 2
}

current_tag() { sed -n "s/^${tag_var}=//p" .env | tail -n 1; }

set_tag() {
    if grep -q "^${tag_var}=" .env; then
        sed -i "s|^${tag_var}=.*|${tag_var}=$1|" .env
    else
        echo "${tag_var}=$1" >>.env
    fi
}

wait_ready() {
    for _ in $(seq 1 30); do
        if "${compose[@]}" exec -T "$service" python -c \
            "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/readyz', timeout=3)" \
            >/dev/null 2>&1; then
            return 0
        fi
        sleep 2
    done
    return 1
}

previous="$(current_tag)"
echo "deploy: ${service} ${previous:-<none>} -> ${tag}"

if [[ -n "$previous" ]] && "${compose[@]}" ps --status running --quiet "$service" | grep -q .; then
    "${compose[@]}" exec -T "$service" semestra backup /data/backups/pre-deploy --db-only ||
        echo "deploy: WARNING pre-deploy snapshot failed, continuing" >&2
fi

set_tag "$tag"
if ! "${compose[@]}" pull "${pulled[@]}"; then
    echo "deploy: pulling ${tag} failed, nothing changed" >&2
    [[ -n "$previous" ]] && set_tag "$previous"
    exit 1
fi
"${compose[@]}" up -d --remove-orphans

if wait_ready; then
    echo "deploy: ${tag} is ready"
    docker image prune -f >/dev/null
    exit 0
fi

echo "deploy: ${tag} did not become ready, rolling back to ${previous:-<none>}" >&2
"${compose[@]}" logs --tail 80 "$service" >&2 || true
if [[ -n "$previous" ]]; then
    set_tag "$previous"
    "${compose[@]}" up -d --remove-orphans
    wait_ready || echo "deploy: rollback also failed, intervene manually" >&2
fi
exit 1
