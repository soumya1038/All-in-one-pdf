import { readFile, writeFile, unlink, stat } from 'fs/promises';
import { join, dirname, basename, extname } from 'path';
import { spawn } from 'child_process';
import { PDFDocument } from 'pdf-lib';
import { Result, ErrorCode } from '../../../src/types/Error.types';
import { getTempFilePath } from '../utils/tempDir';

/**
 * Service for PDF operations.
 * All public methods accept FILE PATHS, not document IDs.
 * Document ID → path resolution happens in the IPC handlers (pdf.handler.ts)
 * so this service has no dependency on FileService, avoiding a circular import.
 */
export class PdfService {
  /**
   * Merge multiple PDFs / images into one PDF at outputPath
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

      const mergedPdf = await PDFDocument.create();

      for (const pdfPath of documentPaths) {
        try {
          const fileBytes = await readFile(pdfPath);
          const ext = pdfPath.toLowerCase();

          if (ext.endsWith('.png') || ext.endsWith('.jpg') || ext.endsWith('.jpeg')) {
            const image = ext.endsWith('.png')
              ? await mergedPdf.embedPng(fileBytes)
              : await mergedPdf.embedJpg(fileBytes);

            const { width, height } = image.scale(1);
            const page = mergedPdf.addPage([width, height]);
            page.drawImage(image, { x: 0, y: 0, width, height });
          } else {
            const pdf = await PDFDocument.load(fileBytes, { ignoreEncryption: true });
            const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
            copiedPages.forEach((page) => mergedPdf.addPage(page));
          }
        } catch (error) {
          return {
            success: false,
            error: {
              code: ErrorCode.PDF_MERGE_FAILED,
              message: `Failed to process document: ${pdfPath.split(/[\\/]/).pop()}`,
              detail: error instanceof Error ? error.message : 'Unknown error',
              recoverable: false,
            },
          };
        }
      }

      const mergedPdfBytes = await mergedPdf.save({ useObjectStreams: true });
      await writeFile(outputPath, mergedPdfBytes);

      console.log(`Merged ${documentPaths.length} documents into: ${outputPath}`);
      return { success: true, data: outputPath };
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
   * Get page count from a PDF file path
   */
  async getPageCount(pdfPath: string): Promise<Result<number>> {
    try {
      const pdfBytes = await readFile(pdfPath);
      const pdf = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
      return { success: true, data: pdf.getPageCount() };
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
   * Compress a PDF file using Python + pypdf.
   * Compresses content streams and uses Pillow (if available/installed automatically)
   * to re-compress images to a target quality.
   */
  async compressFile(filePath: string, targetSize?: number): Promise<Result<string>> {
    const dir = dirname(filePath);
    const ext = extname(filePath);
    const base = basename(filePath, ext);
    const outputPath = join(dir, `${base}_compressed.pdf`);
    const scriptPath = getTempFilePath('_compress_script.py');

    try {
      // 1. Get original file size
      let origSize = 0;
      try {
        const stats = await stat(filePath);
        origSize = stats.size;
      } catch (err) {
        // Fallback
      }

      // 2. Calculate target quality (15-80)
      let quality = 50; // Default quality
      if (targetSize && origSize > 0) {
        const ratio = targetSize / origSize;
        if (ratio >= 0.9) quality = 80;
        else if (ratio >= 0.7) quality = 65;
        else if (ratio >= 0.5) quality = 50;
        else if (ratio >= 0.3) quality = 30;
        else quality = 15;
      }

      const pyScript = `
import sys
import os
import io

# Try importing PIL/Pillow. If not found, attempt automatic installation.
try:
    import PIL
    from PIL import Image
except ImportError:
    import subprocess
    try:
        subprocess.check_call([sys.executable, "-m", "pip", "install", "Pillow"])
        from PIL import Image
    except Exception as e:
        print("Failed to auto-install Pillow:", e, file=sys.stderr)

from pypdf import PdfReader, PdfWriter

def compress_pdf(input_path, output_path, target_quality=50):
    reader = PdfReader(input_path)
    writer = PdfWriter()

    for page in reader.pages:
        writer.add_page(page)

    # Compress content streams
    for page in writer.pages:
        try:
            page.compress_content_streams()
        except Exception:
            pass

    # Compress images if Pillow is available
    if "PIL" in sys.modules:
        for page in writer.pages:
            try:
                img_keys = list(page.images.keys())
            except Exception:
                img_keys = []
            
            for key in img_keys:
                try:
                    img_file = page.images[key]
                    if img_file.data:
                        img = Image.open(io.BytesIO(img_file.data))
                        
                        # Convert to RGB (JPEG does not support transparency/alpha)
                        if img.mode in ('RGBA', 'LA') or (img.mode == 'P' and 'transparency' in img.info):
                            bg = Image.new('RGB', img.size, (255, 255, 255))
                            if img.mode == 'RGBA':
                                bg.paste(img, mask=img.split()[3])
                            else:
                                bg.paste(img.convert('RGBA'), mask=img.convert('RGBA').split()[3])
                            img = bg
                        elif img.mode != 'RGB':
                            img = img.convert('RGB')
                        
                        # Save with target quality
                        out_bytes = io.BytesIO()
                        img.save(out_bytes, format='JPEG', quality=target_quality, optimize=True)
                        page.images[key].replace(img, quality=target_quality)
                except Exception as ex:
                    print(f"Skipped image {key}: {ex}", file=sys.stderr)

    with open(output_path, "wb") as f:
        writer.write(f)

if __name__ == '__main__':
    compress_pdf(sys.argv[1], sys.argv[2], int(sys.argv[3]))
    print("SUCCESS")
`;

      await writeFile(scriptPath, pyScript, 'utf-8');

      await new Promise<void>((resolve, reject) => {
        const proc = spawn('python', [
          scriptPath,
          filePath,
          outputPath,
          quality.toString(),
        ]);

        let stderr = '';
        proc.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });
        proc.on('close', (code: number) => {
          if (code === 0) resolve();
          else reject(new Error(stderr || `Python exited with code ${code}`));
        });
        proc.on('error', (err: Error) => reject(err));
      });

      await unlink(scriptPath).catch(() => {});

      // Verify and log sizes
      try {
        const newStats = await stat(outputPath);
        const reduction = origSize > 0 ? (((origSize - newStats.size) / origSize) * 100).toFixed(1) : '0';
        console.log(`Compressed PDF: ${origSize} → ${newStats.size} bytes (${reduction}% reduction, quality: ${quality})`);
      } catch (err) {
        // Ignore stats errors
      }

      return { success: true, data: outputPath };
    } catch (error) {
      await unlink(scriptPath).catch(() => {});
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      const isPythonMissing = errMsg.includes('ENOENT') || errMsg.includes('not found');

      return {
        success: false,
        error: {
          code: ErrorCode.PDF_COMPRESS_FAILED,
          message: isPythonMissing
            ? 'Python is not installed or not in PATH. Please install Python 3.'
            : 'Failed to compress PDF. Ensure pypdf is installed.',
          detail: errMsg,
          recoverable: true,
        },
      };
    }
  }

