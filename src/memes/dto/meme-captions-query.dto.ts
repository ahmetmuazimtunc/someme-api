import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, Length } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export enum CaptionOrder {
  RANK = 'rank',
  RECENT = 'recent',
  TOP = 'top',
}

export class MemeCaptionsQueryDto extends PaginationDto {
  @ApiPropertyOptional({ enum: CaptionOrder, default: CaptionOrder.RANK })
  @IsOptional()
  @IsEnum(CaptionOrder)
  order?: CaptionOrder = CaptionOrder.RANK;

  @ApiPropertyOptional({ example: 'en', description: 'Filter by language code' })
  @IsOptional()
  @IsString()
  @Length(2, 5)
  language?: string;
}
