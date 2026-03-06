import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Length, MinLength, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class ForgotPasswordDto {
  @ApiProperty({ example: 'john@example.com' })
  @IsEmail()
  @Transform(({ value }: { value: string }) => value?.toLowerCase().trim())
  email: string;
}

export class VerifyResetCodeDto {
  @ApiProperty({ example: 'john@example.com' })
  @IsEmail()
  @Transform(({ value }: { value: string }) => value?.toLowerCase().trim())
  email: string;

  @ApiProperty({ example: '483921', description: '6-digit code sent to email' })
  @IsString()
  @Length(6, 6, { message: 'Code must be exactly 6 digits' })
  code: string;
}

export class ResetPasswordDto {
  @ApiProperty({ example: 'john@example.com' })
  @IsEmail()
  @Transform(({ value }: { value: string }) => value?.toLowerCase().trim())
  email: string;

  @ApiProperty({ example: '483921', description: '6-digit code sent to email' })
  @IsString()
  @Length(6, 6)
  code: string;

  @ApiProperty({ example: 'NewStrongP@ss1', description: 'New password, minimum 8 characters' })
  @IsString()
  @MinLength(8)
  @MaxLength(64)
  newPassword: string;
}
