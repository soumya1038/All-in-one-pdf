import { copyFile, unlink, writeFile, stat, readFile } from 'fs/promises';
import { basename } from 'path';
import { v4 as uuidv4 } from 'uuid';
import sharp from 'sharp';
sharp.cache(false);
import { Result, ErrorCode } from '../../../src/types/Error.types';
import { DocumentItem, DocumentType, PlacedSignature } from '../../../src/types/Document.types';
import { getTempFilePath } from '../utils/tempDir';
import { sanitizeFilename } from '../../../src/utils/sanitizeFilename';
import { generatePdfThumbnail } from '../utils/pdfThumbnail';
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
    try {
      const thumbnailPath = getTempFilePath(`${id}_thumb.jpg`);

      if (type === DocumentType.IMAGE) {
        // Generate image thumbnail using Sharp
        await sharp(filePath)
          .resize(120, 160, {
            fit: 'cover',
            position: 'top',
          })
          .jpeg({ quality: 80 })
          .toFile(thumbnailPath);
        console.log(`Generated thumbnail for IMAGE: ${thumbnailPath}`);
        return thumbnailPath;
      } else if (type === DocumentType.PDF) {
        // Generate PDF thumbnail using canvas PDF.js
        await generatePdfThumbnail(filePath, thumbnailPath, 120, 160);
        console.log(`Generated thumbnail for PDF: ${thumbnailPath}`);
        return thumbnailPath;
      }
      return undefined;
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
  async updateDocumentFile(
    id: string,
    fileBuffer: Buffer,
    cleanFileBuffer?: Buffer,
    signatures?: PlacedSignature[],
    pageNumber: number = 1
  ): Promise<Result<DocumentItem>> {
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

      // If document is a PDF, replace the specific page inside the existing PDF
      let finalBuffer = fileBuffer;
      if (document.type === DocumentType.PDF) {
        try {
          const { PDFDocument } = await import('pdf-lib');
          // Load the current PDF file contents
          const currentPdfBytes = await readFile(oldTempPath);
          const pdfDoc = await PDFDocument.load(currentPdfBytes, { ignoreEncryption: true });
          
          // Embed the edited page image
          const image = await pdfDoc.embedJpg(fileBuffer);
          const pageIndex = pageNumber - 1;
          
          // Insert the new page at the correct index
          const newPage = pdfDoc.insertPage(pageIndex, [image.width, image.height]);
          newPage.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
          
          // Remove the old page (which has now shifted to index pageIndex + 1)
          if (pdfDoc.getPageCount() > pageIndex + 1) {
            pdfDoc.removePage(pageIndex + 1);
          }
          
          const pdfBytes = await pdfDoc.save();
          finalBuffer = Buffer.from(pdfBytes);
        } catch (err) {
          console.error('Failed to replace PDF page:', err);
        }
      }

      // Write to new path (never locked)
      await writeFile(newTempPath, finalBuffer);

      // Re-generate thumbnail on a new path (always uses the first page for the thumbnail)
      const newThumbnailPath = await this.createThumbnail(newTempPath, newId, document.type);

      // Handle clean image if provided, mapping by page number
      if (cleanFileBuffer) {
        const cleanId = uuidv4();
        const baseName = sanitized.replace(/\.pdf$/i, '');
        const pageCleanPath = getTempFilePath(`${cleanId}_clean_${baseName}_page_${pageNumber}.jpg`);
        await writeFile(pageCleanPath, cleanFileBuffer);

        if (!document.cleanTempPaths) {
          document.cleanTempPaths = {};
        }

        // Clean up previous clean image for this page if it existed
        const oldPageCleanPath = document.cleanTempPaths[pageNumber];
        if (oldPageCleanPath) {
          unlink(oldPageCleanPath).catch(() => {});
        }

        document.cleanTempPaths[pageNumber] = pageCleanPath;
      }

      // Update document properties with new paths
      document.tempPath = newTempPath;
      if (newThumbnailPath) {
        document.thumbnailPath = newThumbnailPath;
      }
      if (signatures) {
        document.signatures = signatures;
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
   * Delete a specific page from a PDF document
   */
  async deletePage(id: string, pageNumber: number): Promise<Result<DocumentItem>> {
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

      if (document.type !== DocumentType.PDF) {
        return {
          success: false,
          error: {
            code: ErrorCode.UNKNOWN_ERROR,
            message: 'Document is not a PDF',
            recoverable: false,
          },
        };
      }

      if (document.pageCount <= 1) {
        return {
          success: false,
          error: {
            code: ErrorCode.UNKNOWN_ERROR,
            message: 'Cannot delete the only page in a PDF',
            recoverable: false,
          },
        };
      }

      const oldTempPath = document.tempPath;
      const oldThumbnailPath = document.thumbnailPath;

      const { PDFDocument } = await import('pdf-lib');
      const currentPdfBytes = await readFile(oldTempPath);
      const pdfDoc = await PDFDocument.load(currentPdfBytes, { ignoreEncryption: true });

      if (pageNumber < 1 || pageNumber > pdfDoc.getPageCount()) {
        return {
          success: false,
          error: {
            code: ErrorCode.UNKNOWN_ERROR,
            message: `Invalid page number: ${pageNumber}`,
            recoverable: false,
          },
        };
      }

      pdfDoc.removePage(pageNumber - 1);

      const pdfBytes = await pdfDoc.save();
      const finalBuffer = Buffer.from(pdfBytes);

      const newId = uuidv4();
      const sanitized = sanitizeFilename(basename(document.filename));
      const newTempPath = getTempFilePath(`${newId}_${sanitized}`);

      await writeFile(newTempPath, finalBuffer);

      // Re-generate thumbnail
      const newThumbnailPath = await this.createThumbnail(newTempPath, newId, document.type);

      // Clean up previous clean images and shift remaining clean paths
      if (document.cleanTempPaths) {
        const oldCleanTempPaths = document.cleanTempPaths;
        const newCleanTempPaths: Record<number, string> = {};

        for (const [pageStr, path] of Object.entries(oldCleanTempPaths)) {
          const page = parseInt(pageStr, 10);
          if (page === pageNumber) {
            unlink(path).catch(() => {});
          } else if (page > pageNumber) {
            newCleanTempPaths[page - 1] = path;
          } else {
            newCleanTempPaths[page] = path;
          }
        }
        document.cleanTempPaths = newCleanTempPaths;
      }

      // Shift signatures
      if (document.signatures) {
        document.signatures = document.signatures
          .filter((sig) => sig.page !== pageNumber)
          .map((sig) => {
            if (sig.page > pageNumber) {
              return { ...sig, page: sig.page - 1 };
            }
            return sig;
          });
      }

      document.tempPath = newTempPath;
      if (newThumbnailPath) {
        document.thumbnailPath = newThumbnailPath;
      }

      const fileStats = await stat(newTempPath);
      document.size = fileStats.size;
      document.pageCount = await this.getPdfPageCount(newTempPath);

      // Clean up old files
      unlink(oldTempPath).catch(() => {});
      if (oldThumbnailPath) {
        unlink(oldThumbnailPath).catch(() => {});
      }

      return {
        success: true,
        data: document,
      };
    } catch (error) {
      console.error('Failed to delete page:', error);
      return {
        success: false,
        error: {
          code: ErrorCode.UNKNOWN_ERROR,
          message: 'Failed to delete PDF page',
          detail: error instanceof Error ? error.message : 'Unknown error',
          recoverable: true,
        },
      };
    }
  }

  /**
   * Add a page (blank or from file) to a PDF document
   */
  async addPage(id: string, pageNumber: number, sourceFilePath?: string): Promise<Result<DocumentItem>> {
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

      if (document.type !== DocumentType.PDF) {
        return {
          success: false,
          error: {
            code: ErrorCode.UNKNOWN_ERROR,
            message: 'Document is not a PDF',
            recoverable: false,
          },
        };
      }

      const oldTempPath = document.tempPath;
      const oldThumbnailPath = document.thumbnailPath;

      const { PDFDocument } = await import('pdf-lib');
      const currentPdfBytes = await readFile(oldTempPath);
      const pdfDoc = await PDFDocument.load(currentPdfBytes, { ignoreEncryption: true });

      const pageCountBefore = pdfDoc.getPageCount();
      const insertIndex = Math.max(0, Math.min(pageNumber - 1, pageCountBefore));

      let pagesInserted = 0;

      if (sourceFilePath) {
        const ext = sourceFilePath.toLowerCase();
        const isImage = ext.endsWith('.png') || ext.endsWith('.jpg') || ext.endsWith('.jpeg') ||
                        ext.endsWith('.webp') || ext.endsWith('.bmp') || ext.endsWith('.tiff') || ext.endsWith('.tif');

        if (isImage) {
          const fileBytes = await readFile(sourceFilePath);
          let imageBuffer: Uint8Array = new Uint8Array(fileBytes);
          let isPng = ext.endsWith('.png');

          if (ext.endsWith('.webp') || ext.endsWith('.bmp') || ext.endsWith('.tiff') || ext.endsWith('.tif')) {
            const pngBuffer = await sharp(fileBytes).png().toBuffer();
            imageBuffer = new Uint8Array(pngBuffer);
            isPng = true;
          }

          const image = isPng
            ? await pdfDoc.embedPng(imageBuffer)
            : await pdfDoc.embedJpg(imageBuffer);

          const { width, height } = image.scale(1);
          const newPage = pdfDoc.insertPage(insertIndex, [width, height]);
          newPage.drawImage(image, { x: 0, y: 0, width, height });
          pagesInserted = 1;
        } else if (ext.endsWith('.pdf')) {
          const sourcePdfBytes = await readFile(sourceFilePath);
          const sourcePdfDoc = await PDFDocument.load(sourcePdfBytes, { ignoreEncryption: true });
          const copiedPages = await pdfDoc.copyPages(sourcePdfDoc, sourcePdfDoc.getPageIndices());

          copiedPages.forEach((copiedPage, i) => {
            pdfDoc.insertPage(insertIndex + i, copiedPage);
          });
          pagesInserted = copiedPages.length;
        } else {
          return {
            success: false,
            error: {
              code: ErrorCode.UNKNOWN_ERROR,
              message: 'Unsupported file type for page insertion',
              recoverable: false,
            },
          };
        }
      } else {
        // Insert a blank page
        let width = 595.28;
        let height = 841.89;
        if (pageCountBefore > 0) {
          const refPageIndex = Math.min(insertIndex, pageCountBefore - 1);
          const refPage = pdfDoc.getPage(refPageIndex);
          width = refPage.getWidth();
          height = refPage.getHeight();
        }
        pdfDoc.insertPage(insertIndex, [width, height]);
        pagesInserted = 1;
      }

      if (pagesInserted === 0) {
        return {
          success: false,
          error: {
            code: ErrorCode.UNKNOWN_ERROR,
            message: 'No pages were inserted',
            recoverable: false,
          },
        };
      }

      const pdfBytes = await pdfDoc.save();
      const finalBuffer = Buffer.from(pdfBytes);

      const newId = uuidv4();
      const sanitized = sanitizeFilename(basename(document.filename));
      const newTempPath = getTempFilePath(`${newId}_${sanitized}`);

      await writeFile(newTempPath, finalBuffer);

      // Re-generate thumbnail
      const newThumbnailPath = await this.createThumbnail(newTempPath, newId, document.type);

      const insertedStartPage = insertIndex + 1;

      if (document.cleanTempPaths) {
        const oldCleanTempPaths = document.cleanTempPaths;
        const newCleanTempPaths: Record<number, string> = {};

        for (const [pageStr, path] of Object.entries(oldCleanTempPaths)) {
          const page = parseInt(pageStr, 10);
          if (page >= insertedStartPage) {
            newCleanTempPaths[page + pagesInserted] = path;
          } else {
            newCleanTempPaths[page] = path;
          }
        }
        document.cleanTempPaths = newCleanTempPaths;
      }

      // Shift signatures
      if (document.signatures) {
        document.signatures = document.signatures.map((sig) => {
          if (sig.page >= insertedStartPage) {
            return { ...sig, page: sig.page + pagesInserted };
          }
          return sig;
        });
      }

      document.tempPath = newTempPath;
      if (newThumbnailPath) {
        document.thumbnailPath = newThumbnailPath;
      }

      const fileStats = await stat(newTempPath);
      document.size = fileStats.size;
      document.pageCount = await this.getPdfPageCount(newTempPath);

      // Clean up old files
      unlink(oldTempPath).catch(() => {});
      if (oldThumbnailPath) {
        unlink(oldThumbnailPath).catch(() => {});
      }

      return {
        success: true,
        data: document,
      };
    } catch (error) {
      console.error('Failed to add page:', error);
      return {
        success: false,
        error: {
          code: ErrorCode.UNKNOWN_ERROR,
          message: 'Failed to add PDF page',
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
