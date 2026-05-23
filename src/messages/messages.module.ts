import { Module } from '@nestjs/common';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
import { PrismaModule } from '../prisma/prisma.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { SearchModule } from '../search/search.module';

@Module({
  imports: [PrismaModule, RealtimeModule, SearchModule],
  controllers: [MessagesController],
  providers: [MessagesService],
})
export class MessagesModule {}
