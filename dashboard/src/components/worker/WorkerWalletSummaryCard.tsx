import { Wallet } from 'lucide-react';
import { formatMoney } from '../../utils/workerFormat';
import { WorkerCard } from './WorkerUI';

/**
 * The wallet card shared by the inviter Home and the inviter Wallet page.
 * Same shape as the ticket holder's Home card: awaiting payment on top, then a
 * two-column footer for the last and lifetime payments.
 */
export function WorkerWalletSummaryCard({
  awaiting,
  lastPayment,
  lifetimePayment,
}: {
  awaiting: number;
  lastPayment: number;
  lifetimePayment: number;
}) {
  return (
    <WorkerCard className="overflow-hidden border-0 bg-wallet-gradient text-white">
      <div className="flex items-start justify-between gap-4 p-5">
        <div className="min-w-0">
          <p className="text-sm font-medium text-white/80">Awaiting payment</p>
          <p className="mt-2 font-display text-3xl font-bold tabular-nums leading-none">{formatMoney(awaiting)}</p>
        </div>
        <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15 text-white">
          <Wallet className="h-5 w-5" />
        </span>
      </div>
      <div className="grid grid-cols-2 border-t border-white/20">
        <div className="min-w-0 border-r border-white/20 px-5 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-white/75">Last payment</p>
          <p className="mt-1.5 font-display text-base font-bold tabular-nums leading-none">{formatMoney(lastPayment)}</p>
        </div>
        <div className="min-w-0 px-5 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-white/75">Lifetime payment</p>
          <p className="mt-1.5 font-display text-base font-bold tabular-nums leading-none">{formatMoney(lifetimePayment)}</p>
        </div>
      </div>
    </WorkerCard>
  );
}
