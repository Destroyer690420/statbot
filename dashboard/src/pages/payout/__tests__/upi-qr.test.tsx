import React from 'react';
(globalThis as any).React = React;
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { buildUpiPayLink } from '../utils/upiLink';
import { PayWorkerModal } from '../components/PayWorkerModal';
import { PayInviterModal } from '../components/PayInviterModal';

describe('buildUpiPayLink util', () => {
  it('correctly formats basic pa, am (with 2 decimals), and cu=INR', () => {
    const link = buildUpiPayLink('merchant@upi', 150);
    assert.strictEqual(link, 'upi://pay?pa=merchant%40upi&am=150.00&cu=INR');
  });

  it('always formats am with two decimal places', () => {
    assert.ok(buildUpiPayLink('test@bank', 50).includes('am=50.00'));
    assert.ok(buildUpiPayLink('test@bank', 60.5).includes('am=60.50'));
    assert.ok(buildUpiPayLink('test@bank', 99.99).includes('am=99.99'));
    assert.ok(buildUpiPayLink('test@bank', 0).includes('am=0.00'));
  });

  it('includes pn (payeeLabel) when provided', () => {
    const link = buildUpiPayLink('john@upi', 200, 'ticket-0594');
    assert.strictEqual(link, 'upi://pay?pa=john%40upi&am=200.00&cu=INR&pn=ticket-0594');
  });

  it('includes tn (note) when provided', () => {
    const link = buildUpiPayLink('john@upi', 200, 'worker1', 'Weekly payout');
    assert.strictEqual(link, 'upi://pay?pa=john%40upi&am=200.00&cu=INR&pn=worker1&tn=Weekly+payout');
  });

  it('correctly URL-encodes special characters in pn and tn', () => {
    const link = buildUpiPayLink('special@upi', 500, 'Alice & Bob / ticket #123', 'Payout for task ?a=1&b=2');
    const url = new URL(link);
    assert.strictEqual(url.protocol, 'upi:');
    assert.strictEqual(url.searchParams.get('pa'), 'special@upi');
    assert.strictEqual(url.searchParams.get('am'), '500.00');
    assert.strictEqual(url.searchParams.get('cu'), 'INR');
    assert.strictEqual(url.searchParams.get('pn'), 'Alice & Bob / ticket #123');
    assert.strictEqual(url.searchParams.get('tn'), 'Payout for task ?a=1&b=2');
  });
});

describe('PayWorkerModal states', () => {
  const createWrapper = (data: { qrCodeUrl: string | null; upiId: string | null } | null) => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    if (data !== null) {
      queryClient.setQueryData(['worker-qr', 'worker-101'], {
        success: true,
        data,
      });
    }
    return ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };

  it('State 1: renders generated QR (QRCodeSVG) with pre-filled amount copy when upiId is present', () => {
    const Wrapper = createWrapper({
      qrCodeUrl: 'https://example.com/uploads/worker-101.png',
      upiId: 'worker101@okaxis',
    });
    const html = renderToStaticMarkup(
      <Wrapper>
        <PayWorkerModal
          workerId="worker-101"
          workerName="ticket-0101"
          totalAmount={450}
          dateParams={{}}
          onClose={() => {}}
          onPaid={() => {}}
        />
      </Wrapper>
    );

    // Generated QR code is an SVG
    assert.ok(html.includes('<svg'), 'Should render generated SVG QR code');
    // Helper copy reflects pre-filled amount
    assert.ok(html.includes('Scan to pay — the amount is already filled in.'));
    // Shows copyable UPI ID
    assert.ok(html.includes('worker101@okaxis'));
  });

  it('State 2: falls back to uploaded static image when upiId is null', () => {
    const Wrapper = createWrapper({
      qrCodeUrl: 'https://example.com/uploads/worker-101.png',
      upiId: null,
    });
    const html = renderToStaticMarkup(
      <Wrapper>
        <PayWorkerModal
          workerId="worker-101"
          workerName="ticket-0101"
          totalAmount={450}
          dateParams={{}}
          onClose={() => {}}
          onPaid={() => {}}
        />
      </Wrapper>
    );

    // Renders uploaded image
    assert.ok(html.includes('<img src="https://example.com/uploads/worker-101.png"'));
    // Generic copy
    assert.ok(html.includes('Scan the QR to pay, then Confirm to record the payment.'));
    // Does not show UPI ID container
    assert.ok(!html.includes('Copy UPI ID'));
  });

  it('State 3: falls back to placeholder when neither upiId nor qrCodeUrl exists', () => {
    const Wrapper = createWrapper({
      qrCodeUrl: null,
      upiId: null,
    });
    const html = renderToStaticMarkup(
      <Wrapper>
        <PayWorkerModal
          workerId="worker-101"
          workerName="ticket-0101"
          totalAmount={450}
          dateParams={{}}
          onClose={() => {}}
          onPaid={() => {}}
        />
      </Wrapper>
    );

    // Shows placeholder
    assert.ok(html.includes('No QR code uploaded yet'));
    // Confirm button remains present and enabled
    assert.ok(html.includes('Confirm'));
    assert.ok(!html.includes('<img'));
  });
});

