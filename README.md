# Elewen

Event planning platform: customer website, admin panel, Express API, and Strapi CMS.

## Architecture

| App | Folder | Role |
|-----|--------|------|
| Website | `frontend/` | Customer-facing React (Vite) app |
| Admin panel | `admin-pannel/` | Internal ops UI (Vite) |
| API | `api/` | Express + Prisma (bookings, payments, etc.) |
| CMS | `strapi/` | Strapi v5 (packages, content, auth) |
| Infra | Docker | Postgres + Redis for local (apps run on the host) |

```
Browser → frontend (:5173) / admin (:5174)
              ↓
         api (:3000)  ←→  Redis (:6379)
              ↓
         strapi (:1337)
              ↓
         Postgres (:15432)
```

## Prerequisites

- **Node.js 20–22** (see `.nvmrc`; Strapi requires ≤22)
- **npm** (comes with Node)
- **Docker Desktop** (Postgres + Redis only)

```bash
node -v    # Check Node version (need v20.x or v22.x)
docker -v  # Check Docker is installed and running
```

---

## Local development (recommended)

Do **not** run `docker compose up` for the full stack on your laptop. Root Docker env points at production URLs and will break local CORS / redirects. Run **only Postgres + Redis** in Docker; run the four Node apps on the host.

### 1. Root env for Docker Postgres/Redis

Compose reads DB credentials from a root `.env`:

```bash
cp .env.docker.example .env  # Create root .env so Docker Compose knows DB user/password/name
```

For local infra you mainly need:

```env
DB_USER=postgres
DB_PASSWORD=postgres
DB_NAME=elewen
```

(You can leave other production-oriented values as-is; apps use their own `.env` files.)

### 2. Start Postgres + Redis

```bash
# Stop any Docker app containers that would fight with local ports (1337, 3000, 5173, 5174)
docker compose stop strapi api frontend admin-panel migrate 2>/dev/null || true

# Start only the database and cache in the background
docker compose up -d postgres redis
```

- Postgres: `localhost:15432` (user `postgres`, password `postgres`, db `elewen`)
- Redis: `localhost:6379`

### 3. Create per-app env files

```bash
cp api/.env.example api/.env                    # Express API config (DB, JWT, Redis, Strapi URL)
cp strapi/.env.example strapi/.env              # CMS config (DB, secrets, OAuth, uploads)
cp frontend/.env.example frontend/.env          # Website Vite vars (API + Strapi URLs)
cp admin-pannel/.env.example admin-pannel/.env  # Admin panel Vite vars (API URL)
```

**Critical local DB host port:** Docker maps Postgres to **15432**, not 5432.

In `api/.env`:

```env
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:15432/elewen?schema=api
REDIS_URL=redis://localhost:6379
STRAPI_URL=http://localhost:1337
```

In `strapi/.env`:

```env
DATABASE_HOST=localhost
DATABASE_PORT=15432
DATABASE_NAME=elewen
DATABASE_USERNAME=postgres
DATABASE_PASSWORD=postgres
PUBLIC_URL=http://localhost:1337
FRONTEND_URL=http://localhost:5173
GOOGLE_REDIRECT_URI=http://localhost:1337/api/connect/google/callback
```

Generate secrets (run once, paste into both files where noted):

```bash
# Print a random secret string — run several times for JWT_SECRET, APP_KEYS, etc.
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

| Variable | Where |
|----------|--------|
| `JWT_SECRET` | `api/.env` |
| `STRAPI_JWT_SECRET` | `api/.env` — **must equal** `JWT_SECRET` in `strapi/.env` |
| `JWT_SECRET`, `ADMIN_JWT_SECRET`, `API_TOKEN_SALT`, `TRANSFER_TOKEN_SALT` | `strapi/.env` |
| `APP_KEYS` | `strapi/.env` — **four** comma-separated random strings |

Frontend / admin defaults in the examples (`VITE_API_URL`, `VITE_STRAPI_URL`) already point at localhost.

Optional / later: SMTP, Google OAuth, Cloudflare R2, Cashfree — see [GOOGLE_OAUTH_SETUP.md](./GOOGLE_OAUTH_SETUP.md). The site can start without them; auth email and payments will not work until configured.

### 4. (Optional) Load the included SQL dump

If you want existing CMS/API data instead of an empty DB:

```bash
# Pipe the SQL dump into the running Postgres container (loads packages, users, etc.)
docker compose exec -T postgres psql -U postgres -d elewen < elewen_dump.sql
```

If admin publish later fails with duplicate key / sequence errors, see the sequence-fix section in [DEPLOYMENT.md](./DEPLOYMENT.md).

### 5. Start Strapi (CMS)

```bash
cd strapi          # Enter the CMS project folder
npm install        # Install Strapi dependencies (first time only)
npm run develop    # Start CMS in local mode (API + admin UI on :1337)
```

→ http://localhost:1337  

Log in with `STRAPI_ADMIN_EMAIL` / `STRAPI_ADMIN_PASSWORD` from `.env` (`local.env` defaults: `admin@elewen.local` / `Admin@12345`). Strapi creates this Super Admin on start if it doesn't exist, and resets its password to the `.env` value on every start. Leave both empty to create admins in the browser instead.

**Important:** use `npm run develop` (not `npx strapi develop`). The latter can steal port **5173** from the website. Details: [DEV_PORTS.md](./DEV_PORTS.md).

### 6. Start the Express API

```bash
cd api                    # Enter the Express API folder
npm install               # Install API dependencies (first time only)
npm run prisma:generate   # Generate the Prisma client from the schema
npm run migrate:deploy    # Apply database migrations (creates API tables)
npm run dev               # Start the API with auto-reload on :3000
```

→ http://localhost:3000  

Health check: http://localhost:3000/health

### 7. Start the customer website

```bash
cd frontend    # Enter the customer website folder
npm install    # Install frontend dependencies (first time only)
npm run dev    # Start Vite dev server on :5173
```

→ http://localhost:5173  

**UI-only without Strapi:** set `VITE_USE_FALLBACK=true` in `frontend/.env`.

**Use production Strapi media locally:**

```bash
# Point the website at production Strapi media via a Vite /cms proxy
cp frontend/.env.local.example frontend/.env.local
```

Delete `.env.local` to use local Strapi again.

### 8. Start the admin panel

```bash
cd admin-pannel   # Enter the admin panel folder (note spelling: "pannel")
npm install       # Install admin panel dependencies (first time only)
npm run dev       # Start Vite dev server on :5174
```

→ http://localhost:5174  

---

## URLs (local)

| Service | URL |
|---------|-----|
| Website | http://localhost:5173 |
| Admin panel | http://localhost:5174 |
| Express API | http://localhost:3000 |
| Strapi CMS | http://localhost:1337 |
| Postgres | `localhost:15432` |
| Redis | `localhost:6379` |

---

## Quick checklist

```bash
# ── Terminal 1 — database + cache ──────────────────────────
docker compose up -d postgres redis
# Start Postgres (:15432) and Redis (:6379) in Docker

