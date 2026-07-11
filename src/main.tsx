import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { useAppStore } from './store/appStore';

// Expose store globally so the Electron main process can inspect app state
// during the window close event (via webContents.executeJavaScript) to warn
// users before closing during an active operation. See electron/main/index.ts.
(window as unknown as { useAppStore: typeof useAppStore }).useAppStore = useAppStore;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
