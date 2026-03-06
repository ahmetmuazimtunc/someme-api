import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class ViewCaptionDto {
  @ApiProperty({ description: 'Caption ID to record a view for' })
  @IsUUID('4')
  id: string;
}
