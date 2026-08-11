import { useState, useMemo } from 'react';
import { Outlet, NavLink, useLocation, Navigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Wallet, UserPlus } from 'lucide-react';
import { getPayoutWeek } from '../../api/client';
import { PayoutHeader } from './PayoutHeader';
import { DateFilter } from './DateFilter';
import { formatSimpleDate } from './utils';
import type { FilterMode } from './DateFilter';

// Context type shared with child routes via Outlet
export interface PayoutContext {
  dateParams: Record<string, string> | undefined;
  filterMode: FilterMode;
  isCurrentWeek: boolean;
  weekData: any;
}

export function PayoutLayout() {
  const location = useLocation();

  // ─── Filter State ─────────────────────────────────────────
  const [filterMode, setFilterMode] = useState<FilterMode>('previous');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  // ─── Week Info Query ──────────────────────────────────────
  const weekQuery = useQuery({
    queryKey: ['payout-week'],
    queryFn: getPayoutWeek,
  });

  // ─── Date Range Params ────────────────────────────────────
  const dateParams = useMemo((): Record<string, string> | undefined => {
    const weekData = weekQuery.data?.data;

    if (filterMode === 'all') return undefined;
    if (filterMode === 'current' && weekData?.current) {
      return { weekStart: weekData.current.weekStart, weekEnd: weekData.current.weekEnd };
    }
    if (filterMode === 'previous' && weekData?.previous) {
      return { weekStart: weekData.previous.weekStart, weekEnd: weekData.previous.weekEnd };
    }
    if (filterMode === 'custom' && customStart && customEnd) {
      return {
        weekStart: new Date(customStart + 'T00:00:00+05:30').toISOString(),
        weekEnd: new Date(customEnd + 'T23:59:59+05:30').toISOString(),
      };
    }
    return undefined;
  }, [filterMode, customStart, customEnd, weekQuery.data]);

  const isCurrentWeek = filterMode === 'all' || filterMode === 'current' || filterMode === 'previous' || (filterMode === 'custom' && !!customStart && !!customEnd);
  const weekData = weekQuery.data?.data;

  const weekLabel = useMemo(() => {
    if (filterMode === 'previous' && weekData?.previous?.weekLabel) {
      return `To Pay This Week (${weekData.previous.weekLabel})`;
    }
    if (filterMode === 'current' && weekData?.current?.weekLabel) {
      return `Current Active Cycle (${weekData.current.weekLabel})`;
    }
    if (filterMode === 'all') return 'All Unpaid Tasks';
    if (filterMode === 'custom' && customStart && customEnd) {
      return `${formatSimpleDate(customStart)} — ${formatSimpleDate(customEnd)}`;
    }
    return '';
  }, [filterMode, weekData, customStart, customEnd]);

  // Determine active sub-route
  const activeRoute = location.pathname.endsWith('/commissions') ? 'commissions' : 'tasks';

  // ─── Loading ──────────────────────────────────────────────
  if (weekQuery.isLoading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <Loader2 className="w-10 h-10 text-primary-500 animate-spin" />
      </div>
    );
  }

  // Redirect bare /payout to /payout/tasks
  if (location.pathname === '/payout' || location.pathname === '/payout/') {
    return <Navigate to="/payout/tasks" replace />;
  }

  const outletContext: PayoutContext = {
    dateParams,
    filterMode,
    isCurrentWeek,
    weekData,
  };

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* Header */}
      <PayoutHeader
        weekLabel={weekLabel}
        dateParams={dateParams}
        activeRoute={activeRoute}
      />

      {/* Sub-navigation tabs */}
      <div className="flex gap-1 bg-dark-900/40 p-1 rounded-xl border border-dark-700/30 w-fit">
        <NavLink
          to="/payout/tasks"
          className={`flex items-center gap-2 px-4 sm:px-5 py-2 sm:py-2.5 rounded-lg text-xs sm:text-sm font-semibold transition-all duration-200 ${
            activeRoute === 'tasks'
              ? 'bg-primary-600/20 text-primary-400 shadow-sm'
              : 'text-dark-400 hover:text-white hover:bg-dark-800/40'
          }`}
        >
          <Wallet className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          <span>Task Payments</span>
        </NavLink>
        <NavLink
          to="/payout/commissions"
          className={`flex items-center gap-2 px-4 sm:px-5 py-2 sm:py-2.5 rounded-lg text-xs sm:text-sm font-semibold transition-all duration-200 ${
            activeRoute === 'commissions'
              ? 'bg-primary-600/20 text-primary-400 shadow-sm'
              : 'text-dark-400 hover:text-white hover:bg-dark-800/40'
          }`}
        >
          <UserPlus className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          <span>Commissions</span>
        </NavLink>
      </div>

      {/* Date Filter */}
      <DateFilter
        filterMode={filterMode}
        setFilterMode={setFilterMode}
        customStart={customStart}
        customEnd={customEnd}
        setCustomStart={setCustomStart}
        setCustomEnd={setCustomEnd}
      />

      {/* Route content */}
      <Outlet context={outletContext} />
    </div>
  );
}
