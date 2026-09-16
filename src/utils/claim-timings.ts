import { z } from 'zod';

/**
 * Phase-0 instrumentation from the watcher. All fields optional — old
 * watcher versions omit `timings` entirely. Step durations are ms since the
 * claim reached the tab; null when that step was never reached.
 */
export const claimTimingsSchema = z
  .object({
    pollReceivedAt: z.number().int().nonnegative().optional().nullable(),
    drawerOpenedMs: z.number().int().nonnegative().optional().nullable(),
    acceptedMs: z.number().int().nonnegative().optional().nullable(),
    pushedMs: z.number().int().nonnegative().optional().nullable(),
  })
  .optional()
  .nullable();

export type ClaimTimings = z.infer<typeof claimTimingsSchema>;

export interface ClaimTimingClaim {
  id: string;
  cycleId: string;
  externalTaskId: string;
  workerId: string | null;
  createdAt: Date;
}

/**
 * Builds the 'Claim timings' log payload: queue wait (claim created ->
 * verdict) plus the watcher's in-page step durations. Pure — never throws,
 * so timing can never break verdicts.
 */
export function buildClaimTimingsLog(
  claim: ClaimTimingClaim,
  ok: boolean,
  timings: ClaimTimings,
): Record<string, string | boolean | number | null> {
  const t = timings ?? null;
  return {
    claimId: claim.id,
    cycleId: claim.cycleId,
    task: claim.externalTaskId,
    workerId: claim.workerId,
    ok,
    queueWaitMs: Date.now() - claim.createdAt.getTime(),
    pollReceivedAt: t?.pollReceivedAt ?? null,
    drawerOpenedMs: t?.drawerOpenedMs ?? null,
    acceptedMs: t?.acceptedMs ?? null,
    pushedMs: t?.pushedMs ?? null,
  };
}
