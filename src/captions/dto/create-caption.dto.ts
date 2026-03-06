import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength, IsOptional, Length, IsUUID } from 'class-validator';

export class CreateCaptionDto {
  @ApiProperty({ description: 'Meme ID to caption' })
  @IsUUID('4')
  meme_id: string;

  @ApiProperty({ example: 'When the WiFi drops for 2 seconds 😤', maxLength: 280 })
  @IsString()
  @MinLength(3, { message: 'Caption must be at least 3 characters' })
  @MaxLength(280, { message: 'Caption cannot exceed 280 characters' })
  text: string;

  @ApiPropertyOptional({ example: 'en', default: 'en' })
  @IsOptional()
  @IsString()
  @Length(2, 5)
  language?: string = 'en';
}
