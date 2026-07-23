import { useQuery } from '@tanstack/react-query';
import { getStats, getDailyStats, getTasks } from '../api/client';
import { CheckCircle2, Clock, AlertCircle, ListTodo, Loader2, FileText, MessageSquare, Trash2, XCircle } from 'lucide-react';
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
      <div className="flex h-[50vh] items-center justify-center">
        <Loader2 className="w-10 h-10 text-primary-500 animate-spin" />
      </div>
    );
  }

  const stats = statsData?.data || {};
  const daily = dailyData?.data || [];
  const allTasks: any[] = tasksData?.data || [];

  // Client-side computed stats from tasks
  const todayPosts = allTasks.filter((t) => t.type === 'POST' && isToday(t.createdAt)).length;
  const todayComments = allTasks.filter((t) => t.type === 'COMMENT' && isToday(t.createdAt)).length;
  const todayPostsDeleted = allTasks.filter((t) => t.type === 'POST' && isDeleted(t) && (isToday(t.updatedAt) || isToday(t.createdAt))).length;
  const todayCommentsDeleted = allTasks.filter((t) => t.type === 'COMMENT' && isDeleted(t) && (isToday(t.updatedAt) || isToday(t.createdAt))).length;
  const totalDeleted = allTasks.filter((t) => isDeleted(t)).length;

  const chartData = daily.map((d: { date: string; count: number }) => ({
    name: d.date.slice(5),
    tasks: d.count,
  }));

  if (chartData.length === 0) {
    chartData.push({ name: 'No data', tasks: 0 });
  }

  const statCards = [
    { title: 'Total Tasks', value: stats.total || 0, icon: ListTodo, color: 'text-primary-400' },
    { title: 'Pending', value: stats.pending || 0, icon: Clock, color: 'text-yellow-400' },
    { title: 'Completed', value: stats.completed || 0, icon: CheckCircle2, color: 'text-green-400' },
    { title: 'Overdue', value: stats.overdue || 0, icon: AlertCircle, color: 'text-red-400' },
  ];

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Primary Stats Grid */}

      {/* Primary Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {statCards.map((stat, i) => (
          <div key={i} className="stat-card relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-6 opacity-10 group-hover:opacity-20 transition-opacity">
              <stat.icon className={`w-16 h-16 ${stat.color}`} />
            </div>
            <div className="relative z-10">
              <p className="text-dark-400 font-medium mb-1">{stat.title}</p>
              <h2 className="text-4xl font-bold text-white">{stat.value}</h2>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Chart */}
        <div className="lg:col-span-2 glass-card p-6">
          <h3 className="text-lg font-semibold text-white mb-6">Task Activity (Last 7 Days)</h3>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorTasks" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis dataKey="name" stroke="#64748b" tick={{fill: '#64748b'}} axisLine={false} tickLine={false} />
                <YAxis stroke="#64748b" tick={{fill: '#64748b'}} axisLine={false} tickLine={false} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '12px' }}
                  itemStyle={{ color: '#e0e7ff' }}
                />
                <Area type="monotone" dataKey="tasks" stroke="#6366f1" strokeWidth={3} fillOpacity={1} fill="url(#colorTasks)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Secondary Activity & Deletion Cards Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Today's Post */}
          <div className="stat-card relative overflow-hidden group flex flex-col justify-between p-5">
            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
              <FileText className="w-12 h-12 text-purple-400" />
            </div>
            <div className="relative z-10">
              <p className="text-dark-400 text-xs font-medium mb-1">Today's Post</p>
              <h2 className="text-3xl font-bold text-white">{todayPosts}</h2>
            </div>
          </div>

          {/* Today's Comment */}
          <div className="stat-card relative overflow-hidden group flex flex-col justify-between p-5">
            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
              <MessageSquare className="w-12 h-12 text-indigo-400" />
            </div>
            <div className="relative z-10">
              <p className="text-dark-400 text-xs font-medium mb-1">Today's Comment</p>
              <h2 className="text-3xl font-bold text-white">{todayComments}</h2>
            </div>
          </div>

          {/* Today's Deleted — split into Post / Comment */}
          <div className="stat-card relative overflow-hidden group flex flex-col justify-between p-5">
            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
              <Trash2 className="w-12 h-12 text-orange-400" />
            </div>
            <div className="relative z-10">
              <p className="text-dark-400 text-xs font-medium mb-2">Today's Deleted</p>
              <div className="flex items-center gap-4">
                <div>
                  <p className="text-dark-500 text-[10px] font-semibold uppercase tracking-wider">Post</p>
                  <h2 className="text-2xl font-bold text-white">{todayPostsDeleted}</h2>
                </div>
                <div className="w-px h-8 bg-dark-700/60" />
                <div>
                  <p className="text-dark-500 text-[10px] font-semibold uppercase tracking-wider">Comment</p>
                  <h2 className="text-2xl font-bold text-white">{todayCommentsDeleted}</h2>
                </div>
              </div>
            </div>
          </div>

          {/* Total Deleted */}
          <div className="stat-card relative overflow-hidden group flex flex-col justify-between p-5">
            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
              <XCircle className="w-12 h-12 text-red-400" />
            </div>
            <div className="relative z-10">
              <p className="text-dark-400 text-xs font-medium mb-1">Total Deleted</p>
              <h2 className="text-3xl font-bold text-white">{totalDeleted}</h2>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

