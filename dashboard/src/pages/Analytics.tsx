import { useQuery } from '@tanstack/react-query';
import { getStats, getDailyStats, getTypeDistribution, getEmployeePerformance } from '../api/client';
import { Loader2 } from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, PieChart, Pie, Cell, Legend,
} from 'recharts';

const COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

export function Analytics() {
  const { data: statsData, isLoading: statsLoading } = useQuery({
    queryKey: ['stats'],
    queryFn: getStats,
  });

  const { data: dailyData, isLoading: dailyLoading } = useQuery({
    queryKey: ['daily-stats'],
    queryFn: () => getDailyStats(30),
  });

  const { data: typesData, isLoading: typesLoading } = useQuery({
    queryKey: ['type-distribution'],
    queryFn: getTypeDistribution,
  });

  const { data: empData, isLoading: empLoading } = useQuery({
    queryKey: ['employee-performance'],
    queryFn: getEmployeePerformance,
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
  const typeDist = typesData?.data || [];
  const employees = empData?.data || [];

  const statCards = [
    { title: 'Tasks Today', value: stats.tasksToday || 0 },
    { title: 'Tasks This Week', value: stats.tasksThisWeek || 0 },
    { title: 'Tasks This Month', value: daily.filter((_: any, i: number) => i >= daily.length - 30).reduce((s: number, d: any) => s + d.count, 0) || 0 },
    { title: 'Completion %', value: `${stats.completionRate || 0}%` },
    { title: 'Avg Completion', value: `${stats.avgCompletionTimeHours || 0}h` },
    { title: 'Overdue', value: stats.overdue || 0 },
    { title: 'Cancelled', value: stats.cancelled || 0 },
  ];

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Stats Cards */}

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
        {statCards.map((card, i) => (
          <div key={i} className="stat-card">
            <p className="text-dark-400 text-xs font-medium mb-1">{card.title}</p>
            <h3 className="text-2xl font-bold text-white">{card.value}</h3>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Tasks Per Day */}
        <div className="glass-card p-6">
          <h3 className="text-lg font-semibold text-white mb-6">Tasks Per Day (Last 30 Days)</h3>
          {dailyLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-6 h-6 text-primary-500 animate-spin" />
            </div>
          ) : daily.length === 0 ? (
            <p className="text-dark-400 text-center py-12">No data available yet.</p>
          ) : (
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={daily}>
                  <defs>
                    <linearGradient id="colorDaily" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="date" stroke="#64748b" tick={{fill: '#64748b', fontSize: 12}} axisLine={false} tickLine={false} />
                  <YAxis stroke="#64748b" tick={{fill: '#64748b'}} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '12px' }} />
                  <Area type="monotone" dataKey="count" stroke="#6366f1" strokeWidth={2} fillOpacity={1} fill="url(#colorDaily)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Task Type Distribution */}
        <div className="glass-card p-6">
          <h3 className="text-lg font-semibold text-white mb-6">Task Type Distribution</h3>
          {typesLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-6 h-6 text-primary-500 animate-spin" />
            </div>
          ) : typeDist.length === 0 ? (
            <p className="text-dark-400 text-center py-12">No data available yet.</p>
          ) : (
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={typeDist}
                    cx="50%"
                    cy="50%"
                    outerRadius={100}
                    dataKey="count"
                    nameKey="type"
                    label={({ type, count }: any) => `${type}: ${count}`}
                  >
                    {typeDist.map((_: any, i: number) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '12px' }} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Employee Performance */}
        <div className="lg:col-span-2 glass-card p-6">
          <h3 className="text-lg font-semibold text-white mb-6">Employee Performance</h3>
          {empLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-6 h-6 text-primary-500 animate-spin" />
            </div>
          ) : employees.length === 0 ? (
            <p className="text-dark-400 text-center py-12">No employee data available yet.</p>
          ) : (
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={employees}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="userId" stroke="#64748b" tick={{fill: '#64748b', fontSize: 12}} axisLine={false} tickLine={false} />
                  <YAxis stroke="#64748b" tick={{fill: '#64748b'}} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '12px' }} />
                  <Legend />
                  <Bar dataKey="total" name="Total Tasks" fill="#6366f1" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="completed" name="Completed" fill="#22c55e" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="pending" name="Pending" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
