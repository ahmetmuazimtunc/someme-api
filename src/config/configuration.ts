export default () => ({
  email: {
    host: process.env.SMTP_HOST ?? 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT ?? '587', 10),
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.SMTP_FROM ?? 'noreply@someme.app',
    senderName: process.env.SMTP_SENDER_NAME ?? 'SoMeme',
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
  },
  port: parseInt(process.env.PORT ?? '3000', 10),
  app: {
    env: process.env.NODE_ENV ?? 'development',
    frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:3001',
  },
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '30d',
  },
  redis: {
    url: process.env.REDIS_URL,
  },
  spaces: {
    key: process.env.DO_SPACES_KEY,
    secret: process.env.DO_SPACES_SECRET,
    endpoint: process.env.DO_SPACES_ENDPOINT,
    bucket: process.env.DO_SPACES_BUCKET,
    region: process.env.DO_SPACES_REGION ?? 'lon1',
    cdnEndpoint: process.env.DO_SPACES_CDN_ENDPOINT,
  },
});
