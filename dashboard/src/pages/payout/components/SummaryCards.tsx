import { ReactNode } from 'react';

interface CardConfig {
  label: string;
  value: string | number;
  icon: ReactNode;
  accent: 'indigo' | 'green' | 'amber' | 'blue';
  subtitle?: ReactNode;
}

const accentDots = {
  indigo: '#6C8CFF',
  green: '#4CAF82',
  amber: '#D6A85A',
  blue: '#829EFF',
} as const;

export function SummaryCards({ cards }: { cards: CardConfig[] }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
      {cards.map((card, i) => (
        <div
          key={i}
          className="summary-card"
        >
          <div className="flex items-center justify-between mb-2 sm:mb-3">
            <p className="text-dark-400 text-xs sm:text-[13px] font-medium truncate pr-2">{card.label}</p>
            <div className="shrink-0">{card.icon}</div>
          </div>
          <p className="text-2xl sm:text-[28px] font-semibold text-text-primary tracking-tight tabular-nums">{card.value}</p>
          <div className="h-0.5 rounded-full mt-3" style={{ background: `${accentDots[card.accent]}33` }}>
            <div className="h-0.5 rounded-full w-2/5" style={{ background: accentDots[card.accent] }} />
          </div>
          {card.subtitle && (
            <div className="mt-1.5 sm:mt-2">{card.subtitle}</div>
          )}
        </div>
      ))}
    </div>
  );
}
