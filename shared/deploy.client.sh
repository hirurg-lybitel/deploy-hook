#!/bin/bash

set -e 

# ==== CONFIGURATION ====
REPO_URL="git@github.com:naytron-org/naytron.git"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mkdir -p "$SCRIPT_DIR/../repos" "$SCRIPT_DIR/../worktrees"
REPO_DIR="$(cd "$SCRIPT_DIR/../repos" && pwd)/naytron-server"
WORKTREES_DIR="$(cd "$SCRIPT_DIR/../worktrees" && pwd)"
PROJECT_DIR="$WORKTREES_DIR/$DOMAIN"
ENV_FILE="$SCRIPT_DIR/envs/naytron/.env.prod.local"
BRANCH="main"
CLIENT_BRANCH="naytron-client-${DOMAIN}"
BUILDER="docker:s:build"
DEPLOY_SCRIPT="docker:s:run"
DB_BUILD_SCRIPT="docker:db:build"
DB_DEPLOY_SCRIPT="docker:db:run"

echo "📦 Starting client deployment: $(date)"
echo "📁 Target repository directory: $PROJECT_DIR"

# ==== ENSURE BASE REPO EXISTS ====
if [ ! -d "$REPO_DIR/.git" ]; then
  echo "📁 Base repository not found. Cloning..."
  mkdir -p "$REPO_DIR"
  git clone --branch "$BRANCH" "$REPO_URL" "$REPO_DIR"
fi

cd "$REPO_DIR"

# ==== CREATE CLIENT BRANCH IF NEEDED ====
if ! git show-ref --verify --quiet refs/heads/$CLIENT_BRANCH; then
  echo "🌱 Creating branch $CLIENT_BRANCH from $BRANCH..."
  git branch $CLIENT_BRANCH $BRANCH
fi

# ==== CREATE OR UPDATE WORKTREE ====
if [ ! -d "$PROJECT_DIR" ]; then
  echo "📁 Worktree for $DOMAIN not found. Creating..."
  mkdir -p "$WORKTREES_DIR"
  cd "$REPO_DIR"
  git worktree prune
  git worktree add "$PROJECT_DIR" "$CLIENT_BRANCH"
else
  echo "📁 Worktree for $DOMAIN exists. Updating..."
  cd "$PROJECT_DIR"
  git fetch origin
  git reset --hard
  git clean -fd
  # Ensure the client branch exists in this worktree/repo and switch to it.
  git checkout -B "$CLIENT_BRANCH" "origin/$BRANCH"
fi

# Always run subsequent commands from the workspace worktree.
cd "$PROJECT_DIR"


# ==== COPY ENVIRONMENT FILE ====
echo "⚙️ Copying environment file (.env.prod.local) to project directory..."
cp "$ENV_FILE" "$PROJECT_DIR/.env.prod.local"

# .env.workspace — второй env_file в compose; переопределяет envs для этого воркспейса
{
  echo "PORT=$PORT"
  echo "DB_HOST=$DB_HOST"
  echo "DB_PORT=$DB_PORT"
  echo "SEED_API_KEY_PLAINTEXT=$SEED_API_KEY_PLAINTEXT"
} > "$PROJECT_DIR/.env.workspace"


# ==== INSTALL PRODUCTION DEPENDENCIES ====
# echo "📦 Installing production dependencies with pnpm..."
# pnpm install --prod --ignore-scripts

# ==== SET SSL CERTIFICATE PATH ====
SSL_CERT_PATH="$(realpath "$SCRIPT_DIR/ssl")"
export SSL_CERT_PATH

# ==== SET SECRETS DIR PATH ====
SECRETS_PATH="$(realpath "$SCRIPT_DIR/secrets")"
export SECRETS_PATH

# ==== RUN DB BUILD SCRIPT ====
echo "🚀 Building DB container for $DOMAIN with $DB_BUILD_SCRIPT"
pnpm "$DB_BUILD_SCRIPT"

# ==== RUN DB DEPLOY SCRIPT ====
echo "🚀 Deploying DB container for $DOMAIN with $DB_DEPLOY_SCRIPT"
pnpm "$DB_DEPLOY_SCRIPT"

# ==== RUN BUILD SCRIPT ====
echo "🚀 Building UI container for $DOMAIN with $DB_BUILD_SCRIPT"
pnpm "$DB_BUILD_SCRIPT"

# ==== RUN DEPLOY SCRIPT ====
echo "🚀 Deploying UI container for $DOMAIN with $DB_DEPLOY_SCRIPT"
pnpm "$DEPLOY_SCRIPT"

# ==== DEPLOYMENT COMPLETE ====
echo "✅ Deployment finished for $DOMAIN: $(date)"
