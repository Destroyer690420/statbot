import sharp from 'sharp';
import {
  buildReceiptSvg,
  escapeXml,
  formatReceiptAmount,
  formatReceiptDate,
  generatePayoutReceipt,
} from '../services/payout-receipt.service';
import { parsePayeeName } from '../utils/payment-qr';

describe('payout receipt formatting helpers', () => {
  test('formatReceiptAmount formats integers without decimals and decimals with two places', () => {
    expect(formatReceiptAmount(420)).toBe('420');
    expect(formatReceiptAmount(2000)).toBe('2,000');
    expect(formatReceiptAmount(150.5)).toBe('150.50');
    expect(formatReceiptAmount(2000.75)).toBe('2,000.75');
  });

  test('formatReceiptDate formats in IST', () => {
    const d = new Date('2026-10-19T17:40:00Z'); // 11:10 PM IST
    const formatted = formatReceiptDate(d);
    expect(formatted).toMatch(/19 October 2026/);
    expect(formatted).toMatch(/11:10 pm/);
  });

  test('escapeXml escapes dangerous characters', () => {
    expect(escapeXml('<script>&"\'</script>')).toBe('&lt;script&gt;&amp;&quot;&apos;&lt;/script&gt;');
  });

  test('parsePayeeName extracts and cleans pn parameter from upi:// URLs', () => {
    expect(parsePayeeName('upi://pay?pa=worker@okaxis&pn=John%20Doe')).toBe('John Doe');
    expect(parsePayeeName('upi://pay?pa=worker@okaxis&pn=MR%20%20Daksh')).toBe('MR Daksh');
    expect(parsePayeeName('upi://pay?pa=worker@okaxis')).toBeNull();
    expect(parsePayeeName('upi://pay?pa=worker@okaxis&pn=   ')).toBeNull();
    expect(parsePayeeName('https://example.com?pn=John')).toBeNull();
    expect(parsePayeeName('invalid-url')).toBeNull();
  });
});

describe('buildReceiptSvg and generatePayoutReceipt', () => {
  test('buildReceiptSvg includes amount, payee label, and conditionally renders upiId', () => {
    const withUpi = buildReceiptSvg({
      amount: 2000,
      payeeLabel: 'MR Daksh',
      upiId: 'daksh100@slc',
      paidAt: new Date('2026-10-19T17:40:00Z'),
    });

    expect(withUpi).toContain('₹2,000');
    expect(withUpi).toContain('Paid to');
    expect(withUpi).toContain('MR Daksh');
    expect(withUpi).toContain('daksh100@slc');
    expect(withUpi).toContain('POWERED BY');
    expect(withUpi).toContain('UNIFIED PAYMENTS INTERFACE');
    expect(withUpi).toContain('y="632"');

    const withoutUpi = buildReceiptSvg({
      amount: 420,
      payeeLabel: 'ticket-0595',
      paidAt: new Date('2026-10-19T17:40:00Z'),
    });

    expect(withoutUpi).toContain('₹420');
    expect(withoutUpi).toContain('ticket-0595');
    expect(withoutUpi).not.toContain('daksh100@slc');
    // Shifts up to 595
    expect(withoutUpi).toContain('y="595"');
  });

  test('generatePayoutReceipt returns a valid 540x960 PNG buffer', async () => {
    const buffer = await generatePayoutReceipt({
      amount: 2000,
      payeeLabel: 'MR Daksh',
      upiId: 'daksh100@slc',
      paidAt: new Date('2026-10-19T17:40:00Z'),
    });

    expect(Buffer.isBuffer(buffer)).toBe(true);
    const meta = await sharp(buffer).metadata();
    expect(meta.format).toBe('png');
    expect(meta.width).toBe(540);
    expect(meta.height).toBe(960);
  });
});
