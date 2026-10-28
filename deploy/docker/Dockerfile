# syntax=docker/dockerfile:1.7
#
# Build context is the repository root:
#   docker build -f deploy/docker/Dockerfile --target api         -t semestra-api .
#   docker build -f deploy/docker/Dockerfile --target api-office  -t semestra-api:office .
#   docker build -f deploy/docker/Dockerfile --target allinone    -t semestra-allinone .
#   docker build -f deploy/docker/Dockerfile --target allinone-ocr -t semestra-allinone:ocr .
#   docker build -f deploy/docker/Dockerfile --target edge        -t semestra-edge .
#
# Targets:
#   api         FastAPI backend only
#   api-office  api + headless LibreOffice for converting legacy Office files
#   allinone    api + the built SPA served from the same origin (self-hosting and the hosted app)
#   allinone-ocr  allinone + local OCR of scanned pages (PaddleOCR on ONNX Runtime; models are
#               downloaded into /data when first needed); for self-hosting, amd64 and arm64
#   edge        Caddy with the landing page (/landing) and the docs (/docs) baked in; the hosted
#               stack's reverse proxy in front of allinone (deploy/hosted/Caddyfile)

# trixie: its SQLite (3.46) has the FTS5 contentless_delete option the files index needs (>= 3.43).
ARG PYTHON_IMAGE=python:3.14-slim-trixie
ARG NODE_IMAGE=node:26-slim

# ---- backend dependencies ------------------------------------------------------------------
FROM ${PYTHON_IMAGE} AS api-builder
COPY --from=ghcr.io/astral-sh/uv:0.13 /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/opt/venv
WORKDIR /build
COPY apps/api/pyproject.toml apps/api/uv.lock apps/api/.python-version ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-dev --no-install-project
COPY apps/api/src ./src
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-dev --no-editable

# The same plus the `ocr` extra (PaddleOCR, ONNX Runtime) for the allinone-ocr image.
FROM api-builder AS api-builder-ocr
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-dev --no-editable --extra ocr

# ---- backend runtime -----------------------------------------------------------------------
# Everything but the virtualenv, shared by api and allinone-ocr (which has its own).
FROM ${PYTHON_IMAGE} AS runtime
# System libraries for the document pipeline (M07) belong in this layer.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates tzdata \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 semestra \
    && useradd --uid 10001 --gid 10001 --create-home --shell /usr/sbin/nologin semestra \
    && mkdir -p /app /data \
    && chown semestra:semestra /app /data
COPY --chown=semestra:semestra apps/api/alembic.ini /app/alembic.ini
COPY --chown=semestra:semestra apps/api/migrations /app/migrations
COPY deploy/docker/entrypoint.sh /usr/local/bin/semestra-entrypoint
RUN chmod 0755 /usr/local/bin/semestra-entrypoint
ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    SEMESTRA_ENV=prod \
    SEMESTRA_DATA_DIR=/data \
    SEMESTRA_DATABASE_URL=sqlite+aiosqlite:////data/semestra.db \
    SEMESTRA_STORAGE_LOCAL_ROOT=/data/storage
WORKDIR /app
USER semestra
VOLUME /data
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/healthz', timeout=3)"]
ENTRYPOINT ["semestra-entrypoint"]
CMD ["semestra", "serve", "--host", "0.0.0.0", "--port", "8000"]

FROM runtime AS api
COPY --from=api-builder /opt/venv /opt/venv

# ---- backend + LibreOffice -----------------------------------------------------------------
FROM api AS api-office
USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libreoffice-writer-nogui libreoffice-calc-nogui libreoffice-impress-nogui fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*
USER semestra

