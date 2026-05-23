import { ConfigService } from '@nestjs/config';
import { Meilisearch } from 'meilisearch';
import { SearchService } from '../../src/search/search.service';

describe('SearchService (integration)', () => {
  let service: SearchService;
  let client: Meilisearch;

  const waitForIndexing = (ms = 600) => new Promise((r) => setTimeout(r, ms));

  beforeAll(async () => {
    const cfg = {
      getOrThrow: (key: string) => process.env[key] as string,
      get: (key: string) => process.env[key],
    } as unknown as ConfigService;

    service = new SearchService(cfg);
    client = new Meilisearch({
      host: process.env.MEILI_HOST!,
      apiKey: process.env.MEILI_MASTER_KEY,
    });

    await service.onModuleInit();
    // Чиста стартова точка для тестового набору
    await client.index('messages').deleteAllDocuments();
    await waitForIndexing();
  });

  afterEach(async () => {
    await client.index('messages').deleteAllDocuments();
    await waitForIndexing();
  });

  it('indexes a message and finds it by exact word', async () => {
    await service.indexMessage({
      id: 'int-1',
      text: 'Hello realtime world',
      createdAt: Date.now(),
      userId: 'u1',
      userName: 'Alice',
    });
    await waitForIndexing();

    const ids = await service.search('hello', 10);
    expect(ids).toContain('int-1');
  });

  it('finds a message with a typo (typo-tolerance)', async () => {
    await service.indexMessage({
      id: 'int-2',
      text: 'meilisearch is great',
      createdAt: Date.now(),
      userId: 'u1',
      userName: null,
    });
    await waitForIndexing();

    const ids = await service.search('meilesearch', 10); // навмисна опечатка
    expect(ids).toContain('int-2');
  });

  it('returns empty array when nothing matches', async () => {
    await service.indexMessage({
      id: 'int-3',
      text: 'привіт світ',
      createdAt: Date.now(),
      userId: 'u1',
      userName: null,
    });
    await waitForIndexing();

    const ids = await service.search('zzzzzz-nonexistent', 10);
    expect(ids).toEqual([]);
  });

  it('removes a message from index via deleteMessage', async () => {
    await service.indexMessage({
      id: 'int-4',
      text: 'will be deleted',
      createdAt: Date.now(),
      userId: 'u1',
      userName: null,
    });
    await waitForIndexing();

    expect(await service.search('deleted', 10)).toContain('int-4');

    await service.deleteMessage('int-4');
    await waitForIndexing();

    expect(await service.search('deleted', 10)).not.toContain('int-4');
  });

  it('searches by userName as well as text (multi-field)', async () => {
    await service.indexMessage({
      id: 'int-5',
      text: 'random body content',
      createdAt: Date.now(),
      userId: 'u-bob',
      userName: 'Bob',
    });
    await waitForIndexing();

    const ids = await service.search('bob', 10);
    expect(ids).toContain('int-5');
  });
});
