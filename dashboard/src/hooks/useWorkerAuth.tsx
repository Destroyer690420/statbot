import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  WORKER_TOKEN_KEY,
  verifyWorkerCode,
  verifyInviterCode,
  logoutWorker,
  getWorkerMe,
} from '../api/workerApi';

interface WorkerTicket {
  channelId: string;
  channelName: string | null;
  discordUrl: string;
}

interface WorkerAuthContextType {
  token: string | null;
  isLoading: boolean;
  workerName: string | null;
  ticket: WorkerTicket | null;
  /** `inviter` = ticket-less login (no ticket, no tasks, invites only). */
  scope: 'ticket' | 'inviter' | null;
  /** Drives the role-aware panel: which tabs this account can actually use. */
  capabilities: { hasTasks: boolean; hasInvites: boolean } | null;
  login: (channelId: string, code: string) => Promise<{ workerName: string; ticketName: string }>;
  loginAsInviter: (username: string, code: string) => Promise<{ workerName: string }>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;
}

const WorkerAuthContext = createContext<WorkerAuthContextType | null>(null);

export function WorkerAuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(WORKER_TOKEN_KEY));
  const [isLoading, setIsLoading] = useState(true);
  const [workerName, setWorkerName] = useState<string | null>(null);
  const [ticket, setTicket] = useState<WorkerTicket | null>(null);
  const [scope, setScope] = useState<'ticket' | 'inviter' | null>(null);
  const [capabilities, setCapabilities] = useState<{ hasTasks: boolean; hasInvites: boolean } | null>(null);
  const navigate = useNavigate();

  const refreshMe = useCallback(async () => {
    const t = localStorage.getItem(WORKER_TOKEN_KEY);
    if (!t) {
      setWorkerName(null);
      setTicket(null);
      setScope(null);
      setCapabilities(null);
      return;
    }
    const res = await getWorkerMe();
    if (res?.success && res?.data) {
      setWorkerName(res.data.name ?? null);
      setTicket(res.data.ticket ?? null);
      setScope(res.data.scope ?? null);
      setCapabilities(res.data.capabilities ?? null);
    }
  }, []);

  useEffect(() => {
    const t = localStorage.getItem(WORKER_TOKEN_KEY);
    setToken(t);
    if (!t) {
      setIsLoading(false);
      return;
    }
    refreshMe()
      .catch(() => {
        // 401s are handled by the workerApi interceptor (clears + redirects).
      })
      .finally(() => setIsLoading(false));
  }, [refreshMe]);

  const login = async (channelId: string, code: string) => {
    const res = await verifyWorkerCode(channelId, code);
    if (res?.success && res?.data?.token) {
      localStorage.setItem(WORKER_TOKEN_KEY, res.data.token);
      setToken(res.data.token);
      setWorkerName(res.data.workerName ?? null);
      await refreshMe().catch(() => undefined);
      return { workerName: res.data.workerName, ticketName: res.data.ticketName };
    }
    throw new Error(res?.message || 'Verification failed');
  };

  /** Ticket-less login for people who only invite and never get a task. */
  const loginAsInviter = async (username: string, code: string) => {
    const res = await verifyInviterCode(username, code);
    if (res?.success && res?.data?.token) {
      localStorage.setItem(WORKER_TOKEN_KEY, res.data.token);
      setToken(res.data.token);
      setWorkerName(res.data.workerName ?? null);
      await refreshMe().catch(() => undefined);
      return { workerName: res.data.workerName };
    }
    throw new Error(res?.message || 'Verification failed');
  };

  const logout = async () => {
    try {
      await logoutWorker();
    } catch {
      // Best-effort: still clear the client-side token.
    }
    localStorage.removeItem(WORKER_TOKEN_KEY);
    setToken(null);
    setWorkerName(null);
    setTicket(null);
    setScope(null);
    setCapabilities(null);
    navigate('/worker/login', { replace: true });
  };

  return (
    <WorkerAuthContext.Provider
      value={{ token, isLoading, workerName, ticket, scope, capabilities, login, loginAsInviter, logout, refreshMe }}
    >
      {children}
    </WorkerAuthContext.Provider>
  );
}

export function useWorkerAuth() {
  const context = useContext(WorkerAuthContext);
  if (!context) throw new Error('useWorkerAuth must be used within WorkerAuthProvider');
  return context;
}
