// external
import React from 'react';
import ReactDOM from 'react-dom/client';

// internal
import App from './App.jsx';

// helpers
import './helpers/i18n';

// styles and assets
import ErrorBoundary from './components/ErrorBoundary.jsx';
import './index.scss';

// render app in element with id root
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
); 