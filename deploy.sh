#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# deploy.sh — Zero-downtime deployment script for someme-api
# Usage: ./deploy.sh [branch]
# Default branch: main
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

BRANCH="${1:-main}"
APP_DIR="/home/someme/someme-api"
LOG_DIR="/var/log/pm2"
APP_NAME="someme-api"

echo "──────────────────────────────────────────"
echo " SoMeme API Deployment — branch: $BRANCH"
echo " $(date '+%Y-%m-%d %H:%M:%S')"
echo "──────────────────────────────────────────"

cd "$APP_DIR"

# 1. Pull latest code
echo "[1/6] Pulling latest code from origin/$BRANCH..."
git fetch origin
git checkout "$BRANCH"
git pull origin "$BRANCH"

# 2. Install / update dependencies (production only, skip devDependencies)
echo "[2/6] Installing dependencies..."
npm ci --omit=dev

# 3. Run database migrations (safe — only applies pending migrations)
echo "[3/6] Running Prisma migrations..."
npx prisma migrate deploy
npx prisma generate

# 4. Build TypeScript → dist/
echo "[4/6] Building application..."
npm run build

# 5. Ensure log directory exists
mkdir -p "$LOG_DIR"

# 6. Reload PM2 with zero downtime (cluster reload)
echo "[5/6] Reloading PM2 cluster..."
if pm2 describe "$APP_NAME" > /dev/null 2>&1; then
  pm2 reload "$APP_NAME" --update-env
else
  pm2 start ecosystem.config.js
fi

pm2 save

# 7. Optional — clear Redis search/trending caches so stale data is not served
echo "[6/6] Clearing Redis caches..."
redis-cli -a "$REDIS_PASSWORD" KEYS "search:*" | xargs -r redis-cli -a "$REDIS_PASSWORD" DEL > /dev/null 2>&1 || true
redis-cli -a "$REDIS_PASSWORD" DEL "trending:topics:v2" > /dev/null 2>&1 || true

echo ""
echo "✓ Deployment complete!"
echo "  Status:  pm2 status"
echo "  Logs:    pm2 logs $APP_NAME"
echo "  Health:  curl http://localhost:3000/api/v1/health"
