import { Module } from '@nestjs/common';
import { CaptionsService } from './captions.service';
import { CaptionsController } from './captions.controller';
import { TagsModule } from '../tags/tags.module';

@Module({
  imports: [TagsModule],
  providers: [CaptionsService],
  controllers: [CaptionsController],
})
export class CaptionsModule {}
