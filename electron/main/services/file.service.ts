import { copyFile, unlink, writeFile, stat } from 'fs/promises';
import { basename } from 'path';
import { v4 as uuidv4 } from 'uuid';
import sharp from 'sharp';
import { Result, ErrorCode } from '../../../src/types/Error.types';
import { DocumentItem, DocumentType } from '../../../src/types/Document.types';
import { getTempFilePath } from '../utils/tempDir';
import { sanitizeFilename } from '../../../src/utils/sanitizeFilename';
// import { generatePdfThumbnail } from '../utils/pdfThumbnail'; // Disabled - canvas not available
import { PdfService } from './pdf.service';

/**
 * Service for file operations
 */
export class FileService {
  private static documents: Map<string, DocumentItem> = new Map();

  /**
   * Create a document item from a file path
   * Copies file to temp directory and creates DocumentItem
   */
  async createDocument(
    filePath: string,
    type: DocumentType,
    size: number
  ): Promise<Result<DocumentItem>> {
    try {
      const id = uuidv4();
      const filename = basename(filePath);
      const sanitized = sanitizeFilename(filename);
      const tempPath = getTempFilePath(`${id}_${sanitized}`);

      // Copy file to temp directory
      await copyFile(filePath, tempPath);

      // Generate thumbnail
      const thumbnailPath = await this.createThumbnail(tempPath, id, type);

      // Determine page count (1 for images, actual for PDFs)
      const pageCount = type === DocumentType.PDF ? await this.getPdfPageCount(tempPath) : 1;

      const document: DocumentItem = {
        id,
        filename,
        type,
        size,
        pageCount,
        thumbnailPath,
        tempPath,
        originalPath: filePath,
        edits: [],
        createdAt: Date.now(),
      };

      FileService.documents.set(id, document);

      return {
        success: true,
        data: document,
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: ErrorCode.UNKNOWN_ERROR,
          message: 'Failed to process file',
          detail: error instanceof Error ? error.message : 'Unknown error',
          recoverable: true,
        },
      };
    }
  }

  /**
   * Delete a document and its temp files
   */
  async deleteDocument(id: string): Promise<Result<void>> {
    try {
      const document = FileService.documents.get(id);
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

      // Delete temp file
      try {
        await unlink(document.tempPath);
      } catch {
        // Ignore if file doesn't exist
      }

      // Delete thumbnail
      if (document.thumbnailPath) {
        try {
          await unlink(document.thumbnailPath);
        } catch {
          // Ignore if file doesn't exist
        }
      }

      FileService.documents.delete(id);

      return {
        success: true,
        data: undefined,
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: ErrorCode.UNKNOWN_ERROR,
          message: 'Failed to delete document',
          detail: error instanceof Error ? error.message : 'Unknown error',
          recoverable: true,
        },
      };
    }
  }

  /**
   * Generate thumbnail for a document
   */
  async generateThumbnail(id: string): Promise<Result<string>> {
    try {
      const document = FileService.documents.get(id);
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

      if (document.thumbnailPath) {
        return {
          success: true,
          data: document.thumbnailPath,
        };
      }

      const thumbnailPath = await this.createThumbnail(document.tempPath, id, document.type);

      return {
        success: true,
        data: thumbnailPath || '',
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: ErrorCode.UNKNOWN_ERROR,
          message: 'Failed to generate thumbnail',
          detail: error instanceof Error ? error.message : 'Unknown error',
          recoverable: true,
        },
      };
    }
  }

  /**
   * Create thumbnail from file
   */
  private async createThumbnail(
    filePath: string,
    id: string,
    type: DocumentType
  ): Promise<string | undefined> {
    // Only generate thumbnails for images (PDFs disabled due to canvas dependency)
    if (type !== DocumentType.IMAGE) {
      return undefined;
    }

    try {
      const thumbnailPath = getTempFilePath(`${id}_thumb.jpg`);

      // Generate image thumbnail using Sharp
      await sharp(filePath)
        .resize(120, 160, {
          fit: 'cover',
          position: 'top',
        })
        .jpeg({ quality: 80 })
        .toFile(thumbnailPath);

      console.log(`Generated thumbnail for ${type}: ${thumbnailPath}`);
      return thumbnailPath;
    } catch (error) {
      console.error('Failed to create thumbnail:', error);
      return undefined;
    }
  }

  /**
   * Get PDF page count
   * TODO: Implement with pdf-lib
   */
  private async getPdfPageCount(filePath: string): Promise<number> {
    try {
      // Use PdfService to get page count
      const pdfService = new PdfService();
      const result = await pdfService.getPageCount(filePath);
      
      if (result.success) {
        return result.data;
      }
    } catch (error) {
      console.error('Failed to get PDF page count:', error);
    }
    return 1; // Default to 1 if error
  }

  /**
   * Update a document's file content and regenerate its thumbnail
   */
  async updateDocumentFile(id: string, fileBuffer: Buffer): Promise<Result<DocumentItem>> {
    try {
      const document = FileService.documents.get(id);
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

      const oldTempPath = document.tempPath;
      const oldThumbnailPath = document.thumbnailPath;

      // Generate brand new unique paths to bypass Windows file locking issues
      const newId = uuidv4();
      const sanitized = sanitizeFilename(basename(document.filename));
      const newTempPath = getTempFilePath(`${newId}_${sanitized}`);

      // Write to new path (never locked)
      await writeFile(newTempPath, fileBuffer);

      // Re-generate thumbnail on a new path
      let newThumbnailPath: string | undefined = undefined;
      if (document.type === DocumentType.IMAGE) {
        newThumbnailPath = getTempFilePath(`${newId}_thumb.jpg`);
        await sharp(newTempPath)
          .resize(120, 160, {
            fit: 'cover',
            position: 'top',
          })
          .jpeg({ quality: 80 })
          .toFile(newThumbnailPath);
      }

      // Update document properties with new paths
      document.tempPath = newTempPath;
      if (newThumbnailPath) {
        document.thumbnailPath = newThumbnailPath;
      }

      // Update file stats
      const fileStats = await stat(newTempPath);
      document.size = fileStats.size;

      // Update page count if PDF
      if (document.type === DocumentType.PDF) {
        document.pageCount = await this.getPdfPageCount(newTempPath);
      }

      // Attempt to clean up old files asynchronously (silently fail if locked)
      unlink(oldTempPath).catch(() => {});
      if (oldThumbnailPath) {
        unlink(oldThumbnailPath).catch(() => {});
      }

      return {
        success: true,
        data: document,
      };
    } catch (error) {
      console.error('Failed to update document file:', error);
      return {
        success: false,
        error: {
          code: ErrorCode.UNKNOWN_ERROR,
          message: 'Failed to update document file',
          detail: error instanceof Error ? error.message : 'Unknown error',
          recoverable: true,
        },
      };
    }
  }

  /**
   * Get document by ID
   */
  getDocument(id: string): DocumentItem | undefined {
    return FileService.documents.get(id);
  }
}
