import axios from 'axios';

const api = axios.create({
  baseURL: '/api/v1',
  headers: { 'Content-Type': 'application/json' },
});

// Attach JWT token to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('rtm_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle 401 responses (auto logout)
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('rtm_token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  },
);

// ─── Auth ────────────────────────────────────────────────────

export async function login(username: string, password: string) {
  const { data } = await api.post('/auth/login', { username, password });
  return data;
}

// ─── Tasks ───────────────────────────────────────────────────

export async function getTasks(params?: Record<string, string>) {
  const { data } = await api.get('/tasks', { params });
  return data;
}

export async function getTask(id: string) {
  const { data } = await api.get(`/tasks/${encodeURIComponent(id)}`);
  return data;
}

export async function deleteTask(id: string) {
  const { data } = await api.delete(`/tasks/${encodeURIComponent(id)}`);
  return data;
}

export async function updateTask(id: string, body: Record<string, unknown>) {
  const { data } = await api.patch(`/tasks/${encodeURIComponent(id)}`, body);
  return data;
}

export async function doneTask(id: string) {
  const { data } = await api.post(`/tasks/${encodeURIComponent(id)}/done`);
  return data;
}

export async function reassignTask(id: string, ticket: string) {
  const { data } = await api.post(`/tasks/${encodeURIComponent(id)}/reassign`, { ticket });
  return data;
}

export async function retryAssignment(id: string) {
  const { data } = await api.post(`/tasks/${encodeURIComponent(id)}/retry-assignment`);
  return data;
}

export async function submitTaskUrl(id: string, redditUrl: string) {
  const { data } = await api.post(`/tasks/${encodeURIComponent(id)}/submit-url`, { redditUrl });
  return data;
}

export async function recheckFormat(id: string) {
  const { data } = await api.post(`/tasks/${encodeURIComponent(id)}/recheck-format`);
  return data;
}

export async function getLiveReddit(id: string) {
  const { data } = await api.get(`/tasks/${encodeURIComponent(id)}/live-reddit`);
  return data;
}

export async function getRedditSessionStatus() {
  const { data } = await api.get('/automation/reddit-session');
  return data;
}

export async function saveRedditSession(body: { cookie: string; userAgent?: string }) {
  const { data } = await api.post('/automation/reddit-session', body);
  return data;
}

export async function getTickets() {
  const { data } = await api.get('/discord/tickets');
  return data;
}

export async function getReminders(taskId: string) {
  const { data } = await api.get(`/tasks/${encodeURIComponent(taskId)}/reminders`);
  return data;
}

export async function getUpcomingReminders(limit = 10) {
  const { data } = await api.get('/reminders/upcoming', { params: { limit } });
  return data;
}

// ─── Stats ───────────────────────────────────────────────────

export async function getStats() {
  const { data } = await api.get('/stats');
  return data;
}

export async function getDailyStats(days = 30) {
  const { data } = await api.get('/stats/daily', { params: { days } });
  return data;
}

export async function getTypeDistribution() {
  const { data } = await api.get('/stats/types');
  return data;
}

export async function getEmployeePerformance() {
  const { data } = await api.get('/stats/employees');
  return data;
}

// ─── Export ──────────────────────────────────────────────────

export function getExportCsvUrl(params?: Record<string, string>): string {
  const searchParams = new URLSearchParams(params || {});
  return `/api/v1/export/csv?${searchParams}`;
}