  /**
   * Convert PDF to another format.
   * NOTE: Requires Ghostscript or LibreOffice (not bundled).
   */
  async convertFile(_filePath: string, targetFormat: string): Promise<Result<string>> {
    return {
      success: false,
      error: {
        code: ErrorCode.PDF_CONVERT_FAILED,
        message: `Conversion to ${targetFormat} is not supported in this version. PDF-to-image or PDF-to-Word conversion requires Ghostscript or LibreOffice to be installed separately.`,
        recoverable: false,
      },
    };
  }

  /**
   * Split a PDF file at specified page-boundary points.
   * splitPoints: array of page numbers at which a new part begins
   * (e.g., [3] splits pages 1-2 into part1, pages 3-N into part2).
   * Returns an array of temp file paths for each part.
   */
  async splitFile(filePath: string, splitPoints: number[]): Promise<Result<string[]>> {
    try {
      const pdfBytes = await readFile(filePath);
      const originalPdf = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
      const pageCount = originalPdf.getPageCount();

      const points = [...new Set(splitPoints)]
        .filter((p) => p > 0 && p < pageCount)
        .sort((a, b) => a - b);

      if (points.length === 0) {
        return {
          success: false,
          error: {
            code: ErrorCode.PDF_SPLIT_FAILED,
            message: 'No valid split points provided. Page numbers must be between 1 and ' + (pageCount - 1),
            recoverable: false,
          },
        };
      }

      const dir = dirname(filePath);
      const ext = extname(filePath);
      const base = basename(filePath, ext);

      const allPoints = [...points, pageCount]; // include end sentinel
      const outputPaths: string[] = [];
      let startIdx = 0;

      for (let i = 0; i < allPoints.length; i++) {
        const endIdx = allPoints[i];
        const newPdf = await PDFDocument.create();
        const pageIndices = Array.from({ length: endIdx - startIdx }, (_, k) => startIdx + k);

        const copiedPages = await newPdf.copyPages(originalPdf, pageIndices);
        copiedPages.forEach((page) => newPdf.addPage(page));

        const newPdfBytes = await newPdf.save({ useObjectStreams: true });
        const newPath = join(dir, `${base}_part${i + 1}${ext}`);
        await writeFile(newPath, newPdfBytes);
        outputPaths.push(newPath);

        startIdx = endIdx;
      }

      console.log(`Split into ${outputPaths.length} parts`);
      return { success: true, data: outputPaths };
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
   * Protect a PDF with owner/user passwords using Python + pypdf.
   * Paths are passed as CLI argv to avoid Windows backslash shell-escaping issues.
   */
  async protectFile(
    filePath: string,
    ownerPassword?: string,
    userPassword?: string
  ): Promise<Result<string>> {
    const dir = dirname(filePath);
    const ext = extname(filePath);
    const base = basename(filePath, ext);
    const outputPath = join(dir, `${base}_protected.pdf`);
    const scriptPath = getTempFilePath('_protect_script.py');

    const pyScript = `
import sys
from pypdf import PdfReader, PdfWriter
reader = PdfReader(sys.argv[1])
writer = PdfWriter()
writer.append(reader)
owner_pass = sys.argv[2] if sys.argv[2] != '__NONE__' else ''
user_pass  = sys.argv[3] if sys.argv[3] != '__NONE__' else ''
writer.encrypt(user_password=user_pass, owner_password=owner_pass)
with open(sys.argv[4], 'wb') as fout:
    writer.write(fout)
print('OK')
`;

    try {
      await writeFile(scriptPath, pyScript, 'utf-8');

      await new Promise<void>((resolve, reject) => {
        const proc = spawn('python', [
          scriptPath,
          filePath,
          ownerPassword || '__NONE__',
          userPassword || '__NONE__',
          outputPath,
        ]);

        let stderr = '';
        proc.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });
        proc.on('close', (code: number) => {
          if (code === 0) resolve();
          else reject(new Error(stderr || `Python exited with code ${code}`));
        });
        proc.on('error', (err: Error) => reject(err));
      });

      await unlink(scriptPath).catch(() => {});
      return { success: true, data: outputPath };
    } catch (error) {
      await unlink(scriptPath).catch(() => {});

      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      const isPythonMissing = errMsg.includes('ENOENT') || errMsg.includes('not found');

      return {
        success: false,
        error: {
          code: ErrorCode.PDF_PROTECT_FAILED,
          message: isPythonMissing
            ? 'Python is not installed or not in PATH. Please install Python 3 and run: pip install pypdf'
            : 'Failed to protect PDF. Ensure Python 3 and pypdf are installed (pip install pypdf).',
          detail: errMsg,
          recoverable: true,
        },
      };
    }
  }
}
