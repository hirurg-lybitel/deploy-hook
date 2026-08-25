# Deployer

Automated deployments via secure webhooks. This tiny Node.js service listens for GitHub webhooks (or your own signed HTTP calls) and runs project-specific deployment scripts that build and run Docker containers on your server.

— Keep your server always up-to-date after pushes to the main branch — or trigger a manual deploy from any app.

## Highlights
- Secure HMAC SHA256 signature verification (`X-Hub-Signature-256`)
- One endpoint for multiple deployment targets
- Works with GitHub Webhooks and manual HTTP calls
- Ships as Node app, with PM2 and Docker options
- Branch filtering (only deploys from `master`/`main` branches)
- Automatic child container updates for `naytron` deployments
- Multi-tenant support via git worktree for `client` type

## How it works
- The server exposes `POST /webhook?type=<naytron|client>`.
- The request body (raw JSON) is verified with HMAC SHA256 using your `SECRET`.
- Branch validation: only `master`/`main` branches trigger deployments (except `client` which uses `payload.gitBranch`).
- Server responds with `202 Accepted` immediately (async deployment).
- Based on `type`, one of the scripts in `shared/` is executed:
  - `type=naytron` → `shared/deploy.naytron.sh` (production)
  - `type=client` → `shared/deploy.client.sh` (uses git worktree for multi-tenant)
- Scripts clone/update the corresponding repos via SSH, apply env files from `shared/envs/**`, then build and run containers via each project’s own scripts.

## Project layout
- `index.js` — Express server, signature verification, branch filtering, and script runner
- `shared/` — deployment scripts, SSL bundle, environment templates (`envs/`)
- `repos/` — working directory where target projects are cloned/updated
- `worktrees/` — git worktrees for multi-tenant `client` deployments (one per domain)
- `ecosystem.config.js` — PM2 configuration
- `docker-compose.yaml`, `Dockerfile` — containerization for this service

## Requirements
- Node.js 18+ (Docker image uses `node:22-alpine`)
- Docker + Docker Compose
- Git with SSH access to target repos (configure `~/.ssh/config` and keys; set `REPO_URL` in deploy scripts)
- `pnpm` and `yarn` installed on the server (used by target projects)

## Environment (.env)
Create a `.env` in the project root (use `.env.sample` as a reference):

```env
NODE_ENV=production
PORT=3000
SECRET=your_hmac_secret

# PM2 Keymetrics (optional; only for 'naytron' type, not passed to client workspaces)
IN_PM2_PUBLIC_KEY=
IN_PM2_SECRET_KEY=
```

Notes:
- `SECRET` is required; requests with invalid or missing signatures are rejected.
- `PORT` is where this service listens (`0.0.0.0:<PORT>`).
- **Naytron (central)**: Defaults for app port and DB (`PORT`, `DB_HOST`, `DB_PORT`) are in `shared/envs/naytron/.env.prod.local`. Optional central-only vars (e.g. `TG_BOT_TOKEN`) go in `shared/envs/naytron/.env.central` (see `.env.central.example`).
- **Client**: Send `env.domain`, `env.port`, `env.dbHost`, `env.dbPort` in the webhook body; the deploy script writes them into `.env.workspace` so each workspace gets its own values (see `shared/envs/naytron/.env.workspace.example`).

## Run it

### Node (local)
```bash
npm install
npm start
# or
node index.js
```

### PM2
```bash
npm install --production
pm2 start
# or
pm2 start ecosystem.config.js
```
`run_server.sh` simply calls `pm2 start` (and includes optional PM2 Enterprise variables).

### Docker
1) Build and run:
```bash
docker compose up -d --build
```
Ensure `PORT` in `.env` matches the exposed mapping (`${PORT}:${PORT}`).

2) Update/restart:
```bash
docker compose pull
docker compose up -d
```

## Webhook endpoint

- Method: `POST`
- URL: `/webhook?type=<naytron|client>`
- Headers: `X-Hub-Signature-256: sha256=<hex>`
- Body: JSON; may contain `env` for domain/ports (used by `naytron`/`client`)

Example body (GitHub webhook):
```json
{
  "ref": "refs/heads/master",
  "env": {
    "domain": "my-tenant",
    "port": 3001,
    "dbPort": 27018,
    "dbHost": "93.84.115.54"
  }
}
```

Example body (for `client` type; include `port`, `dbHost`, `dbPort` so the workspace gets its own):
```json
{
  "gitBranch": "master",
  "env": {
    "domain": "my-tenant",
    "port": 3001,
    "dbHost": "93.84.115.54",
    "dbPort": 27018
  }
}
```

What happens:
1. The server reads the raw JSON to compute HMAC accurately.
2. Compares `X-Hub-Signature-256` to `sha256=<hex(HMAC_SHA256(SECRET, rawBody))>`.
3. **Branch validation**: 
   - For `naytron`: checks `payload.ref` must be `refs/heads/master` or `refs/heads/main`
   - For `client`: checks `payload.gitBranch` must be `master` or `main`
   - If branch doesn't match, returns `200 OK` with `{ ignored: true }` and stops
4. Returns `202 Accepted` immediately (deployment runs asynchronously).
5. Selects and runs the script for the given `type`.
6. For `naytron`/`client`, environment variables derived from `payload.env` are passed to the script (e.g. `DOMAIN`, `CONTAINER_NAME`, `NEXTAUTH_URL`). `PORT`, `DB_HOST`, `DB_PORT` for naytron come from `shared/envs/naytron/.env.prod.local`; for client they are taken from the payload and written into `.env.workspace`.
7. For `naytron` type: after successful deployment, waits 5 seconds and triggers child container updates via `https://developer.naytron.dev/api/deploy/webhook`.

