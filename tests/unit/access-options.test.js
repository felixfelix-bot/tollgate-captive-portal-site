import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { AccessOptions } from '../../src/App.jsx';

// Mock react-i18next so AccessOptions can render without a provider.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key) => key,
    i18n: { language: 'en' },
    ready: true,
  }),
  Trans: ({ children }) => children,
  initReactI18next: {
    type: '3rdParty',
    init: () => {},
  },
}));

const noCommentText = (html) => html.replace(/<!--.*?-->/g, '').trim();

describe('AccessOptions bare-"0" render guard (GPL-port #10)', () => {
  it('renders nothing (not a literal "0") when pricingInfo is empty', () => {
    const html = renderToStaticMarkup(
      React.createElement(AccessOptions, {
        pricingInfo: [],
        selectedMint: null,
        setSelectedMint: () => {},
      })
    );
    // React anti-pattern: {arr.length && <JSX>} evaluates to 0 (rendered as text)
    // when the array is empty. The fixed version must emit no text at all.
    expect(noCommentText(html)).toBe('');
  });

  it('renders a button per mint when pricingInfo is non-empty', () => {
    const html = renderToStaticMarkup(
      React.createElement(AccessOptions, {
        pricingInfo: [
          { price: 210, unit: 'sat', url: 'https://mint.example', step_size: 600000, min_steps: 1 },
        ],
        selectedMint: { url: 'https://mint.example' },
        setSelectedMint: () => {},
      })
    );
    expect(noCommentText(html)).toContain('mint.example');
  });
});
