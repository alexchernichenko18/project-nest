import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();

async function main() {
  const tokens = await p.passwordResetToken.findMany({
    include: { user: { select: { email: true } } },
    orderBy: { createdAt: 'desc' },
  });
  console.log(JSON.stringify(tokens, null, 2));
  await p.$disconnect();
}

main();
