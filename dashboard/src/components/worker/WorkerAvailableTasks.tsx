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

interface AcceptedTaskEntry {
  task: AvailableTaskItem;
  claimId: string;
  channelId?: string;
  guildId?: string;
}

export function WorkerAvailableTasks() {
  const queryClient = useQueryClient();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [acceptedTasks, setAcceptedTasks] = useState<Map<string, AcceptedTaskEntry>>(new Map());

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['worker-available-tasks'],
    queryFn: getAvailableTasks,
    refetchInterval: 3500, // Live poll matching backend scan frequency
  });

  const liveTasks: AvailableTaskItem[] = data?.data?.tasks || [];
  const workerStatus: WorkerStatus | undefined = data?.data?.workerStatus;

  // Combine accepted tasks (kept in state) with live tasks, ensuring no duplicates
  const allCardTasks: { task: AvailableTaskItem; isAccepted: boolean; acceptedData?: AcceptedTaskEntry }[] = [];
  const seenIds = new Set<string>();

  // Accepted cards shown first so worker immediately sees the "Please accept the post" prompt
  acceptedTasks.forEach((entry, id) => {
    allCardTasks.push({ task: entry.task, isAccepted: true, acceptedData: entry });
    seenIds.add(id);
  });

  // Then add remaining live available tasks
  liveTasks.forEach((task) => {
    if (!seenIds.has(task.id)) {
      allCardTasks.push({ task, isAccepted: false });
      seenIds.add(task.id);
    }
  });

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

  const handleAccept = async (task: AvailableTaskItem) => {
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

      // Mark the task as accepted in local state immediately so the card changes
      const acceptedEntry: AcceptedTaskEntry = { task, claimId, channelId, guildId };
      setAcceptedTasks((prev) => new Map(prev).set(task.id, acceptedEntry));

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
            setAcceptedTasks((prev) =>
              new Map(prev).set(task.id, {
                task,
                claimId,
                channelId: pollRes.data.channelId || channelId,
                guildId: pollRes.data.guildId || guildId,
              }),
            );
            queryClient.invalidateQueries({ queryKey: ['worker-available-tasks'] });
            queryClient.invalidateQueries({ queryKey: ['worker-tasks'] });
            break;
          } else if (status === 'FAILED') {
            resolved = true;
            // Remove from accepted map on failure
            setAcceptedTasks((prev) => {
              const next = new Map(prev);
              next.delete(task.id);
              return next;
            });
            setClaimError(
              pollRes.data.failureReason || 'Someone else just claimed this post! Please select another one.',
            );
            queryClient.invalidateQueries({ queryKey: ['worker-available-tasks'] });
            break;
          } else if (status === 'EXPIRED') {
            resolved = true;
            setAcceptedTasks((prev) => {
              const next = new Map(prev);
              next.delete(task.id);
              return next;
            });
            setClaimError('Claim timed out. Please try another post.');
            queryClient.invalidateQueries({ queryKey: ['worker-available-tasks'] });
            break;
          }
        } catch {
          // Keep polling on transient network glitch
        }
      }

      if (!resolved) {
        // Still pending at timeout: companion is processing it in Discord
        queryClient.invalidateQueries({ queryKey: ['worker-available-tasks'] });
        queryClient.invalidateQueries({ queryKey: ['worker-tasks'] });
      }
    } catch (err: unknown) {
      // Revert accepted state on initial rejection
      setAcceptedTasks((prev) => {
        const next = new Map(prev);
        next.delete(task.id);
        return next;
      });

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

  const defaultTicketUrl =
    workerStatus?.guildId && workerStatus?.channelId
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
            <h1 className="font-display text-base font-semibold text-worker-text sm:text-lg">Live Task Feed</h1>
            <p className="text-xs text-worker-text-muted">Real-time eligible posts available for instant acceptance</p>
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
                {defaultTicketUrl ? (
                  <a
                    href={defaultTicketUrl}
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

      {/* Claim Conflict / Error Banner */}
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
      {isLoading && allCardTasks.length === 0 ? (
        <div className="grid gap-3 md:grid-cols-2 min-[1440px]:grid-cols-3" aria-label="Loading available tasks">
          {[0, 1, 2, 3].map((item) => (
            <WorkerSkeleton key={item} className="h-44 rounded-xl" />
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
      ) : allCardTasks.length === 0 ? (
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
          {allCardTasks.map(({ task, isAccepted, acceptedData }) => {
            const isExpanded = expandedIds.has(task.id);
            const isClaiming = claimingId === task.id;
            const canClaim = !!workerStatus?.canClaim && !claimingId;

            const ticketUrl =
              acceptedData?.guildId && acceptedData?.channelId
                ? `https://discord.com/channels/${acceptedData.guildId}/${acceptedData.channelId}`
                : defaultTicketUrl;

            // ─── If Accepted: The claim card changes to "Please accept the post" ───
            if (isAccepted) {
              return (
                <li key={task.id} className="min-w-0">
                  <WorkerCard className="flex flex-col justify-between overflow-hidden rounded-xl border-worker-success/40 bg-worker-success/5 p-0 transition-all duration-150">
                    <div className="p-4">
                      {/* Subreddit badge + Accepted badge */}
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="inline-flex items-center rounded-full border border-worker-success/30 bg-worker-success/15 px-3 py-1 font-mono text-xs font-semibold text-worker-success">
                            r/{task.subreddit}
                          </span>
                          <span className="inline-flex items-center gap-1 rounded-full border border-worker-success/40 bg-worker-success/20 px-2 py-0.5 text-[11px] font-semibold text-worker-success">
                            <CheckCircle2 className="h-3 w-3" />
                            Accepted
                          </span>
                        </div>
                      </div>

                      {/* Title: ALWAYS visible */}
                      <h3 className="mt-2.5 font-display text-sm font-semibold text-worker-text leading-snug">
                        {task.title || '(No title)'}
                      </h3>

                      {/* Changed card state: Please accept the post */}
                      <div className="mt-3.5 rounded-lg border border-worker-success/30 bg-worker-surface/90 p-3.5 text-center space-y-2">
                        <div className="flex items-center justify-center gap-1.5 text-sm font-bold text-worker-success">
                          <CheckCircle2 className="h-4 w-4" />
                          <span>Please accept the post</span>
                        </div>
                        <p className="text-xs text-worker-text-muted">
                          The post details have been sent to your Discord ticket. Please open your ticket now to view details and submit your link.
                        </p>
                        {ticketUrl ? (
                          <a
                            href={ticketUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="worker-primary-button w-full text-xs py-2 h-auto mt-1 inline-flex items-center justify-center gap-1.5"
                          >
                            Open Discord Ticket
                            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                          </a>
                        ) : null}
                      </div>
                    </div>
                  </WorkerCard>
                </li>
              );
            }

            // ─── Normal Available Card: Title ALWAYS visible + See Details button reveals content ───
            return (
              <li key={task.id} className="min-w-0">
                <WorkerCard className="flex flex-col justify-between overflow-hidden rounded-xl border-worker-border/80 p-0 transition-shadow duration-150 hover:border-worker-border">
                  <div className="p-4">
                    {/* Top: Subreddit badge and Post badge */}
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

                    {/* Title: ALWAYS visible on every card */}
                    <h3 className="mt-2.5 font-display text-sm font-semibold text-worker-text leading-snug">
                      {task.title || '(No title)'}
                    </h3>

                    {/* Post Content preview: revealed ONLY when "See Details" is clicked */}
                    {isExpanded ? (
                      <div className="mt-3 space-y-1.5 rounded-lg border border-worker-border/60 bg-worker-surface-2 p-3">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-worker-text-faint">
                          Post Content
                        </p>
                        <div className="max-h-48 overflow-y-auto text-xs leading-relaxed text-worker-text-muted whitespace-pre-wrap">
                          {task.content || '(No content)'}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  {/* Actions footer: See Details toggle + Accept Post button */}
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
                      onClick={() => handleAccept(task)}
                      className="worker-primary-button min-h-[36px] py-1 px-3 text-xs"
                      title={!workerStatus?.canClaim ? workerStatus?.reason || 'Cannot claim at this time' : undefined}
                    >
                      {isClaiming ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                          Accepting...
                        </>
                      ) : (
                        <>
                          <Check className="h-3.5 w-3.5" aria-hidden="true" />
                          Accept Post
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
