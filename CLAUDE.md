# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Start development server (with auto-reload)
npm run dev

# Start production server
npm start

# Run in Docker
docker build -t quickplan .
docker run -p 3000:3000 -v $(pwd)/data:/app/data quickplan
```

No test suite exists yet (`npm test` is a no-op).

## Architecture

QuickPlan is a single-file Express + SQLite backend with a single-page frontend (Quasar via CDN).

**Backend — [`server.js`](server.js)**  
All server logic lives here: Express setup, SQLite initialization, and every API route. There is no separate routing module or controller layer.

- Database file is persisted at `data/tasks.db` (WAL mode enabled for concurrency)
- SQLite schema uses a single `tasks` table; subtasks are rows with `parent_id` and `is_subtask = 1`
- Schema migrations are done inline at startup via `ALTER TABLE … ADD COLUMN` with `duplicate column name` error suppression — this is intentional, not a bug
- Stats endpoint (`GET /api/stats`) has a 30-second in-memory cache invalidated on any write operation
- Excel export (`POST /api/export`) uses ExcelJS to build and stream a `.xlsx` buffer directly from the DB

**Frontend — [`public/index.html`](public/index.html)**  
A single HTML file containing all Vue 3 + Quasar UI code inline (no build step). Loaded from CDN:
- `https://cdn.quasar.dev/2.14.2/quasar.prod.css`
- `https://unpkg.com/vue@3` and `https://unpkg.com/quasar@2`

**API surface**

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/tasks` | All tasks, returned as hierarchy (subtasks nested under parent) |
| POST | `/api/tasks` | Create task (requires `tarea`, `recurso`) |
| PUT | `/api/tasks/reorder` | Reorder by array of IDs |
| PUT | `/api/tasks/:id` | Update task |
| DELETE | `/api/tasks` | Delete all tasks |
| DELETE | `/api/tasks/:id` | Delete single task |
| POST | `/api/tasks/:parentId/subtasks` | Create subtask (validates hours don't exceed parent) |
| GET | `/api/tasks/:id/validate` | Check if subtask hours sum matches parent |
| POST | `/api/tasks/reorder` | Drag-and-drop reorder |
| GET | `/api/stats` | Stats with 30s cache |
| POST | `/api/export` | Generate and download Excel report |
| GET | `/health` | Quick health check (no DB) |
| GET | `/api/health` | Health check with DB test |

## Data model

```sql
tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tarea TEXT NOT NULL,
  horas REAL DEFAULT 0,
  observaciones TEXT DEFAULT '',
  recurso TEXT DEFAULT '',
  sort_order INTEGER DEFAULT 0,
  parent_id INTEGER DEFAULT NULL,   -- subtask FK
  is_subtask INTEGER DEFAULT 0,     -- 0=task, 1=subtask
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

Subtask hours are validated server-side: `sum(subtask.horas) <= parent.horas`.
