import { ipcMain } from 'electron';
import { IpcChannel } from '../../../src/types/IPC.types';
import { Result, ErrorCode } from '../../../src/types/Error.types';
import { DocumentItem } from '../../../src/types/Document.types';
import { validateFile } from '../utils/fileValidator';
import { FileService } from '../services/file.service';

const fileService = new FileService();

/**
 * Register file-related IPC handlers
 */
export function registerFileHandlers(): void {
  /**
   * Handle file upload
   */
  ipcMain.handle(IpcChannel.FILE_UPLOAD, async (_, filePaths: string[]) => {
    try {
      const documents: DocumentItem[] = [];

      for (const filePath of filePaths) {
        const validation = await validateFile(filePath);
        
        if (!validation.success) {
          console.error(`File validation failed for ${filePath}:`, validation.error);
          continue; // Skip invalid files
        }

        const document = await fileService.createDocument(
          filePath,
          validation.data.type,
          validation.data.size
        );

        if (document.success) {
          documents.push(document.data);
        }
      }

      const result: Result<DocumentItem[]> = {
        success: true,
        data: documents,
      };

      return result;
    } catch (error) {
      const result: Result<DocumentItem[]> = {
        success: false,
        error: {
          code: ErrorCode.UNKNOWN_ERROR,
          message: 'Failed to upload files',
          detail: error instanceof Error ? error.message : 'Unknown error',
          recoverable: true,
        },
      };
      return result;
    }
  });

  /**
   * Handle file deletion
   */
  ipcMain.handle(IpcChannel.FILE_DELETE, async (_, documentId: string) => {
    return await fileService.deleteDocument(documentId);
  });

  /**
   * Handle file validation
   */
  ipcMain.handle(IpcChannel.FILE_VALIDATE, async (_, filePath: string) => {
    return await validateFile(filePath);
  });

  /**
   * Handle thumbnail generation
   */
  ipcMain.handle(IpcChannel.FILE_GET_THUMBNAIL, async (_, documentId: string) => {
    return await fileService.generateThumbnail(documentId);
  });
}
