type FilterMode = 'all' | 'current' | 'previous' | 'custom';

interface DateFilterProps {
  filterMode: FilterMode;
  setFilterMode: (mode: FilterMode) => void;
  customStart: string;
  customEnd: string;
  setCustomStart: (v: string) => void;
  setCustomEnd: (v: string) => void;
}

const filterOptions: { mode: FilterMode; label: string; shortLabel: string }[] = [
  { mode: 'previous', label: 'Previous Cycle', shortLabel: 'Previous' },
  { mode: 'current', label: 'Current Cycle', shortLabel: 'Current' },
  { mode: 'all', label: 'All Unpaid', shortLabel: 'All' },
  { mode: 'custom', label: 'Custom Range', shortLabel: 'Custom' },
];

export function DateFilter({
  filterMode,
  setFilterMode,
  customStart,
  customEnd,
  setCustomStart,
  setCustomEnd,
}: DateFilterProps) {
  return (
    <div className="glass-card p-3 sm:p-4">
      <div className="flex flex-col gap-3">
        {/* Segmented control */}
        <div className="segmented-control">
          {filterOptions.map((opt) => (
            <button
              key={opt.mode}
              onClick={() => setFilterMode(opt.mode)}
              className={`segmented-control-item ${filterMode === opt.mode ? 'active' : ''}`}
            >
              <span className="hidden sm:inline">{opt.label}</span>
              <span className="sm:hidden">{opt.shortLabel}</span>
            </button>
          ))}
        </div>

        {/* Custom date inputs */}
        {filterMode === 'custom' && (
          <div className="flex items-center gap-2 pl-1">
            <input
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="input-field text-xs sm:text-sm py-1.5 px-2.5 w-[130px] sm:w-auto"
            />
            <span className="text-dark-500 text-xs">to</span>
            <input
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="input-field text-xs sm:text-sm py-1.5 px-2.5 w-[130px] sm:w-auto"
            />
          </div>
        )}
      </div>
    </div>
  );
}

export type { FilterMode };
