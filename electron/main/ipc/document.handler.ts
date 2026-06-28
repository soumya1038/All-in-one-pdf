import { ipcMain } from 'electron';
import { IpcChannel } from '../../../src/types/IPC.types';
import { FileService } from '../services/file.service';
import { Result, ErrorCode } from '../../../src/types/Error.types';
import { DocumentItem } from '../../../src/types/Document.types';

const fileService = new FileService();

/**
 * Register document-related IPC handlers
 */
export function registerDocumentHandlers(): void {
  /**
   * Apply edits (e.g. crop/filters) to a document's temp file
   */
  ipcMain.handle(IpcChannel.DOCUMENT_APPLY_EDIT, async (_, { documentId, base64Data }) => {
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

      // Extract the raw image buffer from base64 data URL
      const matches = base64Data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
      if (!matches || matches.length !== 3) {
        return {
          success: false,
          error: {
            code: ErrorCode.UNKNOWN_ERROR,
            message: 'Invalid base64 data format',
            recoverable: false,
          },
        };
      }

      const buffer = Buffer.from(matches[2], 'base64');
      const result = await fileService.updateDocumentFile(documentId, buffer);
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
