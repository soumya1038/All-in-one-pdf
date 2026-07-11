import { BrowserWindow } from 'electron';
import { join } from 'path';

/**
 * Create the main application window with proper security settings
 * @returns BrowserWindow instance
 */
export function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#F7F6F4',
    titleBarStyle: 'hidden',
    frame: false,
    webPreferences: {
      // Security: isolate context and disable node integration
      nodeIntegration: false,
      contextIsolation: true,
      // Preload script to expose safe IPC API
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      // Disable web security features to allow iframe loading local file:// resources
      webSecurity: false,
      allowRunningInsecureContent: false,
      // Enable dev tools only in development
      devTools: process.env.NODE_ENV === 'development',
    },
    show: false, // Don't show until ready-to-show
  });

  // Show window when ready (prevents white flash)
  window.once('ready-to-show', () => {
    window.show();
  });

  // Set Content Security Policy
  const isDev = process.env.NODE_ENV === 'development';
  const csp = isDev
    ? ["default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: file:; connect-src 'self' ws: http: https: blob: data:; img-src 'self' data: blob: file: docuflow:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; frame-src 'self' file:; object-src 'self' file:; worker-src 'self' blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: file:;"]
    : ["default-src 'self' file:; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: file:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: file: docuflow:; connect-src 'self' https: blob: data:; frame-src 'self' file:; object-src 'self' file:; worker-src 'self' blob:;"];

  window.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': csp,
      },
    });
  });

  // Forward renderer console logs to main terminal
  window.webContents.on('console-message', (_event, _level, message, _line, _sourceId) => {
    console.log(`[Renderer] ${message}`);
  });

  return window;
}
