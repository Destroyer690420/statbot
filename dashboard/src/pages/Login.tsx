import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

import { useAuth } from '../hooks/useAuth';

export function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const from = location.state?.from?.pathname || '/';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      await login(username, password);
      navigate(from, { replace: true });
    } catch (err: any) {
      setError(err.message || 'Failed to login');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-dark-950 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
          <div className="w-12 h-12 bg-surface border border-appborder rounded-lg flex items-center justify-center overflow-hidden p-1.5">
            <img src="/logo.png" alt="Logo" className="w-full h-full object-contain" />
          </div>
        </div>
        <h2 className="mt-5 text-center text-2xl font-semibold text-text-primary tracking-tight">
          Task Manager
        </h2>
        <p className="mt-1.5 text-center text-[13px] text-text-secondary">
          Sign in to the admin dashboard
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="glass-card py-8 px-4 sm:px-10">
          <form className="space-y-5" onSubmit={handleSubmit}>
            {error && (
              <div
                className="rounded-md px-4 py-3"
                style={{ background: 'rgba(214, 107, 114, 0.12)', border: '1px solid rgba(214, 107, 114, 0.30)' }}
              >
                <p className="text-[13px] text-center font-medium" style={{ color: '#D66B72' }}>{error}</p>
              </div>
            )}

            <div>
              <label className="block text-[13px] font-medium text-text-secondary mb-1.5">
                Username
              </label>
              <input
                type="text"
                required
                className="input-field w-full"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter your username"
              />
            </div>

            <div>
              <label className="block text-[13px] font-medium text-text-secondary mb-1.5">
                Password
              </label>
              <input
                type="password"
                required
                className="input-field w-full"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="btn-primary w-full py-2.5"
            >
              {isLoading ? (
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                'Sign in'
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
