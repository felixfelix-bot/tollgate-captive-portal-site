import React from 'react';

// Catch render errors anywhere in the guest portal so a bug shows a recoverable
// message instead of blanking the whole page. Regression context: the Cashu
// flow dereferenced a null `allocation` during render, which unmounted the app
// and made the captive portal "go away" (2026-09).
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Keep the details in the console for debugging; the UI stays minimal.
    console.error('TollGate portal error:', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: '2rem', textAlign: 'center' }}>
          <h2>Something went wrong</h2>
          <p>Please reload the page to try again.</p>
          <button className="cta" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
