// ─── Shared date/currency formatters for the payout section ────

export function formatDate(ts: any): string {
  if (!ts) return '-';
  // Handle Firestore serialized timestamps (legacy)
  if (ts._seconds) {
    return new Date(ts._seconds * 1000).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }
  // Handle ISO strings
  if (typeof ts === 'string') {
    const d = new Date(ts);
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    }
  }
  if (ts instanceof Date) {
    return ts.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  return String(ts);
}

export function formatISODate(iso: string): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export function formatSimpleDate(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatCurrency(amount: number): string {
  return `₹${(amount ?? 0).toLocaleString('en-IN')}`;
}
