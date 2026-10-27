import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { UPI_LOGO_DATA_URI } from './upi-logo-constant';

let cachedLogoUri: string | null = null;

export function getUpiLogoDataUri(): string {
  if (cachedLogoUri) return cachedLogoUri;
  try {
    const candidates = [
      path.resolve(__dirname, '../../assets/images/upi-logo-dark.png'),
      path.resolve(process.cwd(), 'assets/images/upi-logo-dark.png'),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        cachedLogoUri = `data:image/png;base64,${fs.readFileSync(p).toString('base64')}`;
        return cachedLogoUri;
      }
    }
  } catch {
    // ignore filesystem errors and fall back to constant
  }
  cachedLogoUri = UPI_LOGO_DATA_URI;
  return cachedLogoUri;
}

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
  const logoUri = getUpiLogoDataUri();

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
  <g transform="translate(270, 875)">
    <!-- POWERED BY text -->
    <text x="0" y="-32" class="font-sans" font-size="10" font-weight="500" fill="#9AA0A6" text-anchor="middle" letter-spacing="2">POWERED BY</text>

    <!-- Official NPCI UPI Logo (UNIFIED PAYMENTS INTERFACE) -->
    <image x="-57" y="-20" width="114" height="42" href="${logoUri}" preserveAspectRatio="xMidYMid meet"/>
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
