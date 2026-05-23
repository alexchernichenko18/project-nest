import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { io, Socket } from 'socket.io-client';
import { AddressInfo } from 'net';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Realtime (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let url: string;
  const createdUserIds: string[] = [];

  const registerUser = async (alias: string) => {
    const email = `e2e-rt-${alias}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}@test.local`;
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password: 'TestPass123' })
      .expect(201);
    createdUserIds.push(res.body.user.id);
    return { token: res.body.accessToken as string, userId: res.body.user.id as string };
  };

  const waitForEvent = <T = unknown>(
    socket: Socket,
    event: string,
    timeoutMs = 5000,
  ): Promise<T> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Timeout waiting for "${event}" after ${timeoutMs}ms`)),
        timeoutMs,
      );
      socket.once(event, (payload: T) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    await app.listen(0); // random free port
    const { port } = app.getHttpServer().address() as AddressInfo;
    url = `http://localhost:${port}`;
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await app.close();
  });

  it('broadcasts message:created to another connected client', async () => {
    const alice = await registerUser('sender');
    const bob = await registerUser('listener');

    const bobSocket = io(url, {
      auth: { token: bob.token },
      transports: ['websocket'],
      reconnection: false,
    });

    await waitForEvent(bobSocket, 'connect');

    const eventPromise = waitForEvent<any>(bobSocket, 'message:created');

    await request(app.getHttpServer())
      .post('/messages')
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ text: 'broadcast me' })
      .expect(201);

    const event = await eventPromise;
    expect(event.text).toBe('broadcast me');
    expect(event.user.id).toBe(alice.userId);

    bobSocket.disconnect();
  });

  it('rejects WS connection with invalid token', async () => {
    const badSocket = io(url, {
      auth: { token: 'not.a.real.jwt' },
      transports: ['websocket'],
      reconnection: false,
    });

    await new Promise<void>((resolve) => {
      badSocket.once('disconnect', () => resolve());
      badSocket.once('connect_error', () => resolve());
    });

    expect(badSocket.connected).toBe(false);
    badSocket.disconnect();
  });
});
