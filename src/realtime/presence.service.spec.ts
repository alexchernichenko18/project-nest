import { PresenceService } from './presence.service';

describe('PresenceService', () => {
  let service: PresenceService;

  beforeEach(() => {
    service = new PresenceService();
  });

  describe('addSocket', () => {
    it('marks user as online when first socket is added', () => {
      const result = service.addSocket('user-1', 'socket-A');

      expect(result.wentOnline).toBe(true);
      expect(service.isOnline('user-1')).toBe(true);
    });

    it('does not re-trigger online on subsequent sockets of the same user', () => {
      service.addSocket('user-1', 'socket-A');
      const result = service.addSocket('user-1', 'socket-B');

      expect(result.wentOnline).toBe(false);
      expect(service.isOnline('user-1')).toBe(true);
    });

    it('tracks multiple users independently', () => {
      service.addSocket('user-1', 'socket-A');
      const r2 = service.addSocket('user-2', 'socket-B');

      expect(r2.wentOnline).toBe(true);
      expect(service.isOnline('user-1')).toBe(true);
      expect(service.isOnline('user-2')).toBe(true);
    });
  });

  describe('removeSocket', () => {
    it('marks user offline only when last socket disconnects', () => {
      service.addSocket('user-1', 'socket-A');
      service.addSocket('user-1', 'socket-B');

      const first = service.removeSocket('user-1', 'socket-A');
      expect(first.wentOffline).toBe(false);
      expect(service.isOnline('user-1')).toBe(true);

      const second = service.removeSocket('user-1', 'socket-B');
      expect(second.wentOffline).toBe(true);
      expect(service.isOnline('user-1')).toBe(false);
    });

    it('is a no-op when removing socket of unknown user', () => {
      const result = service.removeSocket('ghost-user', 'socket-X');

      expect(result.wentOffline).toBe(false);
      expect(service.isOnline('ghost-user')).toBe(false);
    });

    it('does not affect other users when one disconnects', () => {
      service.addSocket('user-1', 'a');
      service.addSocket('user-2', 'b');

      service.removeSocket('user-1', 'a');

      expect(service.isOnline('user-1')).toBe(false);
      expect(service.isOnline('user-2')).toBe(true);
    });
  });

  describe('isOnline', () => {
    it('returns false for unknown user', () => {
      expect(service.isOnline('whoever')).toBe(false);
    });

    it('returns true while at least one socket is connected', () => {
      service.addSocket('user-1', 'socket-A');
      expect(service.isOnline('user-1')).toBe(true);
    });
  });

  describe('getOnlineUserIds', () => {
    it('returns empty array when no one is online', () => {
      expect(service.getOnlineUserIds()).toEqual([]);
    });

    it('returns ids of all currently online users', () => {
      service.addSocket('user-1', 'a');
      service.addSocket('user-2', 'b');
      service.addSocket('user-1', 'c'); // second socket of user-1, не дублюється

      expect(service.getOnlineUserIds().sort()).toEqual(['user-1', 'user-2']);
    });

    it('drops users that fully disconnected', () => {
      service.addSocket('user-1', 'a');
      service.addSocket('user-2', 'b');
      service.removeSocket('user-1', 'a');

      expect(service.getOnlineUserIds()).toEqual(['user-2']);
    });
  });
});
