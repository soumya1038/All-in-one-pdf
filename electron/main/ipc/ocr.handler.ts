import { ipcMain, app } from 'electron';
import { IpcChannel, OcrRecognizeRequest, OcrRecognizeResultData, OcrRenderPdfRequest, OcrRenderPdfPageItem, OcrWordItem } from '../../../src/types/IPC.types';
import { Result, ErrorCode } from '../../../src/types/Error.types';
import { createWorker } from 'tesseract.js';
import { readFile, copyFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, basename } from 'path';
import sharp from 'sharp';
import { createCanvas } from 'canvas';
import pdfjs from 'pdfjs-dist/legacy/build/pdf.js';

let tessdataDir = '';

/**
 * Initialize tessdata directory and copy pre-packaged traineddata models
 */
async function initTessdataDir(): Promise<string> {
  if (tessdataDir && existsSync(tessdataDir)) {
    return tessdataDir;
  }

  try {
    const userTessdata = join(app.getPath('userData'), 'tessdata');
    if (!existsSync(userTessdata)) {
      await mkdir(userTessdata, { recursive: true });
    }
    tessdataDir = userTessdata;

    // Check project root / app resources for bundled traineddata models
    const candidateDirs = [
      process.cwd(),
      join(__dirname, '..', '..'),
      join(process.resourcesPath || '', 'tessdata'),
      join(process.resourcesPath || '', 'app.asar.unpacked')
    ];

    const bundledModels = ['eng.traineddata', 'ben.traineddata', 'hin.traineddata'];
    for (const model of bundledModels) {
      const destFile = join(userTessdata, model);
      if (!existsSync(destFile)) {
        for (const candidateDir of candidateDirs) {
          const srcFile = join(candidateDir, model);
          if (existsSync(srcFile)) {
            try {
              await copyFile(srcFile, destFile);
              console.log(`[OCR] Copied pre-installed model ${model} to ${destFile}`);
              break;
            } catch (copyErr) {
              console.warn(`[OCR] Failed copying ${model}:`, copyErr);
            }
          }
        }
      }
    }
  } catch (err) {
    console.error('[OCR] Failed to initialize tessdata directory:', err);
    tessdataDir = process.cwd();
  }

  return tessdataDir;
}

/**
 * Register OCR IPC Handlers
 */
