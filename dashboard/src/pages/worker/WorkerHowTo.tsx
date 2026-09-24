import { useQuery } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { getWorkerStatus } from '../../api/workerApi';
import { useWorkerAuth } from '../../hooks/useWorkerAuth';
import {
  WORKER_GUIDE_SECTIONS,
  GUIDE_CHANNEL_IDS,
  PAYMENT_PROOF_CHANNEL_ID,
  discordChannelUrl,
} from '../../content/workerGuide';

export default function WorkerHowTo() {
  const { ticket } = useWorkerAuth();
  const { data } = useQuery({ queryKey: ['worker-status'], queryFn: getWorkerStatus });
  const guildId = data?.data?.guildId || '';

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-white">How to</h1>

      {/* Sticky in-page section list */}
      <nav className="sticky top-[57px] z-[5] glass-card p-2 overflow-x-auto" aria-label="Guide sections">
        <div className="flex gap-1.5 min-w-max">
          {WORKER_GUIDE_SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#guide-${s.id}`}
              className="px-3 py-2 min-h-[44px] flex items-center text-xs text-primary-400 whitespace-nowrap"
            >
              {s.title}
            </a>
          ))}
        </div>
      </nav>

      {WORKER_GUIDE_SECTIONS.map((s) => (
        <section key={s.id} id={`guide-${s.id}`} className="glass-card p-4 scroll-mt-32">
          <h2 className="font-semibold text-white mb-2">{s.title}</h2>
          {s.id === 'insights' && guildId && (
            <div className="flex flex-wrap gap-2 mb-2">
              {GUIDE_CHANNEL_IDS.map((c, i) => (
                <a
                  key={c}
                  href={discordChannelUrl(guildId, c)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary-400 min-h-[44px] flex items-center"
                >
                  Guide channel {i + 1}
                </a>
              ))}
            </div>
          )}
          <ol className="list-decimal list-inside space-y-1.5">
            {s.steps.map((step, i) => (
              <li key={i} className="text-sm text-dark-200">
                {step}
              </li>
            ))}
          </ol>
          {s.tips.length > 0 && (
            <ul className="mt-2 space-y-1">
              {s.tips.map((t, i) => (
                <li key={i} className="text-xs text-green-400">
                  Tip: {t}
                </li>
              ))}
            </ul>
          )}
          {s.warnings.length > 0 && (
            <ul className="mt-2 space-y-1">
              {s.warnings.map((t, i) => (
                <li key={i} className="text-xs text-yellow-300">
                  {t}
                </li>
              ))}
            </ul>
          )}
          {s.id === 'payments' && guildId && (
            <a
              href={discordChannelUrl(guildId, PAYMENT_PROOF_CHANNEL_ID)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary-400 flex items-center gap-1 mt-2 min-h-[44px]"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Open payment proof channel
            </a>
          )}
          {s.id === 'need-help' && ticket?.discordUrl && (
            <a
              href={ticket.discordUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary mt-2 min-h-[44px] inline-flex items-center"
            >
              Open my ticket in Discord
            </a>
          )}
        </section>
      ))}
    </div>
  );
}
