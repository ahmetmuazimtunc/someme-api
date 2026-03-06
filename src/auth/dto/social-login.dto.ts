import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional } from 'class-validator';

export class GoogleLoginDto {
  @ApiProperty({ description: 'Google ID token from the Google Sign-In SDK' })
  @IsString()
  idToken: string;
}

export class AppleLoginDto {
  @ApiProperty({ description: 'Apple identity token (JWT) from Sign in with Apple SDK' })
  @IsString()
  identityToken: string;

  @ApiPropertyOptional({ description: 'Apple authorization code' })
  @IsOptional()
  @IsString()
  authorizationCode?: string;

  @ApiPropertyOptional({ description: 'Full name provided by Apple on first login' })
  @IsOptional()
  @IsString()
  fullName?: string;
}

export class FacebookLoginDto {
  @ApiProperty({ description: 'Facebook access token from the Facebook SDK' })
  @IsString()
  accessToken: string;
}
