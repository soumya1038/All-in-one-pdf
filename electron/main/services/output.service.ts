import { dialog } from 'electron';
import { join } from 'path';
import { Result, ErrorCode } from '../../../src/types/Error.types';
import { OutputOptions, ProcessingResult, OutputFormat } from '../../../src/types/Output.types';
import { PdfService } from './pdf.service';
import { FileService } from './file.service';
import { sanitizeFilename } from '../../../src/utils/sanitizeFilename';

/**
 * Service for output processing
 */
export class OutputService {
  private pdfService = new PdfService();
  private fileService = new FileService();
  private lastOutputPath: string | null = null;

  /**
   * Process output with all options
   */
  async process(
    documentIds: string[],
    options: OutputOptions
  ): Promise<Result<ProcessingResult>> {
    try {
      const startTime = Date.now();

      // Get documents
      const documents = documentIds
        .map((id) => this.fileService.getDocument(id))
        .filter((doc) => doc !== undefined);

      if (documents.length === 0) {
        return {
          success: false,
          error: {
            code: ErrorCode.UNKNOWN_ERROR,
            message: 'No documents found',
            recoverable: false,
          },
        };
      }

      const isSplit = options.splitPoints && options.splitPoints.length > 0;
      let outputPath = '';

      if (isSplit) {
        // For splitting, ask user to select destination folder
        const folderDialogResult = await dialog.showOpenDialog({
          title: 'Select Destination Folder for Split PDFs',
          properties: ['openDirectory', 'createDirectory'],
        });

        if (folderDialogResult.canceled || folderDialogResult.filePaths.length === 0) {
          return {
            success: false,
            error: {
              code: ErrorCode.SAVE_FAILED,
              message: 'Save cancelled by user',
              recoverable: true,
            },
          };
        }
        outputPath = folderDialogResult.filePaths[0];
      } else {
        // Ask user where to save file
        const saveDialogResult = await dialog.showSaveDialog({
          title: 'Save Output',
          defaultPath: sanitizeFilename(`${options.filename}.${options.format.toLowerCase()}`),
          filters: [
            { name: 'Output File', extensions: [options.format.toLowerCase()] },
            { name: 'All Files', extensions: ['*'] },
          ],
        });

        if (saveDialogResult.canceled || !saveDialogResult.filePath) {
          return {
            success: false,
            error: {
              code: ErrorCode.SAVE_FAILED,
              message: 'Save cancelled by user',
              recoverable: true,
            },
          };
        }
        outputPath = saveDialogResult.filePath;
      }

      // Process based on format and options
      
      // 1. Check for unsupported format conversions
      if (options.format !== OutputFormat.PDF) {
        return {
          success: false,
          error: {
            code: ErrorCode.PDF_CONVERT_FAILED,
            message: `Conversion to ${options.format} requires external dependencies (Ghostscript/ImageMagick) which are not installed.`,
            recoverable: false,
          },
        };
      }

      // 2.5 Process Split PDF if splitPoints are provided
      if (isSplit) {
        const splitResult = await this.pdfService.split(documents[0].id, options.splitPoints!);
        if (!splitResult.success) {
          return {
            success: false,
            error: splitResult.error,
          };
        }

        const { copyFile, unlink } = await import('fs/promises');
        const { basename } = require('path');

        for (const tempPath of splitResult.data) {
          const fileName = basename(tempPath);
          const finalPath = join(outputPath, fileName);
          await copyFile(tempPath, finalPath);
          // Clean up temp parts
          await unlink(tempPath).catch(() => {});
        }

        const duration = Date.now() - startTime;
        return {
          success: true,
          data: {
            outputPath,
            outputSize: 0,
            duration,
          },
        };
      }

      // 3. Process PDF (Merge or Single)
      let finalTempPath = documents[0].tempPath;
      const { copyFile, unlink, stat } = await import('fs/promises');

      const needsMergeOrConversion = 
        documents.length > 1 || 
        (documents.length === 1 && documents[0].type !== 'PDF');

      if (needsMergeOrConversion) {
        const documentPaths = documents.map((doc) => doc.tempPath);
        const { getTempFilePath } = await import('../utils/tempDir');
        const mergeTempPath = getTempFilePath(`merged_${Date.now()}.pdf`);
        const mergeResult = await this.pdfService.merge(documentPaths, mergeTempPath);

        if (!mergeResult.success) {
          return mergeResult as Result<ProcessingResult>;
        }
        finalTempPath = mergeTempPath;
      }

      // 4. Compress if requested
      if (options.targetSize) {
        const compressResult = await this.pdfService.compressFile(finalTempPath, options.targetSize);
        if (!compressResult.success) {
          return compressResult as Result<ProcessingResult>;
        }
        
        // Clean up intermediate merged file if we compressed it
        if (finalTempPath !== documents[0].tempPath) {
          await unlink(finalTempPath).catch(() => {});
        }
        finalTempPath = compressResult.data;
      }

      // 4.5 Protect if requested
      if (options.protection && options.protection.enabled) {
        const protectResult = await this.pdfService.protectFile(
          finalTempPath,
          options.protection.ownerPassword,
          options.protection.userPassword
        );
        if (!protectResult.success) {
          return protectResult as Result<ProcessingResult>;
        }

        // Clean up intermediate merged/compressed file if we protected it
        if (finalTempPath !== documents[0].tempPath) {
          await unlink(finalTempPath).catch(() => {});
        }
        finalTempPath = protectResult.data;
      }

      // 5. Final Save
      await copyFile(finalTempPath, outputPath);
      
      // Clean up final temporary file if it was generated (merged or compressed)
      if (finalTempPath !== documents[0].tempPath) {
        await unlink(finalTempPath).catch(() => {});
      }

      // Calculate output size
      const stats = await stat(outputPath);

      this.lastOutputPath = outputPath;

      const duration = Date.now() - startTime;

      return {
        success: true,
        data: {
          outputPath,
          outputSize: stats.size,
          duration,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: ErrorCode.UNKNOWN_ERROR,
          message: 'Failed to process output',
          detail: error instanceof Error ? error.message : 'Unknown error',
          recoverable: true,
        },
      };
    }
  }

  /**
   * Get last output path
   */
  getLastOutputPath(): string | null {
    return this.lastOutputPath;
  }

  /**
   * Save output to specified path
   */
  async save(_outputPath: string): Promise<Result<void>> {
    try {
      // TODO: Implement save logic
      return {
        success: false,
        error: {
          code: ErrorCode.SAVE_FAILED,
          message: 'Save functionality not yet implemented',
          recoverable: false,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: ErrorCode.SAVE_FAILED,
          message: 'Failed to save output',
          detail: error instanceof Error ? error.message : 'Unknown error',
          recoverable: true,
        },
      };
    }
  }
}
