import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

type Transport =
  | { kind: 'smtp'; transporter: Transporter }
  | { kind: 'resend'; resend: Resend }
  | { kind: 'console' };

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transport: Transport;
  private readonly from: string;

  constructor(private cfg: ConfigService) {
    this.from = this.cfg.get<string>('EMAIL_FROM') ?? 'onboarding@resend.dev';

    const smtpHost = this.cfg.get<string>('SMTP_HOST');
    const apiKey = this.cfg.get<string>('RESEND_API_KEY');

    if (smtpHost) {
      const port = Number(this.cfg.get<string>('SMTP_PORT') ?? 1025);
      const user = this.cfg.get<string>('SMTP_USER');
      const pass = this.cfg.get<string>('SMTP_PASS');
      this.transport = {
        kind: 'smtp',
        transporter: nodemailer.createTransport({
          host: smtpHost,
          port,
          secure: port === 465,
          auth: user && pass ? { user, pass } : undefined,
        }),
      };
      this.logger.log(`MailService: SMTP transport → ${smtpHost}:${port}`);
    } else if (apiKey) {
      this.transport = { kind: 'resend', resend: new Resend(apiKey) };
      this.logger.log('MailService: Resend transport');
    } else {
      this.transport = { kind: 'console' };
      this.logger.warn(
        'MailService: no SMTP_HOST or RESEND_API_KEY — emails will be logged to console',
      );
    }
  }

  async sendPasswordResetEmail(to: string, resetUrl: string) {
    const subject = 'Reset your password';
    const html = `
      <p>You requested a password reset.</p>
      <p>Click the link below to set a new password. The link expires in 1 hour.</p>
      <p><a href="${resetUrl}">${resetUrl}</a></p>
      <p>If you didn't request this, you can safely ignore this email.</p>
    `;
    const text = `Reset your password: ${resetUrl}\n\nThe link expires in 1 hour. If you didn't request this, ignore this email.`;

    if (this.transport.kind === 'console') {
      this.logger.log(`[MOCK EMAIL] to=${to} subject="${subject}" url=${resetUrl}`);
      return;
    }

    if (this.transport.kind === 'smtp') {
      await this.transport.transporter.sendMail({
        from: this.from,
        to,
        subject,
        html,
        text,
      });
      return;
    }

    const { error } = await this.transport.resend.emails.send({
      from: this.from,
      to,
      subject,
      html,
      text,
    });
    if (error) {
      this.logger.error(`Failed to send reset email to ${to}: ${error.message}`);
      throw new Error('Failed to send email');
    }
  }
}
