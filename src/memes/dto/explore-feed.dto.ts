import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString, IsUUID } from 'class-validator';

export class ExploreFeedDto {
  @ApiPropertyOptional({
    description: 'Array of meme IDs already seen — these will be excluded',
    type: [String],
    example: ['uuid-1', 'uuid-2'],
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  excepts?: string[] = [];
}
