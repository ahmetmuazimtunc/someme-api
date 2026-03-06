import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsDateString,
  IsOptional,
  IsString,
  MaxLength,
  ArrayMaxSize,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'John Doe' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  @Transform(({ value }: { value: string }) => value?.trim())
  displayName?: string;

  @ApiPropertyOptional({ example: 'Meme connoisseur 🎭', maxLength: 160 })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  bio?: string;

  @ApiPropertyOptional({
    example: '1990-01-15',
    description: 'ISO date string',
  })
  @IsOptional()
  @IsDateString()
  birthday?: string;

  @ApiPropertyOptional({
    example: ['en', 'tr', 'es'],
    description: 'Preferred content language codes',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(10)
  contentLanguages?: string[];

  @ApiPropertyOptional({
    description: 'Base64-encoded image (jpeg/png/webp). Will be resized to 512×512.',
    example: 'data:image/jpeg;base64,/9j/4AAQ...',
  })
  @IsOptional()
  @IsString()
  photoBase64?: string;
}
