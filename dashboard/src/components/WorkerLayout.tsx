import { useEffect, useRef, useState } from 'react';
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { BookOpen, Hash, Home, Layers, ListTodo, LogOut, Menu, User, UserPlus, Wallet, X } from 'lucide-react';
import { useWorkerAuth } from '../hooks/useWorkerAuth';

const TABS = [
  { to: '/worker', label: 'Home', icon: Home, end: true, needs: 'tasks' },
  { to: '/worker/tasks', label: 'Tasks', icon: ListTodo, end: false, needs: 'tasks' },
  { to: '/worker/wallet', label: 'Wallet', icon: Wallet, end: false, needs: 'tasks' },
  { to: '/worker/invites', label: 'Invites', icon: UserPlus, end: false, needs: 'invites' },
  { to: '/worker/how-to', label: 'How-to', icon: BookOpen, end: false, needs: null },
] as const;

const PAGE_TITLES: Record<string, string> = {
  '/worker': 'Home',
  '/worker/tasks': 'Tasks',
  '/worker/wallet': 'Wallet',
  '/worker/invites': 'Invites',
  '/worker/how-to': 'How-to',
};

function pageTitleFor(pathname: string): string {
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname];
  if (pathname.startsWith('/worker/tasks/')) return 'Task details';
  return 'Home';
}

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

function WorkerNavLink({
  to,
  label,
  icon: Icon,
  end,
  onNavigate,
}: {
  to: string;
  label: string;
  icon: typeof Home;
  end: boolean;
  onNavigate: () => void;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onNavigate}
      className={({ isActive }) =>
        `group relative flex min-h-[48px] items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-worker-accent ${
          isActive
            ? 'bg-worker-accent/10 text-worker-text'
            : 'text-worker-text-muted hover:bg-worker-surface-2 hover:text-worker-text'
        }`
      }
    >
      {({ isActive }) => (
        <>
          <span
            className={`absolute inset-y-2 left-0 w-0.5 rounded-full ${isActive ? 'bg-worker-accent opacity-100' : 'opacity-0'}`}
            aria-hidden="true"
          />
          <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
          <span>{label}</span>
        </>
      )}
    </NavLink>
  );
}

export function WorkerLayout() {
  useNoIndex();
  const { workerName, ticket, logout, capabilities } = useWorkerAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const pageTitle = pageTitleFor(location.pathname);

  // A pure inviter has no tasks at all, so the work tabs would be permanently
  // empty for them: show only what this account can actually use. While
  // capabilities are still loading, show everything to avoid a nav flicker.
  const tabs = TABS.filter((tab) => {
    if (!capabilities) return true;
    if (tab.needs === 'tasks') return capabilities.hasTasks;
    if (tab.needs === 'invites') return capabilities.hasInvites;
    return true;
  });
  const isPureInviter = capabilities !== null && !capabilities.hasTasks && capabilities.hasInvites;

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleKeyDown);
    closeButtonRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

  // Land a ticket-less inviter straight on the invites dashboard.
  if (isPureInviter && location.pathname === '/worker') {
    return <Navigate to="/worker/invites" replace />;
  }

  const handleLogout = async () => {
    setMenuOpen(false);
    await logout();
    navigate('/worker/login', { replace: true });
  };

  return (
    <div className="min-h-screen bg-worker-bg text-worker-text">
      <header className="sticky top-0 z-30 border-b border-worker-border bg-worker-bg/95 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
          <p className="min-w-0 truncate font-display text-lg font-bold tracking-tight text-worker-text">{pageTitle}</p>
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            className="worker-icon-button -mr-2"
            aria-label="Open menu"
            aria-expanded={menuOpen}
            aria-controls="worker-menu"
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 pb-12 pt-4 sm:px-6 sm:pt-6 lg:px-8 lg:pt-8">
        <div key={location.pathname} className="worker-route-fade">
          <Outlet />
        </div>
      </main>

      {menuOpen ? (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Worker menu">
          <div
            className="worker-backdrop absolute inset-0 bg-black/60"
            onClick={() => setMenuOpen(false)}
            aria-hidden="true"
          />
          <aside
            id="worker-menu"
            className="worker-drawer absolute inset-y-0 right-0 flex w-80 max-w-[85vw] flex-col border-l border-worker-border bg-worker-surface shadow-pop"
          >
            <div className="flex items-center justify-between gap-3 border-b border-worker-border px-4 py-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-worker-accent/15 text-worker-accent">
                  <Layers className="h-4 w-4" aria-hidden="true" />
                </span>
                <p className="min-w-0 truncate font-display text-base font-bold text-worker-text">Reddit Tasks</p>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={() => setMenuOpen(false)}
                className="worker-icon-button -mr-1"
                aria-label="Close menu"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4" aria-label="Worker navigation">
              {tabs.map((tab) => (
                <WorkerNavLink key={tab.to} {...tab} onNavigate={() => setMenuOpen(false)} />
              ))}
            </nav>

            <div className="space-y-3 border-t border-worker-border p-4">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-worker-border bg-worker-surface-2 text-worker-text-muted">
                  <User className="h-5 w-5" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-worker-text">{workerName || 'Worker'}</p>
                  <p className="mt-0.5 text-xs text-worker-text-muted">Signed in</p>
                </div>
              </div>
              {ticket?.discordUrl ? (
                <a
                  href={ticket.discordUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setMenuOpen(false)}
                  className="worker-secondary-button w-full"
                >
                  <Hash className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="truncate">{ticket.channelName || 'Open ticket'}</span>
                </a>
              ) : null}
              <button type="button" onClick={handleLogout} className="worker-ghost-button w-full justify-start text-worker-text-muted">
                <LogOut className="h-4 w-4" aria-hidden="true" />
                Logout
              </button>
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
