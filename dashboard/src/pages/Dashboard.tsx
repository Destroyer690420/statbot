import { useQuery } from '@tanstack/react-query';
import { getStats, getDailyStats, getTasks } from '../api/client';
import { CheckCircle2, Clock, AlertCircle, ListTodo, FileText, MessageSquare, Trash2, XCircle } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

function isToday(dateStr: string): boolean {
  const d = new Date(dateStr);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
}

function isDeleted(task: any): boolean {
  return task.status === 'CANCELLED' ||
    task.cancelledReason === 'deleted' ||
    task.cancelledReason === 'deleted_later';
}

const CHART_PRIMARY = '#6C8CFF';
const CHART_GRID = '#20252C';
const CHART_LABEL = '#66707C';
const CHART_TOOLTIP_BG = '#111418';
const CHART_TOOLTIP_BORDER = '#272D35';

export function Dashboard() {
  const { data: statsData, isLoading: statsLoading } = useQuery({
    queryKey: ['stats'],
    queryFn: getStats,
  });

  const { data: dailyData } = useQuery({
    queryKey: ['daily-stats-7'],
    queryFn: () => getDailyStats(7),
  });

  const { data: tasksData } = useQuery({
    queryKey: ['all-tasks-dashboard'],
    queryFn: () => getTasks(),
  });

  if (statsLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton h-[104px]" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 skeleton h-[380px]" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="skeleton h-[124px]" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  const stats = statsData?.data || {};
  const daily = dailyData?.data || [];
  const allTasks: any[] = tasksData?.data || [];

  // Client-side computed stats from tasks
  const todayPosts = allTasks.filter((t) => t.type === 'POST' && isToday(t.createdAt)).length;
  const todayComments = allTasks.filter((t) => t.type === 'COMMENT' && isToday(t.createdAt)).length;
  const todayPostsDeleted = allTasks.filter((t) => t.type === 'POST' && isDeleted(t) && isToday(t.createdAt)).length;
  const todayCommentsDeleted = allTasks.filter((t) => t.type === 'COMMENT' && isDeleted(t) && isToday(t.createdAt)).length;
  const totalDeleted = allTasks.filter((t) => isDeleted(t)).length;

  const chartData = daily.map((d: { date: string; count: number }) => ({
    name: d.date.slice(5),
    tasks: d.count,
  }));

  if (chartData.length === 0) {
    chartData.push({ name: 'No data', tasks: 0 });
  }

  const statCards = [
    { title: 'Total Tasks', value: stats.total || 0, icon: ListTodo, accent: '#6C8CFF' },
    { title: 'Pending', value: stats.pending || 0, icon: Clock, accent: '#D6A85A' },
    { title: 'Completed', value: stats.completed || 0, icon: CheckCircle2, accent: '#4CAF82' },
    { title: 'Overdue', value: stats.overdue || 0, icon: AlertCircle, accent: '#D66B72' },
  ];

  const secondaryCards = [
    { title: "Today's Posts", value: todayPosts, icon: FileText },
    { title: "Today's Comments", value: todayComments, icon: MessageSquare },
    { title: 'Total Deleted', value: totalDeleted, icon: XCircle },
  ];

  return (
    <div className="space-y-6">
      {/* Context */}
      <div>
        <h1 className="text-2xl font-semibold text-text-primary tracking-tight">Dashboard</h1>
        <p className="text-[13px] text-text-secondary mt-1">
          Task throughput, completions, and deletions at a glance.
        </p>
      </div>

      {/* Key metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((stat, i) => (
          <div key={i} className="stat-card">
            <div className="flex items-center justify-between">
              <p className="text-[13px] text-text-secondary font-medium">{stat.title}</p>
              <stat.icon className="w-4 h-4" style={{ color: stat.accent }} strokeWidth={2} />
            </div>
            <h2 className="text-[28px] leading-8 font-semibold text-text-primary mt-2 tabular-nums">{stat.value}</h2>
            <div className="h-0.5 rounded-full mt-3" style={{ background: `${stat.accent}33` }}>
              <div className="h-0.5 rounded-full w-2/5" style={{ background: stat.accent }} />
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Activity chart */}
        <div className="lg:col-span-2 glass-card p-5">
          <div className="flex items-baseline justify-between mb-4">
            <h3 className="text-[16px] font-semibold text-text-primary">Task activity</h3>
            <span className="text-xs text-text-muted">Last 7 days</span>
          </div>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorTasks" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={CHART_PRIMARY} stopOpacity={0.25} />
                    <stop offset="95%" stopColor={CHART_PRIMARY} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
                <XAxis dataKey="name" stroke={CHART_LABEL} tick={{ fill: CHART_LABEL, fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis stroke={CHART_LABEL} tick={{ fill: CHART_LABEL, fontSize: 12 }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: CHART_TOOLTIP_BG, borderColor: CHART_TOOLTIP_BORDER, borderRadius: '8px', fontSize: 13 }}
                  itemStyle={{ color: '#F2F4F7' }}
                  labelStyle={{ color: '#98A1AD' }}
                />
                <Area type="monotone" dataKey="tasks" stroke={CHART_PRIMARY} strokeWidth={2} fillOpacity={1} fill="url(#colorTasks)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Secondary activity */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-4">
          {secondaryCards.map((card, i) => (
            <div key={i} className="stat-card flex items-center justify-between py-4">
              <div>
                <p className="text-[13px] text-text-secondary font-medium">{card.title}</p>
                <h2 className="text-2xl font-semibold text-text-primary mt-1 tabular-nums">{card.value}</h2>
              </div>
              <card.icon className="w-5 h-5 text-text-muted" strokeWidth={2} />
            </div>
          ))}
          <div className="stat-card py-4">
            <p className="text-[13px] text-text-secondary font-medium">Today's deleted</p>
            <div className="flex items-center gap-4 mt-2">
              <div>
                <p className="text-text-muted text-[11px] font-medium uppercase tracking-wider">Posts</p>
                <p className="text-xl font-semibold text-text-primary tabular-nums">{todayPostsDeleted}</p>
              </div>
              <div className="w-px h-8 bg-appborder-subtle" />
              <div>
                <p className="text-text-muted text-[11px] font-medium uppercase tracking-wider">Comments</p>
                <p className="text-xl font-semibold text-text-primary tabular-nums">{todayCommentsDeleted}</p>
              </div>
              <Trash2 className="w-5 h-5 text-text-muted ml-auto" strokeWidth={2} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
