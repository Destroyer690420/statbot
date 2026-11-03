process.env.DISCORD_TOKEN = 'test-discord-token-12345';
process.env.CLIENT_ID = 'test-client-id';
process.env.GUILD_ID = 'test-guild-id';
process.env.ADMIN_USER_IDS = '1299323714101317715';
process.env.MANAGER_USER_IDS = '222';
process.env.MODERATOR_USER_IDS = '333';
process.env.DATABASE_URL = 'postgresql://u:p@localhost:5432/db';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.JWT_SECRET = 'test-jwt-secret-at-least-16-chars';
process.env.DASHBOARD_PASSWORD = 'test-password';

import createOutreachRoutes from '../api/routes/outreach';
import { getDb } from '../database/db';
import { ticketInactivityRepository } from '../database/repositories';
import { auditLogService } from '../services/audit.service';
import { AuditAction } from '../types';

jest.mock('../database/db', () => ({
  getDb: jest.fn(),
}));

jest.mock('../database/repositories', () => ({
  ticketInactivityRepository: {
    recordDeleted: jest.fn().mockResolvedValue({}),
  },
}));

jest.mock('../services/audit.service', () => ({
  auditLogService: {
    log: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../services/outreach.service', () => ({
  outreachService: {},
}));

jest.mock('../api/middleware/auth', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.userId = 'admin-user';
    next();
  },
  requireDashboardAdmin: jest.fn().mockReturnValue(true),
}));

describe('DELETE /api/v1/outreach/tickets/:channelId', () => {
  it('deletes Discord channel, cleans up outreach, records deleted in inactivity, and logs audit', async () => {
    const mockChannelDelete = jest.fn().mockResolvedValue(undefined);
    const mockChannel = {
      name: 'ticket-1234',
      delete: mockChannelDelete,
    };
    const mockDiscordClient: any = {
      channels: {
        fetch: jest.fn().mockResolvedValue(mockChannel),
      },
    };

    const mockDeleteMany = jest.fn().mockResolvedValue({ count: 1 });
    (getDb as jest.Mock).mockReturnValue({
      ticketOutreach: {
        deleteMany: mockDeleteMany,
      },
    });

    const router = createOutreachRoutes(mockDiscordClient);
    const routeLayer: any = router.stack.find(
      (layer: any) => layer.route && layer.route.path === '/tickets/:channelId' && layer.route.methods.delete,
    );
    expect(routeLayer).toBeDefined();

    const handler = routeLayer.route.stack[0].handle;

    const req: any = {
      params: { channelId: 'ch-999' },
      userId: 'admin-1',
    };
    const res: any = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    };
    const next = jest.fn();

    await handler(req, res, next);

    expect(mockDiscordClient.channels.fetch).toHaveBeenCalledWith('ch-999');
    expect(mockChannelDelete).toHaveBeenCalledWith(expect.stringContaining('Daily Outreach'));
    expect(mockDeleteMany).toHaveBeenCalledWith({ where: { channelId: 'ch-999' } });
    expect(ticketInactivityRepository.recordDeleted).toHaveBeenCalledWith('ch-999', null, expect.any(Date));
    expect(auditLogService.log).toHaveBeenCalledWith(
      AuditAction.TICKET_DELETED,
      null,
      'admin-1',
      expect.stringContaining('ch-999'),
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        message: expect.stringContaining('#ticket-1234'),
      }),
    );
  });
});
