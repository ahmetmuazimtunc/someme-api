import { Module, forwardRef } from '@nestjs/common';
import { MemesService } from './memes.service';
import { MemesController } from './memes.controller';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [forwardRef(() => UsersModule)],
  providers: [MemesService],
  controllers: [MemesController],
  exports: [MemesService],
})
export class MemesModule {}
