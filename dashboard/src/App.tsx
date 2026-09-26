import { BrowserRouter as Router, Routes, Route, Outlet } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './hooks/useAuth';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { PayoutLayout } from './pages/payout/PayoutLayout';
import { NotFound } from './pages/NotFound';
import { WorkerAuthProvider } from './hooks/useWorkerAuth';
import { WorkerProtectedRoute } from './components/WorkerProtectedRoute';
import { WorkerLayout } from './components/WorkerLayout';

// Admin pages are code-split. They were previously all in the entry chunk, which
// pulled Recharts (via Dashboard/Analytics) and every page's code into the
// initial download for worker-portal users too. Route elements are unchanged;
// each page is fetched on first navigation.
const Dashboard = lazy(() => import('./pages/Dashboard').then((m) => ({ default: m.Dashboard })));
const Tasks = lazy(() => import('./pages/Tasks').then((m) => ({ default: m.Tasks })));
const AcceptedTasks = lazy(() => import('./pages/AcceptedTasks').then((m) => ({ default: m.AcceptedTasks })));
const DailyOutreach = lazy(() => import('./pages/DailyOutreach').then((m) => ({ default: m.DailyOutreach })));
const Automation = lazy(() => import('./pages/Automation').then((m) => ({ default: m.Automation })));
const TaskDetails = lazy(() => import('./pages/TaskDetails').then((m) => ({ default: m.TaskDetails })));
const Analytics = lazy(() => import('./pages/Analytics').then((m) => ({ default: m.Analytics })));
const Archives = lazy(() => import('./pages/Archives').then((m) => ({ default: m.Archives })));
const Settings = lazy(() => import('./pages/Settings').then((m) => ({ default: m.Settings })));
const TaskPayments = lazy(() => import('./pages/payout/TaskPayments').then((m) => ({ default: m.TaskPayments })));
const Commissions = lazy(() => import('./pages/payout/Commissions').then((m) => ({ default: m.Commissions })));
const Referrals = lazy(() => import('./pages/Referrals').then((m) => ({ default: m.Referrals })));
const OwnerEarnings = lazy(() => import('./pages/OwnerEarnings').then((m) => ({ default: m.OwnerEarnings })));

const WorkerLogin = lazy(() => import('./pages/worker/WorkerLogin'));
const WorkerHome = lazy(() => import('./pages/worker/WorkerHome'));
const WorkerTasks = lazy(() => import('./pages/worker/WorkerTasks'));
const WorkerTaskDetail = lazy(() => import('./pages/worker/WorkerTaskDetail'));
const WorkerWallet = lazy(() => import('./pages/worker/WorkerWallet'));
const WorkerInvites = lazy(() => import('./pages/worker/WorkerInvites'));
const WorkerHowTo = lazy(() => import('./pages/worker/WorkerHowTo'));

function WorkerFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-worker-bg">
      <div className="h-10 w-10 animate-spin rounded-full border-2 border-worker-border border-t-worker-accent" aria-label="Loading worker page" />
    </div>
  );
}

function PageFallback() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-dark-700 border-t-primary-500" aria-label="Loading page" />
    </div>
  );
}

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
          {/* Single boundary for the lazily-loaded admin pages. Worker routes
              keep their own inner Suspense below, which takes precedence. */}
          <Suspense fallback={<PageFallback />}>
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

            {/* Worker portal (read-only, OTP login — never wrapped in the admin ProtectedRoute) */}
            <Route path="/worker" element={
              <WorkerAuthProvider>
                <Outlet />
              </WorkerAuthProvider>
            }>
              <Route path="login" element={
                <Suspense fallback={<WorkerFallback />}>
                  <WorkerLogin />
                </Suspense>
              } />
              <Route element={
                <WorkerProtectedRoute>
                  <WorkerLayout />
                </WorkerProtectedRoute>
              }>
                <Route index element={
                  <Suspense fallback={<WorkerFallback />}>
                    <WorkerHome />
                  </Suspense>
                } />
                <Route path="tasks" element={
                  <Suspense fallback={<WorkerFallback />}>
                    <WorkerTasks />
                  </Suspense>
                } />
                <Route path="tasks/:id" element={
                  <Suspense fallback={<WorkerFallback />}>
                    <WorkerTaskDetail />
                  </Suspense>
                } />
                <Route path="wallet" element={
                  <Suspense fallback={<WorkerFallback />}>
                    <WorkerWallet />
                  </Suspense>
                } />
                <Route path="invites" element={
                  <Suspense fallback={<WorkerFallback />}>
                    <WorkerInvites />
                  </Suspense>
                } />
                <Route path="how-to" element={
                  <Suspense fallback={<WorkerFallback />}>
                    <WorkerHowTo />
                  </Suspense>
                } />
              </Route>
            </Route>

            <Route path="*" element={<NotFound />} />
          </Routes>
          </Suspense>
        </Router>
      </AuthProvider>
    </QueryClientProvider>
  );
}
