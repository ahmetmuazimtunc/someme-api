import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class LoginDto {
  @ApiProperty({
    example: 'john@example.com',
    description: 'Email address OR username',
  })
  @IsString()
  @Transform(({ value }: { value: string }) => value?.trim())
  identifier: string;

  @ApiProperty({ example: 'StrongP@ss1' })
  @IsString()
  @MinLength(8)
  password: string;
}
