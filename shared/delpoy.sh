#!/bin/bash

set -e 

# ==== CONFIGURATION ====
REPO_URL="git@github.com:GoldenSoftwareLtd/king-of-pos.git"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR=$(realpath "$SCRIPT_DIR/../repos/king-pos-server")
ENV_FILE="$SCRIPT_DIR/envs/.env.prod.local"
BRANCH="master"
DEPLOY_SCRIPT="docker:s:up"

echo "📦 Starting deployment: $(date)"
echo "📁 Target repository directory: $PROJECT_DIR"

# ==== CLONE OR UPDATE REPOSITORY ====
if [ -d "$PROJECT_DIR/.git" ]; then
  echo "📁 Repository already exists. Pulling latest changes..."
  cd "$PROJECT_DIR"
  git reset --hard
  git clean -fd
  git fetch origin
  git checkout $BRANCH
  git pull origin $BRANCH
else
  echo "📁 Cloning repository..."
  git clone --branch "$BRANCH" "$REPO_URL" "$PROJECT_DIR"
  cd "$PROJECT_DIR"  
fi


# ==== COPY ENVIRONMENT FILE ====
echo "⚙️ Copying environment file (.env.prod.local) to project directory..."
cp "$ENV_FILE" "$PROJECT_DIR/.env.prod.local"

# ==== INSTALL PRODUCTION DEPENDENCIES ====
echo "📦 Installing production dependencies with pnpm..."
pnpm install --prod --ignore-scripts

# ==== SET SSL CERTIFICATE PATH ====
SSL_CERT_PATH="$(realpath "$SCRIPT_DIR/ssl")"
export SSL_CERT_PATH
echo "📁 SSL_CERT_PATH set to: $SSL_CERT_PATH"

# ==== RUN DEPLOY SCRIPT ====
echo "🚀 Running pnpm $DEPLOY_SCRIPT with build flag..."
pnpm "$DEPLOY_SCRIPT" --build

# ==== DEPLOYMENT COMPLETE ====
echo "✅ Deployment finished: $(date)"