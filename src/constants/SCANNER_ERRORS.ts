import { ErrorCode } from '../types/Error.types';

/**
 * User-facing error messages for scanner errors
 */
export const SCANNER_ERROR_MESSAGES: Record<ErrorCode, string> = {
  [ErrorCode.SCANNER_NOT_FOUND]: 
    'No scanner detected. Make sure your scanner is connected and drivers are installed.',
  
  [ErrorCode.SCANNER_BUSY]: 
    'Scanner is currently in use by another application. Please close other apps and try again.',
  
  [ErrorCode.SCANNER_DISCONNECTED]: 
    'Scanner disconnected during scan. Please reconnect and try again.',
  
  [ErrorCode.SCANNER_PAPER_JAM]: 
    'Paper jam detected. Please clear the jam and try again.',
  
  [ErrorCode.SCANNER_EMPTY_FEEDER]: 
    'Document feeder is empty. Please load paper and try again.',
  
  [ErrorCode.SCANNER_TIMEOUT]: 
    'Scanner operation timed out. Please check your scanner and try again.',
  
  [ErrorCode.SCANNER_BLANK_PAGE]: 
    'The scanned page appears blank. Do you want to retry?',
  
  // Placeholder for other error codes (not scanner-related)
  [ErrorCode.FILE_NOT_FOUND]: '',
  [ErrorCode.FILE_TOO_LARGE]: '',
  [ErrorCode.FILE_CORRUPTED]: '',
  [ErrorCode.FILE_UNSUPPORTED]: '',
  [ErrorCode.FILE_EMPTY]: '',
  [ErrorCode.FILE_PROTECTED]: '',
  [ErrorCode.PDF_MERGE_FAILED]: '',
  [ErrorCode.PDF_COMPRESS_FAILED]: '',
  [ErrorCode.PDF_CONVERT_FAILED]: '',
  [ErrorCode.PDF_SPLIT_FAILED]: '',
  [ErrorCode.PDF_PROTECT_FAILED]: '',
  [ErrorCode.TEMP_DIR_CREATE_FAILED]: '',
  [ErrorCode.SAVE_FAILED]: '',
  [ErrorCode.PERMISSION_DENIED]: '',
  [ErrorCode.UNKNOWN_ERROR]: '',
};

/**
 * Scanner timeout duration in milliseconds
 */
export const SCANNER_TIMEOUT_MS = 60000; // 60 seconds

/**
 * Blank page detection threshold (percentage of white pixels)
 */
export const BLANK_PAGE_THRESHOLD = 0.95; // 95%
