import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AtSign, Clock3, ExternalLink, Hash, MessageCircle, Search, Send, ShieldCheck, X } from 'lucide-react';
import {
  getWorkerStatus,
  getWorkerTickets,
  requestWorkerCode,
  requestInviterCode,
  workerErrorMessage,
  WORKER_LAST_TICKET_KEY,
} from '../../api/workerApi';
import { useWorkerAuth } from '../../hooks/useWorkerAuth';
import { WorkerCard, WorkerSkeleton } from '../../components/worker/WorkerUI';

interface TicketOption {
  channelId: string;
  name: string;
}

export default function WorkerLogin() {
  const navigate = useNavigate();
  const { token, login, loginAsInviter } = useWorkerAuth();
  const [mode, setMode] = useState<'ticket' | 'inviter'>('ticket');
  const [status, setStatus] = useState<{ enabled: boolean; guildId: string } | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [query, setQuery] = useState(() => localStorage.getItem(WORKER_LAST_TICKET_KEY + '_q') || '');
  const [options, setOptions] = useState<TicketOption[]>([]);
  const [selected, setSelected] = useState<TicketOption | null>(null);
  const [step, setStep] = useState<'ticket' | 'code'>('ticket');
  const [code, setCode] = useState('');
  const [message, setMessage] = useState('');
  const [isError, setIsError] = useState(false);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [resendAt, setResendAt] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const [inviterUsername, setInviterUsername] = useState('');
  const [inviterStep, setInviterStep] = useState<'username' | 'code'>('username');
  const codeInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!token) return;
    navigate('/worker', { replace: true });
  }, [token, navigate]);

  useEffect(() => {
    getWorkerStatus()
      .then((res) => {
        if (res?.success) setStatus(res.data);
      })
      .catch(() => undefined)
      .finally(() => setStatusLoading(false));
  }, []);

  useEffect(() => {
    if (query.trim().length < 3) {
      setOptions([]);
      return;
    }
    const timer = setTimeout(() => {
      getWorkerTickets(query.trim())
        .then((res) => {
          if (res?.success) setOptions(res.data || []);
        })
        .catch(() => setOptions([]));
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (step !== 'code') return;
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [step]);

  useEffect(() => {
    if (step === 'code') codeInputRef.current?.focus();
  }, [step]);

  const sendCode = async (channelId: string) => {
    setSending(true);
    setMessage('');
    setIsError(false);
    try {
      const res = await requestWorkerCode(channelId);
      if (res?.success) {
        const now = Date.now();
        setExpiresAt(now + (res.data?.expiresInSeconds ?? 300) * 1000);
        setResendAt(now + (res.data?.cooldownSeconds ?? 60) * 1000);
        setStep('code');
        localStorage.setItem(WORKER_LAST_TICKET_KEY, channelId);
        localStorage.setItem(WORKER_LAST_TICKET_KEY + '_q', query);
        setMessage('Code sent. Open Discord and copy it from your ticket.');
        setIsError(false);
      }
    } catch (err: unknown) {
      const anyErr = err as { response?: { status?: number; data?: { remainingSeconds?: number } } };
      const remaining = anyErr?.response?.data?.remainingSeconds;
      if (anyErr?.response?.status === 429 && remaining) {
        const now = Date.now();
        setExpiresAt(now + remaining * 1000);
        setResendAt(now + remaining * 1000);
        setStep('code');
        setMessage(workerErrorMessage(err, 'A code was already sent. Check Discord.'));
        setIsError(false);
      } else {
        setMessage(workerErrorMessage(err, 'Could not send the code. Try again.'));
        setIsError(true);
      }
    } finally {
      setSending(false);
    }
  };

  const handleVerify = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected || verifying) return;
    const normalized = code.toUpperCase().replace(/[\s-]+/g, '');
    if (normalized.length !== 8) {
      setMessage('Enter the 8-character code from Discord.');
      setIsError(true);
      return;
    }
    setVerifying(true);
    setMessage('');
    setIsError(false);
    try {
      await login(selected.channelId, normalized);
      navigate('/worker', { replace: true });
    } catch (err: unknown) {
      setMessage(workerErrorMessage(err, 'Verification failed. Try again.'));
      setIsError(true);
    } finally {
      setVerifying(false);
    }
  };

  const expirySecs = expiresAt ? Math.max(0, Math.ceil((expiresAt - nowMs) / 1000)) : 0;
  const resendSecs = resendAt ? Math.max(0, Math.ceil((resendAt - nowMs) / 1000)) : 0;
  const discordUrl = status?.guildId && selected ? `https://discord.com/channels/${status.guildId}/${selected.channelId}` : null;

  const onCodeChange = (value: string) => {
    setCode(value.toUpperCase().replace(/[^A-Z0-9\s-]/gi, '').slice(0, 9));
  };

  // ─── Inviter (ticket-less) flow ──────────────────────────────────────
  // People who invite but never receive a task have no ticket to search for,
  // so they prove their Discord account with a code sent to their own DMs.
  const sendInviterCode = async () => {
    const username = inviterUsername.trim().replace(/^@/, '');
    if (username.length < 2 || sending) return;
    setSending(true);
    setMessage('');
    setIsError(false);
    try {
      const res = await requestInviterCode(username);
      if (res?.success) {
        const now = Date.now();
        setExpiresAt(now + (res.data?.expiresInSeconds ?? 300) * 1000);
        setResendAt(now + (res.data?.cooldownSeconds ?? 60) * 1000);
        setInviterStep('code');
        setMessage('If that account is in the server, we sent a code to its Discord DMs.');
        setIsError(false);
      }
    } catch (err: unknown) {
      const anyErr = err as { response?: { status?: number; data?: { remainingSeconds?: number } } };
      const remaining = anyErr?.response?.data?.remainingSeconds;
      if (anyErr?.response?.status === 429 && remaining) {
        const now = Date.now();
        setExpiresAt(now + remaining * 1000);
        setResendAt(now + remaining * 1000);
        setInviterStep('code');
        setMessage(workerErrorMessage(err, 'A code was already sent. Check your DMs.'));
        setIsError(false);
      } else {
        setMessage(workerErrorMessage(err, 'Could not send the code. Try again.'));
        setIsError(true);
      }
    } finally {
      setSending(false);
    }
  };

  const handleInviterVerify = async (event: React.FormEvent) => {
    event.preventDefault();
    if (verifying) return;
    const normalized = code.toUpperCase().replace(/[\s-]+/g, '');
    if (normalized.length !== 8) {
      setMessage('Enter the 8-character code from your DMs.');
      setIsError(true);
      return;
    }
    setVerifying(true);
    setMessage('');
    setIsError(false);
    try {
      await loginAsInviter(inviterUsername.trim().replace(/^@/, ''), normalized);
      navigate('/worker/invites', { replace: true });
    } catch (err: unknown) {
      setMessage(workerErrorMessage(err, 'Verification failed. Try again.'));
      setIsError(true);
    } finally {
      setVerifying(false);
    }
  };

  const switchMode = (next: 'ticket' | 'inviter') => {
    setMode(next);
    setMessage('');
    setIsError(false);
    setCode('');
    if (next === 'inviter') {
      setInviterStep('username');
    } else {
      setInviterUsername('');
    }
  };

  return (
    <div className="min-h-screen bg-worker-bg px-4 py-8 sm:px-6 sm:py-12">
      <main className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-[400px] flex-col justify-center">
        <div className="mb-7 text-center">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl border border-worker-border bg-worker-surface text-worker-accent">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          </div>
          <h1 className="mt-4 font-display text-2xl font-bold tracking-tight text-worker-text sm:text-3xl">Worker panel</h1>
          <p className="mt-2 text-sm text-worker-text-muted">Your tasks, insights and payments in one place.</p>
        </div>

        {status && status.enabled && !statusLoading ? (
          <div className="mb-4 grid grid-cols-2 gap-1 rounded-lg border border-worker-border bg-worker-surface-2 p-1" role="tablist" aria-label="Login type">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'ticket'}
              onClick={() => switchMode('ticket')}
              className={`min-h-[40px] rounded-md px-2 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-worker-accent ${
                mode === 'ticket' ? 'bg-worker-accent text-white' : 'text-worker-text-muted hover:text-worker-text'
              }`}
            >
              I have a ticket
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'inviter'}
              onClick={() => switchMode('inviter')}
              className={`min-h-[40px] rounded-md px-2 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-worker-accent ${
                mode === 'inviter' ? 'bg-worker-accent text-white' : 'text-worker-text-muted hover:text-worker-text'
              }`}
            >
              I only invite
            </button>
          </div>
        ) : null}

        {mode === 'inviter' ? (
          <WorkerCard className="p-5 sm:p-7">
            {statusLoading ? (
              <div className="space-y-3" aria-label="Loading worker portal">
                <WorkerSkeleton className="h-12 w-full" />
                <WorkerSkeleton className="h-12 w-full" />
              </div>
            ) : status && !status.enabled ? (
              <div className="py-5 text-center">
                <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-worker-surface-2 text-worker-text-faint">
                  <ShieldCheck className="h-5 w-5" aria-hidden="true" />
                </div>
                <p className="mt-3 text-sm text-worker-text-muted">Worker portal is not available.</p>
              </div>
            ) : inviterStep === 'username' ? (
              <div className="space-y-4">
                <div>
                  <label htmlFor="worker-inviter-username" className="mb-2 block text-sm font-semibold text-worker-text">
                    Your Discord username
                  </label>
                  <div className="relative">
                    <AtSign className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-worker-text-faint" aria-hidden="true" />
                    <input
                      id="worker-inviter-username"
                      type="text"
                      className="worker-input pl-10"
                      value={inviterUsername}
                      onChange={(event) => setInviterUsername(event.target.value)}
                      placeholder="e.g. ironmanexists"
                      autoComplete="off"
                    />
                  </div>
                  <p className="mt-2 text-xs leading-5 text-worker-text-muted">
                    For people who invite others but never receive a task. We send a one-time code to that
                    account&apos;s Discord DMs — no ticket number needed.
                  </p>
                </div>

                {message ? (
                  <p role={isError ? 'alert' : 'status'} className={`text-sm ${isError ? 'text-worker-danger' : 'text-worker-success'}`}>
                    {message}
                  </p>
                ) : null}

                <button
                  type="button"
                  disabled={inviterUsername.trim().replace(/^@/, '').length < 2 || sending}
                  onClick={sendInviterCode}
                  className="worker-primary-button w-full"
                >
                  {sending ? 'Sending…' : 'Send me a code'}
                  {!sending ? <Send className="h-4 w-4" aria-hidden="true" /> : null}
                </button>

                <p className="text-center text-xs leading-5 text-worker-text-faint">
                  DMs closed? Run <span className="font-semibold text-worker-text-muted">/logincode</span> in the
                  server instead — it shows you the code privately.
                </p>
              </div>
            ) : (
              <div className="space-y-5">
                <p className="text-sm leading-6 text-worker-text-muted">
                  We sent a code to the DMs of{' '}
                  <span className="font-semibold text-worker-text">{inviterUsername.trim().replace(/^@/, '')}</span>.
                  Open Discord and enter it here.
                </p>

                <form onSubmit={handleInviterVerify} className="space-y-4">
                  <div>
                    <label htmlFor="worker-inviter-code" className="mb-2 block text-sm font-semibold text-worker-text">
                      Enter your 8-character code
                    </label>
                    <input
                      id="worker-inviter-code"
                      type="text"
                      inputMode="text"
                      autoComplete="one-time-code"
                      autoFocus
                      className="worker-input text-center font-semibold uppercase tracking-[0.28em]"
                      value={code}
                      onChange={(event) => onCodeChange(event.target.value)}
                      placeholder="ABCD-2345"
                      maxLength={9}
                    />
                  </div>
                  <div className="flex items-center justify-center gap-1.5 text-xs text-worker-text-muted" role="timer">
                    <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
                    {expirySecs > 0
                      ? `Expires in ${Math.floor(expirySecs / 60)}:${String(expirySecs % 60).padStart(2, '0')}`
                      : 'Code expired. Request a new one.'}
                  </div>
                  {message ? (
                    <p role={isError ? 'alert' : 'status'} className={`text-sm ${isError ? 'text-worker-danger' : 'text-worker-success'}`}>
                      {message}
                    </p>
                  ) : null}
                  <button type="submit" disabled={verifying} className="worker-primary-button w-full">
                    {verifying ? 'Verifying…' : 'Verify and open my panel'}
                    {!verifying ? <ShieldCheck className="h-4 w-4" aria-hidden="true" /> : null}
                  </button>
                </form>

                <div className="flex items-center justify-between gap-2 border-t border-worker-border pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setInviterStep('username');
                      setCode('');
                      setMessage('');
                    }}
                    className="worker-ghost-button px-2"
                  >
                    Change username
                  </button>
                  <button
                    type="button"
                    disabled={resendSecs > 0 || sending}
                    onClick={sendInviterCode}
                    className="worker-ghost-button px-2"
                  >
                    {resendSecs > 0 ? `Resend in ${resendSecs}s` : 'Resend code'}
                  </button>
                </div>
              </div>
            )}
          </WorkerCard>
        ) : (
        <WorkerCard className="p-5 sm:p-7">
          {statusLoading ? (
            <div className="space-y-3" aria-label="Loading worker portal">
              <WorkerSkeleton className="h-12 w-full" />
              <WorkerSkeleton className="h-12 w-full" />
              <WorkerSkeleton className="h-11 w-full" />
            </div>
          ) : status && !status.enabled ? (
            <div className="py-5 text-center">
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-worker-surface-2 text-worker-text-faint">
                <ShieldCheck className="h-5 w-5" aria-hidden="true" />
              </div>
              <p className="mt-3 text-sm text-worker-text-muted">Worker portal is not available.</p>
            </div>
          ) : step === 'ticket' ? (
            <div className="space-y-4">
              <div>
                <label htmlFor="worker-ticket-search" className="mb-2 block text-sm font-semibold text-worker-text">
                  Find your ticket
                </label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-worker-text-faint" aria-hidden="true" />
                  <input
                    id="worker-ticket-search"
                    type="text"
                    className="worker-input pl-10"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Type your ticket number, e.g. 0074"
                    autoComplete="off"
                  />
                </div>
                <p className="mt-2 text-xs text-worker-text-muted">Search by the ticket number shared with you.</p>
              </div>

              {query.trim().length >= 3 && options.length === 0 ? (
                <p className="rounded-lg border border-worker-border bg-worker-surface-2 px-3 py-2.5 text-sm text-worker-text-muted">
                  No ticket found. Check the number and try again.
                </p>
              ) : null}

              {options.length > 0 ? (
                <ul className="space-y-2" aria-label="Matching tickets">
                  {options.map((option) => (
                    <li key={option.channelId}>
                      <button
                        type="button"
                        onClick={() => setSelected(option)}
                        className={`flex min-h-[48px] w-full items-center gap-2 rounded-lg border px-3 text-left text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-worker-accent ${
                          selected?.channelId === option.channelId
                            ? 'border-worker-accent/50 bg-worker-accent/10 text-worker-text'
                            : 'border-worker-border bg-worker-surface-2 text-worker-text-muted hover:border-worker-text-faint hover:text-worker-text'
                        }`}
                      >
                        <Hash className="h-4 w-4 shrink-0 text-worker-text-faint" aria-hidden="true" />
                        <span className="truncate">{option.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}

              {selected ? (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-worker-accent/30 bg-worker-accent/10 px-3 py-2.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <Hash className="h-4 w-4 shrink-0 text-worker-accent" aria-hidden="true" />
                    <span className="truncate text-sm font-medium text-worker-text">{selected.name}</span>
                  </div>
                  <button type="button" onClick={() => setSelected(null)} className="worker-icon-button -mr-2 -my-1" aria-label="Change selected ticket">
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              ) : null}

              {message ? (
                <p role={isError ? 'alert' : 'status'} className={`text-sm ${isError ? 'text-worker-danger' : 'text-worker-success'}`}>
                  {message}
                </p>
              ) : null}

              <button
                type="button"
                disabled={!selected || sending}
                onClick={() => selected && sendCode(selected.channelId)}
                className="worker-primary-button w-full"
              >
                {sending ? 'Sending…' : 'Send code to my ticket in Discord'}
                {!sending ? <Send className="h-4 w-4" aria-hidden="true" /> : null}
              </button>
            </div>
          ) : (
            <div className="space-y-5">
              <div>
                <p className="text-sm leading-6 text-worker-text-muted">
                  We posted a code in <span className="font-semibold text-worker-text">{selected?.name}</span>. Open Discord, copy the code and enter it here.
                </p>
              </div>

              <form onSubmit={handleVerify} className="space-y-4">
                <div>
                  <label htmlFor="worker-code" className="mb-2 block text-sm font-semibold text-worker-text">
                    Enter your 8-character code
                  </label>
                  <input
                    ref={codeInputRef}
                    id="worker-code"
                    type="text"
                    inputMode="text"
                    autoComplete="one-time-code"
                    autoFocus
                    className="worker-input text-center font-semibold uppercase tracking-[0.28em]"
                    value={code}
                    onChange={(event) => onCodeChange(event.target.value)}
                    placeholder="ABCD-2345"
                    maxLength={9}
                  />
                </div>
                <div className="flex items-center justify-center gap-1.5 text-xs text-worker-text-muted" role="timer">
                  <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
                  {expirySecs > 0
                    ? `Expires in ${Math.floor(expirySecs / 60)}:${String(expirySecs % 60).padStart(2, '0')}`
                    : 'Code expired. Request a new one.'}
                </div>
                {message ? (
                  <p role={isError ? 'alert' : 'status'} className={`text-sm ${isError ? 'text-worker-danger' : 'text-worker-success'}`}>
                    {message}
                  </p>
                ) : null}
                <button type="submit" disabled={verifying} className="worker-primary-button w-full">
                  {verifying ? 'Verifying…' : 'Verify and open my panel'}
                  {!verifying ? <ShieldCheck className="h-4 w-4" aria-hidden="true" /> : null}
                </button>
              </form>

              {discordUrl ? (
                <a href={discordUrl} target="_blank" rel="noopener noreferrer" className="worker-secondary-button w-full">
                  <MessageCircle className="h-4 w-4" aria-hidden="true" />
                  Open my ticket in Discord
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
              ) : null}

              <div className="flex items-center justify-between gap-2 border-t border-worker-border pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setStep('ticket');
                    setCode('');
                    setMessage('');
                  }}
                  className="worker-ghost-button px-2"
                >
                  Change ticket
                </button>
                <button
                  type="button"
                  disabled={resendSecs > 0 || sending || !selected}
                  onClick={() => selected && sendCode(selected.channelId)}
                  className="worker-ghost-button px-2"
                >
                  {resendSecs > 0 ? `Resend in ${resendSecs}s` : 'Resend code'}
                </button>
              </div>
            </div>
          )}
        </WorkerCard>
        )}
      </main>
    </div>
  );
}
