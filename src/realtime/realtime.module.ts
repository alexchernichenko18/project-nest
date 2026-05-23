import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '../prisma/prisma.module';
import { ChatGateway } from './chat.gateway';
import { PresenceService } from './presence.service';

@Module({
  imports: [
    PrismaModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        secret: cfg.getOrThrow<string>('JWT_SECRET'),
      }),
    }),
  ],
  providers: [PresenceService, ChatGateway],
  exports: [PresenceService, ChatGateway],
})
export class RealtimeModule {}
