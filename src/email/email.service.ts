import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly transporter: nodemailer.Transporter;
  private readonly from: string;
  private readonly senderName: string;

  constructor(private readonly configService: ConfigService) {
    this.from = configService.get<string>('email.from') ?? 'noreply@someme.app';
    this.senderName = configService.get<string>('email.senderName') ?? 'SoMeme';

    this.transporter = nodemailer.createTransport({
      host: configService.get<string>('email.host'),
      port: configService.get<number>('email.port'),
      secure: configService.get<number>('email.port') === 465,
      auth: {
        user: configService.get<string>('email.user'),
        pass: configService.get<string>('email.pass'),
      },
    });
  }

  async sendPasswordResetCode(email: string, code: string, username: string): Promise<void> {
    await this.transporter.sendMail({
      from: `"${this.senderName}" <${this.from}>`,
      to: email,
      subject: 'Your SoMeme password reset code',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
          <h2 style="color: #111;">Hi @${username},</h2>
          <p style="color: #444;">You requested to reset your password. Use the code below:</p>
          <div style="background: #f4f4f4; border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0;">
            <span style="font-size: 42px; font-weight: bold; letter-spacing: 12px; color: #6200ea;">${code}</span>
          </div>
          <p style="color: #666; font-size: 14px;">This code expires in <strong>10 minutes</strong>.</p>
          <p style="color: #666; font-size: 14px;">If you didn't request a password reset, you can safely ignore this email.</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
          <p style="color: #aaa; font-size: 12px;">SoMeme — The social meme captioning app</p>
        </div>
      `,
    });

    this.logger.log(`Password reset code sent to ${email}`);
  }

  async sendWelcomeEmail(email: string, username: string): Promise<void> {
    await this.transporter.sendMail({
      from: `"${this.senderName}" <${this.from}>`,
      to: email,
      subject: 'Welcome to SoMeme! 🎭',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
          <h2 style="color: #111;">Welcome to SoMeme, @${username}! 🎭</h2>
          <p style="color: #444;">You're now part of the best meme captioning community on the internet.</p>
          <p style="color: #444;">Start by exploring memes and adding your best captions!</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
          <p style="color: #aaa; font-size: 12px;">SoMeme — The social meme captioning app</p>
        </div>
      `,
    });
  }
}
