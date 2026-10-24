import { Task } from '../types';
import { GOPARTTIME_SOURCE } from '../config/constants';
import { taskRepository } from '../database/repositories';
import { toTask } from '../database/converters';
import { buildManualTaskIdCandidates } from './goparttime-task-lookup.service';

/**
 * Resolves GoPartTime task numbers to Statbot tasks.
 *
 * The two-step rule is shared by every read-only GoPartTime endpoint and by
 * the failed-task checker:
 *
 *   1. the exact `(source, externalTaskId)` link written by the userscript /
 *      automation ingest, then
 *   2. manually-created tasks whose id embeds the number ("POST #688318") —
 *      only when they carry no `source`, so a real GoPartTime task is never
 *      shadowed by a manual one.
 *
 * The batch form exists because the failed-task scan sends a whole page of
 * IDs at once: two `IN` queries replace up to five per-ID round trips.
 */

export async function findTasksByExternalIds(
  externalTaskIds: string[],
): Promise<Map<string, Task>> {
  const ids = Array.from(new Set(externalTaskIds.filter(Boolean)));
  const result = new Map<string, Task>();
  if (!ids.length) return result;

  const linkedRows = await taskRepository.findBySourceExternalIds(GOPARTTIME_SOURCE, ids);
  const linkedByExternal = new Map<string, Task>();
  for (const row of linkedRows) {
    if (row.externalTaskId) linkedByExternal.set(row.externalTaskId, toTask(row));
  }

  const candidateIds = ids
    .filter((id) => !linkedByExternal.has(id))
    .flatMap((id) => buildManualTaskIdCandidates(id));
  const manualRows = candidateIds.length ? await taskRepository.findByIds(candidateIds) : [];
  const manualById = new Map<string, Task>();
  for (const row of manualRows) manualById.set(row.id, toTask(row));

  for (const id of ids) {
    const linked = linkedByExternal.get(id);
    if (linked) {
      result.set(id, linked);
      continue;
    }
    for (const candidateId of buildManualTaskIdCandidates(id)) {
      const candidate = manualById.get(candidateId);
      if (candidate && !candidate.source) {
        result.set(id, candidate);
        break;
      }
    }
  }

  return result;
}

export async function findTaskByExternalId(
  externalTaskId: string,
): Promise<Task | null> {
  const resolved = await findTasksByExternalIds([externalTaskId]);
  return resolved.get(externalTaskId) ?? null;
}
