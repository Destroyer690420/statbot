import { useQuery } from '@tanstack/react-query';
import { getStats, getDailyStats, getTypeDistribution, getEmployeePerformance } from '../api/client';
import { Loader2 } from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, PieChart, Pie, Cell, Legend,
} from 'recharts';

const COLORS = ['#6C8CFF', '#4CAF82', '#D6A85A', '#D66B72', '#829EFF', '#98A1AD'];

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
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
        {statCards.map((card, i) => (
          <div key={i} className="stat-card">
            <p className="text-text-secondary text-xs font-medium mb-1">{card.title}</p>
            <h3 className="text-2xl font-semibold text-text-primary tabular-nums">{card.value}</h3>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Tasks Per Day */}
        <div className="glass-card p-5">
          <div className="flex items-baseline justify-between mb-4">
            <h3 className="text-[16px] font-semibold text-text-primary">Tasks per day</h3>
            <span className="text-xs text-text-muted">Last 30 days</span>
          </div>
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
                      <stop offset="5%" stopColor="#6C8CFF" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#6C8CFF" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#20252C" vertical={false} />
                  <XAxis dataKey="date" stroke="#66707C" tick={{fill: '#66707C', fontSize: 12}} axisLine={false} tickLine={false} />
                  <YAxis stroke="#66707C" tick={{fill: '#66707C'}} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ backgroundColor: '#111418', borderColor: '#272D35', borderRadius: '12px' }} />
                  <Area type="monotone" dataKey="count" stroke="#6C8CFF" strokeWidth={2} fillOpacity={1} fill="url(#colorDaily)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Task Type Distribution */}
        <div className="glass-card p-5">
          <h3 className="text-[16px] font-semibold text-text-primary mb-4">Task type distribution</h3>
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
                  <Tooltip contentStyle={{ backgroundColor: '#111418', borderColor: '#272D35', borderRadius: '12px' }} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Employee Performance */}
        <div className="lg:col-span-2 glass-card p-5">
          <h3 className="text-[16px] font-semibold text-text-primary mb-4">Employee performance</h3>
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
                  <CartesianGrid strokeDasharray="3 3" stroke="#20252C" vertical={false} />
                  <XAxis dataKey="userId" stroke="#66707C" tick={{fill: '#66707C', fontSize: 12}} axisLine={false} tickLine={false} />
                  <YAxis stroke="#66707C" tick={{fill: '#66707C'}} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ backgroundColor: '#111418', borderColor: '#272D35', borderRadius: '12px' }} />
                  <Legend />
                  <Bar dataKey="total" name="Total Tasks" fill="#6C8CFF" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="completed" name="Completed" fill="#4CAF82" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="pending" name="Pending" fill="#D6A85A" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
