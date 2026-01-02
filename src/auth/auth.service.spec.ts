import { AuthService } from './auth.service';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';

// 1) Мокаємо bcryptjs ОДИН РАЗ
jest.mock('bcryptjs', () => ({
  hash: jest.fn(),
  compare: jest.fn(),
}));

describe('AuthService (unit)', () => {
  const prisma = {
    user: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    account: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  } as any;

  const jwt: Partial<JwtService> = {
    signAsync: jest.fn().mockResolvedValue('JWT'),
  };

  const cfg = {
    get: (k: string) => (k === 'GOOGLE_CLIENT_ID' ? 'test-google-client-id' : null),
  } as any;

  const cache = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  } as any;

  let service: AuthService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new AuthService(prisma, jwt as JwtService, cfg, cache);

    // гарантуємо що signAsync завжди повертає "JWT"
    jest.spyOn(service['jwt'], 'signAsync').mockResolvedValue('JWT');

    (service as any).googleClient = {
      verifyIdToken: jest.fn(),
    };
  });

  describe('register', () => {
    it('ok', async () => {
      (bcrypt.hash as jest.Mock).mockResolvedValue('HASH');
      prisma.user.create.mockResolvedValue({
        id: 1,
        email: 'a@b.com',
        name: null,
        createdAt: new Date(),
        tokenVersion: 0,
      });

      const res = await service.register('a@b.com', 'secret');

      expect(jwt.signAsync).toHaveBeenCalledWith(
        expect.objectContaining({ sub: 1, email: 'a@b.com', tv: 0 }),
      );
      expect(res.accessToken).toBe('JWT');
      expect(res.user).toEqual({ id: 1, email: 'a@b.com', name: null });
    });

    it('duplicate email -> BadRequest', async () => {
      (bcrypt.hash as jest.Mock).mockResolvedValue('HASH');
      prisma.user.create.mockRejectedValue({ code: 'P2002' });

      await expect(service.register('a@b.com', 'secret'))
        .rejects.toThrow(BadRequestException);
    });
  });

  describe('login', () => {
    it('ok -> increments tokenVersion and returns JWT', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 1,
        email: 'a@b.com',
        name: null,
        password: 'HASH',
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      prisma.user.update.mockResolvedValue({
        id: 1,
        email: 'a@b.com',
        name: null,
        tokenVersion: 1,
      });

      const res = await service.login('a@b.com', 'secret');

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { tokenVersion: { increment: 1 } } }),
      );
      expect(jwt.signAsync).toHaveBeenCalledWith(
        expect.objectContaining({ sub: 1, email: 'a@b.com', tv: 1 }),
      );
      expect(res.accessToken).toBe('JWT');
      expect(res.user).toEqual({ id: 1, email: 'a@b.com', name: null });
    });

    it('no user or password null -> Unauthorized', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.login('x@y.com', 'secret'))
        .rejects.toThrow(UnauthorizedException);

      prisma.user.findUnique.mockResolvedValue({ id: 1, email: 'x@y.com', password: null });
      await expect(service.login('x@y.com', 'secret'))
        .rejects.toThrow(UnauthorizedException);
    });

    it('wrong password -> Unauthorized', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 1, email: 'a@b.com', password: 'HASH' });
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.login('a@b.com', 'bad'))
        .rejects.toThrow(UnauthorizedException);
    });
  });

  describe('googleLogin', () => {
    const verifyOk = (email = 'g@mail.com', verified = true, sub = 'sub123') => ({
      getPayload: () => ({ email, email_verified: verified, sub, name: 'G User' }),
    });

    it('new google user -> create User+Account, inc tokenVersion', async () => {
      (service as any).googleClient.verifyIdToken.mockResolvedValue(verifyOk());

      prisma.account.findUnique.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({ id: 7, email: 'g@mail.com' });
      prisma.account.create.mockResolvedValue({
        id: 1,
        userId: 7,
        provider: 'google',
        providerAccountId: 'sub123',
        user: { id: 7, email: 'g@mail.com' },
      });
      // обов'язково повернути tokenVersion
      prisma.user.update.mockResolvedValue({ id: 7, email: 'g@mail.com', tokenVersion: 1 });

      const res = await service.googleLogin('idtoken');

      expect(prisma.user.create).toHaveBeenCalled();
      expect(prisma.account.create).toHaveBeenCalled();
      expect(jwt.signAsync).toHaveBeenCalledWith(
        expect.objectContaining({ sub: 7, email: 'g@mail.com', tv: 1 }),
      );
      expect(res.accessToken).toBe('JWT');
      expect(res.user).toEqual({ id: 7, email: 'g@mail.com', name: undefined });
    });

    it('existing user without account -> create Account', async () => {
      (service as any).googleClient.verifyIdToken.mockResolvedValue(verifyOk());

      prisma.account.findUnique.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({ id: 5, email: 'g@mail.com' });
      prisma.account.create.mockResolvedValue({
        id: 2,
        userId: 5,
        provider: 'google',
        providerAccountId: 'sub123',
        user: { id: 5, email: 'g@mail.com' },
      });
      prisma.user.update.mockResolvedValue({ id: 5, email: 'g@mail.com', tokenVersion: 2 });

      const res = await service.googleLogin('idtoken');

      expect(prisma.account.create).toHaveBeenCalled();
      expect(jwt.signAsync).toHaveBeenCalledWith(
        expect.objectContaining({ sub: 5, email: 'g@mail.com', tv: 2 }),
      );
      expect(res.accessToken).toBe('JWT');
      expect(res.user).toEqual({ id: 5, email: 'g@mail.com', name: undefined });
    });

    it('existing account -> just inc tokenVersion', async () => {
      (service as any).googleClient.verifyIdToken.mockResolvedValue(verifyOk());

      prisma.account.findUnique.mockResolvedValue({
        id: 3,
        userId: 3,
        provider: 'google',
        providerAccountId: 'sub123',
        user: { id: 3, email: 'g@mail.com' },
      });
      prisma.user.update.mockResolvedValue({ id: 3, email: 'g@mail.com', tokenVersion: 10 });

      const res = await service.googleLogin('idtoken');

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 3 }, data: { tokenVersion: { increment: 1 } } }),
      );
      expect(jwt.signAsync).toHaveBeenCalledWith(
        expect.objectContaining({ sub: 3, email: 'g@mail.com', tv: 10 }),
      );
      expect(res.accessToken).toBe('JWT');
      expect(res.user).toEqual({ id: 3, email: 'g@mail.com', name: undefined });
    });

    it('invalid payload -> Unauthorized', async () => {
      (service as any).googleClient.verifyIdToken.mockResolvedValue({ getPayload: () => ({}) });
      await expect(service.googleLogin('bad')).rejects.toThrow(UnauthorizedException);
    });

    it('email not verified -> Unauthorized', async () => {
      (service as any).googleClient.verifyIdToken.mockResolvedValue(
        verifyOk('g@mail.com', false),
      );
      await expect(service.googleLogin('bad')).rejects.toThrow(UnauthorizedException);
    });
  });
});