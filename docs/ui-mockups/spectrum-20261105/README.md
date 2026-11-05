# WiFi channel mockups — feedback gate

**Design only. Every metric, radio, country and state shown is synthetic. No router connection, no production implementation, no hardware or QEMU result.**

## Compare

- **A: decision-first.html / decision-first.png — recommended.** Current versus candidate first, one primary Review action, compact visual comparison. Strong for everyday operators; fewer candidate eligibility details visible. Formula and provenance remain in one disclosure, not deleted.
- **B: evidence-first.html / evidence-first.png.** Channel matrix makes missing evidence and regulatory exclusion explicit. Strong for troubleshooting; denser and horizontally scrollable on narrow phones.
- Each self-contained HTML opens offline. Review opens an honest mock-only dialog with default-off opt-in and acknowledgement; no settings are written. Navigation is visual context, not implemented routing.
- `*-review.png` captures the confirmation; `*-mobile.png` captures responsive layout. Render at 2x with `python render.py` using Python Playwright 1.64.1 and system Google Chrome. `render-results.json` records real browser checks.

Retain upstream dark surfaces, coral primary control, rounded cards, system type and six-item navigation. This is an expanded WiFi admin subview, not a new guest-portal feature. Radio names are illustrative; implementation uses discovered radio IDs/labels, never assumes radio0's band.

## Live source inspection

Fresh upstream snapshots inspected, not existing working checkouts:

- OpenTollGate/tollgate-captive-portal-site `38206d78ca7e053e4f9ea3eabddf8e9f8810fd3a`: `admin/src/routes/wifi.tsx` uses `network.wireless status`, fallback UCI, per-radio current channel/htmode/country and interfaces. `components/layout.tsx` uses Preact (not React proper), Home/WiFi/Peering/Devices/Settings/Wallet. `styles/variables.css` supplies colors. `lib/ubus.ts` is the authenticated RPC seam.
- OpenTollGate/tollgate-module-basic-go `b4f155138b78c1e02cde38ced3502f17bf8dad02`: `src/wireless_gateway_manager/scanner.go` scans `iwinfo <interface> scan`, optionally merges `iw dev <interface> scan` by BSSID, sorts by RSSI and stamps radio bands. It discovers active interface mapping via wireless status. `ScanAllRadios` currently logs/skips individual radio failures: an empty successful aggregate must NOT be interpreted as a successful zero-AP survey.

The inspected scanner path supplies AP observations, not busy/active survey counters. A new capability-aware survey collector and per-radio errors are needed. Do not relabel AP counts/RSSI as utilization. Survey support and off-channel coverage must be proven per driver. Own traffic can contribute to busy time; this is not a calibrated spectrum analyzer and does not identify arbitrary interferers.

## Proposed API seam (not implemented)

Admin Preact -> existing authenticated ubus client -> narrow `tollgate` rpcd methods -> module CLI/service -> radio discovery + read-only survey adapter + existing AP scanner. No guest endpoint, no generic shell execution from browser.

Proposed `wifi_channel_status` response, versioned:

- radio ID, PHY mapping, band, current primary frequency/channel, center frequency, width, configured versus observed channel, country, allowed-channel/width list, DFS/CAC state and timestamp;
- capabilities: survey supported, safe off-channel collection available, AP/STA concurrency, active upstream constraint;
- per-channel survey: state (`fresh/stale/unknown/unavailable/error`), source, observed_at, window_ms, sample_count, raw delta_active_ms and delta_busy_ms, nullable busy_pct, width, reason;
- separate AP observation: observed_at, state, unique BSSID count and strongest RSSI. Return aggregate counts by default, no neighbor identities;
- recommendation: nullable target, eligible candidate set, reason, comparable evidence windows and expiry; policy and last-action/cooldown state.

Busy percent = 100 * delta_busy / delta_active. Reject zero denominator, reset/wrap, negative deltas, busy > active, width/radio/channel mismatch and stale samples; do not silently clamp or substitute zero. Current-channel-only hardware can display current utilization but cannot fabricate ranked off-channel measurements. AP-only suggestions, if later offered, need a separately labeled heuristic and must not trigger survey-based auto selection.

Proposed preview/apply methods accept a short-lived recommendation/config revision and idempotency key. Module rechecks topology, regulatory/DFS eligibility, freshness and lock; UI never chooses a channel by itself. Separate persisted policy configuration in module schema (provisional names: `wifi_channel_policy[radio].enabled`, minimum improvement, consecutive windows, cooldown, allowed candidates and rollback timeout). Explicit false must survive reload/migration. Runtime evidence is not persisted as configuration. Current writer ownership must be resolved before implementation to avoid UCI/module restart reverting each other.

## Acceptance gates BEFORE production PRs

1. Operator chooses A/B and approves control semantics. The 15 pp / 3-window / 30-minute / 60-second numbers are proposals, not agreed defaults or proven safety.
2. Module tests: real parser fixtures + counter edge cases, absent/stale/error vs zero, bounded scan timeouts, dedup, regulatory/width/DFS filtering and unknown-country fail-closed. No independent AP channel on a single-channel shared AP/STA PHY.
3. State machine tests: default off, explicit opt-in persisted, stable-window hysteresis and cooldown, concurrent request serialization, expired preview rejection, upstream appearing between preview/apply, persisted recovery snapshot, restart/crash and rollback failure states.
4. Portal contract/browser tests: permissions and guest denial, unknown fields/version handling, stale evidence cannot enable apply, measurement vs scan labels, keyboard dialog/focus, responsive/light/dark themes, localization and no neighbor identities on guest routes.
5. QEMU: real OpenWrt module/rpcd integration, authenticated ACLs and config persistence; simulated survey inputs explicitly labeled. QEMU is NOT RF evidence.
6. Authorized PRTA hardware reservation only: measure driver survey support, real channel/width/country/DFS, off-channel sampling interruption, AP/STA constraint, connectivity through switch, bounded recovery and rollback, repeat cooldown behavior. Compare installed bytes to branch artifact. No current hardware result; no lab mutation in this task.
7. Separate upstream module + portal production PRs only after mockup feedback, with coordinated schema/API delivery. No production claim from these screenshots.

## Verification

Real headless Chrome execution: both main views rendered, no page errors; Review opens; opt-in unchecked; acknowledgement reports nothing applied; 390px document has no horizontal overflow; alternatives have distinct PNG bytes. Visual review found a fixed-nav overlap in B; changed mock navigation to normal flow, re-rendered, and verified Radio B and all content clear. A and review dialog also visually reviewed. This is UI artifact verification only.

## Feedback questions

1. A decision-first or B evidence-first? Recommendation: A, with B's comparison table available under Details.
2. Manual review initially, or expose default-off automatic selection at first release? Recommend manual-first until hardware rollback gates pass.
3. Accept the proposed safety thresholds as starting test parameters, or require a maintenance window for every change?
