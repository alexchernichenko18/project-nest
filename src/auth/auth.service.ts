import { BadRequestException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';
import { JwtService } from '@nestjs/jwt';
import { OAuth2Client } from 'google-auth-library';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';

@Injectable()
export class AuthService {
  private googleClient: OAuth2Client;

  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private cfg: ConfigService,
    @Inject(CACHE_MANAGER) private cache: Cache,
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

  private async signToken(sub: unknown, email: string, tokenVersion: number) {
    return this.jwt.signAsync({ sub, email, tv: tokenVersion });
  }
}
