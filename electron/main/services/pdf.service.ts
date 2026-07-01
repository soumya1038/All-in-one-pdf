import { readFile, writeFile, unlink, stat } from 'fs/promises';
import { join, dirname, basename, extname } from 'path';
import { spawn } from 'child_process';
import { PDFDocument } from 'pdf-lib';
import { Result, ErrorCode } from '../../../src/types/Error.types';
import { getTempFilePath } from '../utils/tempDir';
import { createCanvas } from 'canvas';
import pdfjs from 'pdfjs-dist/legacy/build/pdf.js';
import sharp from 'sharp';

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
   * Supports: JPEG, PNG, TIFF, and DOCX.
   */
  async convertFile(
    filePath: string,
    targetFormat: string,
    imageDpi: number = 150,
    outputPath?: string
  ): Promise<Result<string>> {
    const formatUpper = targetFormat.toUpperCase();
    const finalOutputPath = outputPath || getTempFilePath(`converted_${Date.now()}.${formatUpper.toLowerCase()}`);

    try {
      if (['JPEG', 'PNG', 'TIFF'].includes(formatUpper)) {
        return await this.convertPdfToImages(filePath, formatUpper as 'JPEG' | 'PNG' | 'TIFF', imageDpi, finalOutputPath);
      } else if (formatUpper === 'DOCX') {
        return await this.convertPdfToDocx(filePath, finalOutputPath);
      } else {
        return {
          success: false,
          error: {
            code: ErrorCode.PDF_CONVERT_FAILED,
            message: `Unsupported target format: ${targetFormat}`,
            recoverable: false,
          },
        };
      }
    } catch (error) {
      return {
        success: false,
        error: {
          code: ErrorCode.PDF_CONVERT_FAILED,
          message: error instanceof Error ? error.message : 'Unknown conversion error',
          recoverable: true,
        },
      };
    }
  }

  /**
   * Render PDF pages as JPEG/PNG/TIFF images using Node Canvas + Sharp
   */
  private async convertPdfToImages(
    filePath: string,
    targetFormat: 'JPEG' | 'PNG' | 'TIFF',
    dpi: number,
    outputPath: string
  ): Promise<Result<string>> {
    try {
      const pdfBuffer = await readFile(filePath);
      const data = new Uint8Array(pdfBuffer);

      const loadingTask = pdfjs.getDocument({ data });
      const pdf = await loadingTask.promise;
      const totalPages = pdf.numPages;

      const scale = dpi / 72.0;
      const baseDir = dirname(outputPath);
      const ext = extname(outputPath);
      const baseName = basename(outputPath, ext);

      let firstPagePath = '';

      for (let p = 1; p <= totalPages; p++) {
        const page = await pdf.getPage(p);
        const viewport = page.getViewport({ scale });

        const canvas = createCanvas(viewport.width, viewport.height);
        const context = canvas.getContext('2d');

        const renderContext = {
          canvasContext: context as any,
          viewport: viewport,
        };

        await page.render(renderContext).promise;

        let finalPath = '';
        if (totalPages === 1) {
          finalPath = outputPath;
        } else {
          finalPath = join(baseDir, `${baseName}_page_${p}${ext}`);
        }

        if (p === 1) {
          firstPagePath = finalPath;
        }

        let buffer: Buffer;
        if (targetFormat === 'JPEG') {
          buffer = canvas.toBuffer('image/jpeg', { quality: 0.9 });
        } else if (targetFormat === 'PNG') {
          buffer = canvas.toBuffer('image/png');
        } else { // TIFF
          const pngBuffer = canvas.toBuffer('image/png');
          buffer = await sharp(pngBuffer).tiff().toBuffer();
        }

        await writeFile(finalPath, buffer);
      }

      return { success: true, data: firstPagePath };
    } catch (err) {
      console.error('PDF image conversion failed:', err);
      throw err;
    }
  }

  /**
   * Convert PDF to DOCX using Python pdf2docx or fallback text docx generator
   */
  private async convertPdfToDocx(filePath: string, outputPath: string): Promise<Result<string>> {
    const scriptPath = getTempFilePath('_convert_docx_script.py');

    const pyScript = `
import sys
import os
import zipfile

# Try to use pdf2docx for layout preservation
try:
    from pdf2docx import Converter
    use_pdf2docx = True
except ImportError:
    use_pdf2docx = False

pdf_path = sys.argv[1]
docx_path = sys.argv[2]

if use_pdf2docx:
    try:
        cv = Converter(pdf_path)
        cv.convert(docx_path)
        cv.close()
        print("CONVERT_OK")
        sys.exit(0)
    except Exception as e:
        sys.stderr.write("pdf2docx failed: " + str(e) + "\\nFalling back to text extraction...\\n")

# Fallback method: Extract text with pypdf and build a simple DOCX file
try:
    import pypdf
    reader = pypdf.PdfReader(pdf_path)
    paragraphs = []
    for page in reader.pages:
        text = page.extract_text()
        if text:
            paragraphs.extend(text.split('\\n'))
            
    # Escape XML characters
    def escape_xml(s):
        return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
        
    content_types = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:contentTypes="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>"""

    rels = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"""

    doc_body = ""
    for p_text in paragraphs:
        p_text = p_text.strip()
        if p_text:
            doc_body += f"<w:p><w:r><w:t>{escape_xml(p_text)}</w:t></w:r></w:p>"

    document_xml = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    {doc_body}
  </w:body>
</w:document>"""

    with zipfile.ZipFile(docx_path, 'w', zipfile.ZIP_DEFLATED) as docx:
        docx.writestr('[Content_Types].xml', content_types)
        docx.writestr('_rels/.rels', rels)
        docx.writestr('word/document.xml', document_xml)
        
    print("CONVERT_FALLBACK_OK")
except Exception as e:
    sys.stderr.write("Fallback failed: " + str(e) + "\\n")
    sys.exit(1)
`;

    try {
      await writeFile(scriptPath, pyScript, 'utf-8');

      await new Promise<void>((resolve, reject) => {
        const proc = spawn('python', [
          scriptPath,
          filePath,
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
          code: ErrorCode.PDF_CONVERT_FAILED,
          message: isPythonMissing
            ? 'Python is not installed or not in PATH. Please install Python 3.'
            : 'Failed to convert PDF to Word. Ensure Python 3 is installed.',
          detail: errMsg,
          recoverable: true,
        },
      };
    }
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
