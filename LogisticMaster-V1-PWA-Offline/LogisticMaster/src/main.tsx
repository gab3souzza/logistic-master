import React from 'react';
import ReactDOM from 'react-dom/client';
import PlatformApp from './platform/PlatformApp';
import './index.css';

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => undefined));
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PlatformApp />
  </React.StrictMode>
);
