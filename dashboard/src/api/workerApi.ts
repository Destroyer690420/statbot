import axios from 'axios';

export const WORKER_TOKEN_KEY = 'rtm_worker_token';
export const WORKER_LAST_TICKET_KEY = 'rtm_worker_last_ticket';

const workerApi = axios.create({
  baseURL: '/api/v1/worker',
  headers: { 'Content-Type': 'application/json' },
});

workerApi.interceptors.request.use((config) => {
  const token = localStorage.getItem(WORKER_TOKEN_KEY);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// A 401 clears ONLY the worker token and goes to /worker/login.
// It must never touch the admin `rtm_token` or redirect to /login.
workerApi.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem(WORKER_TOKEN_KEY);
      if (!window.location.pathname.startsWith('/worker/login')) {
        window.location.href = '/worker/login';
      }
    }
    return Promise.reject(error);
  },
);

export async function getWorkerStatus() {
  const { data } = await workerApi.get('/auth/status');
  return data;
}

export async function getWorkerTickets(q: string) {
  const { data } = await workerApi.get('/auth/tickets', { params: { q } });
  return data;
}

export async function requestWorkerCode(channelId: string) {
  const { data } = await workerApi.post('/auth/request-code', { channelId });
  return data;
}

export async function verifyWorkerCode(channelId: string, code: string) {
  const { data } = await workerApi.post('/auth/verify-code', { channelId, code });
  return data;
}

/** Ticket-less inviter login: the bot DMs a one-time code to this account. */
export async function requestInviterCode(username: string) {
  const { data } = await workerApi.post('/auth/inviter/request-code', { username });
  return data;
}

export async function verifyInviterCode(username: string, code: string) {
  const { data } = await workerApi.post('/auth/inviter/verify-code', { username, code });
  return data;
}

export async function logoutWorker() {
  const { data } = await workerApi.post('/auth/logout');
  return data;
}

export async function getWorkerMe() {
  const { data } = await workerApi.get('/me');
  return data;
}

export async function getWorkerHome() {
  const { data } = await workerApi.get('/home');
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

export async function getWorkerWallet() {
  const { data } = await workerApi.get('/wallet');
  return data;
}

export async function getWorkerInvites() {
  const { data } = await workerApi.get('/invites');
  return data;
}

/** Ask the server for a Discord DM link with an invited person (by opaque ref). */
export async function getInviteeDmUrl(ref: string) {
  const { data } = await workerApi.post('/invites/dm', { ref });
  return data;
}

export function workerErrorMessage(err: unknown, fallback: string): string {
  const anyErr = err as { response?: { status?: number; data?: { message?: string } } };
  const msg = anyErr?.response?.data?.message;
  if (typeof msg === 'string' && msg) return msg;
  return fallback;
}

export default workerApi;
