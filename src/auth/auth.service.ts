import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';
import * as bcrypt from 'bcrypt';
import * as sharp from 'sharp';

import { DatabaseService } from '../database/database.service';
import { RedisService } from '../redis/redis.service';
import { EmailService } from '../email/email.service';
import { StorageService } from '../storage/storage.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { GoogleLoginDto, AppleLoginDto, FacebookLoginDto } from './dto/social-login.dto';
import type { JwtPayload } from './strategies/jwt.strategy';

const BCRYPT_ROUNDS = 12;
const REFRESH_TOKEN_TTL = 60 * 60 * 24 * 30;
const RESET_CODE_TTL = 60 * 10;
const MIN_AGE_YEARS = 13;

const SAFE_USER_SELECT = {
  id: true,
  username: true,
  email: true,
  displayName: true,
  bio: true,
  photoUrl: true,
  birthday: true,
  isVerified: true,
  contentLanguages: true,
  socialProvider: true,
  createdAt: true,
  _count: { select: { followers: true, following: true, captions: true } },
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly googleClient: OAuth2Client;

  constructor(
    private readonly db: DatabaseService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly redis: RedisService,
    private readonly email: EmailService,
    private readonly storage: StorageService,
  ) {
    this.googleClient = new OAuth2Client(configService.get<string>('google.clientId'));
  }

  // ─── Registration ───────────────────────────────────────────────────────────

  async register(dto: RegisterDto) {
    this.validateAge(dto.birthday);

    const [existingEmail, existingUsername] = await Promise.all([
      this.db.user.findUnique({ where: { email: dto.email } }),
      this.db.user.findUnique({ where: { username: dto.username } }),
    ]);

    if (existingEmail) throw new ConflictException('Email is already in use');
    if (existingUsername) throw new ConflictException('Username is already taken');

    const hashedPassword = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    const user = await this.db.user.create({
      data: {
        username: dto.username,
        email: dto.email,
        password: hashedPassword,
        displayName: dto.displayName ?? dto.username,
        birthday: new Date(dto.birthday),
        contentLanguages: dto.contentLanguages ?? ['en'],
      },
      select: SAFE_USER_SELECT,
    });

    this.logger.log(`New user registered: @${user.username}`);

    // Fire and forget welcome email
    this.email.sendWelcomeEmail(dto.email, dto.username).catch(() => null);

    const tokens = await this.generateTokens(user.id, dto.email, dto.username);
    await this.storeRefreshToken(user.id, tokens.refreshToken);

    return { user, ...tokens };
  }

  // ─── Login ───────────────────────────────────────────────────────────────────

  async login(dto: LoginDto) {
    const isEmail = dto.identifier.includes('@');

    const user = await this.db.user.findFirst({
      where: isEmail
        ? { email: dto.identifier.toLowerCase() }
        : { username: dto.identifier.toLowerCase() },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.password) {
      throw new UnauthorizedException(
        `This account uses ${user.socialProvider} login. Please sign in with ${user.socialProvider}.`,
      );
    }

    const passwordMatch = await bcrypt.compare(dto.password, user.password);
    if (!passwordMatch) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const tokens = await this.generateTokens(user.id, user.email, user.username);
    await this.storeRefreshToken(user.id, tokens.refreshToken);

    const safeUser = await this.db.user.findUnique({
      where: { id: user.id },
      select: SAFE_USER_SELECT,
    });

    return { user: safeUser, ...tokens };
  }

  // ─── Current User ────────────────────────────────────────────────────────────

  async getCurrentUser(userId: string) {
    return this.db.user.findUnique({
      where: { id: userId },
      select: SAFE_USER_SELECT,
    });
  }

  // ─── Update Profile ──────────────────────────────────────────────────────────

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    let photoUrl: string | undefined;

    if (dto.photoBase64) {
      const buffer = this.decodeBase64Image(dto.photoBase64);
      const resized = await sharp(buffer)
        .resize(512, 512, { fit: 'cover', position: 'centre' })
        .jpeg({ quality: 85 })
        .toBuffer();

      const file: Express.Multer.File = {
        buffer: resized,
        originalname: `avatar_${userId}.jpg`,
        mimetype: 'image/jpeg',
        size: resized.length,
        fieldname: 'file',
        encoding: '7bit',
        stream: null as never,
        destination: '',
        filename: '',
        path: '',
      };

      const result = await this.storage.uploadFile(file, 'avatars');
      photoUrl = result.url;
    }

    return this.db.user.update({
      where: { id: userId },
      data: {
        ...(dto.displayName && { displayName: dto.displayName }),
        ...(dto.bio !== undefined && { bio: dto.bio }),
        ...(dto.birthday && { birthday: new Date(dto.birthday) }),
        ...(dto.contentLanguages && { contentLanguages: dto.contentLanguages }),
        ...(photoUrl && { photoUrl }),
      },
      select: SAFE_USER_SELECT,
    });
  }

  // ─── Token Management ────────────────────────────────────────────────────────

  async refreshTokens(userId: string, refreshToken: string) {
    const stored = await this.redis.get(`refresh:${userId}`);
    if (!stored) throw new UnauthorizedException('Refresh token expired or invalid');

    const matches = await bcrypt.compare(refreshToken, stored);
    if (!matches) throw new UnauthorizedException('Invalid refresh token');

    const user = await this.db.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, username: true, isActive: true },
    });

    if (!user || !user.isActive) throw new UnauthorizedException('Account not found');

    const tokens = await this.generateTokens(user.id, user.email, user.username);
    await this.storeRefreshToken(user.id, tokens.refreshToken);
    return tokens;
  }

  async logout(userId: string) {
    await this.redis.del(`refresh:${userId}`);
    return { message: 'Logged out successfully' };
  }

  // ─── Password Reset ──────────────────────────────────────────────────────────

  async sendPasswordReset(email: string) {
    const user = await this.db.user.findUnique({ where: { email } });

    // Always return success to prevent email enumeration
    if (!user || !user.isActive || !user.password) {
      return { message: 'If that email exists, a reset code has been sent' };
    }

    const code = this.generateSixDigitCode();
    await this.redis.set(`pwd_reset:${email}`, code, RESET_CODE_TTL);

    await this.email.sendPasswordResetCode(email, code, user.username);

    return { message: 'If that email exists, a reset code has been sent' };
  }

  async verifyResetCode(email: string, code: string) {
    const stored = await this.redis.get(`pwd_reset:${email}`);

    if (!stored || stored !== code) {
      throw new BadRequestException('Invalid or expired reset code');
    }

    return { valid: true, message: 'Code is valid. Proceed to reset your password.' };
  }

  async resetPassword(email: string, code: string, newPassword: string) {
    const stored = await this.redis.get(`pwd_reset:${email}`);

    if (!stored || stored !== code) {
      throw new BadRequestException('Invalid or expired reset code');
    }

    const user = await this.db.user.findUnique({ where: { email } });
    if (!user) throw new NotFoundException('Account not found');

    const hashedPassword = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

    await Promise.all([
      this.db.user.update({ where: { email }, data: { password: hashedPassword } }),
      this.redis.del(`pwd_reset:${email}`),
      this.redis.del(`refresh:${user.id}`), // invalidate all sessions
    ]);

    this.logger.log(`Password reset for @${user.username}`);
    return { message: 'Password reset successfully. Please log in again.' };
  }

  // ─── Username Check ──────────────────────────────────────────────────────────

  async checkUsername(username: string) {
    const existing = await this.db.user.findUnique({
      where: { username: username.toLowerCase() },
      select: { id: true },
    });
    return { available: !existing };
  }

  // ─── Social Auth ─────────────────────────────────────────────────────────────

  async googleLogin(dto: GoogleLoginDto) {
    const clientId = this.configService.get<string>('google.clientId');

    if (!clientId) {
      throw new BadRequestException('Google login is not configured');
    }

    let googleId: string;
    let googleEmail: string;
    let name: string | undefined;
    let picture: string | undefined;

    try {
      const ticket = await this.googleClient.verifyIdToken({
        idToken: dto.idToken,
        audience: clientId,
      });
      const payload = ticket.getPayload();
      if (!payload?.sub) throw new Error('No payload');

      googleId = payload.sub;
      googleEmail = payload.email ?? '';
      name = payload.name;
      picture = payload.picture;
    } catch {
      throw new UnauthorizedException('Invalid Google token');
    }

    return this.findOrCreateSocialUser('google', googleId, googleEmail, name, picture);
  }

  async appleLogin(dto: AppleLoginDto) {
    let appleId: string;
    let appleEmail: string;
    let name: string | undefined;

    try {
      // Decode the identity token (JWT) — Apple signs it with their private key
      // For production: verify signature against https://appleid.apple.com/auth/keys
      const parts = dto.identityToken.split('.');
      if (parts.length !== 3) throw new Error('Invalid token format');

      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));

      if (payload.iss !== 'https://appleid.apple.com') {
        throw new Error('Invalid issuer');
      }
      if (Date.now() / 1000 > payload.exp) {
        throw new Error('Token expired');
      }

      appleId = payload.sub;
      appleEmail = payload.email ?? '';
      name = dto.fullName;
    } catch {
      throw new UnauthorizedException('Invalid Apple token');
    }

    return this.findOrCreateSocialUser('apple', appleId, appleEmail, name);
  }

  async facebookLogin(dto: FacebookLoginDto) {
    let fbId: string;
    let fbEmail: string;
    let name: string | undefined;
    let picture: string | undefined;

    try {
      const res = await fetch(
        `https://graph.facebook.com/me?fields=id,name,email,picture&access_token=${dto.accessToken}`,
      );
      if (!res.ok) throw new Error('Facebook API error');

      const data = (await res.json()) as {
        id?: string;
        email?: string;
        name?: string;
        picture?: { data?: { url?: string } };
      };

      if (!data.id) throw new Error('No user ID');

      fbId = data.id;
      fbEmail = data.email ?? '';
      name = data.name;
      picture = data.picture?.data?.url;
    } catch {
      throw new UnauthorizedException('Invalid Facebook token');
    }

    return this.findOrCreateSocialUser('facebook', fbId, fbEmail, name, picture);
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────────

  private async findOrCreateSocialUser(
    provider: string,
    socialId: string,
    email: string,
    name?: string,
    photoUrl?: string,
  ) {
    // Try to find by social ID first
    let user = await this.db.user.findFirst({
      where: { socialProvider: provider, socialId },
      select: SAFE_USER_SELECT,
    });

    if (!user && email) {
      // Try to link to existing account with same email
      const existing = await this.db.user.findUnique({ where: { email } });
      if (existing) {
        user = await this.db.user.update({
          where: { id: existing.id },
          data: { socialProvider: provider, socialId },
          select: SAFE_USER_SELECT,
        });
      }
    }

    if (!user) {
      // Create new user
      const username = await this.generateUniqueUsername(name ?? provider);
      user = await this.db.user.create({
        data: {
          username,
          email: email || `${socialId}@${provider}.social`,
          displayName: name ?? username,
          photoUrl,
          socialProvider: provider,
          socialId,
          isVerified: true,
          contentLanguages: ['en'],
        },
        select: SAFE_USER_SELECT,
      });
      this.logger.log(`New social user created via ${provider}: @${user.username}`);
    }

    const fullUser = await this.db.user.findUnique({ where: { id: user.id } });
    const tokens = await this.generateTokens(user.id, fullUser!.email, user.username);
    await this.storeRefreshToken(user.id, tokens.refreshToken);

    return { user, ...tokens };
  }

  private async generateUniqueUsername(baseName: string): Promise<string> {
    const base = baseName
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_')
      .replace(/_+/g, '_')
      .slice(0, 18);

    let candidate = base;
    let attempts = 0;

    while (attempts < 10) {
      const existing = await this.db.user.findUnique({ where: { username: candidate } });
      if (!existing) return candidate;
      candidate = `${base}${Math.floor(Math.random() * 9000) + 1000}`;
      attempts++;
    }

    return `user_${Date.now()}`;
  }

  private async generateTokens(userId: string, email: string, username: string) {
    const payload: JwtPayload = { sub: userId, email, username };

    const accessExpiresIn = (this.configService.get<string>('jwt.expiresIn') ?? '30d') as never;
    const refreshExpiresIn = (this.configService.get<string>('jwt.refreshExpiresIn') ?? '30d') as never;

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.configService.get<string>('jwt.secret'),
        expiresIn: accessExpiresIn,
      }),
      this.jwtService.signAsync(payload, {
        secret: this.configService.get<string>('jwt.refreshSecret'),
        expiresIn: refreshExpiresIn,
      }),
    ]);

    return { accessToken, refreshToken };
  }

  private async storeRefreshToken(userId: string, token: string): Promise<void> {
    const hashed = await bcrypt.hash(token, BCRYPT_ROUNDS);
    await this.redis.set(`refresh:${userId}`, hashed, REFRESH_TOKEN_TTL);
  }

  private validateAge(birthday: string): void {
    const dob = new Date(birthday);
    const today = new Date();
    const age = today.getFullYear() - dob.getFullYear();
    const hasBirthdayPassed =
      today.getMonth() > dob.getMonth() ||
      (today.getMonth() === dob.getMonth() && today.getDate() >= dob.getDate());
    const exactAge = hasBirthdayPassed ? age : age - 1;

    if (exactAge < MIN_AGE_YEARS) {
      throw new BadRequestException(`You must be at least ${MIN_AGE_YEARS} years old to register`);
    }
  }

  private generateSixDigitCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  private decodeBase64Image(base64: string): Buffer {
    const base64Data = base64.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    if (buffer.length > 10 * 1024 * 1024) {
      throw new BadRequestException('Image too large. Max 10MB.');
    }
    return buffer;
  }
}
