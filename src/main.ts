import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import * as compression from 'compression';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log', 'debug'],
  });

  const configService = app.get(ConfigService);
  const env = configService.get<string>('app.env');
  const port = configService.get<number>('port') ?? 3000;

  app.use(helmet());
  app.use(compression());

  app.enableCors({
    origin: configService.get<string>('app.frontendUrl'),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  app.setGlobalPrefix('api');

  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new LoggingInterceptor());

  if (env !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('SoMeme API')
      .setDescription('Social Meme Captioning App — REST API')
      .setVersion('1.0')
      .addBearerAuth(
        { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        'access-token',
      )
      .addTag('auth', 'Register, login, refresh tokens')
      .addTag('users', 'User profiles and follows')
      .addTag('memes', 'Meme upload and retrieval')
      .addTag('captions', 'Caption CRUD and likes')
      .addTag('notifications', 'User notification feed')
      .addTag('search', 'Search memes, captions and users')
      .addTag('health', 'Service health checks')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });

    logger.log(`Swagger docs → http://localhost:${port}/api/docs`);
  }

  await app.listen(port);
  logger.log(`Server running on port ${port} [${env}]`);
}

bootstrap();
