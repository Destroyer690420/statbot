import axios from 'axios';

const api = axios.create({
  baseURL: '/api/v1',
  headers: { 'Content-Type': 'application/json' },
});

// Attach JWT token to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('rtm_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle 401 responses (auto logout)
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('rtm_token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  },
);

// ─── Auth ────────────────────────────────────────────────────

export async function login(username: string, password: string) {
  const { data } = await api.post('/auth/login', { username, password });
  return data;
}

// ─── Tasks ───────────────────────────────────────────────────

export async function getTasks(params?: Record<string, string>) {
  const { data } = await api.get('/tasks', { params });
  return data;
}

export async function getTask(id: string) {
  const { data } = await api.get(`/tasks/${encodeURIComponent(id)}`);
  return data;
}

export async function deleteTask(id: string) {
  const { data } = await api.delete(`/tasks/${encodeURIComponent(id)}`);
  return data;
}

export async function updateTask(id: string, body: Record<string, unknown>) {
  const { data } = await api.patch(`/tasks/${encodeURIComponent(id)}`, body);
  return data;
}

export async function getReminders(taskId: string) {
  const { data } = await api.get(`/tasks/${encodeURIComponent(taskId)}/reminders`);
  return data;
}

export async function getUpcomingReminders(limit = 10) {
  const { data } = await api.get('/reminders/upcoming', { params: { limit } });
  return data;
}

// ─── Stats ───────────────────────────────────────────────────

export async function getStats() {
  const { data } = await api.get('/stats');
  return data;
}

export async function getDailyStats(days = 30) {
  const { data } = await api.get('/stats/daily', { params: { days } });
  return data;
}

export async function getTypeDistribution() {
  const { data } = await api.get('/stats/types');
  return data;
}

export async function getEmployeePerformance() {
  const { data } = await api.get('/stats/employees');
  return data;
}

// ─── Export ──────────────────────────────────────────────────

export function getExportCsvUrl(params?: Record<string, string>): string {
  const searchParams = new URLSearchParams(params || {});
  return `/api/v1/export/csv?${searchParams}`;
}

export async function downloadCsv(params?: Record<string, string>): Promise<void> {
  const { data, headers } = await api.get('/export/csv', {
    params,
    responseType: 'blob',
  });
  const contentDisposition = headers['content-disposition'] || '';
  const filenameMatch = contentDisposition.match(/filename="?(.+?)"?$/);
  const filename = filenameMatch?.[1] || `tasks-export-${Date.now()}.csv`;

  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Health ──────────────────────────────────────────────────

export async function getHealth() {
  const { data } = await api.get('/health');
  return data;
}

export default api;
