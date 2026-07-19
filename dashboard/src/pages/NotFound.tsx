import { Link } from 'react-router-dom';
import { Home } from 'lucide-react';

export function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-dark-900">
      <div className="text-center space-y-6">
        <h1 className="text-8xl font-bold text-primary-500">404</h1>
        <h2 className="text-2xl font-semibold text-white">Page Not Found</h2>
        <p className="text-dark-400 max-w-md">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <Link
          to="/"
          className="btn-primary inline-flex items-center gap-2 px-6 py-3"
        >
          <Home className="w-4 h-4" />
          Back to Dashboard
        </Link>
      </div>
    </div>
  );
}
