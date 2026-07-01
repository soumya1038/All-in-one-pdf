/**
 * Document file types accepted by the application
 */
export enum DocumentType {
  PDF = 'PDF',
  IMAGE = 'IMAGE',
  WORD = 'WORD',
  EXCEL = 'EXCEL',
  POWERPOINT = 'POWERPOINT',
  TEXT = 'TEXT',
}

/**
 * Document edit operations applied to a document
 */
export interface DocumentEdit {
  type: 'crop' | 'rotate' | 'filter' | 'signature' | 'annotate';
  data: unknown; // Specific to each edit type
}

/**
 * Core document item in the application session
 */
export interface PlacedSignature {
  id: string;
  x: number;      // percentage (0-100)
  y: number;      // percentage (0-100)
  width: number;  // percentage (0-100)
  height: number; // percentage (0-100)
  imgSrc: string; // Base64 image data URL
  page: number;   // 1-indexed page number
}

export interface DocumentItem {
  id: string;                    // UUID
  filename: string;              // Original filename
  type: DocumentType;            // File type
  size: number;                  // File size in bytes
  pageCount: number;             // Number of pages (1 for images)
  thumbnailPath?: string;        // Path to generated thumbnail
  tempPath: string;              // Path to temp working copy
  originalPath: string;          // Original upload path (never modified)
  edits: DocumentEdit[];         // Applied edits
  createdAt: number;             // Timestamp
  cleanTempPaths?: Record<number, string>; // Maps page number (1-indexed) to temp clean image path
  signatures?: PlacedSignature[]; // Persisted signature coordinates and images
}

/**
 * Filter options for image/PDF enhancement
 */
export interface FilterOptions {
  brightness?: number;   // -100 to 100
  contrast?: number;     // -100 to 100
  sharpen?: boolean;
  grayscale?: boolean;
  blackAndWhite?: boolean;
}

/**
 * Crop selection rectangle
 */
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Rotation angle
 */
export type RotationAngle = 0 | 90 | 180 | 270;

/**
 * Signature data
 */
export interface SignatureData {
  type: 'draw' | 'image';
  data: string;          // Base64 encoded image or SVG path
  position: { x: number; y: number };
  size: { width: number; height: number };
}

/**
 * Text annotation
 */
export interface TextAnnotation {
  text: string;
  position: { x: number; y: number };
  fontSize: number;
  color: string;
}

/**
 * Recent file entry (persisted locally)
 */
export interface RecentFile {
  filename: string;
  path: string;
  timestamp: number;
  operation: string;  // 'merge', 'compress', 'convert', etc.
}
