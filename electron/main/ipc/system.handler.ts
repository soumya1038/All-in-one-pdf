import { ipcMain, shell, BrowserWindow, dialog } from 'electron';
import { IpcChannel } from '../../../src/types/IPC.types';
import { Result, ErrorCode } from '../../../src/types/Error.types';
import { RecentFile } from '../../../src/types/Document.types';
import { cleanupTempDir } from '../utils/tempDir';
import { FileService } from '../services/file.service';
import Store from 'electron-store';

const store = new Store<{ recentFiles: RecentFile[] }>();
const MAX_RECENT_FILES = 20;

/**
 * Register system-related IPC handlers
 */
export function registerSystemHandlers(): void {
  /**
   * Get recent files from persistent storage
   */
  ipcMain.handle(IpcChannel.SYSTEM_GET_RECENT, async () => {
    try {
      const recentFiles = store.get('recentFiles', []);
      const result: Result<RecentFile[]> = { success: true, data: recentFiles };
      return result;
    } catch (error) {
      const result: Result<RecentFile[]> = {
        success: false,
        error: {
          code: ErrorCode.UNKNOWN_ERROR,
          message: 'Failed to load recent files',
          detail: error instanceof Error ? error.message : 'Unknown error',
          recoverable: true,
        },
      };
      return result;
    }
  });

  /**
   * Add a recent file entry to persistent storage
   */
  ipcMain.handle(IpcChannel.SYSTEM_ADD_RECENT, async (_, file: RecentFile) => {
    try {
      const existing = store.get('recentFiles', []);
      // Remove duplicate entries for the same path
      const filtered = existing.filter((f) => f.path !== file.path);
      // Prepend new entry and limit to max
      const updated = [file, ...filtered].slice(0, MAX_RECENT_FILES);
      store.set('recentFiles', updated);
      const result: Result<void> = { success: true, data: undefined };
      return result;
    } catch (error) {
      const result: Result<void> = {
        success: false,
        error: {
          code: ErrorCode.UNKNOWN_ERROR,
          message: 'Failed to save recent file',
          detail: error instanceof Error ? error.message : 'Unknown error',
          recoverable: true,
        },
      };
      return result;
    }
  });

  /**
   * Clear temp directory
   */
  ipcMain.handle(IpcChannel.SYSTEM_CLEAR_TEMP, async () => {
    try {
      await cleanupTempDir();
      const result: Result<void> = { success: true, data: undefined };
      return result;
    } catch (error) {
      const result: Result<void> = {
        success: false,
        error: {
          code: ErrorCode.UNKNOWN_ERROR,
          message: 'Failed to clear temp directory',
          detail: error instanceof Error ? error.message : 'Unknown error',
          recoverable: true,
        },
      };
      return result;
    }
  });

  /**
   * Open file in the default associated application
   */
  ipcMain.handle(IpcChannel.SYSTEM_OPEN_FILE, async (_, filePath: string) => {
    try {
      const err = await shell.openPath(filePath);
      if (err) throw new Error(err);
      const result: Result<void> = { success: true, data: undefined };
      return result;
    } catch (error) {
      const result: Result<void> = {
        success: false,
        error: {
          code: ErrorCode.UNKNOWN_ERROR,
          message: 'Failed to open file',
          detail: error instanceof Error ? error.message : 'Unknown error',
          recoverable: false,
        },
      };
      return result;
    }
  });

  /**
   * Open Explorer at the file location (with the file highlighted).
   * BUG FIX: was using shell.openPath(folder) which just opened the folder.
   * Now uses shell.showItemInFolder(filePath) so Explorer opens with the file selected.
   */
  ipcMain.handle(IpcChannel.SYSTEM_OPEN_FOLDER, async (_, filePath: string) => {
    try {
      shell.showItemInFolder(filePath);
      const result: Result<void> = { success: true, data: undefined };
      return result;
    } catch (error) {
      const result: Result<void> = {
        success: false,
        error: {
          code: ErrorCode.UNKNOWN_ERROR,
          message: 'Failed to open folder',
          detail: error instanceof Error ? error.message : 'Unknown error',
          recoverable: false,
        },
      };
      return result;
    }
  });

  /**
   * Show native open-file dialog
   */
  ipcMain.handle(IpcChannel.SYSTEM_SHOW_OPEN_DIALOG, async (_, options) => {
    try {
      const result = await dialog.showOpenDialog(options || {
        properties: ['openFile', 'multiSelections'],
      });
      if (result.canceled) return { success: true, data: [] };
      return { success: true, data: result.filePaths };
    } catch (error) {
      return {
        success: false,
        error: {
          code: ErrorCode.UNKNOWN_ERROR,
          message: 'Failed to open file dialog',
          detail: error instanceof Error ? error.message : 'Unknown error',
          recoverable: true,
        },
      };
    }
  });

  /**
   * Show a native yes/no confirmation dialog (replaces window.confirm in renderer)
   */
  ipcMain.handle(IpcChannel.SYSTEM_DIALOG_CONFIRM, async (_, message: string, title = 'Confirm') => {
    try {
      const focusedWindow = BrowserWindow.getFocusedWindow();
      const opts = {
        type: 'question' as const,
        buttons: ['Cancel', 'Confirm'],
        defaultId: 1,
        cancelId: 0,
        title,
        message,
      };

      const result = focusedWindow
        ? await dialog.showMessageBox(focusedWindow, opts)
        : await dialog.showMessageBox(opts);

      return result.response === 1; // true = Confirm clicked
    } catch {
      return false;
    }
  });

  /**
   * Print a document
   */
  ipcMain.handle(IpcChannel.SYSTEM_PRINT, async (_, documentId: string) => {
    let printWindow: BrowserWindow | null = null;
    try {
      const fileService = new FileService();
      const document = fileService.getDocument(documentId);
      if (!document) {
        return {
          success: false,
          error: {
            code: ErrorCode.FILE_NOT_FOUND,
            message: 'Document not found',
            recoverable: false,
          },
        };
      }

      printWindow = new BrowserWindow({
        show: false,
        webPreferences: { nodeIntegration: false, contextIsolation: true },
      });

      if (document.type === 'PDF') {
        await printWindow.loadURL(`docuflow:///${document.tempPath.replace(/\\/g, '/')}`);
      } else {
        const url = `docuflow:///${document.tempPath.replace(/\\/g, '/')}`;
        const html = `<html><head><style>@page{size:auto;margin:0}body{margin:0;display:flex;justify-content:center;align-items:center;height:100vh;background:#fff}img{max-width:100%;max-height:100%;object-fit:contain}</style></head><body><img src="${url}"/></body></html>`;
        await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      }

      await printWindow.webContents.print({ silent: false, printBackground: true });
      printWindow.close();
      printWindow = null;
      return { success: true, data: undefined };
    } catch (error) {
      if (printWindow) { try { printWindow.close(); } catch {} }
      return {
        success: false,
        error: {
          code: ErrorCode.UNKNOWN_ERROR,
          message: 'Failed to print document',
          detail: error instanceof Error ? error.message : 'Unknown error',
          recoverable: true,
        },
      };
    }
  });

  // ─── Window Controls ───────────────────────────────────────────────────────
  // These are one-way (send, not handle) so we use ipcMain.on

  ipcMain.on(IpcChannel.WINDOW_MINIMIZE, () => {
    BrowserWindow.getFocusedWindow()?.minimize();
  });

  ipcMain.on(IpcChannel.WINDOW_MAXIMIZE, () => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return;
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  });

  ipcMain.on(IpcChannel.WINDOW_CLOSE, () => {
    BrowserWindow.getFocusedWindow()?.close();
  });
}
