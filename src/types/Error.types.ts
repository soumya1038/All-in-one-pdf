/**
 * Error codes used throughout the application
 */
export enum ErrorCode {
  // File errors
  FILE_NOT_FOUND = 'FILE_NOT_FOUND',
  FILE_TOO_LARGE = 'FILE_TOO_LARGE',
  FILE_CORRUPTED = 'FILE_CORRUPTED',
  FILE_UNSUPPORTED = 'FILE_UNSUPPORTED',
  FILE_EMPTY = 'FILE_EMPTY',
  FILE_PROTECTED = 'FILE_PROTECTED',
  
  // Scanner errors
  SCANNER_NOT_FOUND = 'SCANNER_NOT_FOUND',
  SCANNER_BUSY = 'SCANNER_BUSY',
  SCANNER_DISCONNECTED = 'SCANNER_DISCONNECTED',
  SCANNER_PAPER_JAM = 'SCANNER_PAPER_JAM',
  SCANNER_EMPTY_FEEDER = 'SCANNER_EMPTY_FEEDER',
  SCANNER_TIMEOUT = 'SCANNER_TIMEOUT',
  SCANNER_BLANK_PAGE = 'SCANNER_BLANK_PAGE',
  
  // PDF operation errors
  PDF_MERGE_FAILED = 'PDF_MERGE_FAILED',
  PDF_COMPRESS_FAILED = 'PDF_COMPRESS_FAILED',
  PDF_CONVERT_FAILED = 'PDF_CONVERT_FAILED',
  PDF_SPLIT_FAILED = 'PDF_SPLIT_FAILED',
  PDF_PROTECT_FAILED = 'PDF_PROTECT_FAILED',
  
  // System errors
  TEMP_DIR_CREATE_FAILED = 'TEMP_DIR_CREATE_FAILED',
  SAVE_FAILED = 'SAVE_FAILED',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

/**
 * Structured error type for all application errors
 */
export interface AppError {
  code: ErrorCode;
  message: string;        // User-facing message
  detail?: string;        // Technical detail for logs
  recoverable: boolean;   // Can the user retry?
}

/**
 * Result type for all async operations
 * Replaces throwing exceptions with explicit success/error handling
 */
export type Result<T> =
  | { success: true; data: T }
  | { success: false; error: AppError };
