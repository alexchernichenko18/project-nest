import { ConfigService } from '@nestjs/config';
import { MailService } from '../../src/mail/mail.service';

type MailpitMessage = {
  ID: string;
  From: { Address: string; Name: string };
  To: { Address: string; Name: string }[];
  Subject: string;
  Snippet: string;
};

const mailpitBase = `http://${process.env.SMTP_HOST ?? 'localhost'}:8025`;

const mailpit = {
  async list(): Promise<MailpitMessage[]> {
    const res = await fetch(`${mailpitBase}/api/v1/messages`);
    const data = (await res.json()) as { messages: MailpitMessage[] };
    return data.messages;
  },
  async deleteAll(): Promise<void> {
    await fetch(`${mailpitBase}/api/v1/messages`, { method: 'DELETE' });
  },
  async getHtml(id: string): Promise<string> {
    const res = await fetch(`${mailpitBase}/api/v1/message/${id}`);
    const data = (await res.json()) as { HTML: string };
    return data.HTML;
  },
};

describe('MailService (integration)', () => {
  let service: MailService;

  beforeAll(() => {
    const cfg = {
      get: (key: string) => process.env[key],
      getOrThrow: (key: string) => process.env[key] as string,
    } as unknown as ConfigService;

    service = new MailService(cfg);
  });

  beforeEach(async () => {
    await mailpit.deleteAll();
  });

  it('sends a password reset email via SMTP and Mailpit receives it', async () => {
    const to = `int-test-${Date.now()}@example.com`;
    const resetUrl = 'http://localhost:3000/reset-password?token=integration-test-token';

    await service.sendPasswordResetEmail(to, resetUrl);

    // SMTP доставка швидка, але дамо невелику паузу на network
    await new Promise((r) => setTimeout(r, 300));

    const messages = await mailpit.list();
    expect(messages.length).toBe(1);

    const msg = messages[0];
    expect(msg.To[0].Address).toBe(to);
    expect(msg.Subject).toBe('Reset your password');
  });

  it('includes the reset URL in the HTML body', async () => {
    const to = `int-link-${Date.now()}@example.com`;
    const resetUrl = `http://localhost:3000/reset-password?token=unique-${Date.now()}`;

    await service.sendPasswordResetEmail(to, resetUrl);
    await new Promise((r) => setTimeout(r, 300));

    const [msg] = await mailpit.list();
    const html = await mailpit.getHtml(msg.ID);

    expect(html).toContain(resetUrl);
  });

  it('sends to the exact recipient passed in', async () => {
    const a = `recipient-a-${Date.now()}@test.local`;
    const b = `recipient-b-${Date.now()}@test.local`;

    await service.sendPasswordResetEmail(a, 'http://x/1');
    await service.sendPasswordResetEmail(b, 'http://x/2');
    await new Promise((r) => setTimeout(r, 300));

    const messages = await mailpit.list();
    const recipients = messages.flatMap((m) => m.To.map((t) => t.Address)).sort();

    expect(recipients).toEqual([a, b].sort());
  });
});
