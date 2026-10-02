import { ReactNode, useState, useRef, useEffect } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { LayoutDashboard, ListTodo, Inbox, BarChart3, Archive, Settings, Wallet, LogOut, Menu, Download, UserPlus, Users, Bot } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';

export function Layout({ children }: { children: ReactNode }) {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showHeader, setShowHeader] = useState(true);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showInstallBtn, setShowInstallBtn] = useState(false);
  const mainRef = useRef<HTMLDivElement>(null);
  const lastScrollY = useRef(0);

  useEffect(() => {
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowInstallBtn(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setShowInstallBtn(false);
    }
    setDeferredPrompt(null);
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const currentScrollY = e.currentTarget.scrollTop;
    const diff = currentScrollY - lastScrollY.current;

    if (Math.abs(diff) < 5) return;

    if (currentScrollY <= 10) {
      setShowHeader(true);
    } else if (diff > 0 && currentScrollY > 60) {
      setShowHeader(false);
    } else if (diff < 0) {
      setShowHeader(true);
    }

    lastScrollY.current = currentScrollY;
  };

  useEffect(() => {
    setShowHeader(true);
    if (mainRef.current) {
      mainRef.current.scrollTop = 0;
    }
  }, [location.pathname]);

  const navItems = [
    { name: 'Dashboard', path: '/', icon: LayoutDashboard },
    { name: 'Accepted', path: '/accepted', icon: Inbox },
    { name: 'Daily Outreach', path: '/outreach', icon: Users },
    { name: 'Automation', path: '/automation', icon: Bot },
    { name: 'Tasks', path: '/tasks', icon: ListTodo },
    { name: 'Analytics', path: '/analytics', icon: BarChart3 },
    { name: 'Archives', path: '/archives', icon: Archive },
    { name: 'Payout', path: '/payout', icon: Wallet },
    { name: 'Referrals', path: '/referrals', icon: UserPlus },
    { name: 'Settings', path: '/settings', icon: Settings },
  ];

  const getPageTitle = (pathname: string) => {
    if (pathname === '/') return 'Dashboard';
    if (pathname.startsWith('/tasks')) return 'Tasks';
    if (pathname.startsWith('/accepted')) return 'Accepted Tasks';
    if (pathname.startsWith('/outreach')) return 'Daily Outreach';
    if (pathname.startsWith('/automation')) return 'Automation';
    if (pathname.startsWith('/analytics')) return 'Analytics';
    if (pathname.startsWith('/archives')) return 'Archives';
    if (pathname.startsWith('/payout')) return 'Payout';
    if (pathname.startsWith('/referrals')) return 'Referrals';
    if (pathname.startsWith('/owner-earnings')) return 'Owner Earnings';
    if (pathname.startsWith('/settings')) return 'Settings';
    return 'Task Manager';
  };

  const pageTitle = getPageTitle(location.pathname);

  return (
    <div className="flex h-screen bg-dark-950 overflow-hidden">
      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/65 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-30 w-60 bg-background-secondary border-r border-appborder-subtle transform transition-transform duration-150 lg:translate-x-0 lg:static lg:inset-0 flex flex-col ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="flex items-center gap-2.5 h-16 border-b border-appborder-subtle px-5">
          <img src="/logo.png" alt="Logo" className="w-7 h-7 object-contain rounded-md" />
          <h1 className="text-[15px] font-semibold text-text-primary tracking-tight">
            Task Manager
          </h1>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
          {navItems.map((item) => (
            <NavLink
              key={item.name}
              to={item.path}
              className={({ isActive }) =>
                `relative flex items-center px-3 py-2 rounded-md text-[13px] transition-colors duration-150 ${isActive
                  ? 'text-text-primary font-medium'
                  : 'text-text-secondary hover:bg-surface hover:text-text-primary font-normal'
                }`
              }
              style={({ isActive }) =>
                isActive ? { background: 'rgba(108, 140, 255, 0.12)' } : undefined
              }
              onClick={() => setSidebarOpen(false)}
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <span
                      className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-full"
                      style={{ background: '#6C8CFF' }}
                    />
                  )}
                  <item.icon className="w-4 h-4 mr-2.5 shrink-0" strokeWidth={2} />
                  <span className="truncate">{item.name}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="p-3 border-t border-appborder-subtle">
          <button
            onClick={handleLogout}
            className="flex items-center w-full px-3 py-2 text-[13px] rounded-md transition-colors duration-150 hover:bg-surface"
            style={{ color: '#D66B72' }}
          >
            <LogOut className="w-4 h-4 mr-2.5" strokeWidth={2} />
            <span className="font-medium">Logout</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex flex-col flex-1 overflow-hidden w-full min-w-0 relative">
        <header
          className={`bg-background-secondary/95 backdrop-blur border-b border-appborder-subtle z-10 flex items-center justify-between transition-transform duration-150 fixed top-0 left-0 right-0 h-14 px-4 ${showHeader ? 'translate-y-0' : '-translate-y-full'
            } lg:static lg:translate-y-0 lg:h-16 lg:px-8`}
        >
          <div className="flex items-center space-x-3 min-w-0">
            <button
              className="lg:hidden text-text-secondary hover:text-text-primary p-1.5 rounded-md hover:bg-surface transition-colors"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open navigation"
            >
              <Menu className="w-5 h-5" />
            </button>
            <span className="text-base font-semibold text-text-primary tracking-tight truncate">
              {pageTitle}
            </span>
          </div>

          <div className="flex items-center space-x-3 ml-auto">
            {showInstallBtn && (
              <button
                onClick={handleInstallClick}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
                style={{
                  background: 'rgba(108, 140, 255, 0.12)',
                  color: '#F2F4F7',
                  border: '1px solid rgba(108, 140, 255, 0.30)',
                }}
                title="Install App"
              >
                <Download className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Install App</span>
              </button>
            )}
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-text-primary font-semibold text-[13px]"
              style={{ background: '#222832', border: '1px solid #272D35' }}
            >
              A
            </div>
          </div>
        </header>

        <main
          ref={mainRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto p-4 pt-20 sm:p-6 sm:pt-24 lg:p-8 lg:pt-8"
        >
          <div className="max-w-[1200px] mx-auto w-full">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
