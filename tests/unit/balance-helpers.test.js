import { describe, it, expect } from 'vitest';

import { formatMetricValue, estimateSatsSpent, fetchBalanceData } from '../../src/helpers/balance.js';

// The backend (tollgate-module-basic-go: balanceResponse) reports usage/allotment/
// remaining in the merchant's metric: "milliseconds" or "bytes". The widget has to
// render those raw numbers as human-readable "remaining MB" / "time remaining".
describe('formatMetricValue', () => {
  it('formats bytes >= 1 MiB as MB with one decimal', () => {
    expect(formatMetricValue(9 * 1048576, 'bytes')).toBe('9.0 MB');
  });

  it('formats bytes >= 1 GiB as GB', () => {
    expect(formatMetricValue(2 * 1073741824, 'bytes')).toBe('2.0 GB');
  });

  it('formats bytes >= 1 KiB as KB', () => {
    expect(formatMetricValue(2048, 'bytes')).toBe('2 KB');
  });

  it('formats small byte counts as B', () => {
    expect(formatMetricValue(512, 'bytes')).toBe('512 B');
  });

  it('formats milliseconds >= 1h as "1h 30m"', () => {
    expect(formatMetricValue(5400000, 'milliseconds')).toBe('1h 30m');
  });

  it('formats milliseconds >= 1 min as minutes', () => {
    expect(formatMetricValue(540000, 'milliseconds')).toBe('9 min');
  });

  it('formats milliseconds < 1 min as seconds', () => {
    expect(formatMetricValue(30000, 'milliseconds')).toBe('30s');
  });

  it('treats an unknown metric as time', () => {
    expect(formatMetricValue(540000, '')).toBe('9 min');
  });

  it('returns an em dash when the amount is missing or not numeric', () => {
    expect(formatMetricValue(null, 'bytes')).toBe('—');
    expect(formatMetricValue(undefined, 'milliseconds')).toBe('—');
    expect(formatMetricValue('nope', 'bytes')).toBe('—');
  });
});

// "Sats spent" is not a backend field: /balance reports usage in the merchant's
// metric. The portal therefore *estimates* it from usage + the pricing event
// (price_per_step / min_steps / step_size), and must say nothing rather than
// invent a number when the pricing is unknown.
describe('estimateSatsSpent', () => {
  const option = { metric: 'milliseconds', step_size: 600000, price: 210, unit: 'sat', min_steps: 1 };

  it('scales the step price by the fraction of a step consumed', () => {
    expect(estimateSatsSpent(300000, option)).toEqual({ sats: 105, unit: 'sat' });
  });

  it('divides the price by min_steps before scaling', () => {
    expect(estimateSatsSpent(600000, { ...option, min_steps: 2 })).toEqual({ sats: 105, unit: 'sat' });
  });

  it('rounds to whole sats', () => {
    expect(estimateSatsSpent(100000, option)).toEqual({ sats: 35, unit: 'sat' });
  });

  it('returns null when usage or pricing is missing', () => {
    expect(estimateSatsSpent(null, option)).toBeNull();
    expect(estimateSatsSpent(300000, null)).toBeNull();
    expect(estimateSatsSpent(300000, { ...option, step_size: 0 })).toBeNull();
  });
});

describe('fetchBalanceData', () => {
  it('queries the tollgate backend on port 2121', async () => {
    const payload = { status: 1, session_active: true, metric: 'bytes', usage: 1, allotment: 2, remaining: 1 };
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => payload });

    const result = await fetchBalanceData();

    expect(global.fetch).toHaveBeenCalledWith('http://localhost:2121/balance');
    expect(result).toEqual({ status: 1, value: payload });
  });

  it('returns a network error object when the backend is unreachable', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('offline'));

    const result = await fetchBalanceData();

    expect(result.status).toBe(0);
  });
});