# ---- frontend build ------------------------------------------------------------------------
# Static files, so it runs on the build machine's platform even in a multi-arch build.
FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS web-builder
# Keep in sync with "packageManager" in the root package.json.
ARG PNPM_VERSION=12.14.0
RUN npm install --global "pnpm@${PNPM_VERSION}"
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/api-client/package.json packages/api-client/package.json
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter "@semestra/web..."
COPY apps/web apps/web
COPY packages/api-client packages/api-client
# The About page and the "What's new" dialog read them (apps/web/src/modules/settings), with the
# names of the areas the notes are grouped by.
COPY release-notes release-notes
COPY .changeset/areas.json .changeset/areas.json
# Empty origin = same-origin requests, which is what the all-in-one image serves.
ARG VITE_API_ORIGIN=""
# Optional, baked into the bundle. The published image is shared by the hosted and self-hosted
# installs, so releases leave these empty; set them with --build-arg on your own build.
ARG VITE_SENTRY_DSN=""
ARG VITE_EMAIL_DOMAINS=""
ENV VITE_API_ORIGIN=${VITE_API_ORIGIN} \
    VITE_SENTRY_DSN=${VITE_SENTRY_DSN} \
    VITE_EMAIL_DOMAINS=${VITE_EMAIL_DOMAINS}
RUN pnpm --filter @semestra/web build

# ---- all-in-one ----------------------------------------------------------------------------
FROM api AS allinone
COPY --from=web-builder --chown=semestra:semestra /repo/apps/web/dist /app/web
ENV SEMESTRA_SERVE_WEB=true \
    SEMESTRA_WEB_DIST_DIR=/app/web

# ---- all-in-one with local OCR (self-hosting) ----------------------------------------------
# Built from the shared runtime rather than allinone, so the image has one virtualenv, not two.
FROM runtime AS allinone-ocr
USER root
# OpenCV (pulled in by PaddleOCR) links against these.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgl1 libglib2.0-0t64 \
    && rm -rf /var/lib/apt/lists/*
USER semestra
COPY --from=api-builder-ocr /opt/venv /opt/venv
COPY --from=web-builder --chown=semestra:semestra /repo/apps/web/dist /app/web
# No model is in the image: each downloads into the data volume the first time it is needed,
# with progress in the app. This one is used until a user picks another in settings
# (PP-OCRv6_tiny|small|medium, PP-OCRv5_mobile|server). Plain HTTPS rather than Xet for Hugging
# Face: each file grows on disk as it arrives (what the progress measures), with no chunk cache.
ARG LOCAL_OCR_MODEL=PP-OCRv6_medium
ENV SEMESTRA_SERVE_WEB=true \
    SEMESTRA_WEB_DIST_DIR=/app/web \
    SEMESTRA_LOCAL_OCR=true \
    SEMESTRA_LOCAL_OCR_MODEL=${LOCAL_OCR_MODEL} \
    PADDLE_PDX_CACHE_HOME=/data/ocr-models \
    PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=True \
    HF_HUB_DISABLE_XET=1

# ---- landing page and docs (static) --------------------------------------------------------
FROM ${NODE_IMAGE} AS sites-builder
# Keep in sync with "packageManager" in the root package.json.
ARG PNPM_VERSION=12.14.0
RUN npm install --global "pnpm@${PNPM_VERSION}"
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/site/package.json apps/site/package.json
COPY apps/docs/package.json apps/docs/package.json
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter "@semestra/site..." --filter "@semestra/docs..."
COPY apps/site apps/site
COPY apps/docs apps/docs
# The docs read these from outside apps/docs: the API reference is generated from the committed
# schema, the MCP catalog uses the capability list plus the app's capability titles, and the
# changelog comes from the release notes and their area names.
COPY packages/api-client/openapi.json packages/api-client/capabilities.json packages/api-client/
COPY apps/web/messages/en.json apps/web/messages/zh-CN.json apps/web/messages/
COPY release-notes release-notes
COPY .changeset/areas.json .changeset/areas.json
ARG SITE_URL=https://semestra.jyleo.cc
ENV PUBLIC_SITE_URL=${SITE_URL} SITE_URL=${SITE_URL}
RUN pnpm --filter @semestra/site build && pnpm --filter @semestra/docs build

# ---- hosted reverse proxy ------------------------------------------------------------------
FROM caddy:2 AS edge
COPY --from=sites-builder /repo/apps/site/dist /srv/landing
COPY --from=sites-builder /repo/apps/docs/out /srv/docs
