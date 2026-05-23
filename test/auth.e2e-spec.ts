import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const createdUserIds: string[] = [];

  const uniqueEmail = (alias: string) =>
    `e2e-auth-${alias}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await app.close();
  });

  it('register → login → /auth/me happy path', async () => {
    const email = uniqueEmail('happy');

    const reg = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password: 'TestPass123' })
      .expect(201);
    createdUserIds.push(reg.body.user.id);

    expect(reg.body.user.email).toBe(email);
    expect(reg.body.accessToken).toEqual(expect.any(String));

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'TestPass123' })
      .expect(200);

    const me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .expect(200);

    expect(me.body.email).toBe(email);
    expect(me.body.userId).toBe(reg.body.user.id);
  });

  it('rejects login with wrong password', async () => {
    const email = uniqueEmail('wrong-pass');

    const reg = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password: 'TestPass123' })
      .expect(201);
    createdUserIds.push(reg.body.user.id);

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'WrongPassword' })
      .expect(401);
  });

  it('rejects /auth/me without token', async () => {
    await request(app.getHttpServer()).get('/auth/me').expect(401);
  });

  it('rejects /auth/me with malformed token', async () => {
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', 'Bearer not.a.real.jwt')
      .expect(401);
  });

  it('rejects register with invalid email or short password', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'not-an-email', password: 'TestPass123' })
      .expect(400);

    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: uniqueEmail('short-pass'), password: '123' })
      .expect(400);
  });
});
