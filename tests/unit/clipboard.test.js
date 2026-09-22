import { describe, it, expect, vi, afterEach } from 'vitest';
import { hasClipboardSupport } from '../../src/helpers/clipboard.js';

describe('hasClipboardSupport (GPL-port #19: hide paste button when clipboard API unavailable)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns true when navigator.clipboard.readText is available', () => {
    vi.stubGlobal('navigator', { clipboard: { readText: () => {} } });
    expect(hasClipboardSupport()).toBe(true);
  });

  it('returns false when navigator is undefined', () => {
    vi.stubGlobal('navigator', undefined);
    expect(hasClipboardSupport()).toBe(false);
  });

  it('returns false when navigator.clipboard is undefined (non-secure context)', () => {
    // Captive portals serve plain HTTP; readText is unavailable.
    vi.stubGlobal('navigator', {});
    expect(hasClipboardSupport()).toBe(false);
  });

  it('returns false when readText is not a function', () => {
    vi.stubGlobal('navigator', { clipboard: {} });
    expect(hasClipboardSupport()).toBe(false);
  });
});
