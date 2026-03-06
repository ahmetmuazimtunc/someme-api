import {
  Controller,
  Post,
  Get,
  Put,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ForgotPasswordDto, VerifyResetCodeDto, ResetPasswordDto } from './dto/reset-password.dto';
import { GoogleLoginDto, AppleLoginDto, FacebookLoginDto } from './dto/social-login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { PaginationDto } from '../common/dto/pagination.dto';
import { UsersService } from '../users/users.service';
import { User } from '@prisma/client';

// Strict rate limiting for auth endpoints: 5 requests per minute
const AUTH_THROTTLE = Throttle({ default: { limit: 5, ttl: 60000 } });

@ApiTags('auth')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
  ) {}

  // ─── Registration & Login ─────────────────────────────────────────────────

  @Post('register')
  @Public()
  @AUTH_THROTTLE
  @ApiOperation({ summary: 'Register with email, password and birthday' })
  @ApiResponse({ status: 201, description: 'Returns user + accessToken + refreshToken' })
  @ApiResponse({ status: 400, description: 'Validation error or age requirement not met' })
  @ApiResponse({ status: 409, description: 'Email or username already in use' })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @Public()
  @AUTH_THROTTLE
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email or username + password' })
  @ApiResponse({ status: 200, description: 'Returns user + accessToken + refreshToken' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  // ─── Current User ─────────────────────────────────────────────────────────

  @Get('user')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Get current authenticated user with stats' })
  me(@CurrentUser() user: User) {
    return this.authService.getCurrentUser(user.id);
  }

  @Put('user')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Update profile (displayName, bio, birthday, languages, photo)' })
  @ApiResponse({ status: 200, description: 'Returns updated user' })
  updateProfile(@CurrentUser() user: User, @Body() dto: UpdateProfileDto) {
    return this.authService.updateProfile(user.id, dto);
  }

  // ─── Token Management ─────────────────────────────────────────────────────

  @Post('refresh')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange refresh token for new access token' })
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  refresh(@CurrentUser() user: User, @Body() dto: RefreshTokenDto) {
    return this.authService.refreshTokens(user.id, dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Logout and invalidate refresh token' })
  logout(@CurrentUser() user: User) {
    return this.authService.logout(user.id);
  }

  // ─── Username Check ───────────────────────────────────────────────────────

  @Get('check-username')
  @Public()
  @ApiOperation({ summary: 'Check if a username is available' })
  @ApiQuery({ name: 'username', example: 'johndoe' })
  @ApiResponse({ status: 200, schema: { example: { available: true } } })
  checkUsername(@Query('username') username: string) {
    return this.authService.checkUsername(username);
  }

  // ─── Password Reset ───────────────────────────────────────────────────────

  @Post('password-reset')
  @Public()
  @AUTH_THROTTLE
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send 6-digit reset code to email (expires in 10 minutes)' })
  @ApiResponse({ status: 200, description: 'Always returns success to prevent email enumeration' })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.sendPasswordReset(dto.email);
  }

  @Post('password-reset/check')
  @Public()
  @AUTH_THROTTLE
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify the 6-digit reset code' })
  @ApiResponse({ status: 200, description: 'Code is valid' })
  @ApiResponse({ status: 400, description: 'Invalid or expired code' })
  verifyResetCode(@Body() dto: VerifyResetCodeDto) {
    return this.authService.verifyResetCode(dto.email, dto.code);
  }

  @Post('password-reset/reset')
  @Public()
  @AUTH_THROTTLE
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset password using the verified 6-digit code' })
  @ApiResponse({ status: 200, description: 'Password reset successfully' })
  @ApiResponse({ status: 400, description: 'Invalid or expired code' })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.email, dto.code, dto.newPassword);
  }

  // ─── Social Auth ──────────────────────────────────────────────────────────

  @Post('login/google')
  @Public()
  @AUTH_THROTTLE
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign in with Google ID token' })
  @ApiResponse({ status: 200, description: 'Returns user + tokens (creates account if new)' })
  googleLogin(@Body() dto: GoogleLoginDto) {
    return this.authService.googleLogin(dto);
  }

  @Post('login/apple')
  @Public()
  @AUTH_THROTTLE
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign in with Apple identity token' })
  @ApiResponse({ status: 200, description: 'Returns user + tokens (creates account if new)' })
  appleLogin(@Body() dto: AppleLoginDto) {
    return this.authService.appleLogin(dto);
  }

  @Post('login/facebook')
  @Public()
  @AUTH_THROTTLE
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign in with Facebook access token' })
  @ApiResponse({ status: 200, description: 'Returns user + tokens (creates account if new)' })
  facebookLogin(@Body() dto: FacebookLoginDto) {
    return this.authService.facebookLogin(dto);
  }

  // ─── Blocked Users ────────────────────────────────────────────────────────

  @Get('blocked-users')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Get list of users you have blocked' })
  getBlockedUsers(@CurrentUser() user: User, @Query() pagination: PaginationDto) {
    return this.usersService.getBlockedUsers(user.id, pagination);
  }
}