# ── Terminal 2 — CMS ───────────────────────────────────────
cd strapi && npm install && npm run develop
# Install deps (first time) and start Strapi on :1337

# ── Terminal 3 — API ───────────────────────────────────────
cd api && npm install && npm run prisma:generate && npm run migrate:deploy && npm run dev
# Install deps → generate Prisma client → migrate DB → start API on :3000

# ── Terminal 4 — website ───────────────────────────────────
cd frontend && npm install && npm run dev
# Install deps (first time) and start customer site on :5173

# ── Terminal 5 — admin ─────────────────────────────────────
cd admin-pannel && npm install && npm run dev
# Install deps (first time) and start admin panel on :5174
```

---

## Stopping services (keeps your database)

Your data lives in Docker volumes (`elewen_postgres_data` for the database, `elewen_strapi_uploads` for uploaded files). Stopping or removing containers does not touch them.

**Apps running in terminals** (`npm run dev` / `npm run develop`): press `Ctrl + C` in each terminal.

**Docker containers:**

```bash
docker compose stop   # Stop all containers; keep them so the next start is fast
docker compose down   # Or: stop and remove containers + network; volumes (data) are kept
```

Either way, start again with:

```bash
docker compose up -d strapi  # Start the database and CMS first so Strapi tables exist
docker compose up -d         # Then start migrations, API, website and admin panel
```

Check that your data volumes still exist:

```bash
docker volume ls | grep elewen  # Should list elewen_postgres_data and elewen_strapi_uploads
```

**Do not run these unless you want to wipe everything:**

```bash
docker compose down -v         # -v deletes the volumes: database and uploads are gone
docker volume rm elewen_postgres_data  # Deletes the database volume directly
```

Quitting Docker Desktop also stops everything safely; your data stays.

---

## Common issues

| Problem | Fix |
|---------|-----|
| DB connection refused | Postgres must be up; use port **15432** in `api/.env` and `strapi/.env` |
| Port 5173 already in use | Usually Strapi admin HMR — use `npm run develop` in `strapi/`, or free the port |
| Auth JWT errors between website and API | `api` `STRAPI_JWT_SECRET` must match `strapi` `JWT_SECRET` |
| CORS / redirects to production | You started full Docker stack — stop app containers; run only `postgres` + `redis` |
| Empty packages/images | Import `elewen_dump.sql`, seed Strapi ([strapi/SEEDING.md](./strapi/SEEDING.md)), or use `frontend/.env.local` for prod media |
| Google login fails | Configure OAuth redirect URI for localhost — [GOOGLE_OAUTH_SETUP.md](./GOOGLE_OAUTH_SETUP.md) |

---

## Other docs

| Doc | Topic |
|-----|--------|
| [RUNNING.md](./RUNNING.md) | Shorter local run notes |
| [DEV_PORTS.md](./DEV_PORTS.md) | Port map and Strapi port conflicts |
| [DEPLOYMENT.md](./DEPLOYMENT.md) | Full Docker / production deploy |
| [GOOGLE_OAUTH_SETUP.md](./GOOGLE_OAUTH_SETUP.md) | Google Sign-In + email |
| [strapi/SEEDING.md](./strapi/SEEDING.md) | CMS seed scripts |

## Production (Docker)

On a server with DNS and SSL, use the full compose stack — see [DEPLOYMENT.md](./DEPLOYMENT.md):

```bash
cp .env.docker.example .env   # Create production .env from the Docker template
# Edit .env — fill secrets and public URLs (PUBLIC_SITE_URL, JWT, SMTP, etc.)
docker compose up --build -d  # Build images and start the full stack in the background
```
