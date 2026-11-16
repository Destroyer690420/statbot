/**
 * Best-effort admin notification for task delivery failures.
 *
 * Every path that flips an assignment to FAILED calls this with the Discord
 * client: a queued task that never reached its ticket would otherwise be
 * visible only in logs. A DM failure never changes the delivery outcome.
 */
import { Client } from 'discord.js';
import { OWNER_USER_ID } from '../config/constants';
import { formatDeliveryFailureDm, DeliveryFailureInfo } from '../utils/delivery-failure';
import { logger } from '../utils/logger';

export async function notifyDeliveryFailure(
  client: Client | null | undefined,
  info: DeliveryFailureInfo,
): Promise<boolean> {
  if (!client || !(client as Client).users) return false;
  try {
    const admin = await client.users.fetch(OWNER_USER_ID);
    await admin.send({
      content: formatDeliveryFailureDm(info),
      allowedMentions: { parse: [] },
    });
    logger.info('Delivery failure admin DM sent', {
      taskId: info.taskId,
      stage: info.stage,
      adminId: OWNER_USER_ID,
    });
    return true;
  } catch (error) {
    logger.warn('Delivery failure admin DM failed', {
      taskId: info.taskId,
      stage: info.stage,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
