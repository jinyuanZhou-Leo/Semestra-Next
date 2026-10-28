#!/usr/bin/env bash
# Deploy a commit to the VM from your machine (README.md):
#
#   deploy/vm/deploy.sh            # the commit you have checked out
#   deploy/vm/deploy.sh v1.5.0     # any git ref
#
# The VM has no IPv4 address, so the code travels from here over IAP (git archive -> scp); the VM
# itself only downloads Python and the locked dependencies. remote-deploy.sh does the rest: a
# database snapshot, uv sync, migrations, restart, /readyz check, and rollback to the previous
# release if the new one does not become ready.
set -euo pipefail

ref="${1:-HEAD}"
vm="${SEMESTRA_VM:-semestra-api}"
zone="${SEMESTRA_ZONE:-us-east1-b}"
ssh=(gcloud compute ssh "$vm" --zone="$zone" --tunnel-through-iap)

cd "$(git rev-parse --show-toplevel)"
sha="$(git rev-parse --short=12 "$ref^{commit}")"
[[ -z "$(git status --porcelain -- apps/api deploy/vm)" || "$ref" != HEAD ]] ||
    echo "deploy: note: uncommitted changes in apps/api or deploy/vm are not deployed" >&2

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
git archive --format=tar.gz -o "$tmp/release.tar.gz" "$sha" apps/api deploy/vm
gcloud compute scp --zone="$zone" --tunnel-through-iap "$tmp/release.tar.gz" "$vm:/tmp/semestra-$sha.tar.gz"
"${ssh[@]}" -- "sudo bash -s $sha" <deploy/vm/remote-deploy.sh
