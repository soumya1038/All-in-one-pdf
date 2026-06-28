import { readFile, writeFile } from 'fs/promises';
import { PDFDocument } from 'pdf-lib';
import { Result, ErrorCode } from '../../../src/types/Error.types';

/**
 * Service for PDF operations
 * Uses pdf-lib for PDF manipulation
 */
export class PdfService {
  /**
   * Merge multiple PDFs into one
   * @param documentPaths - Array of PDF file paths to merge
   * @param outputPath - Path where merged PDF will be saved
   */
  async merge(documentPaths: string[], outputPath: string): Promise<Result<string>> {
    try {
      if (documentPaths.length === 0) {
        return {
          success: false,
          error: {
            code: ErrorCode.PDF_MERGE_FAILED,
            message: 'No documents provided for merging',
            recoverable: false,
          },
        };
      }

      const hasImages = documentPaths.some((p) => {
        const lower = p.toLowerCase();
        return lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg');
      });

      if (!hasImages) {
        try {
          const { exec } = require('child_process');
          const { promisify } = require('util');
          const execAsync = promisify(exec);

          const escape = (str: string) => str.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
          const outputEscaped = escape(outputPath);
          const inputPathsEscaped = documentPaths.map(p => `'${escape(p)}'`).join(', ');

          const pyCommand = `python -c "from pypdf import PdfWriter; m=PdfWriter(); [m.append(p) for p in [${inputPathsEscaped}]]; m.write('${outputEscaped}'); m.close()"`;
          await execAsync(pyCommand);

          console.log(`Merged ${documentPaths.length} PDFs into: ${outputPath} using Python pypdf`);
          return {
            success: true,
            data: outputPath,
          };
        } catch (pyError) {
          console.warn('Python PDF merge failed, falling back to JS pdf-lib merge:', pyError);
          // Fallback to JS pdf-lib merge
        }
      }

      // Create a new PDF document
      const mergedPdf = await PDFDocument.create();

      // Load and copy pages from each PDF
      for (const pdfPath of documentPaths) {
        try {
          const fileBytes = await readFile(pdfPath);
          const ext = pdfPath.toLowerCase();

          if (ext.endsWith('.png') || ext.endsWith('.jpg') || ext.endsWith('.jpeg')) {
            // Embed image
            const image = ext.endsWith('.png') 
              ? await mergedPdf.embedPng(fileBytes)
              : await mergedPdf.embedJpg(fileBytes);
            
            const { width, height } = image.scale(1);
            const page = mergedPdf.addPage([width, height]);
            page.drawImage(image, {
              x: 0,
              y: 0,
              width,
              height,
            });
          } else {
            // Load as PDF
            const pdf = await PDFDocument.load(fileBytes, { ignoreEncryption: true });
            const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
            
            copiedPages.forEach((page) => {
              mergedPdf.addPage(page);
            });
          }
        } catch (error) {
          console.error(`Failed to process document: ${pdfPath}`, error);
          return {
            success: false,
            error: {
              code: ErrorCode.PDF_MERGE_FAILED,
              message: `Failed to process document: ${pdfPath}`,
              detail: error instanceof Error ? error.message : 'Unknown error',
              recoverable: false,
            },
          };
        }
      }

      // Save merged PDF
      const mergedPdfBytes = await mergedPdf.save();
      await writeFile(outputPath, mergedPdfBytes);

      console.log(`Merged ${documentPaths.length} PDFs into: ${outputPath} using JS pdf-lib`);

      return {
        success: true,
        data: outputPath,
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: ErrorCode.PDF_MERGE_FAILED,
          message: 'Failed to merge PDFs',
          detail: error instanceof Error ? error.message : 'Unknown error',
          recoverable: true,
        },
      };
    }
  }

  /**
   * Get page count from a PDF file
   * @param pdfPath - Path to PDF file
   */
  async getPageCount(pdfPath: string): Promise<Result<number>> {
    try {
      const pdfBytes = await readFile(pdfPath);
      const pdf = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
      const pageCount = pdf.getPageCount();

      return {
        success: true,
        data: pageCount,
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: ErrorCode.FILE_CORRUPTED,
          message: 'Failed to read PDF',
          detail: error instanceof Error ? error.message : 'Unknown error',
          recoverable: false,
        },
      };
    }
  }

  /**
   * Compress PDF by file path
   */
  async compressFile(filePath: string, _targetSize?: number): Promise<Result<string>> {
    try {
      // Basic "compression" by removing metadata and unneeded objects
      const pdfBytes = await readFile(filePath);
      const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
      
      pdfDoc.setTitle('');
      pdfDoc.setAuthor('');
      pdfDoc.setSubject('');
      pdfDoc.setKeywords([]);
      pdfDoc.setProducer('');
      pdfDoc.setCreator('');
      
      const compressedBytes = await pdfDoc.save({ useObjectStreams: true });
      
      const { dirname, basename, extname } = require('path');
      const outputPath = `${dirname(filePath)}/${basename(filePath, extname(filePath))}_compressed.pdf`;
      await writeFile(outputPath, compressedBytes);

      return {
        success: true,
        data: outputPath,
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: ErrorCode.PDF_COMPRESS_FAILED,
          message: 'Failed to compress PDF',
          detail: error instanceof Error ? error.message : 'Unknown error',
          recoverable: true,
        },
      };
    }
  }

  /**
   * Compress PDF to target size (by document ID)
   */
  async compress(documentId: string, targetSize: number): Promise<Result<string>> {
    try {
      const { FileService } = await import('./file.service');
      const fileService = new FileService();
      const doc = fileService.getDocument(documentId);

      if (!doc || doc.type !== 'PDF') {
        return { success: false, error: { code: ErrorCode.FILE_NOT_FOUND, message: 'PDF not found', recoverable: false } };
      }

      return await this.compressFile(doc.tempPath, targetSize);
    } catch (error) {
      return {
        success: false,
        error: {
          code: ErrorCode.PDF_COMPRESS_FAILED,
          message: 'Failed to compress PDF',
          detail: error instanceof Error ? error.message : 'Unknown error',
          recoverable: true,
        },
      };
    }
  }

  /**
   * Convert PDF to another format
   */
  async convert(_documentId: string, targetFormat: string): Promise<Result<string>> {
    try {
      return {
        success: false,
        error: {
          code: ErrorCode.PDF_CONVERT_FAILED,
          message: `Conversion to ${targetFormat} requires Ghostscript or ImageMagick which are not installed`,
          recoverable: false,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: ErrorCode.PDF_CONVERT_FAILED,
          message: 'Failed to convert PDF',
          detail: error instanceof Error ? error.message : 'Unknown error',
          recoverable: true,
        },
      };
    }
  }

  /**
   * Split PDF at specified points
   */
  async split(documentId: string, splitPoints: number[]): Promise<Result<string[]>> {
    try {
      const { FileService } = await import('./file.service');
      const fileService = new FileService();
      const doc = fileService.getDocument(documentId);

      if (!doc || doc.type !== 'PDF') {
        return {
          success: false,
          error: {
            code: ErrorCode.FILE_NOT_FOUND,
            message: 'Original PDF document not found or invalid type',
            recoverable: false,
          },
        };
      }

      const pdfBytes = await readFile(doc.tempPath);
      const originalPdf = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
      const pageCount = originalPdf.getPageCount();

      // Ensure split points are sorted and valid
      const points = [...new Set(splitPoints)]
        .filter((p) => p > 0 && p < pageCount)
        .sort((a, b) => a - b);

      if (points.length === 0) {
        return {
          success: false,
          error: {
            code: ErrorCode.PDF_SPLIT_FAILED,
            message: 'No valid split points provided',
            recoverable: false,
          },
        };
      }

      const outputPaths: string[] = [];
      let startIdx = 0;
      
      const { dirname, basename, extname } = require('path');
      const dir = dirname(doc.tempPath);
      const ext = extname(doc.tempPath);
      const base = basename(doc.tempPath, ext);

      // Create a split point at the end
      const allPoints = [...points, pageCount];

      for (let i = 0; i < allPoints.length; i++) {
        const endIdx = allPoints[i];
        
        const newPdf = await PDFDocument.create();
        const pageIndices = Array.from({ length: endIdx - startIdx }, (_, k) => startIdx + k);
        
        const copiedPages = await newPdf.copyPages(originalPdf, pageIndices);
        copiedPages.forEach((page) => newPdf.addPage(page));

        const newPdfBytes = await newPdf.save();
        const newPath = `${dir}/${base}_part${i + 1}${ext}`;
        await writeFile(newPath, newPdfBytes);
        outputPaths.push(newPath);

        startIdx = endIdx;
      }

      return {
        success: true,
        data: outputPaths,
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: ErrorCode.PDF_SPLIT_FAILED,
          message: 'Failed to split PDF',
          detail: error instanceof Error ? error.message : 'Unknown error',
          recoverable: true,
        },
      };
    }
  }

  /**
   * Protect PDF file by file path
   */
  async protectFile(
    filePath: string,
    ownerPassword?: string,
    userPassword?: string
  ): Promise<Result<string>> {
    try {
      const { dirname, basename, extname } = require('path');
      const dir = dirname(filePath);
      const ext = extname(filePath);
      const base = basename(filePath, ext);
      const outputPath = `${dir}/${base}_protected.pdf`;

      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);

      const userPass = userPassword || '';
      const ownerPass = ownerPassword || '';

      // Escape quotes and backslashes for Python execution
      const escape = (str: string) => str.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      const inputEscaped = escape(filePath);
      const outputEscaped = escape(outputPath);
      const userPassEscaped = escape(userPass);
      const ownerPassEscaped = escape(ownerPass);

      const pyCommand = `python -c "from pypdf import PdfReader, PdfWriter; r=PdfReader('${inputEscaped}'); w=PdfWriter(); w.append(r); w.encrypt(user_password='${userPassEscaped}', owner_password='${ownerPassEscaped}'); w.write(open('${outputEscaped}', 'wb'))"`;

      await execAsync(pyCommand);

      return {
        success: true,
        data: outputPath,
      };
    } catch (error) {
      console.error('Failed to protect PDF:', error);
      return {
        success: false,
        error: {
          code: ErrorCode.PDF_PROTECT_FAILED,
          message: 'Failed to protect PDF',
          detail: error instanceof Error ? error.message : 'Unknown error',
          recoverable: true,
        },
      };
    }
  }

  /**
   * Protect PDF with password (by document ID)
   */
  async protect(
    documentId: string,
    ownerPassword?: string,
    userPassword?: string
  ): Promise<Result<string>> {
    try {
      const { FileService } = await import('./file.service');
      const fileService = new FileService();
      const doc = fileService.getDocument(documentId);

      if (!doc || doc.type !== 'PDF') {
        return {
          success: false,
          error: {
            code: ErrorCode.FILE_NOT_FOUND,
            message: 'PDF not found',
            recoverable: false,
          },
        };
      }

      return await this.protectFile(doc.tempPath, ownerPassword, userPassword);
    } catch (error) {
      return {
        success: false,
        error: {
          code: ErrorCode.PDF_PROTECT_FAILED,
          message: 'Failed to protect PDF',
          detail: error instanceof Error ? error.message : 'Unknown error',
          recoverable: true,
        },
      };
    }
  }
}
