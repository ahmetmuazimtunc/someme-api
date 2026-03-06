import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { UserReportReason } from '@prisma/client';

export class ReportUserDto {
  @ApiProperty({ example: 'spammer99', description: 'Username of the user to report' })
  @IsString()
  username: string;

  @ApiProperty({ enum: UserReportReason, example: UserReportReason.SPAM })
  @IsEnum(UserReportReason)
  reason: UserReportReason;

  @ApiPropertyOptional({ example: 'Sending repeated unsolicited messages', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
