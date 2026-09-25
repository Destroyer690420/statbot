import { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useWorkerAuth } from '../hooks/useWorkerAuth';

export function WorkerProtectedRoute({ children }: { children: ReactNode }) {
  const { token, isLoading } = useWorkerAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-worker-bg">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-worker-border border-t-worker-accent" aria-label="Loading worker panel" />
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
