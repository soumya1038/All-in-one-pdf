import { stat } from 'fs/promises';
import { extname } from 'path';
import { ACCEPTED_EXTENSIONS, MAX_FILE_SIZE } from '../../../src/constants/ACCEPTED_TYPES';
import { ErrorCode, Result } from '../../../src/types/Error.types';
import { DocumentType } from '../../../src/types/Document.types';

/**
 * Validate if file exists, is readable, and meets size requirements
 * @param filePath - Path to file to validate
 * @returns Result with validation status
 */
export async function validateFile(
  filePath: string
): Promise<Result<{ type: DocumentType; size: number }>> {
  try {
    // Check if file exists and get stats
    const stats = await stat(filePath);

    // Check if it's a file (not directory)
    if (!stats.isFile()) {
      return {
        success: false,
        error: {
          code: ErrorCode.FILE_NOT_FOUND,
          message: 'Selected item is not a file',
          recoverable: false,
        },
      };
    }

    // Check file size
    if (stats.size === 0) {
      return {
        success: false,
        error: {
          code: ErrorCode.FILE_EMPTY,
          message: 'This file appears to be empty',
          recoverable: false,
        },
      };
    }

    if (stats.size > MAX_FILE_SIZE) {
      return {
        success: false,
        error: {
          code: ErrorCode.FILE_TOO_LARGE,
          message: 'This file is too large. DocuFlow supports files up to 2 GB',
          recoverable: false,
        },
      };
    }

    // Check file extension
    const ext = extname(filePath).toLowerCase();
    if (!ACCEPTED_EXTENSIONS.includes(ext)) {
      return {
        success: false,
        error: {
          code: ErrorCode.FILE_UNSUPPORTED,
          message: `File type "${ext}" is not supported`,
          detail: `Supported types: ${ACCEPTED_EXTENSIONS.join(', ')}`,
          recoverable: false,
        },
      };
    }

    // Determine document type
    const type = getDocumentType(ext);

    return {
      success: true,
      data: {
        type,
        size: stats.size,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: {
        code: ErrorCode.FILE_NOT_FOUND,
        message: 'File could not be accessed',
        detail: error instanceof Error ? error.message : 'Unknown error',
        recoverable: false,
      },
    };
  }
}

/**
 * Get document type from file extension
 * @param ext - File extension (with dot)
 * @returns DocumentType
 */
function getDocumentType(ext: string): DocumentType {
  const extLower = ext.toLowerCase();
  
  if (extLower === '.pdf') return DocumentType.PDF;
  
  if (['.jpg', '.jpeg', '.png', '.bmp', '.tiff', '.tif', '.webp'].includes(extLower)) {
    return DocumentType.IMAGE;
  }
  
  if (['.docx', '.doc'].includes(extLower)) return DocumentType.WORD;
  
  if (['.xlsx', '.xls'].includes(extLower)) return DocumentType.EXCEL;
  
  if (['.pptx', '.ppt'].includes(extLower)) return DocumentType.POWERPOINT;
  
  if (extLower === '.txt') return DocumentType.TEXT;
  
  return DocumentType.PDF; // Default fallback
}
