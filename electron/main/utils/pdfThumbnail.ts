import { readFile, writeFile } from 'fs/promises';
import { createCanvas } from 'canvas';
import pdfjs from 'pdfjs-dist/legacy/build/pdf.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// Configure pdfjs to work in Node.js environment
// @ts-ignore - pdfjs types don't include GlobalWorkerOptions
if (pdfjs && pdfjs.GlobalWorkerOptions) {
  pdfjs.GlobalWorkerOptions.workerSrc = require.resolve('pdfjs-dist/legacy/build/pdf.worker.js');
}

/**
 * Generate a thumbnail from the first page of a PDF
 * @param pdfPath - Path to PDF file
 * @param thumbnailPath - Output path for thumbnail
 * @param width - Thumbnail width (default 120)
 * @param height - Thumbnail height (default 160)
 */
export async function generatePdfThumbnail(
  pdfPath: string,
  thumbnailPath: string,
  width: number = 120,
  height: number = 160
): Promise<void> {
  try {
    // Read PDF file
    const pdfBuffer = await readFile(pdfPath);
    const data = new Uint8Array(pdfBuffer);

    // Load PDF document
    const loadingTask = pdfjs.getDocument({ data });
    const pdf = await loadingTask.promise;

    // Get first page
    const page = await pdf.getPage(1);

    // Calculate scale to fit thumbnail size
    const viewport = page.getViewport({ scale: 1.0 });
    const scale = Math.min(width / viewport.width, height / viewport.height);
    const scaledViewport = page.getViewport({ scale });

    // Create canvas
    const canvas = createCanvas(scaledViewport.width, scaledViewport.height);
    const context = canvas.getContext('2d');

    // Render PDF page to canvas
    const renderContext = {
      canvasContext: context as any,
      viewport: scaledViewport,
    };

    await page.render(renderContext).promise;

    // Save canvas as JPEG
    const buffer = canvas.toBuffer('image/jpeg', { quality: 0.8 });
    await writeFile(thumbnailPath, buffer);

    console.log(`Generated PDF thumbnail: ${thumbnailPath}`);
  } catch (error) {
    console.error('Failed to generate PDF thumbnail:', error);
    throw error;
  }
}
