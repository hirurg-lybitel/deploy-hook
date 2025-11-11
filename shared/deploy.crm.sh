#!/bin/bash

set -e 

# ==== CONFIGURATION ====
REPO_URL="git@github-gdmn-nxt:GoldenSoftwareLtd/gdmn-nxt.git"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR=$(realpath "$SCRIPT_DIR/../repos/gdmn-nxt")
BRANCH="main"
ENV_FILE_DIR="$SCRIPT_DIR/envs/crm"
DEPLOY_SCRIPT="docker:build"

echo "📦 [CRM] Starting deployment: $(date)"
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
echo "⚙️ Copying environment files to project directory..."
cp -a "/$ENV_FILE_DIR/." "/$PROJECT_DIR/"

# ==== INSTALL PRODUCTION DEPENDENCIES ====
echo "📦 Installing production dependencies..."
yarn install

# ==== SET SSL CERTIFICATE PATH ====
SSL_CERT_PATH="$(realpath "$SCRIPT_DIR/ssl")"
export SSL_CERT_PATH

# ==== RUN DEPLOY SCRIPT ====
echo "🚀 Running deploy with $DEPLOY_SCRIPT ..."
yarn "$DEPLOY_SCRIPT"

# ==== DEPLOYMENT COMPLETE ====
echo "✅ [CRM] Deployment finished: $(date)"

# # ==== CLEANUP ====
# echo "🧹 Removing project directory: $PROJECT_DIR"
# rm -rf "$PROJECT_DIR"
# echo "🗑️ Project directory removed."