import axios from 'axios';

const workerApi = axios.create({
  baseURL: '/api/v1/worker',
  headers: { 'Content-Type': 'application/json' },
});

workerApi.interceptors.request.use((config) => {
  const token = localStorage.getItem('rtm_worker_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

workerApi.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && !error.config?.url?.includes('/verify-code')) {
      localStorage.removeItem('rtm_worker_token');
      if (window.location.pathname.startsWith('/worker') && window.location.pathname !== '/worker-login') {
        window.location.href = '/worker-login';
      }
    }
    return Promise.reject(error);
  },
);

export async function getWorkerTickets() {
  const { data } = await workerApi.get('/tickets');
  return data;
}

export async function requestWorkerCode(ticket: string) {
  const { data } = await workerApi.post('/request-code', { ticket });
  return data;
}

export async function verifyWorkerCode(ticket: string, code: string) {
  const { data } = await workerApi.post('/verify-code', { ticket, code });
  return data;
}

export async function getWorkerMe() {
  const { data } = await workerApi.get('/me');
  return data;
}

export async function getWorkerTasks(params?: Record<string, string | number>) {
  const { data } = await workerApi.get('/tasks', { params });
  return data;
}

export async function getWorkerTask(id: string) {
  const { data } = await workerApi.get(`/tasks/${encodeURIComponent(id)}`);
  return data;
}

export default workerApi;
