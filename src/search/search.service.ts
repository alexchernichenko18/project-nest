import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Meilisearch, type Index } from 'meilisearch';

export type IndexedMessage = {
  id: string;
  text: string;
  createdAt: number;
  userId: string;
  userName: string | null;
};

const INDEX = 'messages';

@Injectable()
export class SearchService implements OnModuleInit {
  private readonly logger = new Logger(SearchService.name);
  private readonly client: Meilisearch;
  private index!: Index<IndexedMessage>;

  constructor(cfg: ConfigService) {
    this.client = new Meilisearch({
      host: cfg.getOrThrow<string>('MEILI_HOST'),
      apiKey: cfg.get<string>('MEILI_MASTER_KEY') ?? 'devMasterKey123',
    });
  }

  async onModuleInit() {
    try {
      await this.client.createIndex(INDEX, { primaryKey: 'id' }).catch(() => undefined);
      this.index = this.client.index<IndexedMessage>(INDEX);
      await this.index.updateSettings({
        searchableAttributes: ['text', 'userName'],
        sortableAttributes: ['createdAt'],
        rankingRules: ['words', 'typo', 'proximity', 'attribute', 'sort', 'exactness'],
      });
      this.logger.log(`Meilisearch ready (index="${INDEX}")`);
    } catch (err) {
      this.logger.error(`Meilisearch init failed: ${(err as Error).message}`);
    }
  }

  async indexMessage(doc: IndexedMessage) {
    try {
      await this.index.addDocuments([doc]);
    } catch (err) {
      this.logger.error(`indexMessage failed for id=${doc.id}: ${(err as Error).message}`);
    }
  }

  async deleteMessage(id: string) {
    try {
      await this.index.deleteDocument(id);
    } catch (err) {
      this.logger.error(`deleteMessage failed for id=${id}: ${(err as Error).message}`);
    }
  }

  async search(query: string, limit: number): Promise<string[]> {
    const res = await this.index.search(query, { limit, attributesToRetrieve: ['id'] });
    return res.hits.map((h) => h.id);
  }

  async reindexAll(docs: IndexedMessage[]) {
    await this.index.deleteAllDocuments();
    if (docs.length === 0) return;
    await this.index.addDocuments(docs);
    this.logger.log(`Reindexed ${docs.length} messages`);
  }
}
