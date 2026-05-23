import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import { PresenceService } from './presence.service';

type JwtPayload = { sub: string; email: string; tv: number };

@WebSocketGateway({
  cors: { origin: 'http://localhost:3000', credentials: true },
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(ChatGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly presence: PresenceService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token = this.extractToken(client);
      if (!token) {
        client.disconnect(true);
        return;
      }

      const payload = await this.jwt.verifyAsync<JwtPayload>(token);
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, tokenVersion: true },
      });

      if (!user || user.tokenVersion !== payload.tv) {
        client.disconnect(true);
        return;
      }

      client.data.userId = user.id;

      const { wentOnline } = this.presence.addSocket(user.id, client.id);
      if (wentOnline) {
        this.server.emit('presence:update', { userId: user.id, isOnline: true });
      }

      client.emit('presence:snapshot', { onlineUserIds: this.presence.getOnlineUserIds() });

      this.logger.log(
        `WS connect  user=${user.id} socket=${client.id} wentOnline=${wentOnline}`,
      );
    } catch (err) {
      this.logger.warn(`Socket auth failed: ${(err as Error).message}`);
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    const userId = client.data?.userId as string | undefined;
    if (!userId) return;

    const { wentOffline } = this.presence.removeSocket(userId, client.id);
    if (wentOffline) {
      this.server.emit('presence:update', { userId, isOnline: false });
    }

    this.logger.log(
      `WS disconnect user=${userId} socket=${client.id} wentOffline=${wentOffline}`,
    );
  }

  emitMessageCreated(payload: unknown) {
    this.server.emit('message:created', payload);
  }

  emitMessageDeleted(payload: { id: string }) {
    this.server.emit('message:deleted', payload);
  }

  private extractToken(client: Socket): string | undefined {
    const fromAuth = client.handshake.auth?.token;
    if (typeof fromAuth === 'string' && fromAuth.length > 0) return fromAuth;

    const header = client.handshake.headers?.authorization;
    if (typeof header === 'string' && header.startsWith('Bearer ')) {
      return header.slice('Bearer '.length);
    }
    return undefined;
  }
}
