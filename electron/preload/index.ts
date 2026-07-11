import { contextBridge, ipcRenderer } from 'electron';
import { IpcChannel, IpcApi } from '../../src/types/IPC.types';

console.log('Preload script starting execution');

/**
 * Typed IPC API exposed to renderer process
 * All communication between renderer and main goes through these methods
 */
const api: IpcApi = {
  // File operations
  uploadFiles: (filePaths) =>
    ipcRenderer.invoke(IpcChannel.FILE_UPLOAD, filePaths),

  deleteFile: (documentId) =>
    ipcRenderer.invoke(IpcChannel.FILE_DELETE, documentId),

  validateFile: (filePath) =>
    ipcRenderer.invoke(IpcChannel.FILE_VALIDATE, filePath),

  getThumbnail: (documentId) =>
    ipcRenderer.invoke(IpcChannel.FILE_GET_THUMBNAIL, documentId),

  estimateImageSize: (documentId, targetSize, format) =>
    ipcRenderer.invoke(IpcChannel.IMAGE_ESTIMATE_SIZE, { documentId, targetSize, format }),

  // Scanner operations
  listScanners: () =>
    ipcRenderer.invoke(IpcChannel.SCANNER_LIST),

  checkScanner: (deviceId) =>
    ipcRenderer.invoke(IpcChannel.SCANNER_CHECK, deviceId),

  scan: (deviceId, settings) =>
    ipcRenderer.invoke(IpcChannel.SCANNER_SCAN, { deviceId, settings }),

  // PDF operations
  mergePdfs: (documentIds, outputPath) =>
    ipcRenderer.invoke(IpcChannel.PDF_MERGE, { documentIds, outputPath }),

  compressPdf: (documentId, targetSize) =>
    ipcRenderer.invoke(IpcChannel.PDF_COMPRESS, { documentId, targetSize }),

  convertPdf: (documentId, targetFormat) =>
    ipcRenderer.invoke(IpcChannel.PDF_CONVERT, { documentId, targetFormat }),

  splitPdf: (documentId, splitPoints) =>
    ipcRenderer.invoke(IpcChannel.PDF_SPLIT, { documentId, splitPoints }),

  protectPdf: (documentId, ownerPassword, userPassword) =>
    ipcRenderer.invoke(IpcChannel.PDF_PROTECT, { documentId, ownerPassword, userPassword }),

  previewPdf: (documentId) =>
    ipcRenderer.invoke(IpcChannel.PDF_PREVIEW, documentId),

  // Output operations
  processOutput: (documentIds, options) =>
    ipcRenderer.invoke(IpcChannel.OUTPUT_PROCESS, { documentIds, options }),

  saveOutput: (outputPath) =>
    ipcRenderer.invoke(IpcChannel.OUTPUT_SAVE, outputPath),

  // Document operations
  applyDocumentEdit: (documentId, base64Data, cleanBase64Data, signatures, pageNumber) =>
    ipcRenderer.invoke(IpcChannel.DOCUMENT_APPLY_EDIT, { documentId, base64Data, cleanBase64Data, signatures, pageNumber }),

  renderPdfPage: (documentId, pageNumber) =>
    ipcRenderer.invoke(IpcChannel.DOCUMENT_RENDER_PDF_PAGE, { documentId, pageNumber }),

  deletePage: (documentId, pageNumber) =>
    ipcRenderer.invoke(IpcChannel.DOCUMENT_DELETE_PAGE, { documentId, pageNumber }),

  addPage: (documentId, pageNumber, sourceFilePath) =>
    ipcRenderer.invoke(IpcChannel.DOCUMENT_ADD_PAGE, { documentId, pageNumber, sourceFilePath }),

  renderPdfPageThumbnail: (documentId, pageNumber) =>
    ipcRenderer.invoke(IpcChannel.DOCUMENT_RENDER_PDF_PAGE_THUMBNAIL, { documentId, pageNumber }),

  reorderPages: (documentId, newPageOrder) =>
    ipcRenderer.invoke(IpcChannel.DOCUMENT_REORDER_PAGES, { documentId, newPageOrder }),

  // System operations
  getRecentFiles: () =>
    ipcRenderer.invoke(IpcChannel.SYSTEM_GET_RECENT),

  addRecentFile: (file) =>
    ipcRenderer.invoke(IpcChannel.SYSTEM_ADD_RECENT, file),

  removeRecentFile: (filePath) =>
    ipcRenderer.invoke(IpcChannel.SYSTEM_REMOVE_RECENT, filePath),

  clearTemp: () =>
    ipcRenderer.invoke(IpcChannel.SYSTEM_CLEAR_TEMP),

  openFile: (filePath) =>
    ipcRenderer.invoke(IpcChannel.SYSTEM_OPEN_FILE, filePath),

  openFolder: (filePath) =>
    ipcRenderer.invoke(IpcChannel.SYSTEM_OPEN_FOLDER, filePath),

  showOpenDialog: (options) =>
    ipcRenderer.invoke(IpcChannel.SYSTEM_SHOW_OPEN_DIALOG, options),

  printDocument: (documentId) =>
    ipcRenderer.invoke(IpcChannel.SYSTEM_PRINT, documentId),

  showConfirmDialog: (message, title) =>
    ipcRenderer.invoke(IpcChannel.SYSTEM_DIALOG_CONFIRM, message, title),

  saveFileFromBase64: (base64Data, defaultFilename, filters) =>
    ipcRenderer.invoke(IpcChannel.SYSTEM_SAVE_BASE64, { base64Data, defaultFilename, filters }),

  // Window controls (fire-and-forget — no return value needed)
  minimizeWindow: () => ipcRenderer.send(IpcChannel.WINDOW_MINIMIZE),
  maximizeWindow: () => ipcRenderer.send(IpcChannel.WINDOW_MAXIMIZE),
  closeWindow:    () => ipcRenderer.send(IpcChannel.WINDOW_CLOSE),
};

/**
 * Expose API to renderer process via window.electron
 */
contextBridge.exposeInMainWorld('electron', api);

/**
 * TypeScript declaration for window.electron
 * This should be in a global.d.ts file in src/
 */
declare global {
  interface Window {
    electron: IpcApi;
  }
}

console.log('Preload script execution completed, electron API exposed:', !!window.electron);
