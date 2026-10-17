// external
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

// helpers
import { fetchBalanceData, formatMetricValue, estimateSatsSpent } from '../helpers/balance';

// styles and assets
import './BalanceWidget.scss';

// How often the widget re-reads GET /balance. The backend computes the values
// on demand, so polling is cheap; 15s keeps the countdown-ish display honest
// without hammering a small router.
export const DEFAULT_BALANCE_POLL_INTERVAL_MS = 15000;

// BalanceWidget: a small, always-visible "internet balance" card for a device
// with an ACTIVE session. It shows the remaining allowance as the primary
// value (MB for data merchants, time for time merchants), plus the used/total
// allowance for the session and an estimate of the sats spent so far.
//
// `/balance` reports ONE metric per merchant ("bytes" or "milliseconds"), so
// the card never invents the other one: a data merchant gets MB, a time
// merchant gets time.
//
// It renders NOTHING when the backend reports no active session (or when the
// backend is unreachable), so the purchase flow is never hidden behind a
// meaningless empty card.
//
// TASK B (DESIGN-2): the card's header carries the rounded top-left and
// top-right corners — see BalanceWidget.scss.
export const BalanceWidget = (props) => {
  const { t } = useTranslation();
  const {
    accessOption = null,
    pollIntervalMs = DEFAULT_BALANCE_POLL_INTERVAL_MS,
  } = props;

  const [balance, setBalance] = useState(null);

  // poll /balance while mounted
  useEffect(() => {
    let active = true;

    const load = async () => {
      const response = await fetchBalanceData();
      if (!active) return;
      // an unreachable backend is not an error worth shouting about on the
      // portal — just stop showing a balance we cannot verify
      setBalance(response.status ? response.value : null);
    };

    load();

    if (!pollIntervalMs) {
      return () => { active = false; };
    }

    const interval = window.setInterval(load, pollIntervalMs);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [pollIntervalMs]);

  if (!balance || !balance.session_active) {
    return null;
  }

  const metric = balance.metric || '';
  const remaining = formatMetricValue(balance.remaining, metric);
  const used = formatMetricValue(balance.usage, metric);
  const total = formatMetricValue(balance.allotment, metric);
  const sats = estimateSatsSpent(balance.usage, accessOption);

  return <div className="balance-widget" data-testid="balance-widget">
    <div className="balance-widget-header">
      <p className="balance-widget-label">{t('balance_label')}</p>
      <p className="balance-widget-remaining" data-testid="balance-widget-remaining">{remaining}</p>
    </div>

    <div className="balance-widget-body">
      <div className="balance-widget-row">
        <span className="balance-widget-row-label">{t('balance_used')}</span>
        <span className="balance-widget-row-value" data-testid="balance-widget-used">{used}</span>
      </div>

      <div className="balance-widget-row">
        <span className="balance-widget-row-label">{t('balance_total')}</span>
        <span className="balance-widget-row-value" data-testid="balance-widget-total">{total}</span>
      </div>

      <div className="balance-widget-row">
        <span className="balance-widget-row-label">{t('balance_sats_spent')}</span>
        <span className="balance-widget-row-value" data-testid="balance-widget-sats-spent">
          {sats ? `~${sats.sats} ${sats.unit}` : '—'}
        </span>
      </div>
    </div>
  </div>;
};

export default BalanceWidget;
