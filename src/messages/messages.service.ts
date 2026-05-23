import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ChatGateway } from '../realtime/chat.gateway';
import { PresenceService } from '../realtime/presence.service';
import { SearchService } from '../search/search.service';

type RawMessage = {
  id: string;
  text: string;
  createdAt: Date;
  user: { id: string; name: string | null };
};

@Injectable()
export class MessagesService {
  private readonly select = {
    id: true,
    text: true,
    createdAt: true,
    user: { select: { id: true, name: true } },
  } satisfies Prisma.MessageSelect;

  constructor(
    private prisma: PrismaService,
    private gateway: ChatGateway,
    private presence: PresenceService,
    private search: SearchService,
  ) {}

  async create(userId: string, text: string) {
    const message = await this.prisma.message.create({
      data: { text, userId },
      select: this.select,
    });

    const enriched = this.withPresence(message);
    this.gateway.emitMessageCreated(enriched);
    void this.search.indexMessage({
      id: message.id,
      text: message.text,
      createdAt: message.createdAt.getTime(),
      userId: message.user.id,
      userName: message.user.name,
    });
    return enriched;
  }

  async list(cursor: string | undefined, limit: number, search?: string) {
    if (search) {
      const ids = await this.search.search(search, limit);
      if (ids.length === 0) {
        return { items: [], nextCursor: null, hasMore: false };
      }
      const docs = await this.prisma.message.findMany({
        where: { id: { in: ids } },
        select: this.select,
      });
      const byId = new Map(docs.map((d) => [d.id, d]));
      const items = ids
        .map((id) => byId.get(id))
        .filter((m): m is RawMessage => !!m)
        .map((m) => this.withPresence(m));
      return { items, nextCursor: null, hasMore: false };
    }

    const items = await this.prisma.message.findMany({
      take: limit + 1,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: this.select,
    });

    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;

    return {
      items: page.map((m) => this.withPresence(m)),
      nextCursor: hasMore ? page[page.length - 1].id : null,
      hasMore,
    };
  }

  async delete(userId: string, messageId: string) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: { id: true, userId: true },
    });

    if (!message) throw new NotFoundException('Message not found');
    if (message.userId !== userId) throw new ForbiddenException('Not your message');

    await this.prisma.message.delete({ where: { id: messageId } });
    this.gateway.emitMessageDeleted({ id: messageId });
    void this.search.deleteMessage(messageId);
    return { id: messageId };
  }

  private withPresence(message: RawMessage) {
    return {
      ...message,
      user: { ...message.user, isOnline: this.presence.isOnline(message.user.id) },
    };
  }
}
