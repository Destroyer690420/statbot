import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getWorkerStatus,
  getWorkerTickets,
  requestWorkerCode,
  workerErrorMessage,
  WORKER_LAST_TICKET_KEY,
} from '../../api/workerApi';
import { useWorkerAuth } from '../../hooks/useWorkerAuth';

interface TicketOption {
  channelId: string;
  name: string;
}

export default function WorkerLogin() {
  const navigate = useNavigate();
  const { token, login } = useWorkerAuth();
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
  const codeInputRef = useRef<HTMLInputElement>(null);

  // If a valid token already exists, skip the login page.
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

  // Debounced ticket type-ahead (3+ chars).
  useEffect(() => {
    if (query.trim().length < 3) {
      setOptions([]);
      return;
    }
    const t = setTimeout(() => {
      getWorkerTickets(query.trim())
        .then((res) => {
          if (res?.success) setOptions(res.data || []);
        })
        .catch(() => setOptions([]));
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  // Tick for countdowns.
  useEffect(() => {
    if (step !== 'code') return;
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
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
        setMessage('Code sent — open Discord and copy it from your ticket.');
        setIsError(false);
      }
    } catch (err: unknown) {
      const anyErr = err as { response?: { status?: number; data?: { remainingSeconds?: number } } };
      const remaining = anyErr?.response?.data?.remainingSeconds;
      if (anyErr?.response?.status === 429 && remaining) {
        // Single-active-code / cooldown: move to the code step with timers.
        const now = Date.now();
        setExpiresAt(now + remaining * 1000);
        setResendAt(now + remaining * 1000);
        setStep('code');
        setMessage(workerErrorMessage(err, 'A code was already sent — check Discord.'));
        setIsError(false);
      } else {
        setMessage(workerErrorMessage(err, 'Could not send the code. Try again.'));
        setIsError(true);
      }
    } finally {
      setSending(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
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
  const discordUrl =
    status?.guildId && selected ? `https://discord.com/channels/${status.guildId}/${selected.channelId}` : null;

  const onCodeChange = (v: string) => {
    setCode(v.toUpperCase().replace(/[^A-Z0-9\s-]/gi, '').slice(0, 9));
  };

  return (
    <div className="min-h-screen bg-dark-950 flex flex-col justify-center py-12 px-4 sm:px-6 relative overflow-hidden">
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-primary-600/20 blur-[120px] pointer-events-none" />
      <div className="sm:mx-auto sm:w-full sm:max-w-md relative z-10">
        <h2 className="text-center text-2xl font-extrabold text-white tracking-tight">Worker Panel</h2>
        <p className="mt-2 text-center text-sm text-dark-400">See your tasks, insights and earnings</p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md relative z-10">
        <div className="glass-card py-8 px-4 shadow-2xl sm:rounded-2xl sm:px-10 border border-dark-700/50">
          {statusLoading ? (
            <div className="space-y-3">
              <div className="h-11 bg-dark-800 rounded-xl animate-pulse" />
              <div className="h-11 bg-dark-800 rounded-xl animate-pulse" />
            </div>
          ) : status && !status.enabled ? (
            <p className="text-center text-sm text-dark-300">Worker portal is not available.</p>
          ) : step === 'ticket' ? (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-dark-200 mb-2">
                  Type your ticket number (e.g. 0074)
                </label>
                <input
                  type="text"
                  className="input-field w-full min-h-[44px]"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="ticket-0074 or 0074"
                  autoComplete="off"
                />
              </div>
              {query.trim().length >= 3 && options.length === 0 && (
                <p className="text-xs text-dark-400">No matching tickets. Keep typing your ticket number.</p>
              )}
              {options.length > 0 && (
                <ul className="space-y-2">
                  {options.map((o) => (
                    <li key={o.channelId}>
                      <button
                        type="button"
                        onClick={() => setSelected(o)}
                        className={`w-full text-left px-4 py-3 min-h-[44px] rounded-xl border transition-all ${
                          selected?.channelId === o.channelId
                            ? 'bg-primary-600/20 border-primary-500/50 text-white'
                            : 'bg-dark-800 border-dark-700 text-dark-200 hover:border-dark-500'
                        }`}
                      >
                        #{o.name}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {message && (
                <p className={`text-sm text-center ${isError ? 'text-red-400' : 'text-green-400'}`}>{message}</p>
              )}
              <button
                type="button"
                disabled={!selected || sending}
                onClick={() => selected && sendCode(selected.channelId)}
                className="btn-primary w-full min-h-[44px]"
              >
                {sending ? 'Sending…' : 'Send code to my ticket in Discord'}
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-dark-200 text-center">
                We posted a code in <span className="font-semibold text-white">#{selected?.name}</span>. Open
                Discord, copy the code and enter it here.
              </p>
              {discordUrl && (
                <a
                  href={discordUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-secondary w-full min-h-[44px] flex items-center justify-center"
                >
                  Open my ticket in Discord
                </a>
              )}
              <form onSubmit={handleVerify} className="space-y-4">
                <input
                  ref={codeInputRef}
                  type="text"
                  inputMode="text"
                  autoComplete="one-time-code"
                  autoFocus
                  className="input-field w-full text-center text-xl tracking-[0.3em] uppercase min-h-[44px]"
                  value={code}
                  onChange={(e) => onCodeChange(e.target.value)}
                  placeholder="ABCD-2345"
                  maxLength={9}
                />
                <p className="text-xs text-center text-dark-400">
                  {expirySecs > 0
                    ? `Code expires in ${Math.floor(expirySecs / 60)}:${String(expirySecs % 60).padStart(2, '0')}`
                    : 'Code expired — request a new one.'}
                </p>
                {message && (
                  <p className={`text-sm text-center ${isError ? 'text-red-400' : 'text-green-400'}`}>{message}</p>
                )}
                <button type="submit" disabled={verifying} className="btn-primary w-full min-h-[44px]">
                  {verifying ? 'Verifying…' : 'Verify & open my panel'}
                </button>
              </form>
              <div className="flex items-center justify-between text-sm">
                <button
                  type="button"
                  onClick={() => {
                    setStep('ticket');
                    setCode('');
                    setMessage('');
                  }}
                  className="text-primary-400 hover:text-primary-300 min-h-[44px] px-2"
                >
                  Change ticket
                </button>
                <button
                  type="button"
                  disabled={resendSecs > 0 || sending || !selected}
                  onClick={() => selected && sendCode(selected.channelId)}
                  className="text-primary-400 hover:text-primary-300 disabled:opacity-40 min-h-[44px] px-2"
                >
                  {resendSecs > 0 ? `Resend in ${resendSecs}s` : 'Resend code'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
