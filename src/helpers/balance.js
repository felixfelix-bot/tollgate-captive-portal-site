// helpers/balance.js
//
// "Internet balance" helpers for the captive portal.
//
// Two different balance sources live here on purpose:
//
//   1. TOKEN balance (getInternetBalance / formatBalance) — what a given Cashu
//      token *would* grant against the selected mint. Computed with the SAME
//      validation + allocation helpers the purchase flow uses, so it never
//      fabricates a number.
//
//   2. SESSION balance (fetchBalanceData / formatMetricValue / estimateSatsSpent)
//      — the tollgate's own view of the CURRENT session, served by the backend
//      on port 2121:
//        GET /balance -> JSON { status, session_active, metric, usage,
//                               allotment, remaining, start_time, mac }
//      `metric` is the merchant's unit: "milliseconds" or "bytes".

// helpers (real implementations)
import { validateToken } from './cashu';
import { calculateAllocation, getTollgateBaseUrl } from './tollgate';

// Compute the internet balance a Cashu token represents for a given mint.
//
// @param {string}  token - a cashu token string
// @param {object}  mint  - a mint/access-option object (from getAccessOptions)
// @param {function} i18n - translation function
// @returns {object} { status: 1, value: { amount, unit, allocation: {value, unit} } }
//                    or { status: 0, code, label, message } when the token is invalid
export const getInternetBalance = (token, mint, i18n) => {
  // validate the token first (format, decode, proof sum, mint match)
  const validation = validateToken(token, mint, i18n);
  if (!validation.status) {
    return validation;
  }

  // derive the internet balance (time/bytes) the token grants
  return {
    status: 1,
    value: {
      amount: validation.value.amount,
      unit: validation.value.unit,
      allocation: calculateAllocation(validation.value.amount, mint, i18n),
    },
  };
};

// Format an allocation object ({ value, unit }) into a single readable string,
// e.g. { value: 10, unit: 'min' } -> "10 min".
export const formatBalance = (allocation) => {
  if (!allocation || allocation.value == null) {
    return '';
  }
  return `${allocation.value} ${allocation.unit}`;
};

// Fetch the current session's balance from the tollgate backend.
// Returns { status: 1, value: <balanceResponse> } or { status: 0, ... }.
export const fetchBalanceData = async () => {
  try {
    const resp = await fetch(`${getTollgateBaseUrl()}/balance`);
    if (!resp.ok) {
      return { status: 0, code: 'network', message: 'Balance unavailable' };
    }
    const data = await resp.json();
    return { status: 1, value: data };
  } catch {
    return { status: 0, code: 'network', message: 'Balance unavailable' };
  }
};

// Render a raw backend amount (milliseconds or bytes) as a compact, human
// readable string. Unknown/non-numeric amounts render as an em dash rather
// than a bogus number.
export const formatMetricValue = (amount, metric) => {
  if (amount == null || amount === '') return '—';

  const value = Number(amount);
  if (!Number.isFinite(value)) return '—';

  if (metric === 'bytes') {
    if (value >= 1073741824) return `${(value / 1073741824).toFixed(1)} GB`;
    if (value >= 1048576) return `${(value / 1048576).toFixed(1)} MB`;
    if (value >= 1024) return `${(value / 1024).toFixed(0)} KB`;
    return `${value} B`;
  }

  // anything that is not "bytes" is treated as time in milliseconds
  const seconds = Math.floor(value / 1000);
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  if (seconds >= 60) return `${Math.floor(seconds / 60)} min`;
  return `${seconds}s`;
};

// Estimate how many sats the used portion of the current session cost.
//
// /balance reports usage in the merchant's metric, never in sats, so this is
// derived from the pricing event: one "step" costs `price / min_steps` sats.
// Returns null (and the caller renders "—") when either the usage or the
// pricing is missing — we never invent a number.
export const estimateSatsSpent = (usage, accessOption) => {
  if (usage == null) return null;
  if (!accessOption) return null;

  const used = Number(usage);
  const stepSize = Number(accessOption.step_size);
  const price = Number(accessOption.price);
  const minSteps = Number(accessOption.min_steps) || 1;

  if (!Number.isFinite(used) || !Number.isFinite(stepSize) || !Number.isFinite(price)) return null;
  if (stepSize <= 0 || price <= 0) return null;

  const steps = used / stepSize;
  const sats = Math.round((steps * price) / minSteps);
  return { sats, unit: accessOption.unit || 'sat' };
};

export const getMetricLabel = (metric, t) => {
  return metric === 'bytes' ? (t ? t('balance_data') : 'Data') : (t ? t('balance_time') : 'Time');
};
