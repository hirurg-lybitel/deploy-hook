# Deployer

Automated deployments via secure webhooks. This tiny Node.js service listens for GitHub webhooks (or your own signed HTTP calls) and runs project-specific deployment scripts that build and run Docker containers on your server.

— Keep your server always up-to-date after pushes to the main branch — or trigger a manual deploy from any app.

## Highlights
- Secure HMAC SHA256 signature verification (`X-Hub-Signature-256`)
- One endpoint for multiple deployment targets
- Works with GitHub Webhooks and manual HTTP calls
- Ships as Node app, with PM2 and Docker options

## How it works
- The server exposes `POST /webhook?type=<king|client|crm>`.
- The request body (raw JSON) is verified with HMAC SHA256 using your `SECRET`.
- Based on `type`, one of the scripts in `shared/` is executed:
  - `type=king` → `shared/deploy.king.sh`
  - `type=client` → `shared/deploy.client.sh`
  - `type=crm` → `shared/deploy.crm.sh`
- Scripts clone/update the corresponding repos via SSH, apply env files from `shared/envs/**`, then build and run containers via each project’s own scripts.

## Project layout
- `index.js` — Express server, signature verification, and script runner
- `shared/` — deployment scripts, SSL bundle, environment templates (`envs/`)
- `repos/` — working directory where target projects are cloned/updated
- `ecosystem.config.js` — PM2 configuration
- `docker-compose.yml`, `Dockerfile` — containerization for this service

## Requirements
- Node.js 18+ (Docker image uses `node:22-alpine`)
- Docker + Docker Compose
- Git with SSH access to target repos (configure `~/.ssh/config` and keys; scripts use SSH host aliases like `git@github-king-of-pos:...`, `git@github-gdmn-nxt:...`)
- `pnpm` and `yarn` installed on the server (used by target projects)

## Environment (.env)
Create a `.env` in the project root (use `.env.sample` as a reference):

```env
SECRET=your_hmac_secret
PORT=60112

# Optional defaults for deployments that provide no explicit ports
MAIN_CONTAINER_PORT=3000
MAIN_DB_PORT=27017
```

Notes:
- `SECRET` is required; requests with invalid or missing signatures are rejected.
- `PORT` is where this service listens (`0.0.0.0:<PORT>`).
- For `king`/`client` you may send `env.domain`, `env.port`, `env.dbPort` in the body; otherwise `MAIN_CONTAINER_PORT`/`MAIN_DB_PORT` are used.

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
- URL: `/webhook?type=<king|client|crm>`
- Headers: `X-Hub-Signature-256: sha256=<hex>`
- Body: JSON; may contain `env` for domain/ports (used by `king`/`client`)

Example body:
```json
{
  "env": {
    "domain": "my-tenant",
    "port": 3001,
    "dbPort": 27018
  }
}
```

What happens:
1. The server reads the raw JSON to compute HMAC accurately.
2. Compares `X-Hub-Signature-256` to `sha256=<hex(HMAC_SHA256(SECRET, rawBody))>`.
3. Selects and runs the script for the given `type`.
4. For `king`/`client`, environment variables derived from `env.domain` are exported (e.g., `CONTAINER_NAME`, `DB_CONTAINER_NAME`, `NEXTAUTH_URL`, etc.).

If `type` is missing or unknown → `"Unrecognised repository webhook"`.

## Manual trigger (curl)
You must sign the body exactly like GitHub:
`signature = 'sha256=' + hex( HMAC_SHA256(SECRET, rawBody) )`

```bash
BODY='{"env":{"domain":"my-tenant","port":3001,"dbPort":27018}}'
SIGNATURE="sha256=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -binary | xxd -p -c 256)"

curl -X POST "http://<host>:<PORT>/webhook?type=king" \
  -H "Content-Type: application/json" \
  -H "X-Hub-Signature-256: $SIGNATURE" \
  --data "$BODY"
```

Success response:
```json
{ "success": true, "message": "Deployment complete" }
```

## GitHub Webhook setup
- URL: `http(s)://<host>:<PORT>/webhook?type=<king|client|crm>`
- Content type: `application/json`
- Secret: your `.env` `SECRET`
- Events: at minimum, `push` on the main branch of the corresponding repo

GitHub will sign each request with `X-Hub-Signature-256`, which this service verifies.

## Deployment scripts (shared/*.sh)
- `shared/deploy.king.sh` — King POS (branch `master`, `pnpm`, uses `shared/envs/king-pos/.env.prod.local`).
- `shared/deploy.client.sh` — King POS server (also brings up DB; uses `pnpm`, project docker scripts, SSL from `shared/ssl`).
- `shared/deploy.crm.sh` — CRM (branch `main`, `yarn`, copies envs from `shared/envs/crm/`).

Important:
- Scripts use SSH host aliases, so ensure SSH keys and `~/.ssh/config` are configured on the server.
- `SSL_CERT_PATH` is exported pointing to `shared/ssl` and consumed by target projects.
- Target projects control their own docker-compose; these scripts orchestrate them.

## Troubleshooting
- 401 or invalid signature: wrong `SECRET` or signature computed against a modified body (must use raw JSON).
- Repo access failures: check SSH keys and host aliases in `~/.ssh/config`.
- Port conflicts: adjust `env.port`/`env.dbPort` or the defaults `MAIN_CONTAINER_PORT`/`MAIN_DB_PORT`.

## License
MIT
