import { INestApplication, Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  async onModuleInit() {
    await this.$connect();
  }
  async enableShutdownHooks(app: INestApplication) {
    // @ts-expect-error -- Prisma types do not expose $on event names but it is supported at runtime
    this.$on('beforeExit', async () => {
      await app.close();
    });
  }
}