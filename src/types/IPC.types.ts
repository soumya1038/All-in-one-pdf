import { Result } from './Error.types';
import { DocumentItem, DocumentType, RecentFile, PlacedSignature } from './Document.types';
import { ScannerDevice, ScanSettings, ScanResult } from './Scanner.types';
import { OutputOptions, ProcessingResult } from './Output.types';

/**
 * IPC Channel names following docuflow:[noun]:[verb] convention
 */
export enum IpcChannel {
  // File operations
  FILE_UPLOAD = 'docuflow:file:upload',
  FILE_DELETE = 'docuflow:file:delete',
  FILE_VALIDATE = 'docuflow:file:validate',
  FILE_GET_THUMBNAIL = 'docuflow:file:getThumbnail',
  
  // Scanner operations
  SCANNER_LIST = 'docuflow:scanner:list',
  SCANNER_SCAN = 'docuflow:scanner:scan',
  SCANNER_CHECK = 'docuflow:scanner:check',
  
  // PDF operations
  PDF_MERGE = 'docuflow:pdf:merge',
  PDF_COMPRESS = 'docuflow:pdf:compress',
  PDF_CONVERT = 'docuflow:pdf:convert',
  PDF_SPLIT = 'docuflow:pdf:split',
  PDF_PROTECT = 'docuflow:pdf:protect',
  PDF_GET_INFO = 'docuflow:pdf:getInfo',
  PDF_PREVIEW = 'docuflow:pdf:preview',
  
  // Document operations
  DOCUMENT_APPLY_EDIT = 'docuflow:document:applyEdit',
  DOCUMENT_GET_PREVIEW = 'docuflow:document:getPreview',
  DOCUMENT_RENDER_PDF_PAGE = 'docuflow:document:renderPdfPage',
  
  // Output operations
  OUTPUT_PROCESS = 'docuflow:output:process',
  OUTPUT_SAVE = 'docuflow:output:save',
  
  // System operations
  SYSTEM_GET_RECENT = 'docuflow:system:getRecent',
  SYSTEM_ADD_RECENT = 'docuflow:system:addRecent',
  SYSTEM_CLEAR_TEMP = 'docuflow:system:clearTemp',
  SYSTEM_OPEN_FILE = 'docuflow:system:openFile',
  SYSTEM_OPEN_FOLDER = 'docuflow:system:openFolder',
  SYSTEM_SHOW_OPEN_DIALOG = 'docuflow:system:showOpenDialog',
  SYSTEM_PRINT = 'docuflow:system:print',
  SYSTEM_DIALOG_CONFIRM = 'docuflow:system:dialogConfirm',

  // Window controls
  WINDOW_MINIMIZE = 'docuflow:window:minimize',
  WINDOW_MAXIMIZE = 'docuflow:window:maximize',
  WINDOW_CLOSE = 'docuflow:window:close',
}

/**
 * File upload request
 */
export interface FileUploadRequest {
  filePaths: string[];
}

/**
 * File upload response
 */
export interface FileUploadResponse {
  documents: DocumentItem[];
}

/**
 * File validation request
 */
export interface FileValidateRequest {
  filePath: string;
}

/**
 * File validation response
 */
export interface FileValidationResponse {
  valid: boolean;
  type?: DocumentType;
  size?: number;
  reason?: string;
}

/**
 * Scanner list response
 */
export interface ScannerListResponse {
  devices: ScannerDevice[];
}

/**
 * Scanner scan request
 */
export interface ScannerScanRequest {
  deviceId: string;
  settings: ScanSettings;
}

/**
 * PDF merge request
 */
export interface PdfMergeRequest {
  documentIds: string[];
  outputPath: string;
}

/**
 * PDF compress request
 */
export interface PdfCompressRequest {
  documentIds: string[];
  targetSize: number;
}

/**
 * PDF convert request
 */
export interface PdfConvertRequest {
  documentId: string;
  targetFormat: string;
}

/**
 * PDF split request
 */
export interface PdfSplitRequest {
  documentId: string;
  splitPoints: number[];  // Page numbers where to split
}

/**
 * PDF protect request
 */
export interface PdfProtectRequest {
  documentId: string;
  ownerPassword?: string;
  userPassword?: string;
}

/**
 * Output process request
 */
export interface OutputProcessRequest {
  documentIds: string[];
  options: OutputOptions;
}

/**
 * Thumbnail request
 */
export interface ThumbnailRequest {
  documentId: string;
  width?: number;
  height?: number;
}

/**
 * Main IPC API exposed to renderer
 */
export interface IpcApi {
  // File operations
  uploadFiles: (filePaths: string[]) => Promise<Result<DocumentItem[]>>;
  deleteFile: (documentId: string) => Promise<Result<void>>;
  validateFile: (filePath: string) => Promise<Result<FileValidationResponse>>;
  getThumbnail: (documentId: string) => Promise<Result<string>>;
  
  // Scanner operations
  listScanners: () => Promise<Result<ScannerDevice[]>>;
  checkScanner: (deviceId: string) => Promise<Result<boolean>>;
  scan: (deviceId: string, settings: ScanSettings) => Promise<Result<ScanResult>>;
  
  // PDF operations
  mergePdfs: (documentIds: string[], outputPath: string) => Promise<Result<string>>;
  compressPdf: (documentId: string, targetSize: number) => Promise<Result<string>>;
  convertPdf: (documentId: string, targetFormat: string) => Promise<Result<string>>;
  splitPdf: (documentId: string, splitPoints: number[]) => Promise<Result<string[]>>;
  protectPdf: (documentId: string, ownerPassword?: string, userPassword?: string) => Promise<Result<string>>;
  previewPdf: (documentId: string) => Promise<Result<void>>;
  
  // Output operations
  processOutput: (documentIds: string[], options: OutputOptions) => Promise<Result<ProcessingResult>>;
  saveOutput: (outputPath: string) => Promise<Result<void>>;
  
  // Document operations
  applyDocumentEdit: (documentId: string, base64Data: string, cleanBase64Data?: string, signatures?: PlacedSignature[], pageNumber?: number) => Promise<Result<DocumentItem>>;
  renderPdfPage: (documentId: string, pageNumber?: number) => Promise<Result<string>>;
  
  // System operations
  getRecentFiles: () => Promise<Result<RecentFile[]>>;
  addRecentFile: (file: RecentFile) => Promise<Result<void>>;
  clearTemp: () => Promise<Result<void>>;
  openFile: (filePath: string) => Promise<Result<void>>;
  openFolder: (filePath: string) => Promise<Result<void>>;
  showOpenDialog: (options?: any) => Promise<Result<string[]>>;
  printDocument: (documentId: string) => Promise<Result<void>>;
  showConfirmDialog: (message: string, title?: string) => Promise<boolean>;

  // Window controls
  minimizeWindow: () => void;
  maximizeWindow: () => void;
  closeWindow: () => void;
}