If `type` is missing or unknown → `"Unrecognised repository webhook"`.

## Manual trigger (curl)
You must sign the body exactly like GitHub:
`signature = 'sha256=' + hex( HMAC_SHA256(SECRET, rawBody) )`

```bash
BODY='{"ref":"refs/heads/master","env":{"domain":"my-tenant","port":3001,"dbPort":27018}}'
SIGNATURE="sha256=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -binary | xxd -p -c 256)"

curl -X POST "http://<host>:<PORT>/webhook?type=naytron" \
  -H "Content-Type: application/json" \
  -H "X-Hub-Signature-256: $SIGNATURE" \
  --data "$BODY"
```

Immediate response (202 Accepted):
```json
{ "received": true }
```

Note: The deployment runs asynchronously. Check server logs for completion status. The server doesn't wait for deployment to finish before responding.

## GitHub Webhook setup
- URL: `http(s)://<host>:<PORT>/webhook?type=<naytron|client>`
- Content type: `application/json`
- Secret: your `.env` `SECRET`
- Events: at minimum, `push` on the main branch of the corresponding repo

GitHub will sign each request with `X-Hub-Signature-256`, which this service verifies.

**Important**: The service filters branches automatically — only `master`/`main` branch pushes trigger deployments. Pushes to other branches are ignored with a `200 OK` response.

## Deployment scripts (shared/*.sh)

Before first use, set `REPO_URL` in each script to your main application repository.

### `shared/deploy.naytron.sh`
- **Project**: Naytron (production, central instance)
- **Branch**: `master`
- **Package manager**: `pnpm`
- **Environment**: Copies `shared/envs/naytron/.env.prod.local` into the repo; appends `shared/envs/naytron/.env.central` if present (e.g. `TG_BOT_TOKEN` for central only). `.env.workspace` is created empty (via naytron `docker:prepare`); defaults for `PORT`, `DB_HOST`, `DB_PORT` come from `.env.prod.local`.
- **Special**: Passes `IS_CENTRAL_DB=true`, `PM2_PUBLIC_KEY`, `PM2_SECRET_KEY` from deploy-hook env (only for this type).
- **Post-deploy**: Triggers child container updates at `https://developer.naytron.dev/api/deploy/webhook`

### `shared/deploy.client.sh`
- **Project**: Naytron client (multi-tenant)
- **Branch**: `master` (merged into client-specific branches)
- **Package manager**: `pnpm`
- **Environment**: Copies `shared/envs/naytron/.env.prod.local`; writes `PORT`, `DB_HOST`, `DB_PORT` from the webhook payload into `.env.workspace` so compose uses per-workspace values (see `shared/envs/naytron/.env.workspace.example`).
- **Special**: Uses **git worktree** for multi-tenant deployments
  - Base repo cloned to `repos/naytron-server`
  - Each domain gets its own worktree in `worktrees/<domain>`
  - Creates branch `naytron-client-<domain>` if it doesn't exist
  - Merges `master` into client branch before deploying
- **Deployments**: Runs DB (`docker:db:build`, `docker:db:run`) then server (`docker:s:build`, `docker:s:run`)

**Important notes:**
- Set `REPO_URL` in deploy scripts to your application repository SSH URL.
- Ensure SSH keys and `~/.ssh/config` are configured on the server.
- `SSL_CERT_PATH` is exported pointing to `shared/ssl` and consumed by target projects.
- Target projects control their own docker-compose; these scripts orchestrate them.
- All scripts perform `git reset --hard` and `git clean -fd` before pulling to ensure clean state.

## CI/CD Pipeline Flow

```mermaid
graph TB
    A[Developer pushes to GitHub] --> B{GitHub Webhook}
    B -->|POST /webhook?type=X| C[Deploy Hook Server]
    C --> D[Verify HMAC Signature]
    D -->|Invalid| E[Reject Request]
    D -->|Valid| F{Check Branch}
    F -->|Not master/main| G[Ignore - Return 200]
    F -->|master/main| H[Return 202 Accepted]
    H --> I{Select Deploy Script}
    I -->|type=naytron| J[deploy.naytron.sh]
    I -->|type=client| L[deploy.client.sh]
    
    J --> O[Clone/Update Repo]
    L --> P[Setup Git Worktree]
    
    O --> Q[Copy Env Files]
    P --> Q
    Q --> R[Install Dependencies]
    R --> S[Build Docker Containers]
    S --> T[Start Containers]
    
    T -->|naytron only| U[Wait 5s]
    U --> V[Trigger Child Containers Update]
    V --> W[Deployment Complete]
    T -->|client| W
    
    style A fill:#e1f5ff
    style C fill:#fff4e1
    style D fill:#ffe1e1
    style H fill:#e1ffe1
    style W fill:#e1ffe1
```

## Troubleshooting
- **401 or invalid signature**: wrong `SECRET` or signature computed against a modified body (must use raw JSON).
- **Branch ignored**: check that you're pushing to `master`/`main` branch (or `payload.gitBranch` for `client` type).
- **Repo access failures**: check SSH keys, `REPO_URL` in deploy scripts, and `~/.ssh/config` on the server.
- **Port conflicts**: set `env.port`, `env.dbPort` in the webhook body for client; for naytron, edit `shared/envs/naytron/.env.prod.local` (PORT, DB_HOST, DB_PORT).
- **Worktree errors** (`client` type): ensure `worktrees/` directory is writable and git worktree commands have proper permissions.
- **Child containers not updating** (`naytron` type): check that `https://developer.naytron.dev/api/deploy/webhook` is accessible and accepts the forwarded webhook.

## License
MIT
