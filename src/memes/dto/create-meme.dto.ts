import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsPositive } from 'class-validator';

export class CreateMemeDto {
  @ApiProperty({ description: 'Image width in pixels' })
  @IsInt()
  @IsPositive()
  width: number;

  @ApiProperty({ description: 'Image height in pixels' })
  @IsInt()
  @IsPositive()
  height: number;
}
