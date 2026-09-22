import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { verifyWorkerCode as apiVerify } from '../api/worker';

interface WorkerIdentity {
  channelId: string;
  channelName: string | null;
  workerName: string | null;
}

interface WorkerAuthContextType {
  isAuthenticated: boolean;
  isLoading: boolean;
  identity: WorkerIdentity | null;
  login: (ticket: string, code: string) => Promise<void>;
  logout: () => void;
}

const WorkerAuthContext = createContext<WorkerAuthContextType | null>(null);

function readIdentity(): WorkerIdentity | null {
  try {
    const raw = localStorage.getItem('rtm_worker_identity');
    return raw ? (JSON.parse(raw) as WorkerIdentity) : null;
  } catch {
    return null;
  }
}

export function WorkerAuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [identity, setIdentity] = useState<WorkerIdentity | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('rtm_worker_token');
    setIsAuthenticated(!!token);
    setIdentity(readIdentity());
    setIsLoading(false);
  }, []);

  const login = async (ticket: string, code: string) => {
    const response = await apiVerify(ticket, code);
    if (response.success && response.data?.token) {
      localStorage.setItem('rtm_worker_token', response.data.token);
      const id: WorkerIdentity = {
        channelId: response.data.channelId,
        channelName: response.data.channelName ?? null,
        workerName: response.data.workerName ?? null,
      };
      localStorage.setItem('rtm_worker_identity', JSON.stringify(id));
      setIdentity(id);
      setIsAuthenticated(true);
    } else {
      throw new Error(response.message || 'Verification failed');
    }
  };

  const logout = () => {
    localStorage.removeItem('rtm_worker_token');
    localStorage.removeItem('rtm_worker_identity');
    setIdentity(null);
    setIsAuthenticated(false);
  };

  return (
    <WorkerAuthContext.Provider value={{ isAuthenticated, isLoading, identity, login, logout }}>
      {children}
    </WorkerAuthContext.Provider>
  );
}

export function useWorkerAuth() {
  const context = useContext(WorkerAuthContext);
  if (!context) throw new Error('useWorkerAuth must be used within WorkerAuthProvider');
  return context;
}