describe('PayInviterModal states', () => {
  const createWrapper = (data: { qrCodeUrl: string | null; upiId: string | null } | null) => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    if (data !== null) {
      queryClient.setQueryData(['inviter-qr', 'inviter-202'], {
        success: true,
        data,
      });
    }
    return ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };

  it('State 1: renders generated QR (QRCodeSVG) with pre-filled amount copy when upiId is present', () => {
    const Wrapper = createWrapper({
      qrCodeUrl: 'https://example.com/uploads/inviter-202.png',
      upiId: 'inviter202@ybl',
    });
    const html = renderToStaticMarkup(
      <Wrapper>
        <PayInviterModal
          inviterId="inviter-202"
          inviterName="TopInviter"
          totalCommission={250}
          onClose={() => {}}
          onPaid={() => {}}
        />
      </Wrapper>
    );

    // Generated QR code is an SVG
    assert.ok(html.includes('<svg'), 'Should render generated SVG QR code');
    // Helper copy reflects pre-filled amount
    assert.ok(html.includes('Scan to pay — the amount is already filled in.'));
    // Shows copyable UPI ID
    assert.ok(html.includes('inviter202@ybl'));
  });

  it('State 2: falls back to uploaded static image when upiId is null', () => {
    const Wrapper = createWrapper({
      qrCodeUrl: 'https://example.com/uploads/inviter-202.png',
      upiId: null,
    });
    const html = renderToStaticMarkup(
      <Wrapper>
        <PayInviterModal
          inviterId="inviter-202"
          inviterName="TopInviter"
          totalCommission={250}
          onClose={() => {}}
          onPaid={() => {}}
        />
      </Wrapper>
    );

    // Renders uploaded image
    assert.ok(html.includes('<img src="https://example.com/uploads/inviter-202.png"'));
    // Generic copy
    assert.ok(html.includes('Scan the QR to pay, then Confirm to record the commission payment.'));
    // Does not show UPI ID container
    assert.ok(!html.includes('Copy UPI ID'));
  });

  it('State 3: falls back to placeholder when neither upiId nor qrCodeUrl exists', () => {
    const Wrapper = createWrapper({
      qrCodeUrl: null,
      upiId: null,
    });
    const html = renderToStaticMarkup(
      <Wrapper>
        <PayInviterModal
          inviterId="inviter-202"
          inviterName="TopInviter"
          totalCommission={250}
          onClose={() => {}}
          onPaid={() => {}}
        />
      </Wrapper>
    );

    // Shows placeholder
    assert.ok(html.includes('No QR code uploaded yet'));
    // Confirm button remains present and enabled
    assert.ok(html.includes('Confirm'));
    assert.ok(!html.includes('<img'));
  });
});
