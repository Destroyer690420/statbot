import { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useWorkerAuth } from '../hooks/useWorkerAuth';

export function WorkerProtectedRoute({ children }: { children: ReactNode }) {
  const { token, isLoading } = useWorkerAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-dark-950 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500"></div>
      </div>
    );
  }

  // NOTE: this gate checks the WORKER token only. An admin `rtm_token`
  // never opens worker pages (the worker API rejects it with 401).
  if (!token) {
    return <Navigate to="/worker/login" replace />;
  }

  return <>{children}</>;
}
