import sharp from 'sharp';

export interface PayoutReceiptInput {
  amount: number;
  payeeLabel: string;
  upiId?: string | null;
  paidAt?: Date;
}

/**
 * Format the amount in Indian number grouping (e.g. 2,000 or 150.50).
 */
export function formatReceiptAmount(amount: number): string {
  const isInt = Number.isInteger(amount);
  return amount.toLocaleString('en-IN', {
    maximumFractionDigits: 2,
    minimumFractionDigits: isInt ? 0 : 2,
  });
}

/**
 * Format date in IST matching UPI/Google Pay receipts (e.g. "19 October 2026, 11:10 pm").
 */
export function formatReceiptDate(date: Date = new Date()): string {
  const day = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric' }).format(date);
  const month = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', month: 'long' }).format(date);
  const year = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', year: 'numeric' }).format(date);
  const time = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
    .format(date)
    .toLowerCase();
  return `${day} ${month} ${year}, ${time}`;
}

export function escapeXml(unsafe: string): string {
  return String(unsafe || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Build the SVG string for the Google Pay / UPI dark-mode payment receipt.
 */
export function buildReceiptSvg(input: PayoutReceiptInput): string {
  const width = 540;
  const height = 960;
  const formattedAmount = formatReceiptAmount(input.amount);
  const formattedDate = formatReceiptDate(input.paidAt);
  const upiId = input.upiId ? input.upiId.trim() : null;
  const hasUpiId = Boolean(upiId && upiId.length > 0);

  // When upiId is absent (e.g. inviter payouts), the date shifts up cleanly.
  const dateY = hasUpiId ? 632 : 595;

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <style>
      .font-sans { font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
    </style>
  </defs>

  <!-- Background -->
  <rect width="${width}" height="${height}" fill="#111214"/>

  <!-- Checkmark Circle Badge (Google Pay Style) -->
  <g transform="translate(270, 275)">
    <circle r="55" fill="#1A73E8"/>
    <path d="M -20 1 L -6 15 L 21 -11" fill="none" stroke="#FFFFFF" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
  </g>

  <!-- Amount -->
  <text x="270" y="420" class="font-sans" font-size="62" font-weight="600" fill="#FFFFFF" text-anchor="middle">₹${escapeXml(formattedAmount)}</text>

  <!-- Paid to -->
  <text x="270" y="515" class="font-sans" font-size="19" font-weight="400" fill="#9AA0A6" text-anchor="middle">Paid to</text>

  <!-- Payee Name / Label -->
  <text x="270" y="558" class="font-sans" font-size="30" font-weight="600" fill="#FFFFFF" text-anchor="middle">${escapeXml(input.payeeLabel)}</text>

  ${hasUpiId ? `<!-- UPI ID -->
  <text x="270" y="595" class="font-sans" font-size="18" font-weight="400" fill="#9AA0A6" text-anchor="middle">${escapeXml(upiId!)}</text>` : ''}

  <!-- Date & Time (IST) -->
  <text x="270" y="${dateY}" class="font-sans" font-size="16.5" font-weight="400" fill="#9AA0A6" text-anchor="middle">${escapeXml(formattedDate)}</text>

  <!-- Footer: Powered by UPI -->
  <g transform="translate(270, 870)">
    <!-- POWERED BY text -->
    <text x="0" y="-30" class="font-sans" font-size="10" font-weight="500" fill="#9AA0A6" text-anchor="middle" letter-spacing="2">POWERED BY</text>

    <!-- NPCI UPI Wordmark -->
    <g transform="translate(-52, -18) scale(0.95)">
      <!-- UPI letters and arrows -->
      <path d="M 0 0 L 10 0 L 7.5 16 C 7 19.5 4.5 22 1 22 L -3 22 C -6.5 22 -8.5 19.5 -8 16 L -5.5 0 L 4.5 0 L 2.5 14 C 2.3 15.5 1.5 16.5 0 16.5 C -1.5 16.5 -2 15.5 -2.2 14 Z" fill="#FFFFFF" transform="translate(18, 0)"/>
      <path d="M 33 0 L 46 0 C 50.5 0 53 2.5 52.2 7 C 51.5 11.5 48.5 14 44 14 L 37.5 14 L 35.5 22 L 26.5 22 Z M 38.5 8 L 42.5 8 C 44.5 8 45.5 7 45.8 5.5 C 46.1 4 45.5 3 43.5 3 L 39.5 3 Z" fill="#FFFFFF"/>
      <path d="M 58 0 L 67 0 L 63.5 22 L 54.5 22 Z" fill="#FFFFFF"/>
      <!-- Chevrons -->
      <polygon points="76,0 87,11 73,22 79,22 93,11 82,0" fill="#097939"/>
      <polygon points="86,0 97,11 83,22 89,22 103,11 92,0" fill="#ED7524"/>
    </g>

    <!-- UNIFIED PAYMENTS INTERFACE subtext -->
    <text x="0" y="14" class="font-sans" font-size="6.5" font-weight="500" fill="#757575" text-anchor="middle" letter-spacing="1.2">UNIFIED PAYMENTS INTERFACE</text>
  </g>
</svg>`;
}

/**
 * Generate a PNG buffer for the payout receipt.
 */
export async function generatePayoutReceipt(input: PayoutReceiptInput): Promise<Buffer> {
  const svg = buildReceiptSvg(input);
  return sharp(Buffer.from(svg)).png().toBuffer();
}
