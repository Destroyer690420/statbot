import { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useWorkerAuth } from '../hooks/useWorkerAuth';

export function WorkerProtectedRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useWorkerAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-dark-950 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/worker-login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}
