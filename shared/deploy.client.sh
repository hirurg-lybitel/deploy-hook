#!/bin/bash

set -e 

# ==== CONFIGURATION ====
REPO_URL="git@github.com:GoldenSoftwareLtd/king-of-pos.git"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR=$(realpath "$SCRIPT_DIR/../repos/king-pos-server")
WORKTREES_DIR=$(realpath "$SCRIPT_DIR/../worktrees")
PROJECT_DIR="$WORKTREES_DIR/$DOMAIN"
ENV_FILE="$SCRIPT_DIR/envs/king-pos/.env.prod.local"
BRANCH="master"
CLIENT_BRANCH="king-client-${DOMAIN}" 
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
  git checkout "$CLIENT_BRANCH"
  git merge origin/$BRANCH
fi


# ==== COPY ENVIRONMENT FILE ====
echo "⚙️ Copying environment file (.env.prod.local) to project directory..."
cp "$ENV_FILE" "$PROJECT_DIR/.env.prod.local"

# ==== INSTALL PRODUCTION DEPENDENCIES ====
# echo "📦 Installing production dependencies with pnpm..."
# pnpm install --prod --ignore-scripts

# ==== SET SSL CERTIFICATE PATH ====
SSL_CERT_PATH="$(realpath "$SCRIPT_DIR/ssl")"
export SSL_CERT_PATH

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