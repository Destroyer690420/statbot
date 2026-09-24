import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getWorkerWallet, workerErrorMessage } from '../../api/workerApi';
import { formatMoney, formatISTDate } from '../../utils/workerFormat';

function WeekCard({ title, week }: { title: string; week: any }) {
  return (
    <div className="glass-card p-4">
      <h2 className="font-semibold text-white">{title}</h2>
      <p className="text-xs text-dark-400">{week.weekLabel}</p>
      <p className="text-2xl font-extrabold text-white mt-2">{formatMoney(week.total)}</p>
      <p className="text-xs text-dark-400 mt-1">
        {week.tasks} tasks · {week.posts} posts · {week.comments} comments
      </p>
      <div className="flex justify-between text-xs mt-2">
        <span className="text-green-400">Paid {formatMoney(week.paid)}</span>
        <span className="text-blue-400">Awaiting ~{formatMoney(week.awaiting)} est.</span>
      </div>
    </div>
  );
}

export default function WorkerWallet() {
  const [openBatch, setOpenBatch] = useState<number | null>(null);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['worker-wallet'],
    queryFn: getWorkerWallet,
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-32 glass-card animate-pulse" />
        ))}
      </div>
    );
  }

  if (isError || !data?.success) {
    return (
      <div className="glass-card p-6 text-center space-y-3">
        <p className="text-sm text-red-400">{workerErrorMessage(data, 'Could not load your wallet.')}</p>
        <button onClick={() => refetch()} className="btn-secondary min-h-[44px]">
          Retry
        </button>
      </div>
    );
  }

  const w = data.data;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-white">Wallet</h1>

      <WeekCard title="This week" week={w.thisWeek} />
      <WeekCard title="Last week" week={w.lastWeek} />

      <div className="glass-card p-4">
        <h2 className="font-semibold text-white">Awaiting payment (all weeks)</h2>
        <p className="text-2xl font-extrabold text-white mt-1">~{formatMoney(w.awaitingAll.estimated)}</p>
        <p className="text-xs text-dark-400">{w.awaitingAll.count} tasks · estimated at today&apos;s rates</p>
      </div>

      <div className="glass-card p-4">
        <h2 className="font-semibold text-white">Lifetime paid</h2>
        <p className="text-2xl font-extrabold text-green-400 mt-1">{formatMoney(w.lifetimePaid)}</p>
        <p className="text-xs text-dark-400 mt-2">
          ₹{w.rates.post} per post · ₹{w.rates.comment} per comment
        </p>
        <p className="text-xs text-dark-500 mt-2">
          Payments are made by your manager, usually weekly. You&apos;ll get a message in your ticket when a
          payment is credited. Amounts marked estimated use today&apos;s rates.
        </p>
      </div>

      <div className="glass-card p-4">
        <h2 className="font-semibold text-white mb-2">Payment history</h2>
        {w.payments.length === 0 ? (
          <p className="text-sm text-dark-400">No payments yet.</p>
        ) : (
          <ul className="space-y-2">
            {w.payments.map((p: any) => (
              <li key={p.batchNumber} className="rounded-xl border border-dark-700 bg-dark-800/60">
                <button
                  onClick={() => setOpenBatch(openBatch === p.batchNumber ? null : p.batchNumber)}
                  className="w-full text-left px-3 py-3 min-h-[44px]"
                  aria-expanded={openBatch === p.batchNumber}
                >
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium text-white">Batch #{p.batchNumber}</span>
                    <span className="text-sm font-bold text-white">{formatMoney(p.total)}</span>
                  </div>
                  <p className="text-xs text-dark-400 mt-0.5">
                    {p.weekLabel} · {p.taskCount} tasks · {p.paidAt ? formatISTDate(p.paidAt) : ''}
                  </p>
                </button>
                {openBatch === p.batchNumber && (
                  <ul className="px-3 pb-3 space-y-1">
                    {p.tasks.map((t: any) => (
                      <li key={t.taskId} className="flex justify-between text-xs text-dark-300">
                        <span>
                          {t.displayId} · {t.type}
                        </span>
                        <span>{formatMoney(t.amount)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
