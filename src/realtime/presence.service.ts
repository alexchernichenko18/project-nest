import { Injectable } from '@nestjs/common';

@Injectable()
export class PresenceService {
  private readonly sockets = new Map<string, Set<string>>();

  addSocket(userId: string, socketId: string): { wentOnline: boolean } {
    let set = this.sockets.get(userId);
    if (!set) {
      set = new Set();
      this.sockets.set(userId, set);
    }
    const wasEmpty = set.size === 0;
    set.add(socketId);
    return { wentOnline: wasEmpty };
  }

  removeSocket(userId: string, socketId: string): { wentOffline: boolean } {
    const set = this.sockets.get(userId);
    if (!set) return { wentOffline: false };
    set.delete(socketId);
    if (set.size === 0) {
      this.sockets.delete(userId);
      return { wentOffline: true };
    }
    return { wentOffline: false };
  }

  isOnline(userId: string): boolean {
    const set = this.sockets.get(userId);
    return !!set && set.size > 0;
  }

  getOnlineUserIds(): string[] {
    return Array.from(this.sockets.keys());
  }
}
