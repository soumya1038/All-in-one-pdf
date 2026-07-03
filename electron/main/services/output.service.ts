import { dialog } from 'electron';
import { join, basename, extname } from 'path';
import { copyFile, unlink, stat, readFile } from 'fs/promises';
import { Result, ErrorCode } from '../../../src/types/Error.types';
import { OutputOptions, ProcessingResult, OutputFormat } from '../../../src/types/Output.types';
import { DocumentItem, DocumentType, RecentFile } from '../../../src/types/Document.types';
import { PdfService } from './pdf.service';
import { FileService } from './file.service';
import { sanitizeFilename } from '../../../src/utils/sanitizeFilename';
import { getTempFilePath } from '../utils/tempDir';
import Store from 'electron-store';
import sharp from 'sharp';

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

      const unsupportedDocument = documents.find((doc) => !this.isSupportedInput(doc));
      if (unsupportedDocument) {
        return {
          success: false,
          error: {
            code: ErrorCode.FILE_UNSUPPORTED,
            message: `"${unsupportedDocument.filename}" is not supported for processing yet. Please use PDF or image files.`,
            recoverable: false,
          },
        };
      }

      const isSplit = options.splitPoints && options.splitPoints.length > 0;
      const isBatchFolderOutput = !isSplit && documents.length > 1 && !options.mergeAsSingle;
      let outputPath = '';

      if (isSplit || isBatchFolderOutput) {
        // For split and separate multi-file exports, ask for a destination folder.
        const folderDialogResult = await dialog.showOpenDialog({
          title: isSplit ? 'Select Destination Folder for Split PDFs' : 'Select Destination Folder',
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



        const outputPaths: string[] = [];
        let outputSize = 0;
        const prefix = this.getOutputBaseName(options.filename || documents[0].filename);

        for (let index = 0; index < splitResult.data.length; index++) {
          const tempPath = splitResult.data[index];
          const finalPath = join(outputPath, `${prefix}_part${index + 1}.pdf`);
          await copyFile(tempPath, finalPath);
          outputPaths.push(finalPath);
          outputSize += await this.getFileSize(finalPath);
          // Clean up temp parts
          await unlink(tempPath).catch(() => {});
        }

        const duration = Date.now() - startTime;
        await this.addRecentFile({
          filename: basename(outputPath),
          path: outputPath,
          timestamp: Date.now(),
          operation: 'split',
        });

        return {
          success: true,
          data: {
            outputPath,
            outputPaths,
            isFolderOutput: true,
            outputSize,
            duration,
          },
        };
      }

      if (isBatchFolderOutput) {
        return await this.processBatchPdfOutput(documents, outputPath, options, startTime);
      }

      let finalTempPath = documents[0].tempPath;

      // 3. Process Image Compression Workflow directly if selected
      const isCompressImage = options.workflow === 'COMPRESS_IMAGE';

      if (isCompressImage) {
        const inputDoc = documents[0];
        // Calculate targetSize based on options.targetSize or compressionLevel
        let targetSize = options.targetSize;
        if (!targetSize) {
          try {
            const stats = await stat(inputDoc.tempPath);
            const ratio = options.compressionLevel === 'low' ? 0.8
              : options.compressionLevel === 'medium' ? 0.5
              : options.compressionLevel === 'high' ? 0.3
              : 0.15;
            targetSize = Math.round(stats.size * ratio);
          } catch {
            targetSize = 1024 * 100; // default 100kb fallback
          }
        }

        const tempCompressedPath = getTempFilePath(`compressed_image_${Date.now()}.${options.format.toLowerCase()}`);
        
        try {
          // Fit the image dynamically using our search helper
          const compressedBuffer = await this.fitImageToTargetSize(inputDoc.tempPath, targetSize, options.format);

          if (options.format === OutputFormat.PDF) {
            // If output format is PDF, first write the compressed image as JPEG, then convert to PDF
            const imageTempPath = getTempFilePath(`compressed_img_part_${Date.now()}.jpg`);
            await sharp(compressedBuffer).toFile(imageTempPath);
            
            const pdfResult = await this.pdfService.merge([imageTempPath], tempCompressedPath, options.pdfPageSize);
            await unlink(imageTempPath).catch(() => {});
            
            if (!pdfResult.success) {
              return pdfResult as Result<ProcessingResult>;
            }

            // Copy to final outputPath
            await copyFile(tempCompressedPath, outputPath);
            await unlink(tempCompressedPath).catch(() => {});
          } else {
            // Direct image to image compression
            await sharp(compressedBuffer).toFile(outputPath);
          }

          const duration = Date.now() - startTime;
          let outSize = 0;
          try {
            const stats = await stat(outputPath);
            outSize = stats.size;
          } catch {
            outSize = 0;
          }

          this.lastOutputPath = outputPath;

          // Persist to recent files
          const recentFile: RecentFile = {
            filename: basename(outputPath),
            path: outputPath,
            timestamp: Date.now(),
            operation: 'compress_image',
          };
          const recentFiles = store.get('recentFiles', []);
          const updatedRecent = [
            recentFile,
            ...recentFiles.filter((f) => f.path !== outputPath),
          ].slice(0, MAX_RECENT_FILES);
          store.set('recentFiles', updatedRecent);

          return {
            success: true,
            data: {
              outputPath,
              outputSize: outSize,
              duration,
            },
          };
        } catch (err) {
          return {
            success: false,
            error: {
              code: ErrorCode.UNKNOWN_ERROR,
              message: err instanceof Error ? err.message : 'Image compression failed',
              recoverable: true,
            },
          };
        }
      }

      if (
        documents.length === 1 &&
        documents[0].type === DocumentType.IMAGE &&
        options.format !== OutputFormat.PDF
      ) {
        if (options.format === OutputFormat.DOCX) {
          return {
            success: false,
            error: {
              code: ErrorCode.PDF_CONVERT_FAILED,
              message: 'Image to Word conversion is not supported. Choose PDF, JPEG, PNG, or TIFF.',
              recoverable: false,
            },
          };
        }

        await this.convertImageFile(documents[0].tempPath, outputPath, options.format);
        const duration = Date.now() - startTime;
        const outputSize = await this.getFileSize(outputPath);

        this.lastOutputPath = outputPath;
        await this.addRecentFile({
          filename: basename(outputPath),
          path: outputPath,
          timestamp: Date.now(),
          operation: 'convert',
        });

        return {
          success: true,
          data: {
            outputPath,
            outputSize,
            duration,
          },
        };
      }


      const needsMergeOrConversion = 
        documents.length > 1 || 
        (documents.length === 1 && documents[0].type !== 'PDF');

      if (needsMergeOrConversion) {
        const documentPaths = documents.map((doc) => doc.tempPath);
        const mergeTempPath = getTempFilePath(`merged_${Date.now()}.pdf`);
        const mergeResult = await this.pdfService.merge(documentPaths, mergeTempPath, options.pdfPageSize);

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
        } catch {
          outSize = 0;
        }

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

  private async processBatchPdfOutput(
    documents: DocumentItem[],
    outputFolder: string,
    options: OutputOptions,
    startTime: number
  ): Promise<Result<ProcessingResult>> {
    if (options.format !== OutputFormat.PDF) {
      return {
        success: false,
        error: {
          code: ErrorCode.PDF_CONVERT_FAILED,
          message: 'Separate multi-file export is supported for PDF output only.',
          recoverable: false,
        },
      };
    }

    const outputPaths: string[] = [];
    let outputSize = 0;

    try {
      for (let index = 0; index < documents.length; index++) {
        const document = documents[index];
        let workingPath = document.tempPath;
        const tempPathsToClean: string[] = [];

        if (document.type === DocumentType.IMAGE) {
          const imagePdfPath = getTempFilePath(`batch_${document.id}_${Date.now()}.pdf`);
          const mergeResult = await this.pdfService.merge([document.tempPath], imagePdfPath, options.pdfPageSize);
          if (!mergeResult.success) {
            return mergeResult as Result<ProcessingResult>;
          }
          workingPath = imagePdfPath;
          tempPathsToClean.push(imagePdfPath);
        }

        if (options.compress || options.targetSize) {
          const inputSize = await this.getFileSize(workingPath);
          const targetSize = this.getCompressionTargetSize(inputSize, options);
          const compressResult = await this.pdfService.compressFile(workingPath, targetSize);
          if (!compressResult.success) {
            return compressResult as Result<ProcessingResult>;
          }
          workingPath = compressResult.data;
          tempPathsToClean.push(workingPath);
        }

        if (options.protection?.enabled) {
          const protectResult = await this.pdfService.protectFile(
            workingPath,
            options.protection.ownerPassword,
            options.protection.userPassword
          );
          if (!protectResult.success) {
            return protectResult as Result<ProcessingResult>;
          }
          workingPath = protectResult.data;
          tempPathsToClean.push(workingPath);
        }

        const baseName = this.getOutputBaseName(document.filename);
        const finalPath = join(outputFolder, `${baseName}_${index + 1}.pdf`);
        await copyFile(workingPath, finalPath);
        outputPaths.push(finalPath);
        outputSize += await this.getFileSize(finalPath);

        for (const tempPath of tempPathsToClean) {
          if (tempPath !== document.tempPath) {
            await unlink(tempPath).catch(() => {});
          }
        }
      }

      await this.addRecentFile({
        filename: basename(outputFolder),
        path: outputFolder,
        timestamp: Date.now(),
        operation: 'export',
      });

      return {
        success: true,
        data: {
          outputPath: outputFolder,
          outputPaths,
          isFolderOutput: true,
          outputSize,
          duration: Date.now() - startTime,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: ErrorCode.UNKNOWN_ERROR,
          message: 'Failed to export separate PDF files',
          detail: error instanceof Error ? error.message : 'Unknown error',
          recoverable: true,
        },
      };
    }
  }

  private async convertImageFile(
    inputPath: string,
    outputPath: string,
    format: OutputFormat
  ): Promise<void> {
    const image = sharp(inputPath);

    if (format === OutputFormat.JPEG) {
      await image.jpeg({ quality: 92, mozjpeg: true }).toFile(outputPath);
    } else if (format === OutputFormat.PNG) {
      await image.png({ compressionLevel: 9 }).toFile(outputPath);
    } else if (format === OutputFormat.TIFF) {
      await image.tiff({ quality: 90, compression: 'jpeg' }).toFile(outputPath);
    } else {
      throw new Error(`Unsupported image output format: ${format}`);
    }
  }

  private isSupportedInput(document: DocumentItem): boolean {
    return document.type === DocumentType.PDF || document.type === DocumentType.IMAGE;
  }

  private getOutputBaseName(filename: string): string {
    const withoutExtension = filename.slice(0, filename.length - extname(filename).length) || filename;
    const sanitized = sanitizeFilename(withoutExtension).replace(/\.+$/g, '').trim();
    return sanitized || 'DocuFlow_Output';
  }

  private async getFileSize(filePath: string): Promise<number> {
    try {
      const stats = await stat(filePath);
      return stats.size;
    } catch {
      return 0;
    }
  }

  private getCompressionTargetSize(inputSize: number, options: OutputOptions): number | undefined {
    if (options.targetSize) {
      return options.targetSize;
    }

    if (!options.compressionLevel || inputSize <= 0) {
      return undefined;
    }

    const ratio = options.compressionLevel === 'low' ? 0.8
      : options.compressionLevel === 'medium' ? 0.5
      : options.compressionLevel === 'high' ? 0.3
      : 0.15;

    return Math.round(inputSize * ratio);
  }

  private async addRecentFile(file: RecentFile): Promise<void> {
    const existing = store.get('recentFiles', []);
    const filtered = existing.filter((f) => f.path !== file.path);
    store.set('recentFiles', [file, ...filtered].slice(0, MAX_RECENT_FILES));
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
   * Iteratively compress and resize the image to fit the target size with 99%+ accuracy.
   */
  private async fitImageToTargetSize(
    inputPath: string,
    targetSize: number,
    format: string
  ): Promise<Buffer> {
    const inputBuffer = await readFile(inputPath);
    const formatUpper = format.toUpperCase() === 'PDF' ? 'JPEG' : format.toUpperCase();

    // 1. Try a high-quality (quality = 90) or standard compression first
    let currentBuffer: Buffer;
    if (formatUpper === 'PNG') {
      currentBuffer = await sharp(inputBuffer).png({ compressionLevel: 9, palette: true }).toBuffer();
    } else if (formatUpper === 'TIFF') {
      currentBuffer = await sharp(inputBuffer).tiff({ quality: 90, compression: 'jpeg' }).toBuffer();
    } else {
      currentBuffer = await sharp(inputBuffer).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
    }

    // If it already fits the target size, we don't need to reduce quality further
    if (currentBuffer.length <= targetSize) {
      return currentBuffer;
    }

    // 2. Binary search on quality (for JPEG / TIFF)
    let bestBuffer = currentBuffer;
    if (formatUpper !== 'PNG') {
      let qMin = 5;
      let qMax = 95;
      
      for (let i = 0; i < 6; i++) {
        const qVal = Math.round((qMin + qMax) / 2);
        let buf: Buffer;
        if (formatUpper === 'TIFF') {
          buf = await sharp(inputBuffer).tiff({ quality: qVal, compression: 'jpeg' }).toBuffer();
        } else {
          buf = await sharp(inputBuffer).jpeg({ quality: qVal, mozjpeg: true }).toBuffer();
        }

        if (buf.length <= targetSize) {
          bestBuffer = buf;
          qMin = qVal + 1; // Try higher quality
        } else {
          qMax = qVal - 1; // Needs more compression
          if (buf.length < bestBuffer.length) {
            bestBuffer = buf;
          }
        }
      }

      currentBuffer = bestBuffer;
      // If we are within target, return it!
      if (currentBuffer.length <= targetSize) {
        return currentBuffer;
      }
    }

    // 3. If target size is still not met (even at quality = 5), or if it is PNG, we must resize (scale down)
    const metadata = await sharp(inputBuffer).metadata();
    const origWidth = metadata.width || 800;

    let sMin = 0.1;
    let sMax = 0.95;
    let bestScale = 1.0;

    for (let i = 0; i < 6; i++) {
      const sVal = (sMin + sMax) / 2;
      const resizedWidth = Math.round(origWidth * sVal);
      let buf: Buffer;

      if (formatUpper === 'PNG') {
        buf = await sharp(inputBuffer)
          .resize({ width: resizedWidth })
          .png({ compressionLevel: 9, palette: true })
          .toBuffer();
      } else if (formatUpper === 'TIFF') {
        buf = await sharp(inputBuffer)
          .resize({ width: resizedWidth })
          .tiff({ quality: 15, compression: 'jpeg' })
          .toBuffer();
      } else {
        buf = await sharp(inputBuffer)
          .resize({ width: resizedWidth })
          .jpeg({ quality: 15, mozjpeg: true })
          .toBuffer();
      }

      if (buf.length <= targetSize) {
        bestScale = sVal;
        bestBuffer = buf;
        sMin = sVal + 0.02; // Try larger resolution
      } else {
        sMax = sVal - 0.02; // Need to shrink more
        if (buf.length < bestBuffer.length) {
          bestScale = sVal;
          bestBuffer = buf;
        }
      }
    }

    // 4. Fine-tune quality for JPEG / TIFF on the best scaled image if it's still slightly over target
    if (formatUpper !== 'PNG' && bestBuffer.length > targetSize) {
      const resizedWidth = Math.round(origWidth * bestScale);
      let qMin = 5;
      let qMax = 30;

      for (let i = 0; i < 4; i++) {
        const qVal = Math.round((qMin + qMax) / 2);
        let buf: Buffer;
        if (formatUpper === 'TIFF') {
          buf = await sharp(inputBuffer).resize({ width: resizedWidth }).tiff({ quality: qVal, compression: 'jpeg' }).toBuffer();
        } else {
          buf = await sharp(inputBuffer).resize({ width: resizedWidth }).jpeg({ quality: qVal, mozjpeg: true }).toBuffer();
        }

        if (buf.length <= targetSize) {
          bestBuffer = buf;
          qMin = qVal + 1;
        } else {
          qMax = qVal - 1;
        }
      }
    }

    return bestBuffer;
  }

  /**
   * Estimate the size of the compressed image dynamically in-memory using binary search.
   */
  async estimateCompressedSize(
    documentId: string,
    targetSize: number,
    format: string
  ): Promise<Result<number>> {
    try {
      const doc = this.fileService.getDocument(documentId);
      if (!doc) {
        return {
          success: false,
          error: {
            code: ErrorCode.UNKNOWN_ERROR,
            message: 'Document not found',
            recoverable: false,
          },
        };
      }

      const compressedBuffer = await this.fitImageToTargetSize(doc.tempPath, targetSize, format);
      return { success: true, data: compressedBuffer.length };
    } catch (error) {
      return {
        success: false,
        error: {
          code: ErrorCode.UNKNOWN_ERROR,
          message: error instanceof Error ? error.message : 'Estimation failed',
          recoverable: true,
        },
      };
    }
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
