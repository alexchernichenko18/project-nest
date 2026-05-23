import { BadRequestException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { JwtService } from '@nestjs/jwt';
import { OAuth2Client } from 'google-auth-library';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { MailService } from '../mail/mail.service';

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

@Injectable()
export class AuthService {
  private googleClient: OAuth2Client;

  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private cfg: ConfigService,
    @Inject(CACHE_MANAGER) private cache: Cache,
    private mail: MailService,
  ) {
    this.googleClient = new OAuth2Client(cfg.get<string>('GOOGLE_CLIENT_ID'));
  }

  async register(email: string, password: string, name?: string) {
    const hash = await bcrypt.hash(password, 10);
    try {
      const user = await this.prisma.user.create({
        data: { email, password: hash, name },
        select: { id: true, email: true, name: true, createdAt: true, tokenVersion: true },
      });

      const accessToken = await this.signToken(user.id, user.email, user.tokenVersion);

      return { user: { id: user.id, email: user.email, name: user.name }, accessToken };
    } catch (e: any) {
      if (e.code === 'P2002') throw new BadRequestException('Email is already taken');
      throw e;
    }
  }

  async login(email: string, password: string) {
    const found = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, name: true, password: true },
    });
    if (!found || !found.password) throw new UnauthorizedException('Invalid credentials');

    const ok = await bcrypt.compare(password, found.password);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    const user = await this.prisma.user.update({
      where: { id: found.id },
      data: { tokenVersion: { increment: 1 } },
      select: { id: true, email: true, name: true, tokenVersion: true },
    });

    const accessToken = await this.signToken(user.id, user.email, user.tokenVersion);
    await this.cache.del(`auth:me:${user.id}`);

    return { user: { id: user.id, email: user.email, name: user.name }, accessToken };
  }

  async googleLogin(idToken: string) {
    const ticket = await this.googleClient.verifyIdToken({
      idToken,
      audience: this.cfg.get<string>('GOOGLE_CLIENT_ID'),
    });
    const payload = ticket.getPayload();
    if (!payload?.email || !payload.sub) {
      throw new UnauthorizedException('Invalid Google token');
    }
    if (!payload.email_verified) {
      throw new UnauthorizedException('Google email not verified');
    }

    let account = await this.prisma.account.findUnique({
      where: { provider_providerAccountId: { provider: 'google', providerAccountId: payload.sub } },
      include: { user: true },
    });

    if (!account) {
      let user = await this.prisma.user.findUnique({ where: { email: payload.email.toLowerCase() } });
      // If we don't have Google account and we don't have user
      if (!user) {
        user = await this.prisma.user.create({
          data: {
            email: payload.email.toLowerCase(),
            name: payload.name,
            password: null,
          },
        });
      }

      // If we don't have Google account but we already have user with this email we just create Google account
      account = await this.prisma.account.create({
        data: {
          userId: user.id,
          provider: 'google',
          providerAccountId: payload.sub,
        },
        include: { user: true },
      });
    }

    const user = await this.prisma.user.update({
      where: { id: account.userId },
      data: { tokenVersion: { increment: 1 } },
    });

    const accessToken = await this.signToken(user.id, user.email, user.tokenVersion);
    return { user: { id: user.id, email: user.email, name: user.name }, accessToken };
  }

  async forgotPassword(email: string) {
    const normalizedEmail = email.toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true, email: true, password: true },
    });

    if (user && user.password) {
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

      await this.prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });
      await this.prisma.passwordResetToken.create({
        data: { userId: user.id, tokenHash, expiresAt },
      });

      const frontendUrl = this.cfg.get<string>('FRONTEND_URL') ?? 'http://localhost:3000';
      const resetUrl = `${frontendUrl}/reset-password?token=${rawToken}`;

      try {
        await this.mail.sendPasswordResetEmail(user.email, resetUrl);
      } catch {
        // Swallow to preserve anti-enumeration; MailService already logged the cause.
      }
    }

    return { message: 'If an account with that email exists, a reset link has been sent' };
  }

  async resetPassword(token: string, newPassword: string) {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!record || record.expiresAt < new Date()) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    const hash = await bcrypt.hash(newPassword, 10);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        data: { password: hash, tokenVersion: { increment: 1 } },
      }),
      this.prisma.passwordResetToken.deleteMany({ where: { userId: record.userId } }),
    ]);

    await this.cache.del(`auth:me:${record.userId}`);

    return { message: 'Password has been reset successfully' };
  }

  private async signToken(sub: unknown, email: string, tokenVersion: number) {
    return this.jwt.signAsync({ sub, email, tv: tokenVersion });
  }
}
