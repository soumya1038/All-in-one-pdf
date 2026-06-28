import { create } from 'zustand';
import { DocumentItem, RecentFile } from '../types/Document.types';
import { OutputOptions, ProcessingStatus, OutputFormat, PdfPageSize } from '../types/Output.types';
import { ScannerState, ScannerStatus, ScanColorMode, ScanPaperSize } from '../types/Scanner.types';
import { UIState, AppView, ModalType, WorkflowType } from '../types/UI.types';

/**
 * Main application state interface
 */
interface AppState {
  // Document state
  documents: DocumentItem[];
  addDocument: (document: DocumentItem) => void;
  addDocuments: (documents: DocumentItem[]) => void;
  removeDocument: (id: string) => void;
  updateDocument: (id: string, updates: Partial<DocumentItem>) => void;
  reorderDocuments: (startIndex: number, endIndex: number) => void;
  clearDocuments: () => void;

  // Output options
  outputOptions: OutputOptions;
  updateOutputOptions: (updates: Partial<OutputOptions>) => void;

  // Processing status
  processingStatus: ProcessingStatus | null;
  setProcessingStatus: (status: ProcessingStatus | null) => void;

  // Scanner state
  scannerStatus: ScannerState;
  setScannerStatus: (updates: Partial<ScannerState>) => void;

  // Recent files
  recentFiles: RecentFile[];
  setRecentFiles: (files: RecentFile[]) => void;
  addRecentFile: (file: RecentFile) => void;

  // UI state
  ui: UIState;
  setView: (view: AppView) => void;
  openModal: (type: ModalType, data?: unknown) => void;
  closeModal: () => void;
  setLoading: (isLoading: boolean, message?: string) => void;
  setSelectedDocument: (id?: string) => void;
  setActiveWorkflow: (workflow: WorkflowType) => void;
}

/**
 * Default output options
 */
const defaultOutputOptions: OutputOptions = {
  filename: `DocuFlow_Output_${new Date().toISOString().split('T')[0]}`,
  format: OutputFormat.PDF,
  targetSize: undefined,
  pdfPageSize: PdfPageSize.A4,
  imageDpi: 300,
  protection: {
    enabled: false,
  },
  mergeAsSingle: true,
};

/**
 * Default scanner state
 */
const defaultScannerState: ScannerState = {
  status: ScannerStatus.IDLE,
  devices: [],
  settings: {
    resolution: 300,
    colorMode: ScanColorMode.COLOR,
    paperSize: ScanPaperSize.A4,
  },
};

/**
 * Default UI state
 */
const defaultUIState: UIState = {
  currentView: AppView.HOME,
  modal: {
    type: ModalType.NONE,
  },
  sidebarCollapsed: false,
  isLoading: false,
  activeWorkflow: WorkflowType.NONE,
};

/**
 * Main application store
 */
export const useAppStore = create<AppState>((set) => ({
  // Document state
  documents: [],
  
  addDocument: (document) =>
    set((state) => ({
      documents: [...state.documents, document],
    })),

  addDocuments: (documents) =>
    set((state) => ({
      documents: [...state.documents, ...documents],
    })),

  removeDocument: (id) =>
    set((state) => ({
      documents: state.documents.filter((doc) => doc.id !== id),
    })),

  updateDocument: (id, updates) =>
    set((state) => ({
      documents: state.documents.map((doc) =>
        doc.id === id ? { ...doc, ...updates } : doc
      ),
    })),

  reorderDocuments: (startIndex, endIndex) =>
    set((state) => {
      const result = Array.from(state.documents);
      const [removed] = result.splice(startIndex, 1);
      result.splice(endIndex, 0, removed);
      return { documents: result };
    }),

  clearDocuments: () =>
    set((state) => ({
      documents: [],
      ui: { ...state.ui, activeWorkflow: WorkflowType.NONE },
    })),

  // Output options
  outputOptions: defaultOutputOptions,

  updateOutputOptions: (updates) =>
    set((state) => ({
      outputOptions: { ...state.outputOptions, ...updates },
    })),

  // Processing status
  processingStatus: null,

  setProcessingStatus: (status) =>
    set({ processingStatus: status }),

  // Scanner state
  scannerStatus: defaultScannerState,

  setScannerStatus: (updates) =>
    set((state) => ({
      scannerStatus: { ...state.scannerStatus, ...updates },
    })),

  // Recent files
  recentFiles: [],

  setRecentFiles: (files) => set({ recentFiles: files }),

  addRecentFile: (file) =>
    set((state) => ({
      recentFiles: [file, ...state.recentFiles].slice(0, 5), // Keep last 5
    })),

  // UI state
  ui: defaultUIState,

  setView: (view) =>
    set((state) => ({
      ui: { ...state.ui, currentView: view },
    })),

  openModal: (type, data) =>
    set((state) => ({
      ui: { ...state.ui, modal: { type, data } },
    })),

  closeModal: () =>
    set((state) => ({
      ui: { ...state.ui, modal: { type: ModalType.NONE } },
    })),

  setLoading: (isLoading, message) =>
    set((state) => ({
      ui: { ...state.ui, isLoading, loadingMessage: message },
    })),

  setSelectedDocument: (id) =>
    set((state) => ({
      ui: { ...state.ui, selectedDocumentId: id },
    })),

  setActiveWorkflow: (workflow) =>
    set((state) => ({
      ui: { ...state.ui, activeWorkflow: workflow },
    })),
}));
