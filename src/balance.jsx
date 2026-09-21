import React from 'react';
import ReactDOM from 'react-dom/client';

import BalancePage from './BalancePage.jsx';

import './helpers/i18n';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import './index.scss';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <BalancePage />
    </ErrorBoundary>
  </React.StrictMode>
);
