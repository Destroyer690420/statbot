import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Check, ExternalLink, Info, Lightbulb } from 'lucide-react';
import { getWorkerStatus } from '../../api/workerApi';
import { useWorkerAuth } from '../../hooks/useWorkerAuth';
import {
  WORKER_GUIDE_SECTIONS,
  GUIDE_CHANNEL_IDS,
  PAYMENT_PROOF_CHANNEL_ID,
  discordChannelUrl,
} from '../../content/workerGuide';
import { WorkerCard } from '../../components/worker/WorkerUI';

const NUMBERED_SECTIONS = new Set(['how-it-works', 'post-task', 'comment-task', 'deleted-post']);

function GuideNav({ activeId, mobile = false }: { activeId: string; mobile?: boolean }) {
  return (
    <nav
      className={mobile ? 'sticky top-16 z-20 -mx-1 overflow-x-auto bg-worker-bg/95 px-1 py-2 backdrop-blur' : ''}
      aria-label="Guide sections"
    >
      <div className={`${mobile ? 'flex min-w-max gap-1 rounded-xl border border-worker-border bg-worker-surface p-1' : 'space-y-1'}`}>
        {WORKER_GUIDE_SECTIONS.map((section) => {
          const active = activeId === section.id;
          return (
            <a
              key={section.id}
              href={`#guide-${section.id}`}
              aria-current={active ? 'location' : undefined}
              className={`${mobile ? 'min-h-[40px] whitespace-nowrap rounded-lg px-3 py-2 text-xs' : 'block rounded-lg px-3 py-2 text-sm'} transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-worker-accent ${
                active ? 'bg-worker-accent/10 font-semibold text-worker-accent' : 'text-worker-text-muted hover:bg-worker-surface-2 hover:text-worker-text'
              }`}
            >
              {section.title}
            </a>
          );
        })}
      </div>
    </nav>
  );
}

export default function WorkerHowTo() {
  const { ticket } = useWorkerAuth();
  const { data } = useQuery({ queryKey: ['worker-status'], queryFn: getWorkerStatus });
  const guildId = data?.data?.guildId || '';
  const [activeId, setActiveId] = useState(WORKER_GUIDE_SECTIONS[0]?.id || '');

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const elements = WORKER_GUIDE_SECTIONS.map((section) => document.getElementById(`guide-${section.id}`)).filter((element): element is HTMLElement => Boolean(element));
    if (elements.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveId(visible[0].target.id.replace('guide-', ''));
      },
      { rootMargin: '-20% 0px -65% 0px', threshold: [0, 0.1, 0.5] },
    );
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, []);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="lg:grid lg:grid-cols-[180px_minmax(0,1fr)] lg:gap-10">
        <aside className="hidden lg:block">
          <div className="sticky top-24">
            <p className="mb-3 text-xs font-medium text-worker-text-muted">On this page</p>
            <GuideNav activeId={activeId} />
          </div>
        </aside>

        <div className="min-w-0 max-w-3xl">
          <div className="mb-6 lg:hidden">
            <h1 className="font-display text-xl font-bold tracking-tight text-worker-text sm:text-2xl">How to</h1>
            <p className="mt-1 text-sm text-worker-text-muted">A quick reference for your tasks and payments.</p>
          </div>
          <div className="lg:hidden">
            <GuideNav activeId={activeId} mobile />
          </div>

          <div className="mt-4 space-y-4 lg:mt-0">
            {WORKER_GUIDE_SECTIONS.map((section) => {
              const numbered = NUMBERED_SECTIONS.has(section.id);
              return (
                <WorkerCard as="section" key={section.id} id={`guide-${section.id}`} className="scroll-mt-28 p-5 sm:p-6">
                  <div className="flex items-start gap-3">
                    {numbered ? (
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-worker-accent font-display text-sm font-bold text-white">
                        {WORKER_GUIDE_SECTIONS.filter((item) => NUMBERED_SECTIONS.has(item.id)).findIndex((item) => item.id === section.id) + 1}
                      </span>
                    ) : (
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-worker-surface-2 text-worker-text-muted">
                        <Info className="h-4 w-4" aria-hidden="true" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <h2 className="font-display text-lg font-semibold tracking-tight text-worker-text">{section.title}</h2>
                    </div>
                  </div>

                  {section.id === 'insights' && guildId ? (
                    <div className="mt-5 flex flex-wrap gap-2">
                      {GUIDE_CHANNEL_IDS.map((channelId, index) => (
                        <a
                          key={channelId}
                          href={discordChannelUrl(guildId, channelId)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="worker-secondary-button"
                        >
                          Guide channel {index + 1}
                          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                        </a>
                      ))}
                    </div>
                  ) : null}

                  <ul className="mt-5 space-y-2.5">
                    {section.steps.map((step) => (
                      <li key={step} className="flex items-start gap-2.5 text-sm leading-6 text-worker-text-muted">
                        <Check className="mt-1 h-3.5 w-3.5 shrink-0 text-worker-success" aria-hidden="true" />
                        <span>{step}</span>
                      </li>
                    ))}
                  </ul>

                  {section.tips.length > 0 ? (
                    <ul className="mt-4 space-y-2 border-t border-worker-border pt-4">
                      {section.tips.map((tip) => (
                        <li key={tip} className="flex items-start gap-2.5 text-xs leading-5 text-worker-success">
                          <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          <span>Tip: {tip}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  {section.warnings.length > 0 ? (
                    <ul className="mt-3 space-y-2">
                      {section.warnings.map((warning) => (
                        <li key={warning} className="flex items-start gap-2.5 text-xs leading-5 text-worker-warning">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          <span>{warning}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  {section.id === 'payments' && guildId ? (
                    <a
                      href={discordChannelUrl(guildId, PAYMENT_PROOF_CHANNEL_ID)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="worker-secondary-button mt-4"
                    >
                      Open payment proof channel
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                    </a>
                  ) : null}

                  {section.id === 'need-help' && ticket?.discordUrl ? (
                    <a href={ticket.discordUrl} target="_blank" rel="noopener noreferrer" className="worker-secondary-button mt-4">
                      Open my ticket in Discord
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                    </a>
                  ) : null}
                </WorkerCard>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
