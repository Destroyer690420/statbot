import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getWorkerTickets, requestWorkerCode } from '../api/worker';
import { useWorkerAuth } from '../hooks/useWorkerAuth';

export function WorkerLogin() {
  const [ticket, setTicket] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const { login } = useWorkerAuth();
  const navigate = useNavigate();

  const { data: ticketsData, isLoading: ticketsLoading } = useQuery({
    queryKey: ['worker-tickets'],
    queryFn: getWorkerTickets,
    retry: 1,
  });

  const tickets: { channelId: string; channelName: string | null; taskCount: number }[] =
    ticketsData?.data || [];

  const handleRequestCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticket) {
      setError('Please select your ticket.');
      return;
    }
    setError('');
    setInfo('');
    setIsLoading(true);
    try {
      const res = await requestWorkerCode(ticket);
      if (res.success) {
        setCodeSent(true);
        setInfo(`Code sent to #${res.data?.channelName || ticket} on Discord. It expires in 5 minutes.`);
      } else {
        setError(res.message || 'Could not send code.');
      }
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || 'Could not send code.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code) {
      setError('Please enter the code from your ticket.');
      return;
    }
    setError('');
    setIsLoading(true);
    try {
      await login(ticket, code);
      navigate('/worker', { replace: true });
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || 'Verification failed.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-dark-950 flex flex-col justify-center py-12 sm:px-6 lg:px-8 relative overflow-hidden">
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-primary-600/20 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-primary-900/40 blur-[120px] pointer-events-none" />

      <div className="sm:mx-auto sm:w-full sm:max-w-md relative z-10">
        <h2 className="mt-6 text-center text-3xl font-extrabold text-white tracking-tight">
          Worker Portal
        </h2>
        <p className="mt-2 text-center text-sm text-dark-400">
          Select your ticket, get a code on Discord, and view your tasks.
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md relative z-10">
        <div className="glass-card py-8 px-4 shadow-2xl sm:rounded-2xl sm:px-10 border border-dark-700/50 space-y-6">
          {error && (
            <div className="bg-red-500/10 border border-red-500/50 rounded-xl p-4">
              <p className="text-sm text-red-400 text-center font-medium">{error}</p>
            </div>
          )}
          {info && (
            <div className="bg-green-500/10 border border-green-500/50 rounded-xl p-4">
              <p className="text-sm text-green-400 text-center font-medium">{info}</p>
            </div>
          )}

          <form className="space-y-4" onSubmit={handleRequestCode}>
            <div>
              <label className="block text-sm font-medium text-dark-200 mb-2">Your ticket</label>
              <select
                className="input-field w-full"
                value={ticket}
                onChange={(e) => setTicket(e.target.value)}
                disabled={ticketsLoading}
              >
                <option value="">{ticketsLoading ? 'Loading tickets…' : 'Select your ticket…'}</option>
                {tickets.map((t) => (
                  <option key={t.channelId} value={t.channelName || t.channelId}>
                    #{t.channelName || t.channelId} ({t.taskCount} tasks)
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-dark-400">
                Pick the same ticket channel where you receive your tasks.
              </p>
            </div>
            <button type="submit" disabled={isLoading} className="btn-primary w-full flex justify-center py-3 text-base">
              {isLoading && !codeSent ? 'Sending…' : codeSent ? 'Resend code' : 'Send code to my ticket'}
            </button>
          </form>

          {codeSent && (
            <form className="space-y-4" onSubmit={handleVerify}>
              <div>
                <label className="block text-sm font-medium text-dark-200 mb-2">Verification code</label>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  className="input-field w-full tracking-[0.3em] text-center text-lg"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="••••••"
                />
              </div>
              <button type="submit" disabled={isLoading} className="btn-primary w-full flex justify-center py-3 text-base">
                {isLoading ? 'Verifying…' : 'Verify & view my tasks'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
