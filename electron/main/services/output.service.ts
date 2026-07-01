import { dialog } from 'electron';
import { join, basename } from 'path';
import { copyFile, unlink, stat } from 'fs/promises';
import { Result, ErrorCode } from '../../../src/types/Error.types';
import { OutputOptions, ProcessingResult, OutputFormat } from '../../../src/types/Output.types';
import { RecentFile } from '../../../src/types/Document.types';
import { PdfService } from './pdf.service';
import { FileService } from './file.service';
import { sanitizeFilename } from '../../../src/utils/sanitizeFilename';
import { getTempFilePath } from '../utils/tempDir';
import Store from 'electron-store';

const store = new Store<{ recentFiles: RecentFile[] }>();
const MAX_RECENT_FILES = 20;

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
      
      // 1. Format conversion check (supported natively now)

      // 2.5 Process Split PDF if splitPoints are provided
      if (isSplit) {
        const splitResult = await this.pdfService.splitFile(documents[0].tempPath, options.splitPoints!);

        if (!splitResult.success) {
          return {
            success: false,
            error: splitResult.error,
          };
        }



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


      const needsMergeOrConversion = 
        documents.length > 1 || 
        (documents.length === 1 && documents[0].type !== 'PDF');

      if (needsMergeOrConversion) {
        const documentPaths = documents.map((doc) => doc.tempPath);
        const mergeTempPath = getTempFilePath(`merged_${Date.now()}.pdf`);
        const mergeResult = await this.pdfService.merge(documentPaths, mergeTempPath);

        if (!mergeResult.success) {
          return mergeResult as Result<ProcessingResult>;
        }
        finalTempPath = mergeTempPath;
      }

      // 4. Compress if explicitly requested (compress workflow) or if a target size is given
      if (options.compress || options.targetSize) {
        let targetSize = options.targetSize;
        if (options.compressionLevel && !targetSize) {
          const origSize = documents.reduce((sum, d) => sum + d.size, 0);
          const ratio = options.compressionLevel === 'low' ? 0.8
            : options.compressionLevel === 'medium' ? 0.5
            : options.compressionLevel === 'high' ? 0.3
            : 0.15;
          targetSize = origSize * ratio;
        }

        const compressResult = await this.pdfService.compressFile(finalTempPath, targetSize);
        if (!compressResult.success) {
          return compressResult as Result<ProcessingResult>;
        }
        // Clean up intermediate merged/uncompressed file before replacing reference
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

      // 4.8 Format Conversion
      if (options.format !== OutputFormat.PDF) {
        const convertResult = await this.pdfService.convertFile(
          finalTempPath,
          options.format,
          options.imageDpi,
          outputPath
        );

        // Clean up intermediate temp files
        if (finalTempPath !== documents[0].tempPath) {
          await unlink(finalTempPath).catch(() => {});
        }

        if (!convertResult.success) {
          return convertResult as Result<ProcessingResult>;
        }

        const duration = Date.now() - startTime;
        let outSize = 0;
        try {
          const stats = await stat(convertResult.data!);
          outSize = stats.size;
        } catch {}

        this.lastOutputPath = convertResult.data!;

        // Persist to recent files
        try {
          const recentEntry: RecentFile = {
            filename: basename(convertResult.data!),
            path: convertResult.data!,
            timestamp: Date.now(),
            operation: this.detectOperation(options),
          };
          const existing = store.get('recentFiles', []);
          const filtered = existing.filter((f) => f.path !== convertResult.data!);
          filtered.unshift(recentEntry);
          store.set('recentFiles', filtered.slice(0, 50));
        } catch (err) {
          console.error('Failed to add recent file:', err);
        }

        return {
          success: true,
          data: {
            outputPath: convertResult.data!,
            outputSize: outSize,
            duration,
          },
        };
      }

      // 5. Final Save — copy temp → user destination
      await copyFile(finalTempPath, outputPath);

      // Clean up all generated temp files (merged, compressed, protected)
      if (finalTempPath !== documents[0].tempPath) {
        await unlink(finalTempPath).catch(() => {});
      }

      // Calculate actual output size
      const stats = await stat(outputPath);

      this.lastOutputPath = outputPath;

      // Persist to recent files
      try {
        const recentEntry: RecentFile = {
          filename: basename(outputPath),
          path: outputPath,
          timestamp: Date.now(),
          operation: this.detectOperation(options),
        };
        const existing = store.get('recentFiles', []);
        const filtered = existing.filter((f) => f.path !== outputPath);
        store.set('recentFiles', [recentEntry, ...filtered].slice(0, MAX_RECENT_FILES));
      } catch {
        // Non-critical — don't fail the whole operation
      }

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
   * Save is handled during process() via the native save dialog.
   * This method exists for IPC compatibility and always returns success.
   */
  async save(_outputPath: string): Promise<Result<void>> {
    return { success: true, data: undefined };
  }

  /**
   * Determine the operation name for recent files record
   */
  private detectOperation(options: OutputOptions): string {
    if (options.splitPoints && options.splitPoints.length > 0) return 'split';
    if (options.protection?.enabled) return 'protect';
    if (options.compress || options.targetSize) return 'compress';
    if (options.mergeAsSingle) return 'merge';
    return 'convert';
  }
}
