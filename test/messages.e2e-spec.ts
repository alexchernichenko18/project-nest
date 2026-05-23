import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Messages (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const createdUserIds: string[] = [];

  const registerUser = async (alias: string) => {
    const email = `e2e-msg-${alias}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}@test.local`;
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password: 'TestPass123' })
      .expect(201);
    createdUserIds.push(res.body.user.id);
    return { token: res.body.accessToken as string, userId: res.body.user.id as string };
  };

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

  it('POST /messages creates a message and returns it enriched', async () => {
    const { token, userId } = await registerUser('create');

    const res = await request(app.getHttpServer())
      .post('/messages')
      .set('Authorization', `Bearer ${token}`)
      .send({ text: 'Hello from e2e' })
      .expect(201);

    expect(res.body.text).toBe('Hello from e2e');
    expect(res.body.id).toEqual(expect.any(String));
    expect(res.body.user.id).toBe(userId);
    expect(res.body.user).toHaveProperty('isOnline');
  });

  it('GET /messages includes own message in the list', async () => {
    const { token } = await registerUser('list');
    const unique = `marker-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    await request(app.getHttpServer())
      .post('/messages')
      .set('Authorization', `Bearer ${token}`)
      .send({ text: unique })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get('/messages?limit=50')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.items.some((m: any) => m.text === unique)).toBe(true);
  });

  it('DELETE /messages/:id — owner can delete (204), non-owner cannot (403)', async () => {
    const alice = await registerUser('owner');
    const bob = await registerUser('intruder');

    const created = await request(app.getHttpServer())
      .post('/messages')
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ text: 'owned by alice' })
      .expect(201);
    const messageId = created.body.id;

    await request(app.getHttpServer())
      .delete(`/messages/${messageId}`)
      .set('Authorization', `Bearer ${bob.token}`)
      .expect(403);

    await request(app.getHttpServer())
      .delete(`/messages/${messageId}`)
      .set('Authorization', `Bearer ${alice.token}`)
      .expect(204);

    await request(app.getHttpServer())
      .delete(`/messages/${messageId}`)
      .set('Authorization', `Bearer ${alice.token}`)
      .expect(404);
  });

  it('rejects access to /messages without token', async () => {
    await request(app.getHttpServer()).get('/messages').expect(401);
    await request(app.getHttpServer())
      .post('/messages')
      .send({ text: 'anonymous' })
      .expect(401);
  });
});
