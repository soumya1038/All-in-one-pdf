/**
 * Accepted file extensions and their MIME types
 */
export const ACCEPTED_TYPES = {
  // PDF
  '.pdf': 'application/pdf',
  
  // Images
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.bmp': 'image/bmp',
  '.tiff': 'image/tiff',
  '.tif': 'image/tiff',
  '.webp': 'image/webp',
  
  // Documents
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/msword',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.txt': 'text/plain',
} as const;

/**
 * Get all accepted extensions as array
 */
export const ACCEPTED_EXTENSIONS = Object.keys(ACCEPTED_TYPES);

/**
 * Maximum file size (2GB)
 */
export const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024;

/**
 * Maximum total session size (500MB warning threshold)
 */
export const MAX_SESSION_SIZE_WARNING = 500 * 1024 * 1024;

/**
 * File type to DocumentType mapping
 */
export const FILE_TYPE_MAP = {
  pdf: 'PDF',
  jpg: 'IMAGE',
  jpeg: 'IMAGE',
  png: 'IMAGE',
  bmp: 'IMAGE',
  tiff: 'IMAGE',
  tif: 'IMAGE',
  webp: 'IMAGE',
  docx: 'WORD',
  doc: 'WORD',
  xlsx: 'EXCEL',
  xls: 'EXCEL',
  pptx: 'POWERPOINT',
  ppt: 'POWERPOINT',
  txt: 'TEXT',
} as const;
