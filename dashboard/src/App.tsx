import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './hooks/useAuth';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Tasks } from './pages/Tasks';
import { AcceptedTasks } from './pages/AcceptedTasks';
import { DailyOutreach } from './pages/DailyOutreach';
import { Automation } from './pages/Automation';
import { TaskDetails } from './pages/TaskDetails';
import { Analytics } from './pages/Analytics';
import { Archives } from './pages/Archives';
import { Settings } from './pages/Settings';
import { PayoutLayout } from './pages/payout/PayoutLayout';
import { TaskPayments } from './pages/payout/TaskPayments';
import { Commissions } from './pages/payout/Commissions';
import { Referrals } from './pages/Referrals';
import { OwnerEarnings } from './pages/OwnerEarnings';
import { NotFound } from './pages/NotFound';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Router>
          <Routes>
            <Route path="/login" element={<Login />} />

            <Route path="/" element={
              <ProtectedRoute>
                <Layout>
                  <Dashboard />
                </Layout>
              </ProtectedRoute>
            } />

            <Route path="/tasks" element={
              <ProtectedRoute>
                <Layout>
                  <Tasks />
                </Layout>
              </ProtectedRoute>
            } />

            <Route path="/accepted" element={
              <ProtectedRoute>
                <Layout>
                  <AcceptedTasks />
                </Layout>
              </ProtectedRoute>
            } />

            <Route path="/outreach" element={
              <ProtectedRoute>
                <Layout>
                  <DailyOutreach />
                </Layout>
              </ProtectedRoute>
            } />

            <Route path="/automation" element={
              <ProtectedRoute>
                <Layout>
                  <Automation />
                </Layout>
              </ProtectedRoute>
            } />

            <Route path="/tasks/:id" element={
              <ProtectedRoute>
                <Layout>
                  <TaskDetails />
                </Layout>
              </ProtectedRoute>
            } />

            <Route path="/analytics" element={
              <ProtectedRoute>
                <Layout>
                  <Analytics />
                </Layout>
              </ProtectedRoute>
            } />

            <Route path="/archives" element={
              <ProtectedRoute>
                <Layout>
                  <Archives />
                </Layout>
              </ProtectedRoute>
            } />

            <Route path="/settings" element={
              <ProtectedRoute>
                <Layout>
                  <Settings />
                </Layout>
              </ProtectedRoute>
            } />

            <Route path="/owner-earnings" element={
              <ProtectedRoute>
                <Layout>
                  <OwnerEarnings />
                </Layout>
              </ProtectedRoute>
            } />

            <Route path="/payout" element={
              <ProtectedRoute>
                <Layout>
                  <PayoutLayout />
                </Layout>
              </ProtectedRoute>
            }>
              <Route index element={<TaskPayments />} />
              <Route path="tasks" element={<TaskPayments />} />
              <Route path="commissions" element={<Commissions />} />
            </Route>

            <Route path="/referrals" element={
              <ProtectedRoute>
                <Layout>
                  <Referrals />
                </Layout>
              </ProtectedRoute>
            } />

            <Route path="*" element={<NotFound />} />
          </Routes>
        </Router>
      </AuthProvider>
    </QueryClientProvider>
  );
}
