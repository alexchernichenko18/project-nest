import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { mock, MockProxy } from 'jest-mock-extended';
import { PrismaService } from '../prisma/prisma.service';
import { ChatGateway } from '../realtime/chat.gateway';
import { PresenceService } from '../realtime/presence.service';
import { SearchService } from '../search/search.service';
import { MessagesService } from './messages.service';

type PrismaMock = {
  message: {
    create: jest.Mock;
    findMany: jest.Mock;
    findUnique: jest.Mock;
    delete: jest.Mock;
  };
};

describe('MessagesService', () => {
  let service: MessagesService;
  let prisma: PrismaMock;
  let gateway: MockProxy<ChatGateway>;
  let presence: MockProxy<PresenceService>;
  let search: MockProxy<SearchService>;

  const fakeMessage = (overrides: Partial<any> = {}) => ({
    id: 'msg-1',
    text: 'hello',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    user: { id: 'user-1', name: 'Alex' },
    ...overrides,
  });

  beforeEach(() => {
    prisma = {
      message: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        delete: jest.fn(),
      },
    };
    gateway = mock<ChatGateway>();
    presence = mock<PresenceService>();
    search = mock<SearchService>();

    service = new MessagesService(
      prisma as unknown as PrismaService,
      gateway,
      presence,
      search,
    );
  });

  describe('create', () => {
    it('persists message, enriches with online flag, broadcasts and indexes', async () => {
      const msg = fakeMessage();
      prisma.message.create.mockResolvedValue(msg as any);
      presence.isOnline.mockReturnValue(true);

      const result = await service.create('user-1', 'hello');

      expect(prisma.message.create).toHaveBeenCalledWith({
        data: { text: 'hello', userId: 'user-1' },
        select: expect.any(Object),
      });

      expect(result).toEqual({
        ...msg,
        user: { ...msg.user, isOnline: true },
      });

      expect(gateway.emitMessageCreated).toHaveBeenCalledWith(result);
      expect(search.indexMessage).toHaveBeenCalledWith({
        id: msg.id,
        text: msg.text,
        createdAt: msg.createdAt.getTime(),
        userId: msg.user.id,
        userName: msg.user.name,
      });
    });

    it('marks author as offline when presence map says so', async () => {
      prisma.message.create.mockResolvedValue(fakeMessage() as any);
      presence.isOnline.mockReturnValue(false);

      const result = await service.create('user-1', 'hello');

      expect(result.user.isOnline).toBe(false);
    });
  });

  describe('list (no search)', () => {
    it('returns paginated messages with isOnline enrichment', async () => {
      const items = [
        fakeMessage({ id: 'msg-1' }),
        fakeMessage({ id: 'msg-2', user: { id: 'user-2', name: 'Bob' } }),
      ];
      prisma.message.findMany.mockResolvedValue(items as any);
      presence.isOnline.mockImplementation((id) => id === 'user-1');

      const result = await service.list(undefined, 20, undefined);

      expect(result.items).toHaveLength(2);
      expect(result.items[0].user.isOnline).toBe(true);
      expect(result.items[1].user.isOnline).toBe(false);
      expect(result.hasMore).toBe(false);
      expect(result.nextCursor).toBe(null);
    });

    it('signals hasMore and exposes nextCursor when limit reached', async () => {
      const items = [
        fakeMessage({ id: 'm1' }),
        fakeMessage({ id: 'm2' }),
        fakeMessage({ id: 'm3' }), // limit=2 → 3rd item triggers hasMore
      ];
      prisma.message.findMany.mockResolvedValue(items as any);
      presence.isOnline.mockReturnValue(false);

      const result = await service.list(undefined, 2, undefined);

      expect(result.items).toHaveLength(2);
      expect(result.hasMore).toBe(true);
      expect(result.nextCursor).toBe('m2');
    });

    it('does not call search service when no query is given', async () => {
      prisma.message.findMany.mockResolvedValue([]);

      await service.list(undefined, 20, undefined);

      expect(search.search).not.toHaveBeenCalled();
    });
  });

  describe('list (with search)', () => {
    it('queries Meili first, then hydrates via Prisma in Meili order', async () => {
      search.search.mockResolvedValue(['msg-2', 'msg-1']);
      prisma.message.findMany.mockResolvedValue([
        fakeMessage({ id: 'msg-1', text: 'old' }),
        fakeMessage({ id: 'msg-2', text: 'new' }),
      ] as any);
      presence.isOnline.mockReturnValue(true);

      const result = await service.list(undefined, 20, 'query');

      expect(search.search).toHaveBeenCalledWith('query', 20);
      // Items в порядку, який повернув Meili (релевантність), не Mongo
      expect(result.items.map((m) => m.id)).toEqual(['msg-2', 'msg-1']);
      expect(result.nextCursor).toBe(null);
      expect(result.hasMore).toBe(false);
    });

    it('returns empty result when Meili found nothing', async () => {
      search.search.mockResolvedValue([]);

      const result = await service.list(undefined, 20, 'nothing-matches');

      expect(result.items).toEqual([]);
      expect(prisma.message.findMany).not.toHaveBeenCalled();
    });

    it('skips messages that Meili returned but Mongo lost (out of sync)', async () => {
      search.search.mockResolvedValue(['msg-1', 'msg-ghost']);
      prisma.message.findMany.mockResolvedValue([
        fakeMessage({ id: 'msg-1' }),
      ] as any);
      presence.isOnline.mockReturnValue(false);

      const result = await service.list(undefined, 20, 'query');

      expect(result.items.map((m) => m.id)).toEqual(['msg-1']);
    });
  });

  describe('delete', () => {
    it('throws NotFound when message does not exist', async () => {
      prisma.message.findUnique.mockResolvedValue(null);

      await expect(service.delete('user-1', 'missing')).rejects.toThrow(NotFoundException);
      expect(prisma.message.delete).not.toHaveBeenCalled();
      expect(gateway.emitMessageDeleted).not.toHaveBeenCalled();
    });

    it('throws Forbidden when user is not the author', async () => {
      prisma.message.findUnique.mockResolvedValue({ id: 'msg-1', userId: 'someone-else' } as any);

      await expect(service.delete('user-1', 'msg-1')).rejects.toThrow(ForbiddenException);
      expect(prisma.message.delete).not.toHaveBeenCalled();
      expect(gateway.emitMessageDeleted).not.toHaveBeenCalled();
      expect(search.deleteMessage).not.toHaveBeenCalled();
    });

    it('deletes own message and propagates to gateway + search', async () => {
      prisma.message.findUnique.mockResolvedValue({ id: 'msg-1', userId: 'user-1' } as any);
      prisma.message.delete.mockResolvedValue({} as any);

      const result = await service.delete('user-1', 'msg-1');

      expect(prisma.message.delete).toHaveBeenCalledWith({ where: { id: 'msg-1' } });
      expect(gateway.emitMessageDeleted).toHaveBeenCalledWith({ id: 'msg-1' });
      expect(search.deleteMessage).toHaveBeenCalledWith('msg-1');
      expect(result).toEqual({ id: 'msg-1' });
    });
  });
});
