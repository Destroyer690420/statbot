import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Loader2,
  Radio,
  X,
} from 'lucide-react';
import { claimAvailableTask, getAvailableTasks, getClaimStatus, workerErrorMessage } from '../../api/workerApi';
import { WorkerCard, WorkerSkeleton } from './WorkerUI';

interface AvailableTaskItem {
  id: string;
  subreddit: string;
  title: string;
  content: string;
  type: string;
}

interface WorkerStatus {
  canClaim: boolean;
  reason?: string;
  dailyLimit: number;
  completedToday: number;
  hasActiveTask: boolean;
  activeTaskId?: string;
  channelId?: string;
  guildId?: string;
}

export function WorkerAvailableTasks() {
  const queryClient = useQueryClient();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claimSuccess, setClaimSuccess] = useState<{
    claimId: string;
    channelId?: string;
    guildId?: string;
  } | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['worker-available-tasks'],
    queryFn: getAvailableTasks,
    refetchInterval: 3500, // Live poll matching backend scan frequency
  });

  const tasks: AvailableTaskItem[] = data?.data?.tasks || [];
  const workerStatus: WorkerStatus | undefined = data?.data?.workerStatus;

  const toggleDetails = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleClaim = async (task: AvailableTaskItem) => {
    if (!workerStatus?.canClaim || claimingId) return;

    setClaimingId(task.id);
    setClaimError(null);

    try {
      const res = await claimAvailableTask(task.id);
      const claimData = res?.data;
      const claimId = claimData?.claimId;
      const channelId = claimData?.channelId || workerStatus?.channelId;
      const guildId = claimData?.guildId || workerStatus?.guildId;

      if (!claimId) {
        throw new Error('Claim response missing claim ID.');
      }

      // Short poll the claim status until ACCEPTED, FAILED, or EXPIRED
      const startTime = Date.now();
      const maxWaitMs = 15000;
      let resolved = false;

      while (!resolved && Date.now() - startTime < maxWaitMs) {
        await new Promise((r) => setTimeout(r, 1000));
        try {
          const pollRes = await getClaimStatus(claimId);
          const status = pollRes?.data?.status;

          if (status === 'ACCEPTED') {
            resolved = true;
            setClaimSuccess({
              claimId,
              channelId: pollRes.data.channelId || channelId,
              guildId: pollRes.data.guildId || guildId,
            });
            queryClient.invalidateQueries({ queryKey: ['worker-available-tasks'] });
            queryClient.invalidateQueries({ queryKey: ['worker-tasks'] });
            queryClient.invalidateQueries({ queryKey: ['worker-home'] });
            break;
          } else if (status === 'FAILED') {
            resolved = true;
            setClaimError(
              pollRes.data.failureReason || 'Someone else just claimed this post! Please select another one.',
            );
            queryClient.invalidateQueries({ queryKey: ['worker-available-tasks'] });
            break;
          } else if (status === 'EXPIRED') {
            resolved = true;
            setClaimError('Claim timed out. Please try another post.');
            queryClient.invalidateQueries({ queryKey: ['worker-available-tasks'] });
            break;
          }
        } catch {
          // Keep polling on transient network glitch
        }
      }

      if (!resolved) {
        // If still pending, it is being accepted by companion and sent to Discord
        setClaimSuccess({ claimId, channelId, guildId });
        queryClient.invalidateQueries({ queryKey: ['worker-available-tasks'] });
        queryClient.invalidateQueries({ queryKey: ['worker-tasks'] });
      }
    } catch (err: unknown) {
      const anyErr = err as { response?: { status?: number; data?: { message?: string } } };
      const status = anyErr?.response?.status;
      const msg = anyErr?.response?.data?.message;

      if (status === 409 || msg?.includes('Someone else just claimed')) {
        setClaimError('Someone else just claimed this post! Please select another one.');
      } else if (status === 410 || msg === 'Post not available') {
        setClaimError('Post not available');
      } else {
        setClaimError(workerErrorMessage(err, 'Failed to claim post. Please try another one.'));
      }
      queryClient.invalidateQueries({ queryKey: ['worker-available-tasks'] });
    } finally {
      setClaimingId(null);
    }
  };

  const discordTicketUrl =
    claimSuccess?.guildId && claimSuccess?.channelId
      ? `https://discord.com/channels/${claimSuccess.guildId}/${claimSuccess.channelId}`
      : workerStatus?.guildId && workerStatus?.channelId
      ? `https://discord.com/channels/${workerStatus.guildId}/${workerStatus.channelId}`
      : null;

  return (
    <div className="space-y-4">
      {/* Header bar with Live Scanner status & Daily Limit badge */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-worker-border bg-worker-surface p-4">
        <div className="flex items-center gap-2.5">
          <div className="relative flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-worker-success opacity-75" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-worker-success" />
          </div>
          <div>
            <h2 className="font-display text-base font-semibold text-worker-text">Live Task Feed</h2>
            <p className="text-xs text-worker-text-muted">Real-time eligible posts available for instant claim</p>
          </div>
        </div>

        {workerStatus ? (
          <div className="flex items-center gap-2">
            <span
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold tabular-nums ${
                workerStatus.completedToday >= (workerStatus.dailyLimit ?? 2)
                  ? 'border-worker-warning/40 bg-worker-warning/10 text-worker-warning'
                  : 'border-worker-border bg-worker-surface-2 text-worker-text-muted'
              }`}
            >
              Today: {workerStatus.completedToday} / {workerStatus.dailyLimit ?? 2} posts
            </span>
          </div>
        ) : null}
      </div>

      {/* Warning/Eligibility Alerts */}
      {workerStatus && !workerStatus.canClaim ? (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-worker-warning/30 bg-worker-warning/10 p-4 text-sm text-worker-warning"
        >
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            {workerStatus.reason === 'Your ticket is not enrolled in the daily outreach list.' ? (
              <>
                <p className="font-semibold">Not Selected for Daily Outreach</p>
                <p className="mt-0.5 text-xs text-worker-warning/90">
                  Your ticket is not currently selected in today&apos;s outreach list. You cannot claim posts at this time.
                </p>
              </>
            ) : workerStatus.completedToday >= (workerStatus.dailyLimit ?? 2) ? (
              <>
                <p className="font-semibold">Daily Limit Reached</p>
                <p className="mt-0.5 text-xs text-worker-warning/90">
                  You have completed your daily limit of {workerStatus.dailyLimit ?? 2} posts today. Great work! Check back tomorrow.
                </p>
              </>
            ) : workerStatus.hasActiveTask ? (
              <>
                <p className="font-semibold">Active Post In Progress</p>
                <p className="mt-0.5 text-xs text-worker-warning/90">
                  You have an active post awaiting submission in your ticket. Please submit your link in Discord before claiming another post.
                </p>
                {discordTicketUrl ? (
                  <a
                    href={discordTicketUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-worker-accent hover:underline"
                  >
                    Open Ticket in Discord
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  </a>
                ) : null}
              </>
            ) : (
              <p>{workerStatus.reason || 'You are not eligible to claim posts at this time.'}</p>
            )}
          </div>
        </div>
      ) : null}

      {/* Claim Success Banner */}
      {claimSuccess ? (
        <div
          role="status"
          className="flex flex-col gap-3 rounded-xl border border-worker-success/30 bg-worker-success/10 p-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-worker-success" aria-hidden="true" />
            <div>
              <p className="font-display font-semibold text-worker-success">Post Claimed Successfully!</p>
              <p className="text-xs text-worker-text-muted">
                The post details have been sent to your ticket. Please head to your Discord ticket to complete it.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {discordTicketUrl ? (
              <a
                href={discordTicketUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="worker-primary-button text-xs py-2 h-auto"
              >
                Open Discord Ticket
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            ) : null}
            <button
              type="button"
              onClick={() => setClaimSuccess(null)}
              className="worker-secondary-button text-xs py-2 h-auto"
              aria-label="Dismiss banner"
            >
              Dismiss
            </button>
          </div>
        </div>
      ) : null}

      {/* Claim Error Banner */}
      {claimError ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-xl border border-worker-danger/30 bg-worker-danger/10 p-4 text-sm text-worker-danger"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <AlertCircle className="h-5 w-5 shrink-0" aria-hidden="true" />
            <p className="truncate font-medium">{claimError}</p>
          </div>
          <button
            type="button"
            onClick={() => setClaimError(null)}
            className="rounded p-1 text-worker-danger hover:bg-worker-danger/20"
            aria-label="Dismiss error"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      ) : null}

      {/* Task List */}
      {isLoading ? (
        <div className="grid gap-3 md:grid-cols-2 min-[1440px]:grid-cols-3" aria-label="Loading available tasks">
          {[0, 1, 2, 3].map((item) => (
            <WorkerSkeleton key={item} className="h-40 rounded-xl" />
          ))}
        </div>
      ) : isError || !data?.success ? (
        <WorkerCard className="p-6 text-center">
          <AlertCircle className="mx-auto h-8 w-8 text-worker-danger" aria-hidden="true" />
          <p className="mt-3 text-sm text-worker-text-muted">Could not load available posts.</p>
          <button type="button" onClick={() => refetch()} className="worker-secondary-button mt-4">
            Retry
          </button>
        </WorkerCard>
      ) : tasks.length === 0 ? (
        <WorkerCard className="p-10 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-worker-surface-2 text-worker-accent">
            <Radio className="h-6 w-6 motion-safe:animate-pulse" aria-hidden="true" />
          </div>
          <h3 className="mt-4 font-display text-base font-semibold text-worker-text">No posts available right now</h3>
          <p className="mx-auto mt-1.5 max-w-md text-sm text-worker-text-muted">
            We are scanning continuously for new eligible posts. As soon as a post appears, it will show up here automatically.
          </p>
        </WorkerCard>
      ) : (
        <ul className="grid min-w-0 gap-3 md:grid-cols-2 min-[1440px]:grid-cols-3" aria-label="Available tasks list">
          {tasks.map((task) => {
            const isExpanded = expandedIds.has(task.id);
            const isClaiming = claimingId === task.id;
            const canClaim = !!workerStatus?.canClaim && !claimingId;

            return (
              <li key={task.id} className="min-w-0">
                <WorkerCard className="flex flex-col justify-between overflow-hidden rounded-xl border-worker-border/80 p-0 transition-shadow duration-150 hover:border-worker-border">
                  {/* Top: Subreddit badge and Post badge (collapsed view) */}
                  <div className="p-4">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="inline-flex items-center rounded-full border border-worker-accent/30 bg-worker-accent/10 px-3 py-1 font-mono text-xs font-semibold text-worker-accent">
                          r/{task.subreddit}
                        </span>
                        <span className="inline-flex items-center rounded-full border border-worker-border bg-worker-surface-2 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider text-worker-text-faint">
                          Post
                        </span>
                      </div>
                    </div>

                    {/* Expanded View: Title & Content (revealed ONLY when "See Details" is clicked) */}
                    {isExpanded ? (
                      <div className="mt-4 space-y-2.5 border-t border-worker-border/60 pt-3">
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-worker-text-faint">Title</p>
                          <p className="mt-0.5 font-display text-sm font-semibold text-worker-text leading-snug">
                            {task.title || '(No title)'}
                          </p>
                        </div>
                        {task.content ? (
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-worker-text-faint">Content Preview</p>
                            <div className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-worker-border/50 bg-worker-surface-2 p-2.5 text-xs leading-relaxed text-worker-text-muted whitespace-pre-wrap">
                              {task.content}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  {/* Actions footer */}
                  <div className="flex items-center justify-between gap-2 border-t border-worker-border/60 bg-worker-surface-2/40 px-4 py-2.5">
                    <button
                      type="button"
                      onClick={() => toggleDetails(task.id)}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-worker-text-muted hover:text-worker-text transition-colors duration-150"
                      aria-expanded={isExpanded}
                    >
                      {isExpanded ? (
                        <>
                          <ChevronUp className="h-4 w-4" aria-hidden="true" />
                          Hide Details
                        </>
                      ) : (
                        <>
                          <ChevronDown className="h-4 w-4" aria-hidden="true" />
                          See Details
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      disabled={!canClaim || isClaiming}
                      onClick={() => handleClaim(task)}
                      className="worker-primary-button min-h-[36px] py-1 px-3 text-xs"
                      title={!workerStatus?.canClaim ? workerStatus?.reason || 'Cannot claim at this time' : undefined}
                    >
                      {isClaiming ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                          Claiming...
                        </>
                      ) : (
                        <>
                          <Check className="h-3.5 w-3.5" aria-hidden="true" />
                          Claim Post
                        </>
                      )}
                    </button>
                  </div>
                </WorkerCard>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
