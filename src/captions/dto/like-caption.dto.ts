import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class LikeCaptionDto {
  @ApiProperty({ description: 'Caption ID to like or unlike' })
  @IsUUID('4')
  id: string;
}
