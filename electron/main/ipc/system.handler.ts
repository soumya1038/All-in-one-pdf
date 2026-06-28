import { ipcMain, shell, BrowserWindow } from 'electron';
import { IpcChannel } from '../../../src/types/IPC.types';
import { Result, ErrorCode } from '../../../src/types/Error.types';
import { RecentFile } from '../../../src/types/Document.types';
import { cleanupTempDir } from '../utils/tempDir';
import { FileService } from '../services/file.service';
import Store from 'electron-store';

const store = new Store<{ recentFiles: RecentFile[] }>();

/**
 * Register system-related IPC handlers
 */
export function registerSystemHandlers(): void {
  /**
   * Get recent files from local storage
   */
  ipcMain.handle(IpcChannel.SYSTEM_GET_RECENT, async () => {
    try {
      const recentFiles = store.get('recentFiles', []);
      const result: Result<RecentFile[]> = {
        success: true,
        data: recentFiles,
      };
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
   * Clear temp directory
   */
  ipcMain.handle(IpcChannel.SYSTEM_CLEAR_TEMP, async () => {
    try {
      await cleanupTempDir();
      const result: Result<void> = {
        success: true,
        data: undefined,
      };
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
   * Open file in default application
   */
  ipcMain.handle(IpcChannel.SYSTEM_OPEN_FILE, async (_, filePath: string) => {
    try {
      await shell.openPath(filePath);
      const result: Result<void> = {
        success: true,
        data: undefined,
      };
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
   * Open folder in file explorer
   */
  ipcMain.handle(IpcChannel.SYSTEM_OPEN_FOLDER, async (_, folderPath: string) => {
    try {
      await shell.openPath(folderPath);
      const result: Result<void> = {
        success: true,
        data: undefined,
      };
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
   * Show native open file dialog
   */
  ipcMain.handle(IpcChannel.SYSTEM_SHOW_OPEN_DIALOG, async (_, options) => {
    try {
      const { dialog } = require('electron');
      const result = await dialog.showOpenDialog(options || {
        properties: ['openFile', 'multiSelections']
      });
      
      if (result.canceled) {
        return {
          success: true,
          data: []
        };
      }
      
      return {
        success: true,
        data: result.filePaths
      };
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

      // Create a hidden print window
      printWindow = new BrowserWindow({
        show: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
        },
      });

      if (document.type === 'PDF') {
        const url = `file://${document.tempPath.replace(/\\/g, '/')}`;
        await printWindow.loadURL(url);
      } else {
        // Image printing: Wrap image in standard HTML
        const url = `docuflow://${document.tempPath.replace(/\\/g, '/')}`;
        const inlineHtml = `
          <html>
            <head>
              <style>
                @page { size: auto; margin: 0mm; }
                body { margin: 0; padding: 0; display: flex; justify-content: center; align-items: center; height: 100vh; background: white; }
                img { max-width: 100%; max-height: 100%; object-fit: contain; }
              </style>
            </head>
            <body>
              <img src="${url}" />
            </body>
          </html>
        `;
        const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(inlineHtml)}`;
        await printWindow.loadURL(dataUrl);
      }

      // Trigger print
      await printWindow.webContents.print({ silent: false, printBackground: true });
      printWindow.close();
      printWindow = null;

      return {
        success: true,
        data: undefined,
      };
    } catch (error) {
      if (printWindow) {
        try { printWindow.close(); } catch {}
      }
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
}
