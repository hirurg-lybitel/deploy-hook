#!/bin/bash

set -e 

# ==== CONFIGURATION ====
REPO_URL="git@github.com:naytron-org/naytron.git"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mkdir -p "$SCRIPT_DIR/../repos"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../repos" && pwd)/naytron-server"
ENV_FILE="$SCRIPT_DIR/envs/naytron/.env.prod.local"
BRANCH="main"
BUILD_SCRIPT="docker:s:build"
DEPLOY_SCRIPT="docker:s:run"

echo "📦 Starting deployment: $(date)"
echo "📁 Target repository directory: $PROJECT_DIR"

# ==== CLONE OR UPDATE REPOSITORY ====
if [ -d "$PROJECT_DIR/.git" ]; then
  echo "📁 Repository already exists. Pulling latest changes..."
  cd "$PROJECT_DIR"
  git fetch origin
  git checkout $BRANCH
  git reset --hard "origin/$BRANCH"
  git clean -fd
else
  echo "📁 Cloning repository..."
  git clone --branch "$BRANCH" "$REPO_URL" "$PROJECT_DIR"
  cd "$PROJECT_DIR"  
fi


# ==== COPY ENVIRONMENT FILE ====
echo "⚙️ Copying environment file (.env.prod.local) to project directory..."
cp "$ENV_FILE" "$PROJECT_DIR/.env.prod.local"
ENV_CENTRAL_FILE="$SCRIPT_DIR/envs/naytron/.env.central"
if [ -f "$ENV_CENTRAL_FILE" ]; then
  echo "⚙️ Appending central-only env (.env.central) for naytron instance..."
  printf '\n' >> "$PROJECT_DIR/.env.prod.local"
  cat "$ENV_CENTRAL_FILE" >> "$PROJECT_DIR/.env.prod.local"
fi

# ==== INSTALL PRODUCTION DEPENDENCIES ====
echo "📦 Installing production dependencies with pnpm..."
pnpm install --ignore-scripts

# ==== SET SSL CERTIFICATE PATH ====
SSL_CERT_PATH="$(realpath "$SCRIPT_DIR/ssl")"
echo "SET SSL PATH $SSL_CERT_PATH"
export SSL_CERT_PATH

# ==== SET SECRETS DIR PATH ====
SECRETS_PATH="$(realpath "$SCRIPT_DIR/secrets")"
echo "SET SECRETS DIR PATH $SECRETS_PATH"
export SECRETS_PATH

# ==== RUN BUILD SCRIPT ====
echo "🚀 Running building pnpm $BUILD_SCRIPT ..."
pnpm "$BUILD_SCRIPT"

# ==== RUN DEPLOY SCRIPT ====
echo "🚀 Running deploy pnpm $DEPLOY_SCRIPT ..."
pnpm "$DEPLOY_SCRIPT"


# ==== DEPLOYMENT COMPLETE ====
echo "✅ Deployment finished: $(date)"

# # ==== CLEANUP ====
# echo "🧹 Removing project directory: $PROJECT_DIR"
# rm -rf "$PROJECT_DIR"
# echo "🗑️ Project directory removed."
