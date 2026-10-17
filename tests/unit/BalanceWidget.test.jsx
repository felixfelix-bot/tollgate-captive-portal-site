import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

import { BalanceWidget } from '../../src/components/BalanceWidget.jsx';

// Backend contract (tollgate-module-basic-go, balanceResponse):
//   { status, session_active, metric, usage, allotment, remaining, start_time, mac }
const timeBalance = {
  status: 1,
  session_active: true,
  metric: 'milliseconds',
  usage: 300000,
  allotment: 600000,
  remaining: 300000,
  start_time: 1700000000,
};

const dataBalance = {
  status: 1,
  session_active: true,
  metric: 'bytes',
  usage: 1048576,
  allotment: 10485760,
  remaining: 9437184,
  start_time: 1700000000,
};

const accessOption = {
  metric: 'milliseconds',
  step_size: 600000,
  price: 210,
  unit: 'sat',
  min_steps: 1,
};

const mockFetchOnce = (body, ok = true) => vi.fn().mockResolvedValue({ ok, json: async () => body });

describe('BalanceWidget', () => {
  beforeEach(() => {
    global.fetch = mockFetchOnce(timeBalance);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the remaining time as the primary value plus used/total and sats spent', async () => {
    render(<BalanceWidget pollIntervalMs={0} accessOption={accessOption} />);

    await waitFor(() => expect(screen.getByTestId('balance-widget')).toBeInTheDocument());

    expect(screen.getByTestId('balance-widget-remaining').textContent).toBe('5 min');
    expect(screen.getByTestId('balance-widget-used').textContent).toBe('5 min');
    expect(screen.getByTestId('balance-widget-total').textContent).toBe('10 min');
    expect(screen.getByTestId('balance-widget-sats-spent').textContent).toContain('105');
  });

  it('renders the data metric primary value in MB', async () => {
    global.fetch = mockFetchOnce(dataBalance);

    render(<BalanceWidget pollIntervalMs={0} accessOption={{ ...accessOption, metric: 'bytes' }} />);

    await waitFor(() => expect(screen.getByTestId('balance-widget')).toBeInTheDocument());

    expect(screen.getByTestId('balance-widget-remaining').textContent).toBe('9.0 MB');
    expect(screen.getByTestId('balance-widget-used').textContent).toBe('1.0 MB');
    expect(screen.getByTestId('balance-widget-total').textContent).toBe('10.0 MB');
  });

  it('hides itself entirely when the device has no active session', async () => {
    global.fetch = mockFetchOnce({ status: 1, session_active: false });

    const { container } = render(<BalanceWidget pollIntervalMs={0} accessOption={accessOption} />);

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    await waitFor(() => expect(container.querySelector('.balance-widget')).toBeNull());
  });

  it('hides the sats row instead of inventing a number when pricing is unknown', async () => {
    render(<BalanceWidget pollIntervalMs={0} />);

    await waitFor(() => expect(screen.getByTestId('balance-widget')).toBeInTheDocument());

    expect(screen.getByTestId('balance-widget-sats-spent').textContent).toContain('—');
  });

  it('polls the backend repeatedly while mounted', async () => {
    render(<BalanceWidget pollIntervalMs={20} accessOption={accessOption} />);

    await waitFor(() => expect(screen.getByTestId('balance-widget')).toBeInTheDocument());
    await waitFor(() => expect(global.fetch.mock.calls.length).toBeGreaterThan(1));
  });

  it('marks the card header so the top corners are rounded (DESIGN-2 / TASK B)', async () => {
    render(<BalanceWidget pollIntervalMs={0} accessOption={accessOption} />);

    await waitFor(() => expect(screen.getByTestId('balance-widget')).toBeInTheDocument());

    expect(screen.getByTestId('balance-widget').querySelector('.balance-widget-header')).not.toBeNull();
  });
});
