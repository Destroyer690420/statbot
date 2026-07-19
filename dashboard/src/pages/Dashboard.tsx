import { useQuery } from '@tanstack/react-query';
import { getStats, getDailyStats, getUpcomingReminders } from '../api/client';
import { CheckCircle2, Clock, AlertCircle, ListTodo, Bot, Loader2 } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

export function Dashboard() {
  const { data: statsData, isLoading: statsLoading } = useQuery({
    queryKey: ['stats'],
    queryFn: getStats,
  });

  const { data: dailyData } = useQuery({
    queryKey: ['daily-stats-7'],
    queryFn: () => getDailyStats(7),
  });

  const { data: remindersData, isLoading: remindersLoading } = useQuery({
    queryKey: ['upcoming-reminders'],
    queryFn: () => getUpcomingReminders(5),
  });

  if (statsLoading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <Loader2 className="w-10 h-10 text-primary-500 animate-spin" />
      </div>
    );
  }

  const stats = statsData?.data || {};
  const reminders = remindersData?.data || [];
  const daily = dailyData?.data || [];

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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Dashboard Overview</h1>
          <p className="text-dark-400 mt-1">Here's what's happening with your Reddit tasks today.</p>
        </div>
      </div>

      {/* Stats Grid */}
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

        {/* Upcoming Reminders */}
        <div className="glass-card p-6 flex flex-col">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-semibold text-white">Upcoming Reminders</h3>
            <Bot className="w-5 h-5 text-primary-400" />
          </div>
          
          <div className="flex-1 overflow-y-auto pr-2 space-y-4">
            {remindersLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-6 h-6 text-primary-500 animate-spin" />
              </div>
            ) : reminders.length === 0 ? (
              <div className="text-center py-8 text-dark-400">
                <CheckCircle2 className="w-12 h-12 mx-auto mb-3 opacity-20" />
                <p>No upcoming reminders</p>
              </div>
            ) : (
              reminders.map((reminder: any) => (
                <div key={reminder.id} className="bg-dark-800/50 rounded-xl p-4 border border-dark-700/50 transition-all hover:bg-dark-800">
                  <div className="flex justify-between items-start mb-2">
                    <span className="text-xs font-semibold px-2 py-1 bg-primary-900/50 text-primary-400 rounded-lg">
                      {reminder.type.replace('_', ' ')}
                    </span>
                    <span className="text-xs text-dark-400 font-medium">
                      {new Date(reminder.dueAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="text-sm font-medium text-dark-200 font-mono truncate">{reminder.taskId}</p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
