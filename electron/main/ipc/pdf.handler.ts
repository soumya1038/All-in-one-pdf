import { ipcMain, BrowserWindow } from 'electron';
import { IpcChannel } from '../../../src/types/IPC.types';
import { PdfService } from '../services/pdf.service';
import { FileService } from '../services/file.service';

const pdfService = new PdfService();
const fileService = new FileService();

/**
 * Register PDF-related IPC handlers
 */
export function registerPdfHandlers(): void {
  /**
   * Merge PDFs
   */
  ipcMain.handle(IpcChannel.PDF_MERGE, async (_, { documentIds, outputPath }) => {
    // Get document paths from IDs
    const documentPaths: string[] = [];
    
    for (const id of documentIds) {
      const doc = fileService.getDocument(id);
      if (doc) {
        documentPaths.push(doc.tempPath);
      }
    }

    return await pdfService.merge(documentPaths, outputPath);
  });

  /**
   * Compress PDF
   */
  ipcMain.handle(IpcChannel.PDF_COMPRESS, async (_, { documentId, targetSize }) => {
    return await pdfService.compress(documentId, targetSize);
  });

  /**
   * Convert PDF
   */
  ipcMain.handle(IpcChannel.PDF_CONVERT, async (_, { documentId, targetFormat }) => {
    return await pdfService.convert(documentId, targetFormat);
  });

  /**
   * Split PDF
   */
  ipcMain.handle(IpcChannel.PDF_SPLIT, async (_, { documentId, splitPoints }) => {
    return await pdfService.split(documentId, splitPoints);
  });

  /**
   * Protect PDF with password
   */
  ipcMain.handle(IpcChannel.PDF_PROTECT, async (_, { documentId, ownerPassword, userPassword }) => {
    return await pdfService.protect(documentId, ownerPassword, userPassword);
  });

  /**
   * Preview PDF in a new native window
   */
  ipcMain.handle(IpcChannel.PDF_PREVIEW, async (_, documentId) => {
    try {
      const doc = fileService.getDocument(documentId);
      if (!doc) {
        return {
          success: false,
          error: {
            code: 'FILE_NOT_FOUND',
            message: 'Document not found',
            recoverable: false
          }
        };
      }

      // Create a native window to display PDF
      const pdfWindow = new BrowserWindow({
        title: `Preview: ${doc.filename}`,
        width: 1000,
        height: 800,
        autoHideMenuBar: true,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
        }
      });

      const url = `file:///${doc.tempPath.replace(/\\/g, '/')}`;
      await pdfWindow.loadURL(url);

      return {
        success: true,
        data: undefined
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'UNKNOWN_ERROR',
          message: 'Failed to preview PDF',
          detail: error instanceof Error ? error.message : 'Unknown error',
          recoverable: true
        }
      };
    }
  });
}
