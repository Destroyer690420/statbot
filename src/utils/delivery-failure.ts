/** Pure message builder for the admin DM sent when a task delivery fails. */

export type DeliveryFailureStage = 'enqueue' | 'delivery' | 'reassign' | 'retry';

export interface DeliveryFailureInfo {
  taskId: string;
  externalTaskId?: string | null;
  channelId?: string | null;
  workerId?: string | null;
  stage: DeliveryFailureStage;
  error: string;
}

const STAGE_LABELS: Record<DeliveryFailureStage, string> = {
  enqueue: 'queueing delivery',
  delivery: 'sending to ticket',
  reassign: 'reassignment',
  retry: 'manual retry',
};

/** Errors can contain URLs or Discord text; keep the DM short and single-line. */
function oneLine(value: string | null | undefined, max = 300): string {
  const cleaned = String(value ?? '').replace(/\s+/g, ' ').trim();
  return cleaned ? cleaned.slice(0, max) : 'unknown error';
}

export function formatDeliveryFailureDm(info: DeliveryFailureInfo): string {
  const external = oneLine(info.externalTaskId, 40);
  const lines = [
    '🤖 **Reddit Task Manager — task delivery failed**',
    `Task: ${oneLine(info.taskId, 80)}${external !== 'unknown error' ? ` (GoPartTime #${external})` : ''}`,
    `Stage: ${STAGE_LABELS[info.stage] ?? info.stage}`,
    `Ticket channel: ${oneLine(info.channelId, 40)}`,
    `Worker: ${oneLine(info.workerId, 40)}`,
    `Error: ${oneLine(info.error)}`,
    'Check the task on the dashboard and use Retry / Retry assignment once the cause is fixed.',
  ];
  return lines.join('\n');
}
