import { ReactNode, useState, useRef, useEffect } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { LayoutDashboard, ListTodo, BarChart3, History, Archive, Settings, LogOut, Menu } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';

export function Layout({ children }: { children: ReactNode }) {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showHeader, setShowHeader] = useState(true);
  const mainRef = useRef<HTMLDivElement>(null);
  const lastScrollY = useRef(0);

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
    { name: 'Tasks', path: '/tasks', icon: ListTodo },
    { name: 'Analytics', path: '/analytics', icon: BarChart3 },
    { name: 'Activity', path: '/activity', icon: History },
    { name: 'Archives', path: '/archives', icon: Archive },
    { name: 'Settings', path: '/settings', icon: Settings },
  ];

  const getPageTitle = (pathname: string) => {
    if (pathname === '/') return 'Dashboard';
    if (pathname.startsWith('/tasks')) return 'Tasks';
    if (pathname.startsWith('/analytics')) return 'Analytics';
    if (pathname.startsWith('/activity')) return 'Activity';
    if (pathname.startsWith('/archives')) return 'Archives';
    if (pathname.startsWith('/settings')) return 'Settings';
    return 'Task Manager';
  };

  const pageTitle = getPageTitle(location.pathname);

  return (
    <div className="flex h-screen bg-dark-950 overflow-hidden">
      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 z-20 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside 
        className={`fixed inset-y-0 left-0 z-30 w-64 glass-card border-l-0 border-y-0 rounded-none transform transition-transform duration-300 lg:translate-x-0 lg:static lg:inset-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="flex items-center justify-center h-20 border-b border-dark-700/50">
          <h1 className="text-xl font-bold bg-gradient-to-r from-primary-400 to-primary-600 bg-clip-text text-transparent">
            Task Manager
          </h1>
        </div>

        <div className="flex flex-col flex-1 overflow-y-auto">
          <nav className="flex-1 px-4 py-6 space-y-2">
            {navItems.map((item) => (
              <NavLink
                key={item.name}
                to={item.path}
                className={({ isActive }) =>
                  `flex items-center px-4 py-3 rounded-xl transition-all duration-200 ${
                    isActive
                      ? 'bg-primary-600/10 text-primary-400 border border-primary-500/20'
                      : 'text-dark-400 hover:bg-dark-800 hover:text-dark-100'
                  }`
                }
                onClick={() => setSidebarOpen(false)}
              >
                <item.icon className="w-5 h-5 mr-3" />
                <span className="font-medium">{item.name}</span>
              </NavLink>
            ))}
          </nav>

          <div className="p-4 border-t border-dark-700/50">
            <button
              onClick={handleLogout}
              className="flex items-center w-full px-4 py-3 text-red-400 rounded-xl hover:bg-red-500/10 hover:border-red-500/20 border border-transparent transition-all duration-200"
            >
              <LogOut className="w-5 h-5 mr-3" />
              <span className="font-medium">Logout</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex flex-col flex-1 overflow-hidden w-full relative">
        <header 
          className={`fixed top-0 left-0 right-0 h-14 px-4 bg-dark-900/90 backdrop-blur-md border-b border-dark-800/80 shadow-md shadow-black/30 z-10 flex items-center justify-between transition-transform duration-300 ${
            showHeader ? 'translate-y-0' : '-translate-y-full'
          } lg:static lg:translate-y-0 lg:h-20 lg:px-6 lg:glass-card lg:border-r-0 lg:border-t-0 lg:rounded-none lg:shadow-none`}
        >
          <div className="flex items-center space-x-3">
            <button 
              className="lg:hidden text-dark-300 hover:text-white p-1 rounded-lg hover:bg-dark-800 transition-colors"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu className="w-5 h-5" />
            </button>
            <span className="text-base sm:text-lg font-bold bg-gradient-to-r from-primary-400 to-primary-600 bg-clip-text text-transparent">
              {pageTitle}
            </span>
          </div>

          <div className="flex items-center space-x-4 ml-auto">
            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-primary-600 to-primary-400 flex items-center justify-center text-white font-bold text-sm shadow-lg shadow-primary-500/20">
              A
            </div>
          </div>
        </header>

        <main 
          ref={mainRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto p-4 pt-20 sm:p-6 sm:pt-24 lg:p-8"
        >
          {children}
        </main>
      </div>
    </div>
  );
}

