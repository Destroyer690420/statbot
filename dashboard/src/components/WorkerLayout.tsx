import { useEffect } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Home, ListTodo, Wallet, BookOpen, LogOut, ExternalLink } from 'lucide-react';
import { useWorkerAuth } from '../hooks/useWorkerAuth';

const TABS = [
  { to: '/worker', label: 'Home', icon: Home, end: true },
  { to: '/worker/tasks', label: 'Tasks', icon: ListTodo, end: false },
  { to: '/worker/wallet', label: 'Wallet', icon: Wallet, end: false },
  { to: '/worker/how-to', label: 'How to', icon: BookOpen, end: false },
];

function useNoIndex() {
  useEffect(() => {
    let meta = document.querySelector('meta[name="robots"]') as HTMLMetaElement | null;
    const created = !meta;
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'robots');
      document.head.appendChild(meta);
    }
    const prev = meta.getAttribute('content');
    meta.setAttribute('content', 'noindex');
    return () => {
      if (created) {
        meta?.remove();
      } else if (prev !== null) {
        meta?.setAttribute('content', prev);
      }
    };
  }, []);
}

export function WorkerLayout() {
  useNoIndex();
  const { workerName, ticket, logout } = useWorkerAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/worker/login', { replace: true });
  };

  return (
    <div className="min-h-screen bg-dark-950 text-dark-100 pb-24">
      {/* Top bar */}
      <header className="sticky top-0 z-10 bg-dark-950/90 backdrop-blur border-b border-dark-800">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs text-dark-400">Worker Panel</p>
            <p className="font-semibold truncate">{workerName || 'Worker'}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {ticket?.discordUrl && (
              <a
                href={ticket.discordUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-secondary !px-3 !py-2 text-xs min-h-[44px] flex items-center gap-1"
              >
                <ExternalLink className="w-4 h-4" />
                My ticket
              </a>
            )}
            <button
              onClick={handleLogout}
              className="btn-secondary !px-3 !py-2 text-xs min-h-[44px] flex items-center gap-1"
              aria-label="Log out"
            >
              <LogOut className="w-4 h-4" />
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 pt-4">
        <Outlet />
      </main>

      {/* Bottom-tab nav (mobile-first, exactly four tabs) */}
      <nav className="fixed bottom-0 left-0 right-0 z-10 bg-dark-900/95 backdrop-blur border-t border-dark-800">
        <div className="max-w-2xl mx-auto grid grid-cols-4">
          {TABS.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex flex-col items-center justify-center gap-1 py-2.5 min-h-[64px] text-xs font-medium transition-colors ${
                  isActive ? 'text-primary-400' : 'text-dark-400 hover:text-white'
                }`
              }
            >
              <Icon className="w-5 h-5" />
              {label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
