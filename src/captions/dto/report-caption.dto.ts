import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { ReportReason } from '@prisma/client';

export class ReportCaptionDto {
  @ApiProperty({ description: 'Caption ID to report' })
  @IsUUID('4')
  caption_id: string;

  @ApiProperty({ enum: ReportReason, example: ReportReason.INAPPROPRIATE })
  @IsEnum(ReportReason)
  reason: ReportReason;

  @ApiPropertyOptional({ example: 'Contains offensive language', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
