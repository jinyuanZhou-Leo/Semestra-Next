# Semestra-Next

Semestra 的从零重写版。技术栈：FastAPI + SQLAlchemy 2 + Alembic + SQLite（Python 3.15，uv）；React 19 + TypeScript 7 + Vite + TanStack Router（SPA）+ shadcn/ui（Base UI）+ Paraglide。

## 开始

需要：uv ≥ 0.13、Node ≥ 26、pnpm ≥ 12。

```bash
uv python install 3.15
pnpm install
uv sync --project apps/api
pnpm --filter @semestra/api migrate
pnpm dev        # API http://localhost:8000 ，Web http://localhost:5173
```

开发约定与命令见 [CLAUDE.md](CLAUDE.md)，设计与模块规格见 [docs/](docs/specs/README.md)。