export function registerOcrHandlers(): void {
  // Initialize tessdata on handler registration
  initTessdataDir().catch(console.error);

  /**
   * Run 100% Offline Tesseract OCR in Node Main Process
   */
  ipcMain.handle(
    IpcChannel.OCR_RECOGNIZE,
    async (event, request: OcrRecognizeRequest): Promise<Result<OcrRecognizeResultData>> => {
      let worker: any = null;
      try {
        const { imageSource, languages, region } = request;
        if (!imageSource) {
          return {
            success: false,
            error: {
              code: ErrorCode.UNKNOWN_ERROR,
              message: 'No image source provided for OCR',
              recoverable: false
            }
          };
        }

        const cacheDir = await initTessdataDir();

        // 1. Prepare image buffer
        let imageBuffer: Buffer;
        if (imageSource.startsWith('data:')) {
          const base64Data = imageSource.replace(/^data:image\/\w+;base64,/, '');
          imageBuffer = Buffer.from(base64Data, 'base64');
        } else if (existsSync(imageSource)) {
          imageBuffer = await readFile(imageSource);
        } else if (imageSource.startsWith('docuflow:///')) {
          const cleanPath = imageSource.replace('docuflow:///', '');
          imageBuffer = await readFile(decodeURIComponent(cleanPath));
        } else {
          imageBuffer = Buffer.from(imageSource, 'base64');
        }

        // 2. Crop region if requested
        if (region && region.w > 0 && region.h > 0) {
          try {
            const metadata = await sharp(imageBuffer).metadata();
            const imgWidth = metadata.width || 1000;
            const imgHeight = metadata.height || 1000;

            const left = Math.max(0, Math.round((region.x / 100) * imgWidth));
            const top = Math.max(0, Math.round((region.y / 100) * imgHeight));
            const width = Math.min(imgWidth - left, Math.max(10, Math.round((region.w / 100) * imgWidth)));
            const height = Math.min(imgHeight - top, Math.max(10, Math.round((region.h / 100) * imgHeight)));

            imageBuffer = await sharp(imageBuffer)
              .extract({ left, top, width, height })
              .toBuffer();
          } catch (cropErr) {
            console.warn('[OCR] Region crop failed; proceeding with full image:', cropErr);
          }
        }

        // 3. Smart Preprocessing Pipeline for Maximum OCR Accuracy
        let processedBuffer = imageBuffer;
        try {
          const stats = await sharp(imageBuffer).stats();
          const meta = await sharp(imageBuffer).metadata();

          // Calculate average luminance across RGB channels
          const numChannels = Math.min(stats.channels.length, 3);
          let sumMean = 0;
          for (let c = 0; c < numChannels; c++) {
            sumMean += stats.channels[c].mean;
          }
          const avgLuminance = numChannels > 0 ? sumMean / numChannels : 128;
          const isDarkBackground = avgLuminance < 130;
          const shouldInvert = request.invert !== undefined ? request.invert : isDarkBackground;

          let pipeline = sharp(imageBuffer).grayscale();

          // Upscale if text might be small or resolution is moderate
          const currentW = meta.width || 800;
          if (currentW < 1800) {
            const targetW = Math.min(2600, Math.max(1600, Math.round(currentW * 2)));
            pipeline = pipeline.resize({
              width: targetW,
              withoutEnlargement: false,
              kernel: 'lanczos3'
            });
          }

          if (shouldInvert) {
            console.log(`[OCR] Dark background detected (avg luminance: ${Math.round(avgLuminance)}). Inverting colors.`);
            pipeline = pipeline.negate({ alpha: false });
          }

          // Normalize dynamic range and gently sharpen letter boundaries
          pipeline = pipeline.normalize().sharpen({ sigma: 1.2, m1: 1, m2: 2 });
          processedBuffer = await pipeline.toBuffer();
        } catch (prepErr) {
          console.warn('[OCR] Image enhancement pipeline error, using original buffer:', prepErr);
          processedBuffer = imageBuffer;
        }

        // 4. Setup languages
        const selectedLangs = languages && languages.length > 0 ? languages : ['eng'];
        const langStr = selectedLangs.join('+');

        // 5. Create Node-based Tesseract worker
        worker = await createWorker(langStr, 1, {
          cachePath: cacheDir,
          logger: (m: any) => {
            try {
              if (event.sender && !event.sender.isDestroyed()) {
                event.sender.send(IpcChannel.OUTPUT_PROCESS, {
                  type: 'ocr-progress',
                  status: m.status,
                  progress: m.progress || 0
                });
              }
            } catch {
              // ignore IPC send error on destroyed window
            }
          }
        });

        // 6. Set PSM & DPI parameters
        const requestedPsm = request.psm && request.psm !== 'auto' ? request.psm : '3';
        await worker.setParameters({
          tessedit_pageseg_mode: requestedPsm,
          user_defined_dpi: '300'
        });

        // 7. Run Recognition with blocks enabled
        let ocrResult = await worker.recognize(processedBuffer, {}, { text: true, blocks: true });

        // If auto mode and text is sparse or confidence low, try PSM 11 (Sparse Text / Poster)
        if (
          (!request.psm || request.psm === 'auto') &&
          (!ocrResult?.data?.text || ocrResult.data.text.trim().length < 15 || (ocrResult.data.confidence || 0) < 50)
        ) {
          try {
            await worker.setParameters({ tessedit_pageseg_mode: '11' });
            const retryResult = await worker.recognize(processedBuffer, {}, { text: true, blocks: true });
            if (
              retryResult?.data?.text &&
              (retryResult.data.text.trim().length > (ocrResult?.data?.text?.trim()?.length || 0) ||
               (retryResult.data.confidence || 0) > (ocrResult?.data?.confidence || 0))
            ) {
              ocrResult = retryResult;
            }
          } catch (retryErr) {
            console.warn('[OCR] PSM 11 retry skipped:', retryErr);
          }
        }

        const data = ocrResult?.data;

        // 8. Extract Words & Blocks
        const words: OcrWordItem[] = [];
        if (data?.blocks) {
          for (const block of data.blocks) {
            for (const paragraph of (block as any).paragraphs || []) {
              for (const line of (paragraph as any).lines || []) {
                for (const word of (line as any).words || []) {
                  if (word.text && word.text.trim()) {
                    words.push({
                      text: word.text,
                      confidence: Math.round(word.confidence || 0),
                      bbox: word.bbox ? {
                        x0: word.bbox.x0,
                        y0: word.bbox.y0,
                        x1: word.bbox.x1,
                        y1: word.bbox.y1
                      } : undefined
                    });
                  }
                }
              }
            }
          }
        }

        const recognizedText = data?.text || '';
        const confidence = Math.round(data?.confidence || (words.length > 0 ? words.reduce((acc, w) => acc + w.confidence, 0) / words.length : 0));

        await worker.terminate();
        worker = null;

        return {
          success: true,
          data: {
            text: recognizedText,
            confidence,
            words
          }
        };
      } catch (error: any) {
        console.error('[OCR] Execution error:', error);
        if (worker) {
          try {
            await worker.terminate();
          } catch {
            // ignore termination error
          }
        }

        const errorMsg = error?.message || 'OCR recognition failed';
        let friendlyMsg = errorMsg;
        if (errorMsg.includes('Failed to download') || errorMsg.includes('Network') || errorMsg.includes('ENOENT')) {
          friendlyMsg = `Could not load language data (${request.languages?.join(', ') || 'eng'}). Please ensure your internet is connected once to download this language model, or use pre-installed English.`;
        }

        return {
          success: false,
          error: {
            code: ErrorCode.UNKNOWN_ERROR,
            message: friendlyMsg,
            detail: errorMsg,
            recoverable: true
          }
        };
      }
    }
  );

  /**
   * Render all pages of an uploaded PDF into high-resolution images for OCR
   */
  ipcMain.handle(
    IpcChannel.OCR_RENDER_PDF_PAGES,
    async (_, request: OcrRenderPdfRequest): Promise<Result<OcrRenderPdfPageItem[]>> => {
      try {
        const { filePath, base64Data } = request;
        let pdfBuffer: Uint8Array;

        if (filePath && existsSync(filePath)) {
          const fileBytes = await readFile(filePath);
          pdfBuffer = new Uint8Array(fileBytes);
        } else if (base64Data) {
          const raw = base64Data.replace(/^data:application\/pdf;base64,/, '');
          pdfBuffer = new Uint8Array(Buffer.from(raw, 'base64'));
        } else {
          return {
            success: false,
            error: {
              code: ErrorCode.FILE_NOT_FOUND,
              message: 'No PDF file path or data provided',
              recoverable: false
            }
          };
        }

        const loadingTask = pdfjs.getDocument({ data: pdfBuffer });
        const pdf = await loadingTask.promise;
        const totalPages = pdf.numPages;
        const maxPagesToRender = Math.min(totalPages, 50);

        const renderedPages: OcrRenderPdfPageItem[] = [];
        const baseDocName = filePath ? basename(filePath) : 'Document.pdf';

        for (let pageNum = 1; pageNum <= maxPagesToRender; pageNum++) {
          const page = await pdf.getPage(pageNum);
          // Scale 2.0 (~200 DPI) for crisp text recognition
          const viewport = page.getViewport({ scale: 2.0 });

          const canvas = createCanvas(Math.round(viewport.width), Math.round(viewport.height));
          const context = canvas.getContext('2d');

          await page.render({
            canvasContext: context as unknown as CanvasRenderingContext2D,
            viewport
          }).promise;

          const jpegBuf = canvas.toBuffer('image/jpeg', { quality: 0.88 });
          const dataUrl = `data:image/jpeg;base64,${jpegBuf.toString('base64')}`;

          renderedPages.push({
            pageNumber: pageNum,
            name: `${baseDocName} - Page ${pageNum}`,
            dataUrl,
            width: viewport.width,
            height: viewport.height
          });
        }

        return {
          success: true,
          data: renderedPages
        };
      } catch (error: any) {
        console.error('[OCR] Failed to render PDF pages:', error);
        return {
          success: false,
          error: {
            code: ErrorCode.UNKNOWN_ERROR,
            message: 'Failed to convert PDF pages to images for OCR',
            detail: error?.message || 'Unknown error',
            recoverable: true
          }
        };
      }
    }
  );
}
