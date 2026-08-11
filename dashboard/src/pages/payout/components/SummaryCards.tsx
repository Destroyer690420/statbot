import { ReactNode } from 'react';

interface CardConfig {
  label: string;
  value: string | number;
  icon: ReactNode;
  accent: 'indigo' | 'green' | 'amber' | 'blue';
  subtitle?: ReactNode;
}

const accentStyles = {
  indigo: 'border-l-primary-500/60 hover:border-primary-500/40',
  green: 'border-l-green-500/60 hover:border-green-500/40',
  amber: 'border-l-amber-500/60 hover:border-amber-500/40',
  blue: 'border-l-blue-500/60 hover:border-blue-500/40',
} as const;

export function SummaryCards({ cards }: { cards: CardConfig[] }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
      {cards.map((card, i) => (
        <div
          key={i}
          className={`summary-card border-l-4 ${accentStyles[card.accent]}`}
        >
          <div className="flex items-center justify-between mb-2 sm:mb-3">
            <p className="text-dark-400 text-xs sm:text-sm font-medium truncate pr-2">{card.label}</p>
            <div className="shrink-0">{card.icon}</div>
          </div>
          <p className="text-2xl sm:text-3xl font-bold text-white tracking-tight">{card.value}</p>
          {card.subtitle && (
            <div className="mt-1.5 sm:mt-2">{card.subtitle}</div>
          )}
        </div>
      ))}
    </div>
  );
}
