import { FileText, X } from 'lucide-react';
import { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import Sidebar from './Sidebar';
import { useAppStore } from '../../store/appStore';
import { AppView, WorkflowType, ModalType } from '../../types/UI.types';
import { ScannerStatus } from '../../types/Scanner.types';

interface MainLayoutProps {
  children: React.ReactNode;
}

function MainLayout({ children }: MainLayoutProps) {
  const [isMaximized, setIsMaximized] = useState(false);

  const currentView = useAppStore((state) => state.ui.currentView);
  const activeWorkflow = useAppStore((state) => state.ui.activeWorkflow);
  const activeModal = useAppStore((state) => state.ui.modal.type);
  const scannerStatus = useAppStore((state) => state.scannerStatus.status);
  const setActiveWorkflow = useAppStore((state) => state.setActiveWorkflow);

  // Track maximize/restore state for the toggle icon
  useEffect(() => {
    const handleResize = () => {
      // screen.availWidth is a reasonable proxy; Electron's ipc could be more accurate
      // but this avoids an extra IPC round-trip
      setIsMaximized(window.outerWidth >= screen.availWidth && window.outerHeight >= screen.availHeight);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const getActiveFeature = (): { label: string; description: string; isWorkflow: boolean } | null => {
    if (scannerStatus === ScannerStatus.SCANNING || scannerStatus === ScannerStatus.CHECKING || activeModal === ModalType.SCANNER) {
      return { label: 'Scan Document', description: 'Scanner communication & acquisition active', isWorkflow: false };
    }
    if (activeWorkflow === WorkflowType.COMPRESS) {
      return { label: 'Compress PDF', description: 'Optimizing PDF file size and compression ratio', isWorkflow: true };
    }
    if (activeWorkflow === WorkflowType.COMPRESS_IMAGE) {
      return { label: 'Compress Image', description: 'Optimizing image dimensions and quality', isWorkflow: true };
    }
    if (activeWorkflow === WorkflowType.MERGE) {
      return { label: 'Merge PDFs', description: 'Combining multiple files into a single PDF', isWorkflow: true };
    }
    if (activeWorkflow === WorkflowType.CONVERT) {
      return { label: 'Convert Format', description: 'Converting documents between supported formats', isWorkflow: true };
    }
    if (activeWorkflow === WorkflowType.SPLIT) {
      return { label: 'Split PDF', description: 'Separating PDF pages or extracting ranges', isWorkflow: true };
    }
    if (activeWorkflow === WorkflowType.PROTECT) {
      return { label: 'Protect PDF', description: 'Configuring PDF encryption and security permissions', isWorkflow: true };
    }
    if (currentView === AppView.PDF_COMPOSE) {
      return { label: 'PDF Compose', description: 'Composing visual PDF pages and layouts', isWorkflow: false };
    }
    if (currentView === AppView.IMAGE_EDIT) {
      return { label: 'Passport Photo', description: 'Cropping and formatting passport photos', isWorkflow: false };
    }
    if (currentView === AppView.CANVAS_EDITOR) {
      return { label: 'Image Editor', description: 'Advanced image editing, annotations, and filters', isWorkflow: false };
    }
    if (currentView === AppView.OCR) {
      return { label: 'Offline OCR', description: 'Extracting searchable text from images/PDFs', isWorkflow: false };
    }
    if (currentView === AppView.EXCEL_EDITOR || activeWorkflow === WorkflowType.EXCEL_EDIT) {
      return { label: 'Excel Editor', description: 'Viewing and editing spreadsheet documents', isWorkflow: true };
    }
    if (currentView === AppView.SKETCH_EDITOR) {
      return { label: 'Sketch Canvas', description: 'Interactive sketching, drawing, and document annotation', isWorkflow: false };
    }
    return null;
  };

  const activeFeature = getActiveFeature();

  return (
    <div className="h-screen w-screen flex flex-col bg-bg-base overflow-hidden">
      {/* Custom Titlebar */}
      <div className="h-8 bg-bg-surface border-b border-border flex items-center justify-between px-4 select-none drag-region flex-shrink-0">
        <div className="flex items-center gap-3 no-drag">
          <div className="flex items-center gap-2">
            <FileText size={16} className="text-accent" />
            <span className="text-sm font-semibold text-text-primary">DocuFlow</span>
          </div>
          {activeFeature && (
            <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-accent/15 border border-accent/30 text-xs font-semibold text-accent animate-fade-in">
              <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
              <span>Active: {activeFeature.label}</span>
            </div>
          )}
        </div>

        {/* Window controls — must be no-drag so clicks register */}
        <div className="flex items-center no-drag h-full">
          <button
            onClick={() => window.electron.minimizeWindow()}
            className="w-[46px] h-8 flex items-center justify-center hover:bg-bg-sunken transition-fast"
            aria-label="Minimize"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" className="text-text-secondary">
              <line x1="0" y1="5" x2="10" y2="5" stroke="currentColor" strokeWidth="1" />
            </svg>
          </button>
          <button
            onClick={() => { window.electron.maximizeWindow(); setIsMaximized((p) => !p); }}
            className="w-[46px] h-8 flex items-center justify-center hover:bg-bg-sunken transition-fast"
            aria-label={isMaximized ? 'Restore' : 'Maximize'}
          >
            {isMaximized ? (
              <svg width="10" height="10" viewBox="0 0 10 10" className="text-text-secondary">
                <path d="M2.5,1.5 H8.5 V7.5" fill="none" stroke="currentColor" strokeWidth="1" />
                <rect x="1.5" y="2.5" width="6" height="6" fill="none" stroke="currentColor" strokeWidth="1" />
              </svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 10 10" className="text-text-secondary">
                <rect x="1.5" y="1.5" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1" />
              </svg>
            )}
          </button>
          <button
            onClick={() => window.electron.closeWindow()}
            className="w-[46px] h-8 flex items-center justify-center hover:bg-[#E81123] hover:text-white group transition-fast"
            aria-label="Close"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" className="text-text-secondary group-hover:text-white">
              <path d="M1.5,1.5 L8.5,8.5 M8.5,1.5 L1.5,8.5" fill="none" stroke="currentColor" strokeWidth="1" />
            </svg>
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <Sidebar />

        {/* Main content (Right-Hand Side) */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Active workflow / functionality banner on the right-hand side */}
          {activeFeature && activeFeature.isWorkflow && activeWorkflow !== WorkflowType.NONE && (
            <div className="bg-accent/10 border-b border-accent/25 px-5 py-2 flex items-center justify-between text-xs shrink-0 select-none animate-fade-in">
              <div className="flex items-center gap-2.5">
                <span className="flex h-2 w-2 rounded-full bg-accent animate-pulse" />
                <span className="font-bold text-accent tracking-wide uppercase text-[11px]">Active Functionality:</span>
                <span className="font-semibold text-text-primary">{activeFeature.label}</span>
                <span className="text-text-secondary hidden sm:inline">&mdash; {activeFeature.description}</span>
              </div>
              <button
                onClick={() => {
                  setActiveWorkflow(WorkflowType.NONE);
                  toast.success('Exited workflow');
                }}
                className="text-[11px] font-semibold text-accent hover:text-accent-hover bg-accent/15 hover:bg-accent/25 px-2.5 py-1 rounded transition-fast border border-accent/30 flex items-center gap-1"
                title="Exit current workflow mode"
              >
                <X size={12} /> Exit Workflow
              </button>
            </div>
          )}
          <div className="flex-1 overflow-auto flex flex-col min-h-0">{children}</div>
        </div>
      </div>
    </div>
  );
}

export default MainLayout;
