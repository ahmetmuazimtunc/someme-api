module.exports = {
  apps: [
    {
      name: 'someme-api',
      script: 'dist/main.js',

      // Run 2 instances in cluster mode for zero-downtime reloads
      instances: 2,
      exec_mode: 'cluster',

      // Auto-restart settings
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      restart_delay: 2000,

      // Graceful shutdown: wait up to 10 s for in-flight requests
      kill_timeout: 10000,
      listen_timeout: 8000,

      // Log configuration
      out_file: '/var/log/pm2/someme-api-out.log',
      error_file: '/var/log/pm2/someme-api-err.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',

      // Environment variables are loaded from the .env file on the server.
      // Only override NODE_ENV here so the production .env is respected.
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
    },
  ],

  // ─── Deployment config (optional — used with `pm2 deploy`) ──────────────────
  deploy: {
    production: {
      user: 'someme',
      host: '134.122.101.42',
      ref: 'origin/main',
      repo: 'git@github.com:YOUR_ORG/someme-api.git',
      path: '/home/someme/someme-api',
      'post-deploy':
        'npm ci && npx prisma migrate deploy && npm run build && pm2 reload ecosystem.config.js --env production',
    },
  },
};
