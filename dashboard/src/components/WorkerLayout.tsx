import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { BookOpen, Home, ListTodo, LogOut, Menu, UserPlus, Wallet } from 'lucide-react';
import { useWorkerAuth } from '../hooks/useWorkerAuth';

const TABS = [
  { to: '/worker', label: 'Home', icon: Home, end: true, needs: 'home' },
  { to: '/worker/tasks', label: 'Tasks', icon: ListTodo, end: false, needs: 'tasks' },
  { to: '/worker/wallet', label: 'Wallet', icon: Wallet, end: false, needs: 'wallet' },
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
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (PAGE_TITLES[path]) return PAGE_TITLES[path];
  if (path.startsWith('/worker/tasks/')) return 'Task details';
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
        `flex min-h-[42px] items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-worker-accent ${
          isActive
            ? 'bg-worker-accent/10 text-worker-text'
            : 'text-worker-text-muted hover:bg-worker-surface-2 hover:text-worker-text'
        }`
      }
    >
      {({ isActive }) => (
        <>
          <Icon className={`h-[18px] w-[18px] shrink-0 ${isActive ? 'text-worker-accent' : 'text-worker-text-faint'}`} aria-hidden="true" />
          <span>{label}</span>
        </>
      )}
    </NavLink>
  );
}

export function WorkerLayout() {
  useNoIndex();
  const { logout, capabilities } = useWorkerAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const drawerRef = useRef<HTMLElement>(null);
  const pageTitle = pageTitleFor(location.pathname);

  // While capabilities are loading, show everything to avoid a nav flicker.
  // Once resolved: a pure inviter (no tasks) would lose the index-tab unless
  // Home is reachable without `needs: 'tasks'` — so Home needs 'home':
  // everyone sees it at /worker, with the index route rendering the inviter
  // Home for pure inviters and WorkerHome for everyone else. Wallet is shared
  // by both worlds (the wallet route picks the task or inviter wallet), so it
  // shows for anyone with tasks, invites or a team. For a pure inviter the
  // visible order is Home, Wallet, Invites, How-to.
  const tabs = capabilities === null
    ? TABS
    : TABS.filter((tab) => {
        if ((tab as { needs: string }).needs === 'home') return true;
        if (tab.needs === 'tasks') return capabilities.hasTasks;
        if (tab.needs === 'wallet') return capabilities.hasTasks || capabilities.hasInvites || capabilities.hasTeam;
        if (tab.needs === 'invites') return capabilities.hasInvites || capabilities.hasTeam;
        return true;
      });

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
    drawerRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

  const handleLogout = async () => {
    setMenuOpen(false);
    await logout();
    navigate('/worker/login', { replace: true });
  };

  return (
    <div className="min-h-screen bg-worker-bg text-worker-text">
      <header className="sticky top-0 z-30 border-b border-worker-border bg-worker-bg/95 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-2 px-4 sm:px-6 lg:px-8">
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            className="worker-icon-button -ml-2"
            aria-label="Open menu"
            aria-expanded={menuOpen}
            aria-controls="worker-menu"
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>
          <p className="min-w-0 truncate font-display text-lg font-bold tracking-tight text-worker-text">{pageTitle}</p>
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
            ref={drawerRef}
            tabIndex={-1}
            className="worker-drawer absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r border-worker-border bg-worker-surface outline-none"
          >
            <div className="flex h-16 items-center gap-2.5 px-5">
              <img
                src="https://statbot.duckdns.org/logo.png"
                alt=""
                className="h-7 w-7 shrink-0 rounded-full object-contain"
              />
              <p className="min-w-0 truncate font-display text-[15px] font-semibold text-worker-text">Reddit Tasks</p>
            </div>

            <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2" aria-label="Worker navigation">
              {tabs.map((tab) => (
                <WorkerNavLink key={tab.to} {...tab} onNavigate={() => setMenuOpen(false)} />
              ))}
            </nav>

            <div className="border-t border-worker-border p-3">
              <button
                type="button"
                onClick={handleLogout}
                className="flex min-h-[42px] w-full items-center gap-3 rounded-lg px-3 text-sm font-medium text-worker-danger transition-colors duration-150 hover:bg-worker-danger/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-worker-accent"
              >
                <LogOut className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
                Logout
              </button>
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
