import { ipcMain } from 'electron';
import { IpcChannel } from '../../../src/types/IPC.types';
import { FileService } from '../services/file.service';
import { Result, ErrorCode } from '../../../src/types/Error.types';
import { DocumentItem } from '../../../src/types/Document.types';
import { generatePdfThumbnail } from '../utils/pdfThumbnail';
import { getTempFilePath } from '../utils/tempDir';

const fileService = new FileService();

/**
 * Register document-related IPC handlers
 */
export function registerDocumentHandlers(): void {
  /**
   * Render a PDF page as a high-resolution image for editing
   */
  ipcMain.handle(IpcChannel.DOCUMENT_RENDER_PDF_PAGE, async (_, { documentId, pageNumber }) => {
    try {
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

      const page = pageNumber || 1;
      // Generate a high-resolution 1200x1600 rendering of the specific PDF page
      const highResPath = getTempFilePath(`${documentId}_page_${page}_highres.jpg`);
      await generatePdfThumbnail(document.tempPath, highResPath, 1200, 1600, page);
      return { success: true, data: highResPath };
    } catch (error) {
      return {
        success: false,
        error: {
          code: ErrorCode.UNKNOWN_ERROR,
          message: 'Failed to render PDF page to image',
          detail: error instanceof Error ? error.message : 'Unknown error',
          recoverable: true,
        },
      };
    }
  });

  /**
   * Apply edits (e.g. crop/filters) to a document's temp file
   */
  ipcMain.handle(IpcChannel.DOCUMENT_APPLY_EDIT, async (_, { documentId, base64Data, cleanBase64Data, signatures, pageNumber }) => {
    try {
      if (!documentId || !base64Data) {
        return {
          success: false,
          error: {
            code: ErrorCode.UNKNOWN_ERROR,
            message: 'Invalid request data',
            recoverable: false,
          },
        };
      }

      const buffer = Buffer.from(base64Data.replace(/^data:image\/\w+;base64,/, ''), 'base64');
      const cleanBuffer = cleanBase64Data 
        ? Buffer.from(cleanBase64Data.replace(/^data:image\/\w+;base64,/, ''), 'base64')
        : undefined;

      const result = await fileService.updateDocumentFile(documentId, buffer, cleanBuffer, signatures, pageNumber || 1);
      return result;
    } catch (error) {
      const result: Result<DocumentItem> = {
        success: false,
        error: {
          code: ErrorCode.UNKNOWN_ERROR,
          message: 'Failed to apply document edit',
          detail: error instanceof Error ? error.message : 'Unknown error',
          recoverable: true,
        },
      };
      return result;
    }
  });
}
