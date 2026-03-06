import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { DatabaseService } from '../database/database.service';
import { RedisService } from '../redis/redis.service';
import { Public } from '../common/decorators/public.decorator';

@ApiTags('health')
@Controller({ path: 'health', version: '1' })
export class HealthController {
  constructor(
    private readonly db: DatabaseService,
    private readonly redis: RedisService,
  ) {}

  @Get()
  @Public()
  @ApiOperation({ summary: 'Check service health' })
  async check() {
    const result = {
      status: 'ok' as 'ok' | 'degraded',
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
      services: {
        database: 'unknown' as 'up' | 'down' | 'unknown',
        redis: 'unknown' as 'up' | 'down' | 'unknown',
      },
    };

    await Promise.allSettled([
      this.db.$queryRaw`SELECT 1`.then(() => {
        result.services.database = 'up';
      }),
      this.redis.ping().then((pong) => {
        result.services.redis = pong === 'PONG' ? 'up' : 'down';
      }),
    ]);

    const anyDown = Object.values(result.services).some((s) => s === 'down');
    if (anyDown) result.status = 'degraded';

    return result;
  }
}
