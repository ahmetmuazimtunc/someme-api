import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import * as Joi from 'joi';

import configuration from './config/configuration';
import { DatabaseModule } from './database/database.module';
import { RedisModule } from './redis/redis.module';
import { StorageModule } from './storage/storage.module';
import { EmailModule } from './email/email.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { MemesModule } from './memes/memes.module';
import { CaptionsModule } from './captions/captions.module';
import { NotificationsModule } from './notifications/notifications.module';
import { SearchModule } from './search/search.module';
import { TagsModule } from './tags/tags.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema: Joi.object({
        NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
        PORT: Joi.number().default(3000),
        DATABASE_URL: Joi.string().required(),
        REDIS_URL: Joi.string().required(),
        JWT_SECRET: Joi.string().required(),
        JWT_EXPIRES_IN: Joi.string().default('30d'),
        JWT_REFRESH_SECRET: Joi.string().required(),
        JWT_REFRESH_EXPIRES_IN: Joi.string().default('30d'),
        DO_SPACES_KEY: Joi.string().required(),
        DO_SPACES_SECRET: Joi.string().required(),
        DO_SPACES_ENDPOINT: Joi.string().required(),
        DO_SPACES_BUCKET: Joi.string().required(),
        DO_SPACES_REGION: Joi.string().default('lon1'),
        DO_SPACES_CDN_ENDPOINT: Joi.string().required(),
        FRONTEND_URL: Joi.string().default('http://localhost:3001'),
        SMTP_HOST: Joi.string().optional(),
        SMTP_PORT: Joi.number().default(587),
        SMTP_USER: Joi.string().optional(),
        SMTP_PASS: Joi.string().optional(),
        SMTP_FROM: Joi.string().default('noreply@someme.app'),
        GOOGLE_CLIENT_ID: Joi.string().optional(),
      }),
    }),
    ThrottlerModule.forRoot([
      { name: 'short', ttl: 1000, limit: 10 },
      { name: 'long', ttl: 60000, limit: 200 },
    ]),
    DatabaseModule,
    RedisModule,
    StorageModule,
    EmailModule,
    HealthModule,
    AuthModule,
    UsersModule,
    MemesModule,
    CaptionsModule,
    NotificationsModule,
    SearchModule,
    TagsModule,
  ],
  providers: [
    // JWT guard applied globally — use @Public() to opt out
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Rate limiting applied globally — use @Throttle() to override per route
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
