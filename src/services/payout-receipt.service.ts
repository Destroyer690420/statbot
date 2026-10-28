import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { UPI_LOGO_DATA_URI } from './upi-logo-constant';

let cachedLogoUri: string | null = null;

export function getUpiLogoDataUri(): string {
  if (cachedLogoUri) return cachedLogoUri;
  try {
    const candidates = [
      path.resolve(__dirname, '../../assets/images/upi-logo-white.png'),
      path.resolve(process.cwd(), 'assets/images/upi-logo-white.png'),
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
  const logoUri = getUpiLogoDataUri();

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <style>
      .font-sans {
        font-family: 'Google Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      }
    </style>
  </defs>

  <!-- Background: #131313 -->
  <rect width="${width}" height="${height}" fill="#131313"/>

  <!-- Checkmark Circle Badge (Google Pay Style) -->
  <g transform="translate(270, 290)">
    <circle r="60" fill="#0B57CF"/>
    <path d="M -17 3 L -4 16 L 20 -8" fill="none" stroke="#FFFFFF" stroke-width="8.5" stroke-linecap="round" stroke-linejoin="round"/>
  </g>

  <!-- Amount with smaller rupee symbol -->
  <text x="270" y="445" class="font-sans" fill="#FFFFFF" text-anchor="middle">
    <tspan font-size="38" dy="-7">₹</tspan><tspan font-size="64" dy="7" font-weight="400">${escapeXml(formattedAmount)}</tspan>
  </text>

  <!-- Paid to -->
  <text x="270" y="555" class="font-sans" font-size="20" font-weight="400" fill="#C4C7C5" text-anchor="middle">Paid to</text>

  <!-- Payee Name / Label -->
  <text x="270" y="602" class="font-sans" font-size="34" font-weight="400" fill="#FFFFFF" text-anchor="middle">${escapeXml(input.payeeLabel)}</text>

  <!-- Date & Time (IST) -->
  <text x="270" y="648" class="font-sans" font-size="21" font-weight="400" fill="#C4C7C5" text-anchor="middle">${escapeXml(formattedDate)}</text>

  <!-- Footer: Powered by UPI -->
  <g transform="translate(270, 875)">
    <!-- POWERED BY text -->
    <text x="0" y="-30" class="font-sans" font-size="10.5" font-weight="500" fill="#C4C7C5" text-anchor="middle" letter-spacing="1.5">POWERED BY</text>

    <!-- Official NPCI UPI Logo (UNIFIED PAYMENTS INTERFACE) -->
    <image x="-60" y="-18" width="120" height="42" href="${logoUri}" preserveAspectRatio="xMidYMid meet"/>
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
