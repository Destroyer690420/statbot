/**
 * UPI deep-link builder for Pay Worker / Pay Inviter QR generation.
 * Generates upi://pay?pa=...&am=...&cu=INR with 2 decimal places for the amount.
 */
export function buildUpiPayLink(
  upiId: string,
  amount: number,
  payeeLabel?: string,
  note?: string
): string {
  const params = new URLSearchParams({ pa: upiId, am: amount.toFixed(2), cu: 'INR' });
  if (payeeLabel) params.set('pn', payeeLabel);
  if (note) params.set('tn', note);
  return `upi://pay?${params.toString()}`;
}
