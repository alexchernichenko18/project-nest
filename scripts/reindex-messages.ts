import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { Meilisearch } from 'meilisearch';

const prisma = new PrismaClient();
const meili = new Meilisearch({
  host: process.env.MEILI_HOST ?? 'http://localhost:7700',
  apiKey: process.env.MEILI_MASTER_KEY ?? 'devMasterKey123',
});

async function main() {
  await meili.createIndex('messages', { primaryKey: 'id' }).catch(() => undefined);
  const index = meili.index('messages');

  const messages = await prisma.message.findMany({
    select: {
      id: true,
      text: true,
      createdAt: true,
      user: { select: { id: true, name: true } },
    },
  });

  const docs = messages.map((m) => ({
    id: m.id,
    text: m.text,
    createdAt: m.createdAt.getTime(),
    userId: m.user.id,
    userName: m.user.name,
  }));

  await index.deleteAllDocuments();
  if (docs.length > 0) {
    const task = await index.addDocuments(docs);
    console.log(`Enqueued ${docs.length} documents (task uid=${task.taskUid})`);
  } else {
    console.log('No messages to index');
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
