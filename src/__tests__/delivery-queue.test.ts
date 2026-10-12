/**
 * Delivery pipeline decisions — pure, no Redis, no DB.
 */
import { TaskStatus } from '../types';
import { deliveryJobIdFor, isDeliverySuperseded } from '../utils/delivery-queue';

describe('deliveryJobIdFor', () => {
  it('is stable per task (re-enqueues never double)', () => {
    expect(deliveryJobIdFor('Post #1')).toBe('deliver-Post #1');
    expect(deliveryJobIdFor('Post #1')).toBe(deliveryJobIdFor('Post #1'));
  });
});

describe('isDeliverySuperseded', () => {
  const bound = {
    channelId: 'ch1',
    assignedUserId: 'worker1',
    assignmentStatus: 'PENDING',
    status: TaskStatus.ACCEPTED,
  };

  it('proceeds while ticket, worker and PENDING state are unchanged', () => {
    expect(isDeliverySuperseded(bound, { ...bound })).toBe(false);
  });

  it('stands down when the ticket or worker changed (reassigned)', () => {
    expect(isDeliverySuperseded(bound, { ...bound, channelId: 'ch2' })).toBe(true);
    expect(isDeliverySuperseded(bound, { ...bound, assignedUserId: 'worker2' })).toBe(true);
  });

  it('stands down when the delivery left PENDING or the pipeline moved on', () => {
    expect(isDeliverySuperseded(bound, { ...bound, assignmentStatus: 'SENT' })).toBe(true);
    expect(isDeliverySuperseded(bound, { ...bound, assignmentStatus: 'FAILED' })).toBe(true);
    for (const s of [TaskStatus.COMPLETED, TaskStatus.ARCHIVED, TaskStatus.CANCELLED]) {
      expect(isDeliverySuperseded(bound, { ...bound, status: s })).toBe(true);
    }
  });
});
