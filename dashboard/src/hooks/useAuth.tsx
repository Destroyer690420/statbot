import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { login as apiLogin } from '../api/client';

interface AuthContextType {
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('rtm_token');
    setIsAuthenticated(!!token);
    setIsLoading(false);
  }, []);

  const login = async (username: string, password: string) => {
    const response = await apiLogin(username, password);
    if (response.success && response.data?.token) {
      localStorage.setItem('rtm_token', response.data.token);
      setIsAuthenticated(true);
    } else {
      throw new Error(response.message || 'Login failed');
    }
  };

  const logout = () => {
    localStorage.removeItem('rtm_token');
    setIsAuthenticated(false);
  };

  return (
    <AuthContext.Provider value={{ isAuthenticated, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