export async function downloadCsv(params?: Record<string, string>): Promise<void> {
  const { data, headers } = await api.get('/export/csv', {
    params,
    responseType: 'blob',
  });
  const contentDisposition = headers['content-disposition'] || '';
  const filenameMatch = contentDisposition.match(/filename="?(.+?)"?$/);
  const filename = filenameMatch?.[1] || `tasks-export-${Date.now()}.csv`;

  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Outreach ────────────────────────────────────────────────

export async function getOutreach() {
  const { data } = await api.get('/outreach');
  return data;
}

export async function getOutreachSettings() {
  const { data } = await api.get('/outreach/settings');
  return data;
}

export async function updateOutreachSettings(body: { message: string }) {
  const { data } = await api.put('/outreach/settings', body);
  return data;
}

export async function saveOutreachSelection(body: { selections: { channelId: string; selected: boolean }[] }) {
  const { data } = await api.put('/outreach/selection', body);
  return data;
}

export async function sendOutreachMessage(slots: number) {
  const { data } = await api.post('/outreach/send', { slots });
  return data;
}

export async function getDeadTickets() {
  const { data } = await api.get('/outreach/dead-tickets');
  return data;
}

export async function deleteDeadTickets(channelIds: string[]) {
  const { data } = await api.delete('/outreach/dead-tickets', { data: { channelIds } });
  return data;
}

// ─── Payouts ─────────────────────────────────────────────────

export async function getPayoutWeek() {
  const { data } = await api.get('/payouts/week');
  return data;
}

export async function getPayoutSummary(params?: Record<string, string>) {
  const { data } = await api.get('/payouts/summary', { params });
  return data;
}

export async function getEligibleTasks(params?: Record<string, string>) {
  const { data } = await api.get('/payouts/eligible', { params });
  return data;
}

export async function getWorkerDetail(workerId: string, params?: Record<string, string>) {
  const { data } = await api.get(`/payouts/workers/${encodeURIComponent(workerId)}`, { params });
  return data;
}

export async function payWorker(workerId: string, params?: Record<string, string>) {
  const { data } = await api.post(`/payouts/pay-worker/${encodeURIComponent(workerId)}`, params);
  return data;
}

export async function payAll(params?: Record<string, string>) {
  const { data } = await api.post('/payouts/pay-all', params);
  return data;
}

export async function getBatchHistory(params?: Record<string, string>) {
  const { data } = await api.get('/payouts/batches', { params });
  return data;
}

export async function getBatchDetail(batchId: string) {
  const { data } = await api.get(`/payouts/batches/${encodeURIComponent(batchId)}`);
  return data;
}

export async function downloadPayoutCsv(params?: Record<string, string>): Promise<void> {
  const { data, headers } = await api.get('/payouts/export/csv', {
    params,
    responseType: 'blob',
  });
  const contentDisposition = headers['content-disposition'] || '';
  const filenameMatch = contentDisposition.match(/filename="?(.+?)"?$/);
  const filename = filenameMatch?.[1] || `payout-export-${Date.now()}.csv`;

  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Settings ────────────────────────────────────────────────

export async function getPayoutRates() {
  const { data } = await api.get('/settings/payout-rates');
  return data;
}

export async function updatePayoutRates(body: { commentRate: number; postRate: number }) {
  const { data } = await api.put('/settings/payout-rates', body);
  return data;
}

// ─── Commissions ─────────────────────────────────────────────

export async function getCommissionSummary(params?: Record<string, string>) {
  const { data } = await api.get('/commissions/summary', { params });
  return data;
}

export async function getCommissionBreakdown(params?: Record<string, string>) {
  const { data } = await api.get('/commissions/breakdown', { params });
  return data;
}

export async function getInviterDetail(inviterId: string, params?: Record<string, string>) {
  const { data } = await api.get(`/commissions/inviters/${encodeURIComponent(inviterId)}`, { params });
  return data;
}

export async function getReferrals() {
  const { data } = await api.get('/commissions/referrals');
  return data;
}

export async function createReferral(body: {
  inviterId: string;
  inviterName: string;
  inviteeId: string;
  inviteeName: string;
  inviterType: 'normal' | 'special';
}) {
  const { data } = await api.post('/commissions/referrals', body);
  return data;
}

export async function deleteReferral(referralId: string) {
  const { data } = await api.delete(`/commissions/referrals/${encodeURIComponent(referralId)}`);
  return data;
}

export async function updateReferral(referralId: string, body: { inviterId?: string; inviteeId?: string; inviterName?: string; inviteeName?: string; ticketId?: string | null }) {
  const { data } = await api.patch(`/commissions/referrals/${encodeURIComponent(referralId)}`, body);
  return data;
}

export async function updateInviteDetection(id: string, body: { inviterId?: string | null; inviterName?: string | null; inviteeName?: string }) {
  const { data } = await api.patch(`/commissions/invite-detections/${encodeURIComponent(id)}`, body);
  return data;
}

export async function payInviter(inviterId: string) {
  const { data } = await api.post(`/commissions/pay-inviter/${encodeURIComponent(inviterId)}`);
  return data;
}

export async function payAllCommissions() {
  const { data } = await api.post('/commissions/pay-all');
  return data;
}

export async function getCommissionRates() {
  const { data } = await api.get('/commissions/rates');
  return data;
}

export async function updateCommissionRates(body: {
  normalInviteBonus: number;
  normalInviteTaskThreshold: number;
  specialInviteBonus: number;
  specialInviteTaskThreshold: number;
  specialPerComment: number;
  specialPerPost: number;
}) {
  const { data } = await api.put('/commissions/rates', body);
  return data;
}

export async function getCommissionBatchHistory() {
  const { data } = await api.get('/commissions/batches');
  return data;
}

export async function getCommissionBatchDetail(batchId: string) {
  const { data } = await api.get(`/commissions/batches/${encodeURIComponent(batchId)}`);
  return data;
}

export async function getInviteDetections(status: 'pending' | 'all' = 'pending') {
  const { data } = await api.get('/commissions/invite-detections', { params: { status } });
  return data;
}

export async function approveInviteDetection(id: string) {
  const { data } = await api.post(`/commissions/invite-detections/${encodeURIComponent(id)}/approve`);
  return data;
}

export async function rejectInviteDetection(id: string) {
  const { data } = await api.post(`/commissions/invite-detections/${encodeURIComponent(id)}/reject`);
  return data;
}

export async function downloadCommissionCsv(params?: Record<string, string>): Promise<void> {
  const { data, headers } = await api.get('/commissions/export/csv', {
    params,
    responseType: 'blob',
  });
  const contentDisposition = headers['content-disposition'] || '';
  const filenameMatch = contentDisposition.match(/filename="?(.+?)"?$/);
  const filename = filenameMatch?.[1] || `commission-export-${Date.now()}.csv`;

  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Restore ─────────────────────────────────────────────────

export async function restoreUnpaidArchived() {
  const { data } = await api.post('/tasks/restore-unpaid-archived');
  return data;
}

// ─── Health ──────────────────────────────────────────────────

export async function getHealth() {
  const { data } = await api.get('/health');
  return data;
}

// ─── Owner Panel ────────────────────────────────────────────

export async function verifyOwnerPin(pin: string) {
  const { data } = await api.post('/owner/verify', { pin });
  return data;
}

export async function getDailyEarnings() {
  const { data } = await api.get('/owner/daily-earnings');
  return data;
}

export async function getDailyEarningsHistory(days = 7) {
  const { data } = await api.get(`/owner/daily-earnings/history?days=${days}`);
  return data;
}

export async function getWeeklyEarnings() {
  const { data } = await api.get('/owner/weekly-earnings');
  return data;
}

// ─── Automation ──────────────────────────────────────────────

export async function getAutomationStatus() {
  const { data } = await api.get('/automation/status');
  return data;
}

export async function updateAutomationSettings(body: { enabled: boolean; dryRun: boolean; pollEnabled: boolean }) {
  const { data } = await api.put('/automation/settings', body);
  return data;
}

export async function startAutomationCycle(forced = false) {
  const { data } = await api.post(`/automation/start${forced ? '?forced=1' : ''}`);
  return data;
}

export async function stopAutomation() {
  const { data } = await api.post('/automation/stop');
  return data;
}

export async function getAutomationCycles() {
  const { data } = await api.get('/automation/cycles');
  return data;
}

export async function getAutomationCycle(id: string) {
  const { data } = await api.get(`/automation/cycles/${encodeURIComponent(id)}`);
  return data;
}

export async function getBlockedSubreddits() {
  const { data } = await api.get('/automation/blocked');
  return data;
}

export async function addBlockedSubreddit(subreddit: string, reason?: string) {
  const { data } = await api.put('/automation/blocked', { subreddit, reason });
  return data;
}

export async function removeBlockedSubreddit(subreddit: string) {
  const { data } = await api.delete(`/automation/blocked/${encodeURIComponent(subreddit)}`);
  return data;
}

export async function saveAutomationSession(body: {
  sessionToken: string;
  csrfToken: string;
  callbackUrl?: string;
  nextAction?: string;
  userAgent?: string;
}) {
  const { data } = await api.post('/automation/session', body);
  return data;
}

export async function sendTestContact(channelId: string, message?: string) {
  const { data } = await api.post('/automation/test-contact', { channelId, message });
  return data;
}

export async function sendTestAccept(externalTaskId: string, channelId: string, accept = false) {
  const { data } = await api.post('/automation/test-accept', { externalTaskId, channelId, accept });
  return data;
}

export async function sendRehearse(body: {
  externalTaskId: string;
  channelId: string;
  taskType?: 'post' | 'comment';
  subreddit?: string | null;
  title?: string | null;
  live?: boolean;
}) {
  const { data } = await api.post('/automation/rehearse', body);
  return data;
}

export async function getAutomationCompanion() {
  const { data } = await api.get('/automation/companion');
  return data;
}

export async function getAutomationClaims() {
  const { data } = await api.get('/automation/claims');
  return data;
}

export default api;
