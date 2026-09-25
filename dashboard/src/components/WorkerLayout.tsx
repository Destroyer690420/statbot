import { useEffect } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { BookOpen, ExternalLink, Hash, Home, ListTodo, LogOut, Wallet } from 'lucide-react';
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
    const previous = meta.getAttribute('content');
    meta.setAttribute('content', 'noindex');
    return () => {
      if (created) {
        meta?.remove();
      } else if (previous !== null) {
        meta?.setAttribute('content', previous);
      }
    };
  }, []);
}

function pageTitle(pathname: string) {
  if (pathname === '/worker') return 'Home';
  if (pathname.startsWith('/worker/tasks/')) return 'Task details';
  if (pathname === '/worker/tasks') return 'Tasks';
  if (pathname === '/worker/wallet') return 'Wallet';
  if (pathname === '/worker/how-to') return 'How to';
  return 'Worker panel';
}

function WorkerNavLink({
  to,
  label,
  icon: Icon,
  end,
  mobile = false,
}: {
  to: string;
  label: string;
  icon: typeof Home;
  end: boolean;
  mobile?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        mobile
          ? `relative flex min-h-[64px] flex-col items-center justify-center gap-1 px-2 py-2 text-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-worker-accent ${
              isActive ? 'text-worker-accent' : 'text-worker-text-muted hover:text-worker-text'
            }`
          : `group relative flex min-h-[48px] items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-worker-accent ${
              isActive
                ? 'bg-worker-accent/10 text-worker-text'
                : 'text-worker-text-muted hover:bg-worker-surface-2 hover:text-worker-text'
            }`
      }
    >
      {({ isActive }) => (
        <>
          <span
            className={`${mobile ? 'absolute inset-x-4 top-0 h-0.5 rounded-full' : 'absolute inset-y-2 left-0 w-0.5 rounded-full'} ${
              isActive ? 'bg-worker-accent opacity-100' : 'opacity-0'
            }`}
            aria-hidden="true"
          />
          <Icon className={mobile ? 'h-5 w-5' : 'h-[18px] w-[18px]'} aria-hidden="true" />
          <span>{label}</span>
        </>
      )}
    </NavLink>
  );
}

export function WorkerLayout() {
  useNoIndex();
  const { workerName, ticket, logout } = useWorkerAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const firstName = workerName?.trim().split(/\s+/)[0] || 'Worker';
  const currentTitle = pageTitle(location.pathname);

  const handleLogout = async () => {
    await logout();
    navigate('/worker/login', { replace: true });
  };

  return (
    <div className="min-h-screen bg-worker-bg text-worker-text">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[220px] flex-col border-r border-worker-border bg-worker-surface lg:flex">
        <div className="border-b border-worker-border px-5 py-6">
          <p className="text-xs font-medium text-worker-text-muted">Worker panel</p>
          <p className="mt-1 font-display text-lg font-bold text-worker-text">Task desk</p>
        </div>
        <nav className="flex-1 space-y-1 px-3 py-5" aria-label="Worker navigation">
          {TABS.map((tab) => (
            <WorkerNavLink key={tab.to} {...tab} />
          ))}
        </nav>
        <div className="space-y-3 border-t border-worker-border p-4">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-worker-text">{workerName || 'Worker'}</p>
            <p className="mt-0.5 text-xs text-worker-text-muted">Signed in</p>
          </div>
          {ticket?.discordUrl ? (
            <a href={ticket.discordUrl} target="_blank" rel="noopener noreferrer" className="worker-secondary-button w-full">
              <Hash className="h-4 w-4" aria-hidden="true" />
              Open ticket
            </a>
          ) : null}
          <button type="button" onClick={handleLogout} className="worker-ghost-button w-full justify-start text-worker-text-muted">
            <LogOut className="h-4 w-4" aria-hidden="true" />
            Logout
          </button>
        </div>
      </aside>

      <div className="lg:pl-[220px]">
        <header className="sticky top-0 z-30 border-b border-worker-border bg-worker-bg/95 backdrop-blur">
          <div className="mx-auto flex h-16 min-w-0 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
            <div className="flex min-w-0 items-center gap-2 lg:hidden">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-worker-text">{firstName}</p>
                <p className="truncate text-xs text-worker-text-muted">Worker panel</p>
              </div>
              {ticket?.discordUrl ? (
                <a
                  href={ticket.discordUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="worker-secondary-button min-w-0 max-w-[132px] px-2.5 text-xs"
                >
                  <Hash className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate">{ticket.channelName || 'Ticket'}</span>
                </a>
              ) : null}
            </div>
            <h1 className="hidden min-w-0 truncate font-display text-lg font-semibold text-worker-text lg:block">{currentTitle}</h1>
            <div className="ml-auto flex shrink-0 items-center gap-1">
              <button type="button" onClick={handleLogout} className="worker-icon-button lg:hidden" aria-label="Log out">
                <LogOut className="h-4 w-4" aria-hidden="true" />
              </button>
              {ticket?.discordUrl ? (
                <a href={ticket.discordUrl} target="_blank" rel="noopener noreferrer" className="worker-secondary-button hidden lg:inline-flex">
                  <ExternalLink className="h-4 w-4" aria-hidden="true" />
                  Open ticket
                </a>
              ) : null}
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl px-4 pb-28 pt-6 sm:px-6 sm:pt-8 lg:px-10 lg:pb-12 lg:pt-10">
          <div key={location.pathname} className="worker-route-fade">
            <Outlet />
          </div>
        </main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-worker-border bg-worker-surface/95 backdrop-blur lg:hidden" aria-label="Worker navigation">
        <div className="mx-auto grid max-w-2xl grid-cols-4">
          {TABS.map((tab) => (
            <WorkerNavLink key={tab.to} {...tab} mobile />
          ))}
        </div>
      </nav>
    </div>
  );
}
