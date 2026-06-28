import { app, BrowserWindow } from 'electron';
import { join } from 'path';
import { createMainWindow } from './window';
import { registerIpcHandlers } from './ipc';
import { initTempDir, cleanupTempDir } from './utils/tempDir';

let mainWindow: BrowserWindow | null = null;

/**
 * Create the main application window
 */
async function createWindow() {
  // Initialize temp directory for session
  await initTempDir();

  // Create main window
  mainWindow = createMainWindow();

  // Register all IPC handlers
  registerIpcHandlers();

  // Load the app
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  // Handle window closed
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/**
 * Register custom protocol schemes before app is ready
 */
const { protocol } = require('electron');
protocol.registerSchemesAsPrivileged([
  { scheme: 'docuflow', privileges: { bypassCSP: true, standard: true, secure: true, supportFetchAPI: true } }
]);

/**
 * App ready event
 */
app.whenReady().then(() => {
  // Register custom protocol for serving local files
  protocol.registerFileProtocol('docuflow', (request: any, callback: any) => {
    let urlPath = request.url.replace('docuflow://', '');
    try {
      let resolvedPath = decodeURIComponent(urlPath);
      
      // On Windows, URLs like docuflow:///C:/path will result in /C:/path after replacing docuflow://
      if (process.platform === 'win32' && resolvedPath.startsWith('/')) {
        resolvedPath = resolvedPath.slice(1);
      }
      
      // Chrome parses "docuflow://C:/path" as host "c", path "/path", effectively stripping the colon.
      // If the path starts with "c/" (or any single letter drive), reconstruct the Windows drive letter "C:/"
      if (process.platform === 'win32' && /^[a-zA-Z]\//.test(resolvedPath)) {
        resolvedPath = resolvedPath[0] + ':/' + resolvedPath.slice(2);
      }
      
      const { normalize } = require('path');
      resolvedPath = normalize(resolvedPath);
      
      console.log(`Custom protocol: resolved ${request.url} to ${resolvedPath}`);
      return callback(resolvedPath);
    } catch (error) {
      console.error('Failed to parse docuflow URL', error);
      return callback('');
    }
  });

  createWindow();
});

/**
 * All windows closed event
 */
app.on('window-all-closed', () => {
  // On macOS, apps stay active until Cmd+Q
  // But this is Windows-only app, so quit
  app.quit();
});

/**
 * Activate event (macOS)
 */
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

/**
 * Before quit - cleanup temp files
 */
app.on('before-quit', async (event) => {
  event.preventDefault();
  await cleanupTempDir();
  app.exit(0);
});

/**
 * Handle unhandled errors
 */
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  // Log error but don't crash the app
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});
