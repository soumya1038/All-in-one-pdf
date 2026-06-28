/**
 * Output format options
 */
export enum OutputFormat {
  PDF = 'PDF',
  JPEG = 'JPEG',
  PNG = 'PNG',
  TIFF = 'TIFF',
  DOCX = 'DOCX',
}

/**
 * PDF page size options
 */
export enum PdfPageSize {
  A4 = 'A4',
  LETTER = 'LETTER',
  LEGAL = 'LEGAL',
  CUSTOM = 'CUSTOM',
}

/**
 * Image DPI options
 */
export type ImageDpi = 72 | 150 | 300 | 600;

/**
 * PDF protection settings
 */
export interface PdfProtection {
  enabled: boolean;
  ownerPassword?: string;   // Prevents editing
  userPassword?: string;    // Prevents opening
}

/**
 * Output options configuration
 */
export interface OutputOptions {
  filename: string;
  format: OutputFormat;
  targetSize?: number;          // In bytes, optional for compression
  pdfPageSize: PdfPageSize;
  imageDpi: ImageDpi;
  protection: PdfProtection;
  mergeAsSingle: boolean;       // Merge multiple files into one PDF
  splitPoints?: number[];       // Split points (page indices) for splitting
}

/**
 * Processing status
 */
export enum ProcessingStep {
  VALIDATING = 'VALIDATING',
  APPLYING_EDITS = 'APPLYING_EDITS',
  COMPRESSING = 'COMPRESSING',
  CONVERTING = 'CONVERTING',
  MERGING = 'MERGING',
  SAVING = 'SAVING',
  COMPLETE = 'COMPLETE',
  ERROR = 'ERROR',
}

/**
 * Processing status state
 */
export interface ProcessingStatus {
  step: ProcessingStep;
  progress: number;             // 0-100
  currentFile?: string;         // Current file being processed
  totalFiles: number;
  processedFiles: number;
  estimatedTimeRemaining?: number; // Seconds
  error?: string;
}

/**
 * Compression breakdown per document
 */
export interface CompressionBreakdown {
  documentId: string;
  originalSize: number;
  targetSize: number;
  compressionRatio: number;     // 0-1
  quality: 'Good' | 'Fair' | 'Reduced';
  compressibility: number;      // Score 0-1
}

/**
 * Processing result
 */
export interface ProcessingResult {
  outputPath: string;
  outputSize: number;
  duration: number;             // Milliseconds
  compressionBreakdown?: CompressionBreakdown[];
}
