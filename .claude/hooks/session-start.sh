#!/bin/bash
# Prepares a Claude Code cloud session: the Node version CI uses (the image ships an older one),
# the pnpm version `packageManager` pins, and both dependency trees, so a thread can run lint,
# type checks and tests right away. Local machines are left alone.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}"
env_file="${CLAUDE_ENV_FILE:-/dev/null}"

# Node: the major version CI's setup-node uses.
node_major=26
node_dir=/opt/node$node_major
if [ ! -x "$node_dir/bin/node" ]; then
  version=$(curl -fsSL "https://nodejs.org/dist/latest-v$node_major.x/SHASUMS256.txt" |
    grep -o "node-v[0-9.]*-linux-x64.tar.xz" | head -1)
  mkdir -p "$node_dir"
  curl -fsSL "https://nodejs.org/dist/latest-v$node_major.x/$version" |
    tar -xJ -C "$node_dir" --strip-components=1
fi
export PATH="$node_dir/bin:$PATH"
echo "export PATH=\"$node_dir/bin:\$PATH\"" >> "$env_file"

# pnpm: exactly the version `packageManager` pins.
pnpm_version=$(node -p "require('./package.json').packageManager.split('@')[1]")
if [ "$(pnpm --version 2>/dev/null || true)" != "$pnpm_version" ]; then
  npm install --global --silent "pnpm@$pnpm_version"
fi

# Playwright's own browser download is blocked here; the image has a Chromium (Bombadil reads
# CHROME, the dev scripts and Playwright configs fall back to it).
if [ -x /opt/pw-browsers/chromium ]; then
  echo "export CHROME=/opt/pw-browsers/chromium" >> "$env_file"
fi

# Dependencies, only when a file that decides them changed since the last successful install.
hashes=node_modules/.session-start.sha256
if ! sha256sum --check --status "$hashes" 2>/dev/null; then
  rm -f "$hashes"
  pnpm install --prefer-offline
  sha256sum .claude/hooks/session-start.sh package.json pnpm-lock.yaml pnpm-workspace.yaml \
    apps/*/package.json packages/*/package.json > "$hashes"
fi

pyhashes=apps/api/.venv/.session-start.sha256
if ! sha256sum --check --status "$pyhashes" 2>/dev/null; then
  rm -f "$pyhashes"
  uv sync --project apps/api
  sha256sum .claude/hooks/session-start.sh apps/api/pyproject.toml apps/api/uv.lock \
    apps/api/.python-version > "$pyhashes"
fi
