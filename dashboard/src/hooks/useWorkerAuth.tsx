import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  WORKER_TOKEN_KEY,
  verifyWorkerCode,
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
  login: (channelId: string, code: string) => Promise<{ workerName: string; ticketName: string }>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;
}

const WorkerAuthContext = createContext<WorkerAuthContextType | null>(null);

export function WorkerAuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(WORKER_TOKEN_KEY));
  const [isLoading, setIsLoading] = useState(true);
  const [workerName, setWorkerName] = useState<string | null>(null);
  const [ticket, setTicket] = useState<WorkerTicket | null>(null);
  const navigate = useNavigate();

  const refreshMe = useCallback(async () => {
    const t = localStorage.getItem(WORKER_TOKEN_KEY);
    if (!t) {
      setWorkerName(null);
      setTicket(null);
      return;
    }
    const res = await getWorkerMe();
    if (res?.success && res?.data) {
      setWorkerName(res.data.name ?? null);
      setTicket(res.data.ticket ?? null);
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
    navigate('/worker/login', { replace: true });
  };

  return (
    <WorkerAuthContext.Provider value={{ token, isLoading, workerName, ticket, login, logout, refreshMe }}>
      {children}
    </WorkerAuthContext.Provider>
  );
}

export function useWorkerAuth() {
  const context = useContext(WorkerAuthContext);
  if (!context) throw new Error('useWorkerAuth must be used within WorkerAuthProvider');
  return context;
}
