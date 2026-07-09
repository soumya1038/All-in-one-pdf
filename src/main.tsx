import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { useAppStore } from './store/appStore';

// Expose store globally for close confirmation checks
(window as any).useAppStore = useAppStore;

console.log('React starting, window.electron:', window.electron);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
