/**
 * Application views/screens
 */
export enum AppView {
  HOME = 'HOME',
  DOCUMENT_LIST = 'DOCUMENT_LIST',
  OUTPUT_OPTIONS = 'OUTPUT_OPTIONS',
  PROCESSING = 'PROCESSING',
  SUCCESS = 'SUCCESS',
  PREVIEW = 'PREVIEW',
  PDF_COMPOSE = 'PDF_COMPOSE',
  IMAGE_EDIT = 'IMAGE_EDIT',
  CANVAS_EDITOR = 'CANVAS_EDITOR',
  OCR = 'OCR',
  EXCEL_EDITOR = 'EXCEL_EDITOR',
  SKETCH_EDITOR = 'SKETCH_EDITOR',
}

/**
 * Modal types
 */
export enum ModalType {
  NONE = 'NONE',
  SCANNER = 'SCANNER',
  DOCUMENT_PREVIEW = 'DOCUMENT_PREVIEW',
  ADD_MORE = 'ADD_MORE',
  COMPRESSION_PREVIEW = 'COMPRESSION_PREVIEW',
  ERROR = 'ERROR',
  CONFIRM = 'CONFIRM',
}

/**
 * Workflow types
 */
export enum WorkflowType {
  NONE = 'NONE',
  COMPRESS = 'COMPRESS',
  COMPRESS_IMAGE = 'COMPRESS_IMAGE',
  MERGE = 'MERGE',
  CONVERT = 'CONVERT',
  SPLIT = 'SPLIT',
  PROTECT = 'PROTECT',
  EXCEL_EDIT = 'EXCEL_EDIT',
}

/**
 * Modal state
 */
export interface ModalState {
  type: ModalType;
  data?: unknown;
}

/**
 * UI state
 */
export interface UIState {
  currentView: AppView;
  modal: ModalState;
  sidebarCollapsed: boolean;
  selectedDocumentId?: string;
  isLoading: boolean;
  loadingMessage?: string;
  activeWorkflow: WorkflowType;
  previewBackView?: AppView;
}
