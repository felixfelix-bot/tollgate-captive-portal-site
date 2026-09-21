import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

// Reproduce the pre13 blank-portal bug: a valid token is entered in one update
// (paste), so `tokenValue` becomes set while the fee-adjusted `allocation` is
// still null and no error is set. The purchase-button branch used to read
// `allocation.value` and throw ("can't access property \"value\", E is null"),
// unmounting the portal. The render guard must keep this safe.

vi.mock('../../src/helpers/cashu.js', () => ({
  validateToken: () => ({ status: true, value: { amount: 100, unit: 'sat' } }),
  submitToken: vi.fn(),
}));
vi.mock('../../src/helpers/mint-fee.js', () => ({
  getMintSwapFee: vi.fn(async () => ({ status: false })),
}));
vi.mock('../../src/helpers/tollgate.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getAccessOptions: () => [
      { price: 1, metric: 'milliseconds', step_size: 1000 },
    ],
    // keep allocation null so only the guard prevents the crash
    calculateAllocation: () => null,
  };
});
vi.mock('../../src/helpers/qr-code.js', () => ({
  requestScanQr: vi.fn(),
  hasCameraSupport: () => false,
}));
vi.mock('../../src/helpers/clipboard.js', () => ({
  requestPaste: vi.fn(),
}));
// Stub the pieces that pull in the i18n runtime / browser chrome so the test
// exercises only the Cashu render logic.
vi.mock('../../src/App.jsx', () => ({
  Processing: () => null,
  AccessGranted: () => null,
  AccessOptions: () => null,
}));
vi.mock('../../src/components/LanguageSwitcher.jsx', () => ({ default: () => null }));
vi.mock('../../src/components/DeviceInfo.jsx', () => ({ default: () => null }));

import { Cashu } from '../../src/components/Cashu.jsx';

const details = { detailsEvent: { pubkey: '0'.repeat(64) } };

describe('Cashu render guard', () => {
  afterEach(() => cleanup());

  it('does not crash when a valid token is set before allocation resolves', () => {
    render(<Cashu tollgateDetails={details} />);

    const input = document.querySelector('#cashu-token');
    expect(input).toBeTruthy();

    // paste-equivalent: the whole token in a single change event
    fireEvent.change(input, { target: { value: 'cashuBvalidtoken' } });

    // No throw; the disabled purchase button renders (allocation still null).
    expect(screen.getByText('purchase')).toBeInTheDocument();
  });
});
