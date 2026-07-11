import { ipcMain, BrowserWindow, shell } from 'electron';
import { IpcChannel } from '../../../src/types/IPC.types';
import { PdfService } from '../services/pdf.service';
import { FileService } from '../services/file.service';
import { ErrorCode } from '../../../src/types/Error.types';

const pdfService = new PdfService();
const fileService = new FileService();

/**
 * Register PDF-related IPC handlers.
 * Document ID → file path resolution happens HERE so pdf.service has no FileService dependency.
 */
export function registerPdfHandlers(): void {
  // ── Merge ────────────────────────────────────────────────────────────────
  ipcMain.handle(IpcChannel.PDF_MERGE, async (_, { documentIds, outputPath }) => {
    const documentPaths: string[] = [];
    for (const id of documentIds) {
      const doc = fileService.getDocument(id);
      if (doc) documentPaths.push(doc.tempPath);
    }
    return await pdfService.merge(documentPaths, outputPath);
  });

  // ── Compress ─────────────────────────────────────────────────────────────
  ipcMain.handle(IpcChannel.PDF_COMPRESS, async (_, { documentId, targetSize }) => {
    const doc = fileService.getDocument(documentId);
    if (!doc || doc.type !== 'PDF') {
      return {
        success: false,
        error: { code: ErrorCode.FILE_NOT_FOUND, message: 'PDF not found', recoverable: false },
      };
    }
    return await pdfService.compressFile(doc.tempPath, targetSize);
  });

  // ── Convert ──────────────────────────────────────────────────────────────
  ipcMain.handle(IpcChannel.PDF_CONVERT, async (_, { documentId, targetFormat }) => {
    const doc = fileService.getDocument(documentId);
    if (!doc) {
      return {
        success: false,
        error: { code: ErrorCode.FILE_NOT_FOUND, message: 'Document not found', recoverable: false },
      };
    }
    return await pdfService.convertFile(doc.tempPath, targetFormat);
  });

  // ── Split ────────────────────────────────────────────────────────────────
  ipcMain.handle(IpcChannel.PDF_SPLIT, async (_, { documentId, splitPoints }) => {
    const doc = fileService.getDocument(documentId);
    if (!doc || doc.type !== 'PDF') {
      return {
        success: false,
        error: { code: ErrorCode.FILE_NOT_FOUND, message: 'PDF not found', recoverable: false },
      };
    }
    return await pdfService.splitFile(doc.tempPath, splitPoints);
  });

  // ── Protect ──────────────────────────────────────────────────────────────
  ipcMain.handle(IpcChannel.PDF_PROTECT, async (_, { documentId, ownerPassword, userPassword }) => {
    const doc = fileService.getDocument(documentId);
    if (!doc || doc.type !== 'PDF') {
      return {
        success: false,
        error: { code: ErrorCode.FILE_NOT_FOUND, message: 'PDF not found', recoverable: false },
      };
    }
    return await pdfService.protectFile(doc.tempPath, ownerPassword, userPassword);
  });

  // ── Preview ──────────────────────────────────────────────────────────────
  /**
   * Two-strategy PDF preview:
   * 1. shell.openPath() → uses Windows default PDF viewer (Acrobat, Edge, etc.) — most reliable
   * 2. Fallback: in-app BrowserWindow using docuflow:// protocol (Chromium PDF viewer)
   */
  ipcMain.handle(IpcChannel.PDF_PREVIEW, async (_, documentId: string) => {
    try {
      const doc = fileService.getDocument(documentId);
      if (!doc) {
        return {
          success: false,
          error: {
            code: ErrorCode.FILE_NOT_FOUND,
            message: 'Document not found in session',
            recoverable: false,
          },
        };
      }

      // Strategy 1: system default PDF viewer
      const openError = await shell.openPath(doc.tempPath);
      if (!openError) {
        return { success: true, data: undefined };
      }

      // Strategy 2: in-app window via docuflow:// protocol
      console.warn(`shell.openPath failed (${openError}), falling back to in-app viewer`);
      const normalizedPath = doc.tempPath.replace(/\\/g, '/');
      const previewUrl = `docuflow:///${normalizedPath}`;

      const pdfWindow = new BrowserWindow({
        title: `Preview — ${doc.filename}`,
        width: 1000,
        height: 800,
        autoHideMenuBar: true,
        show: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          webSecurity: false, // Required so the iframe can load the docuflow:// URL
        },
      });

      pdfWindow.once('ready-to-show', () => pdfWindow.show());

      const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>PDF Preview</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body, html { height: 100%; background: #525659; }
  iframe { width: 100%; height: 100%; border: none; display: block; }
</style>
</head>
<body>
  <iframe src="${previewUrl}"></iframe>
</body>
</html>`;

      await pdfWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      return { success: true, data: undefined };
    } catch (error) {
      return {
        success: false,
        error: {
          code: ErrorCode.UNKNOWN_ERROR,
          message: error instanceof Error ? error.message : 'Failed to open PDF preview',
          recoverable: true,
        },
      };
    }
  });
}
